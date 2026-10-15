import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CatalogRepository } from '../server/database.js';
import { openConfiguredStore } from '../server/store-config.js';
import { PhotoRightsRepository } from '../server/photo-rights.js';
import { photoRightsDigest, photoRightsFrom } from '../server/photo-rights-values.js';
import { parsePhotoRightsInput } from '../shared/photo-rights.js';
import { validateSnapshot, snapshotDigest } from '../server/migration-snapshot.js';
import { decryptBackup, encryptBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { migrationFixture, removeEmptyPhotoRights, fileDigest } from './migration-fixture.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { notePhoto } from './photo-note-fixture.js';
import { registerPhotoRightsTests, prepareRights, rightsInput } from './photo-rights-fixture.js';

registerPhotoRightsTests('SQLite independent connections', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  const two = new CatalogRepository(f.filename, f.seed);
  return { stores, second: new PhotoRightsRepository(two.db), close: async () => { two.close(); await stores.close(); f.dispose(); } };
});

test('SQLite rights integrity, rehashed backup relationships, immutable history and read-only export survive actual reopen', async () => {
  const f = await migrationFixture(undefined, false); let stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }), storeOpen = true;
  try {
    const p = await prepareRights(stores), saved = await stores.photoRights.review(notePhoto(), rightsInput(p.submission), p.reviewAuthority);
    for (const sql of ["UPDATE photo_rights_reviews SET comment='forged'", 'DELETE FROM photo_rights_reviews']) {
      const db = new DatabaseSync(f.filename); try { assert.throws(() => db.exec(sql)); } finally { db.close(); }
    }
    await stores.close(); storeOpen = false; const before = fileDigest(f.filename), snapshot = f.read(); assert.equal(fileDigest(f.filename), before);
    assert.equal(snapshot.schemaVersion, 10); assert.equal(snapshot.sourceSchemaVersion, 12); assert.equal(Object.keys(snapshot.tables).length, 32);
    const backup = unitBackup(snapshot), key = randomBytes(32); assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, f.seed), backup);
    assert.throws(() => photoRightsFrom({ ...snapshot.tables.photo_rights_reviews[0], public: true }));
    const bad = structuredClone(snapshot), { digest: _, ...payload } = { ...saved, submissionDigest: saved.bindingDigest };
    bad.tables.photo_rights_reviews[0].submission_digest = payload.submissionDigest; bad.tables.photo_rights_reviews[0].digest = photoRightsDigest(payload);
    const { digest: _old, ...data } = bad; bad.digest = snapshotDigest(data); assert.throws(() => validateSnapshot(bad, f.seed));
    const badBackup = structuredClone(backup); badBackup.data.tables.photo_rights_reviews = bad.tables.photo_rights_reviews; assert.throws(() => validatePostgresBackup(rehashBackup(badBackup), f.seed));
    for (const extra of [{ approved: true }, { publicationEligible: true }, { verificationConfirmed: false }, { attributionPlan: ' ' }, { expectedNoteVersion: 0 }]) assert.throws(() => parsePhotoRightsInput({ ...rightsInput(p.submission), ...extra }));
    stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }); storeOpen = true; assert.deepEqual((await stores.photoRights.detail(notePhoto())).history, [saved]);
  } finally { if (storeOpen) await stores.close(); f.dispose(); }
});

test('SQLite rights insert failure rolls back; simulated manual evidence expires without changing professional/public status', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename }), repo = new CatalogRepository(f.filename, f.seed);
  try {
    const p = await prepareRights(stores); let now = Date.now(); const review = new PhotoRightsRepository(repo.db, () => now);
    const input = { ...rightsInput(p.submission), evidenceKind: 'manual-verification' as const, comment: 'ENGINEERING_SIMULATION_NOT_REAL：仅测试人工凭据分支，不是实际权利批准。' };
    repo.db.exec("CREATE TRIGGER fixture_rights_insert BEFORE INSERT ON photo_rights_reviews BEGIN SELECT RAISE(ABORT, 'fixture rights failure'); END;");
    await assert.rejects(review.review(notePhoto(), input, p.reviewAuthority)); assert.equal((await review.detail(notePhoto())).version, 0);
    repo.db.exec('DROP TRIGGER fixture_rights_insert'); const saved = await review.review(notePhoto(), input, p.reviewAuthority);
    assert.equal((await review.detail(notePhoto())).state, 'rights_verified'); assert.equal((await review.detail(notePhoto())).publicationEligible, false);
    now = Date.parse(input.validUntil); const detail = await review.detail(notePhoto()); assert.equal(detail.state, 'stale'); assert.deepEqual(detail.history, [saved]);
    assert.equal((await stores.photoSubmissions.detail(notePhoto())).history[0].candidate.professionalReview, 'pending');
  } finally { repo.close(); await stores.close(); f.dispose(); }
});

test('genuine SQLite v10 populated submission snapshot retains its 30-table format; v12 adds empty rights/professional history', async () => {
  const f = await migrationFixture(undefined, false), stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  try { await prepareRights(stores); } finally { await stores.close(); }
  try {
    const db = new DatabaseSync(f.filename); try { db.exec('PRAGMA foreign_keys=ON'); removeEmptyPhotoRights(db); } finally { db.close(); }
    const before = f.read(), bytes = fileDigest(f.filename); assert.equal(before.schemaVersion, 8); assert.equal(before.sourceSchemaVersion, 10); assert.equal(Object.keys(before.tables).length, 30); assert.equal(fileDigest(f.filename), bytes);
    const latest = new CatalogRepository(f.filename, f.seed); latest.close(); const after = f.read();
    for (const name of Object.keys(before.tables) as (keyof typeof before.tables)[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.equal(after.schemaVersion, 10); assert.equal(after.sourceSchemaVersion, 12); assert.deepEqual(after.tables.photo_rights_reviews, []); assert.deepEqual(after.sequences, before.sequences);
  } finally { f.dispose(); }
});
