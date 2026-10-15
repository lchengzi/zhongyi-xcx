import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CatalogRepository } from '../server/database.js';
import { openConfiguredStore } from '../server/store-config.js';
import { PhotoProfessionalRepository } from '../server/photo-professional.js';
import { photoProfessionalDigest } from '../server/photo-professional-policy.js';
import { photoProfessionalFrom } from '../server/photo-professional-values.js';
import { validateSnapshot, snapshotDigest } from '../server/migration-snapshot.js';
import { encryptBackup, decryptBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { migrationFixture, removeEmptyPhotoProfessional, fileDigest } from './migration-fixture.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { preparePhotoProfessional, registerPhotoProfessionalTests } from './photo-professional-fixture.js';
import { notePhoto } from './photo-note-fixture.js';
import { rightsCode } from './photo-rights-fixture.js';
import { credentialInput } from './professional-fixture.js';
import { rightsInput } from './photo-rights-fixture.js';
import { noteInput } from './photo-note-fixture.js';

registerPhotoProfessionalTests('SQLite professional images', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }), two = new CatalogRepository(f.filename, f.seed);
  return { stores, second: new PhotoProfessionalRepository(two.db), close: async () => { two.close(); await stores.close(); f.dispose(); } };
});
test('SQLite full professional history retains the other profession outside50 display rows and rejects a rehashed truncated snapshot', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  try {
    const p = await preparePhotoProfessional(stores), first = await stores.photoProfessional.review(p.photo, await p.input('pharmacist'), p.authority('pharmacist'));
    for (let index = 0; index < 26; index++) {
      await stores.photoProfessional.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician'));
      await stores.photoProfessional.review(p.photo, await p.input('tcm_physician', 'revoke'), p.authority('tcm_physician'));
    }
    const detail = await stores.photoProfessional.detail(p.photo); assert.equal(detail.version, 53); assert.equal(detail.history.length, 50);
    assert(!detail.history.some(item => item.version === 1)); assert.deepEqual(detail.latestReviews.find(item => item.profession === 'pharmacist'), first);
    const snapshot = f.read(); assert.equal(snapshot.tables.photo_professional_reviews.length, 53);
    snapshot.tables.photo_professional_reviews.shift(); const { digest: old, ...payload } = snapshot; snapshot.digest = snapshotDigest(payload);
    assert.throws(() => validateSnapshot(snapshot, f.seed));
  } finally { await stores.close(); f.dispose(); }
});
test('SQLite professional image history survives actual reopen, strict export and authenticated backup with rehashed relation attacks rejected', async () => {
  const f = await migrationFixture(undefined, false); let stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }), open = true;
  try {
    const p = await preparePhotoProfessional(stores), saved = await stores.photoProfessional.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician'));
    for (const sql of ["UPDATE photo_professional_reviews SET comment='forged'", 'DELETE FROM photo_professional_reviews']) {
      const db = new DatabaseSync(f.filename); try { assert.throws(() => db.exec(sql)); } finally { db.close(); }
    }
    await stores.close(); open = false; const bytes = fileDigest(f.filename), snapshot = f.read(); assert.equal(fileDigest(f.filename), bytes);
    assert.equal(snapshot.schemaVersion, 10); assert.equal(snapshot.sourceSchemaVersion, 12); assert.equal(Object.keys(snapshot.tables).length, 32);
    assert.throws(() => photoProfessionalFrom({ ...snapshot.tables.photo_professional_reviews[0], public: true }));
    const backup = unitBackup(snapshot), key = randomBytes(32); assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, f.seed), backup);
    for (const change of [{ qualificationDigest: saved.bindingDigest }, { qualificationUserId: p.authority('pharmacist').account.id }, { identity: 'uncertain' as const },
      { rightsDigest: saved.bindingDigest }, { noteDigest: saved.bindingDigest }, { createdAt: '2000-01-01T00:00:00.000Z' }]) {
      const bad = structuredClone(snapshot), { digest: ignored, ...payload } = { ...saved, ...change };
      const names: Record<string, string> = { qualificationDigest: 'qualification_digest', qualificationUserId: 'qualification_user_id', identity: 'identity_match', rightsDigest: 'rights_digest', noteDigest: 'note_digest', createdAt: 'created_at' };
      for (const [field, value] of Object.entries(change)) bad.tables.photo_professional_reviews[0][names[field]] = value;
      bad.tables.photo_professional_reviews[0].digest = photoProfessionalDigest(payload);
      const { digest: old, ...data } = bad; bad.digest = snapshotDigest(data); assert.throws(() => validateSnapshot(bad, f.seed));
      const badBackup = structuredClone(backup); badBackup.data.tables.photo_professional_reviews = bad.tables.photo_professional_reviews;
      assert.throws(() => validatePostgresBackup(rehashBackup(badBackup), f.seed));
    }
    stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }); open = true;
    assert.deepEqual((await stores.photoProfessional.detail(p.photo)).history, [saved]);
  } finally { if (open) await stores.close(); f.dispose(); }
});
test('SQLite professional insert rollback and server clock failure leave no opinion or altered basis', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }), repo = new CatalogRepository(f.filename, f.seed);
  try {
    const p = await preparePhotoProfessional(stores), input = await p.input('tcm_physician'), before = await stores.photoRights.detail(p.photo);
    repo.db.exec("CREATE TRIGGER fixture_photo_professional_insert BEFORE INSERT ON photo_professional_reviews BEGIN SELECT RAISE(ABORT, 'fixture insert failure'); END;");
    await assert.rejects(stores.photoProfessional.review(p.photo, input, p.authority('tcm_physician'))); assert.equal((await stores.photoProfessional.detail(p.photo)).version, 0);
    repo.db.exec('DROP TRIGGER fixture_photo_professional_insert');
    await assert.rejects(new PhotoProfessionalRepository(repo.db, () => 0).review(p.photo, input, p.authority('tcm_physician')), rightsCode('photo_professional_clock'));
    assert.deepEqual(await stores.photoRights.detail(p.photo), before); assert.equal((await stores.photoProfessional.detail(p.photo)).version, 0);
    assert.equal((await stores.photoProfessional.review(p.photo, input, p.authority('tcm_physician'))).version, 1);
  } finally { repo.close(); await stores.close(); f.dispose(); }
});
test('historical professional approvals cannot be rehashed into a time after their credential or source heads were superseded', async () => {
  for (const kind of ['qualification', 'rights', 'note'] as const) {
    const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
    try {
      const p = await preparePhotoProfessional(stores), saved = await stores.photoProfessional.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician'));
      if (kind === 'qualification') await stores.workflow.saveQualification(saved.actorId, { ...credentialInput('tcm_physician'), status: 'revoked' }, 1, p.admin.account, p.admin.token);
      if (kind === 'rights') await stores.photoRights.review(p.photo, { ...rightsInput(p.basis.submission, 1), decision: 'revoke' }, p.basis.reviewAuthority);
      if (kind === 'note') await stores.photoNotes.save(p.photo, noteInput(1), p.basis.authority);
      const snapshot = f.read(); // Genuine earlier opinion remains valid historical evidence.
      assert.equal(snapshot.tables.photo_professional_reviews.length, 1);
      const { digest: old, ...payload } = { ...saved, createdAt: new Date(Date.now() + 1000).toISOString() };
      snapshot.tables.photo_professional_reviews[0].created_at = payload.createdAt; snapshot.tables.photo_professional_reviews[0].digest = photoProfessionalDigest(payload);
      const { digest: ignored, ...data } = snapshot; snapshot.digest = snapshotDigest(data);
      assert.throws(() => validateSnapshot(snapshot, f.seed));
    } finally { await stores.close(); f.dispose(); }
  }
});
test('genuine populated SQLite v11 retains exact format9/31-table history; additive v12 changes only journal and new empty opinions', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  try { await preparePhotoProfessional(stores); } finally { await stores.close(); }
  try {
    const db = new DatabaseSync(f.filename); try { db.exec('PRAGMA foreign_keys=ON'); removeEmptyPhotoProfessional(db); } finally { db.close(); }
    const before = f.read(), bytes = fileDigest(f.filename); assert.equal(before.schemaVersion, 9); assert.equal(before.sourceSchemaVersion, 11); assert.equal(Object.keys(before.tables).length, 31); assert.equal(before.tables.photo_rights_reviews.length, 1);
    assert.equal(fileDigest(f.filename), bytes); const latest = new CatalogRepository(f.filename, f.seed); latest.close(); const after = f.read();
    for (const name of Object.keys(before.tables) as (keyof typeof before.tables)[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.equal(after.schemaVersion, 10); assert.equal(after.sourceSchemaVersion, 12); assert.deepEqual(after.tables.photo_professional_reviews, []); assert.deepEqual(after.sequences, before.sequences);
    assert.equal(Object.hasOwn(before.tables, 'photo_professional_reviews'), false); assert.equal(notePhoto().professionalReview, 'pending');
  } finally { f.dispose(); }
});
