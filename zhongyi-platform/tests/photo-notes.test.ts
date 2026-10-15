import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { photoNoteFrom } from '../server/photo-note-values.js';
import { parsePhotoNoteDetail, parsePhotoNoteInput } from '../shared/photo-notes.js';
import { snapshotDigest, validateSnapshot } from '../server/migration-snapshot.js';
import { decryptBackup, encryptBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { migrationFixture, fileDigest, removeEmptyPhotoNotes } from './migration-fixture.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { noteInput, notePhoto, registerPhotoNoteTests } from './photo-note-fixture.js';

registerPhotoNoteTests('SQLite two connections', async () => {
  const fixture = await migrationFixture(undefined, false);
  const one = new CatalogRepository(fixture.filename, fixture.seed), two = new CatalogRepository(fixture.filename, fixture.seed);
  return { auth: new AuthRepository(one.db), one: new PhotoNoteRepository(one.db), two: new PhotoNoteRepository(two.db),
    close: () => { two.close(); one.close(); fixture.dispose(); } };
});

test('photo note protocol rejects blank, unknown, unsafe, non-contiguous and cross-candidate responses', () => {
  for (const bad of [{ ...noteInput(), text: ' ' }, { ...noteInput(), evidenceReference: '' }, { ...noteInput(), text: 'bad\0text' },
    { ...noteInput(), expectedVersion: -1 }, { ...noteInput(), expectedVersion: 0.5 }, { ...noteInput(), category: 'approved' }]) assert.throws(() => parsePhotoNoteInput(bad));
  const expected = { candidateId: notePhoto().id, bindingDigest: noteInput().bindingDigest };
  const detail = { schemaVersion: 'private-photo-notes.1', ...expected, version: 0, history: [] };
  assert.deepEqual(parsePhotoNoteDetail(detail, expected), detail);
  for (const bad of [{ ...detail, version: 1 }, { ...detail, candidateId: 'different' }, { ...detail, approved: true }]) assert.throws(() => parsePhotoNoteDetail(bad, expected));
});

test('SQLite photo notes survive reopen and readonly export/crypto backup; rehashed corruption fails business validation', async () => {
  const f = await migrationFixture(undefined, false); let repo: CatalogRepository | undefined;
  try {
    repo = new CatalogRepository(f.filename, f.seed); const store = new PhotoNoteRepository(repo.db);
    const admin = f.admin; const saved = await store.save(notePhoto(), noteInput(), { account: admin, token: f.token });
    assert.throws(() => repo!.db.exec("UPDATE photo_notes SET text='changed'")); assert.throws(() => repo!.db.exec('DELETE FROM photo_notes'));
    repo.close(); repo = new CatalogRepository(f.filename, f.seed);
    assert.deepEqual((await new PhotoNoteRepository(repo.db).detail(notePhoto())).history, [saved]); repo.close(); repo = undefined;
    const before = fileDigest(f.filename), snapshot = f.read(); assert.equal(fileDigest(f.filename), before);
    assert.equal(snapshot.sourceSchemaVersion, 12); assert.equal(snapshot.schemaVersion, 10); assert.equal(snapshot.tables.photo_notes.length, 1);
    const key = randomBytes(32), backup = unitBackup(snapshot); assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, f.seed), backup);
    const bad = structuredClone(snapshot); bad.tables.photo_notes[0].text = 'forged'; const { digest: _, ...payload } = bad; bad.digest = snapshotDigest(payload);
    assert.throws(() => validateSnapshot(bad, f.seed));
    const badBackup = structuredClone(backup); badBackup.data.tables.photo_notes[0].text = 'forged'; assert.throws(() => validatePostgresBackup(rehashBackup(badBackup), f.seed));
    const row = { ...snapshot.tables.photo_notes[0], unknown: 'not-projected' }; assert.throws(() => photoNoteFrom(row));
  } finally { repo?.close(); f.dispose(); }
});

test('SQLite failed photo insert rolls back and leaves the connection usable', async () => {
  const f = await migrationFixture(undefined, false); const repo = new CatalogRepository(f.filename, f.seed);
  try {
    const store = new PhotoNoteRepository(repo.db), authority = { account: f.admin, token: f.token };
    repo.db.exec("CREATE TRIGGER fixture_photo_insert BEFORE INSERT ON photo_notes BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    await assert.rejects(store.save(notePhoto(), noteInput(), authority)); assert.equal((await store.detail(notePhoto())).version, 0);
    repo.db.exec('DROP TRIGGER fixture_photo_insert'); assert.equal((await store.save(notePhoto(), noteInput(), authority)).version, 1);
  } finally { repo.close(); f.dispose(); }
});

test('genuine SQLite v8 keeps its original 28-table snapshot and bytes; explicit reopen adds only empty photo history', async () => {
  const f = await migrationFixture(undefined, false);
  try {
    const db = new DatabaseSync(f.filename); try { removeEmptyPhotoNotes(db); } finally { db.close(); }
    const bytes = fileDigest(f.filename), before = f.read(); assert.equal(fileDigest(f.filename), bytes);
    assert.equal(before.schemaVersion, 6); assert.equal(before.sourceSchemaVersion, 8); assert.equal(Object.keys(before.tables).length, 28);
    const repo = new CatalogRepository(f.filename, f.seed); repo.close(); const after = f.read();
    for (const name of Object.keys(before.tables) as (keyof typeof before.tables)[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.equal(after.sourceSchemaVersion, 12); assert.deepEqual(after.tables.photo_notes, []); assert.deepEqual(after.sequences, before.sequences);
  } finally { f.dispose(); }
});
