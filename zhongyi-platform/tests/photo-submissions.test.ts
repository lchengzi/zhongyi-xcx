import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { PhotoSubmissionRepository } from '../server/photo-submissions.js';
import { photoSubmissionDigest, photoSubmissionFrom } from '../server/photo-submission-values.js';
import { parsePhotoSubmissionInput, parsePhotoSubmissionDetail, parseReloadedPhotoSubmissions, parseSavedPhotoSubmission } from '../shared/photo-submissions.js';
import { snapshotDigest, validateSnapshot } from '../server/migration-snapshot.js';
import { encryptBackup, decryptBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { migrationFixture, fileDigest, removeEmptyPhotoSubmissions } from './migration-fixture.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { submissionInput, registerPhotoSubmissionTests } from './photo-submission-fixture.js';

registerPhotoSubmissionTests('SQLite independent connections', async () => {
  const f = await migrationFixture(undefined, false), one = new CatalogRepository(f.filename, f.seed), two = new CatalogRepository(f.filename, f.seed);
  return { auth: new AuthRepository(one.db), notes: new PhotoNoteRepository(one.db), one: new PhotoSubmissionRepository(one.db), two: new PhotoSubmissionRepository(two.db),
    close: () => { two.close(); one.close(); f.dispose(); } };
});

test('submission protocol rejects unsafe/blank/unknown, missing note binding and approval injection', () => {
  const input = { bindingDigest: noteInput().bindingDigest, expectedVersion: 0, expectedNoteVersion: 1, noteDigest: noteInput().bindingDigest, caption: '测试', partDescription: '待核对', processingDescription: '待核对', evidenceReference: 'fixture', submissionConfirmed: true };
  assert.equal(parsePhotoSubmissionInput({ ...input, caption: ' 测试 ' }).caption, '测试');
  for (const bad of [{ ...input, caption: '' }, { ...input, partDescription: ' ' }, { ...input, processingDescription: 'bad\0text' }, { ...input, caption: 'x'.repeat(181) },
    { ...input, evidenceReference: '' }, { ...input, expectedNoteVersion: 0 }, { ...input, expectedVersion: 0.5 }, { ...input, noteDigest: '' }, { ...input, submissionConfirmed: false }, { ...input, publicationEligible: true }]) assert.throws(() => parsePhotoSubmissionInput(bad));
  const expected = { candidateId: notePhoto().id, bindingDigest: input.bindingDigest };
  const empty = { schemaVersion: 'private-photo-submissions.1', ...expected, noteVersion: 0, noteDigest: null, noteBindingDigest: null, version: 0, history: [] };
  assert.deepEqual(parsePhotoSubmissionDetail(empty, expected), empty);
  for (const bad of [{ ...empty, noteDigest: input.noteDigest }, { ...empty, noteVersion: 1 }, { ...empty, version: 1 }, { ...empty, approved: true }, { ...empty, candidateId: 'other' }]) assert.throws(() => parsePhotoSubmissionDetail(bad, expected));
});

test('SQLite submission survives reopen/read-only export and encrypted backup; even rehashed relationship corruption is rejected', async () => {
  const f = await migrationFixture(undefined, false); let repo: CatalogRepository | undefined;
  try {
    repo = new CatalogRepository(f.filename, f.seed); const authority = { account: f.admin, token: f.token };
    const note = await new PhotoNoteRepository(repo.db).save(notePhoto(), noteInput(), authority), input = submissionInput(note);
    const store = new PhotoSubmissionRepository(repo.db), saved = await store.submit(notePhoto(), input, authority), previous = await store.detail(notePhoto());
    assert.throws(() => repo!.db.exec("UPDATE photo_submissions SET caption='forged'")); assert.throws(() => repo!.db.exec('DELETE FROM photo_submissions'));
    assert.throws(() => parseSavedPhotoSubmission({ ...saved, caption: 'other response' }, notePhoto(), input, f.admin));
    assert.throws(() => parseReloadedPhotoSubmissions({ ...previous, history: [{ ...saved, noteDigest: noteInput().bindingDigest }] }, previous));
    repo.close(); repo = new CatalogRepository(f.filename, f.seed); assert.deepEqual((await new PhotoSubmissionRepository(repo.db).detail(notePhoto())).history, [saved]); repo.close(); repo = undefined;
    const bytes = fileDigest(f.filename), snapshot = f.read(); assert.equal(fileDigest(f.filename), bytes);
    assert.equal(snapshot.sourceSchemaVersion, 12); assert.equal(snapshot.schemaVersion, 10); assert.equal(Object.keys(snapshot.tables).length, 32);
    const backup = unitBackup(snapshot), key = randomBytes(32); assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, f.seed), backup);
    assert.throws(() => photoSubmissionFrom({ ...snapshot.tables.photo_submissions[0], extra: true }));
    const bad = structuredClone(snapshot), { digest: _, ...payload } = { ...saved, noteDigest: noteInput().bindingDigest };
    bad.tables.photo_submissions[0].note_digest = payload.noteDigest; bad.tables.photo_submissions[0].digest = photoSubmissionDigest(payload);
    const { digest: _snapshot, ...snapshotPayload } = bad; bad.digest = snapshotDigest(snapshotPayload);
    assert.throws(() => validateSnapshot(bad, f.seed));
    const badBackup = structuredClone(backup); badBackup.data.tables.photo_submissions = bad.tables.photo_submissions;
    assert.throws(() => validatePostgresBackup(rehashBackup(badBackup), f.seed));
  } finally { repo?.close(); f.dispose(); }
});

test('failed SQLite submission insert rolls back without losing notes or poisoning the connection', async () => {
  const f = await migrationFixture(undefined, false), repo = new CatalogRepository(f.filename, f.seed);
  try {
    const authority = { account: f.admin, token: f.token }, notes = new PhotoNoteRepository(repo.db), store = new PhotoSubmissionRepository(repo.db);
    const note = await notes.save(notePhoto(), noteInput(), authority);
    repo.db.exec("CREATE TRIGGER fixture_submission_insert BEFORE INSERT ON photo_submissions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
    await assert.rejects(store.submit(notePhoto(), submissionInput(note), authority)); assert.equal((await store.detail(notePhoto())).version, 0); assert.equal((await notes.detail(notePhoto())).version, 1);
    repo.db.exec('DROP TRIGGER fixture_submission_insert'); assert.equal((await store.submit(notePhoto(), submissionInput(note), authority)).version, 1);
  } finally { repo.close(); f.dispose(); }
});

test('genuine SQLite v9 retains populated notes and original 29-table digest; explicit latest reopen adds only empty submissions', async () => {
  const f = await migrationFixture(undefined, false);
  try {
    const repo = new CatalogRepository(f.filename, f.seed);
    try { await new PhotoNoteRepository(repo.db).save(notePhoto(), noteInput(), { account: f.admin, token: f.token }); removeEmptyPhotoSubmissions(repo.db); } finally { repo.close(); }
    const bytes = fileDigest(f.filename), before = f.read(); assert.equal(fileDigest(f.filename), bytes);
    assert.equal(before.sourceSchemaVersion, 9); assert.equal(before.schemaVersion, 7); assert.equal(Object.keys(before.tables).length, 29);
    const next = new CatalogRepository(f.filename, f.seed); next.close(); const after = f.read();
    for (const name of Object.keys(before.tables) as (keyof typeof before.tables)[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.equal(after.sourceSchemaVersion, 12); assert.deepEqual(after.tables.photo_submissions, []); assert.deepEqual(after.sequences, before.sequences);
    const db = new DatabaseSync(f.filename); try { assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0); } finally { db.close(); }
  } finally { f.dispose(); }
});
