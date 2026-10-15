import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RepositoryBundle } from '../server/stores.js';
import type { PhotoNoteStore } from '../server/photo-note-service.js';
import type { PhotoSubmissionStore } from '../server/photo-submission-service.js';
import { parseSavedPhotoSubmission, type PhotoSubmissionInput } from '../shared/photo-submissions.js';
import type { PhotoNote } from '../shared/photo-notes.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { fixturePassword } from './migration-fixture.js';

export const submissionInput = (note: PhotoNote, version = 0): PhotoSubmissionInput => ({ bindingDigest: note.bindingDigest, expectedVersion: version,
  expectedNoteVersion: note.version, noteDigest: note.digest, caption: '工程模拟切片，仅供测试', partDescription: '待专业核对的部位（测试）', processingDescription: '待核对的加工形态（测试）',
  evidenceReference: 'fixture:submission-evidence', submissionConfirmed: true });
type Backend = { auth: RepositoryBundle['auth']; notes: PhotoNoteStore; one: PhotoSubmissionStore; two: PhotoSubmissionStore; close(): void | Promise<void> };
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
export function registerPhotoSubmissionTests(engine: string, backend: () => Promise<Backend>): void {
  test(`${engine}: submission pins original metadata, exact note head and named display intent, never granting approval`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-admin', fixturePassword, 'submission-pin'), authority = { account: login.info.user, token: login.token };
      assert.equal((await f.one.detail(notePhoto())).version, 0);
      await assert.rejects(f.one.submit(notePhoto(), { ...noteInput(), expectedNoteVersion: 1, noteDigest: noteInput().bindingDigest }, authority), code('invalid_photo_submission'));
      const note = await f.notes.save(notePhoto(), noteInput(), authority), input = submissionInput(note);
      const photo = notePhoto(), pending = f.one.submit(photo, input, authority);
      input.caption = 'caller mutation'; photo.concerns.push('caller mutation');
      const saved = await pending;
      assert.equal(saved.caption, '工程模拟切片，仅供测试'); assert.equal(saved.candidate.publicationEligible, false);
      assert.deepEqual(parseSavedPhotoSubmission(saved, notePhoto(), submissionInput(note), authority.account), saved);
      assert.deepEqual((await f.two.detail(notePhoto())).history, [saved]);
      const next = await f.notes.save(notePhoto(), noteInput(1), authority);
      await assert.rejects(f.two.submit(notePhoto(), submissionInput(note, 1), authority), code('photo_submission_conflict'));
      const second = await f.two.submit(notePhoto(), submissionInput(next, 1), authority);
      assert.equal(second.version, 2); assert.equal(second.noteVersion, 2);
      assert.deepEqual((await f.one.detail(notePhoto())).history, [second, saved]);
    } finally { await f.close(); }
  });
  test(`${engine}: missing notes and changed original/source cannot reuse an earlier note as submission evidence`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-editor', fixturePassword, 'submission-source'), authority = { account: login.info.user, token: login.token };
      const missing = { bindingDigest: noteInput().bindingDigest, version: 1, digest: noteInput().bindingDigest };
      await assert.rejects(f.one.submit(notePhoto(), { ...submissionInput({ ...missing, candidate: notePhoto(), category: 'identity', text: 'fixture', evidenceReference: 'fixture', actorId: authority.account.id, actorName: authority.account.username, accountRevision: authority.account.revision, createdAt: new Date().toISOString() }) }, authority), code('photo_submission_conflict'));
      const note = await f.notes.save(notePhoto(), noteInput(), authority);
      const changed = { ...notePhoto(), sourceRevision: '2', observation: '新的来源观察，未核验' };
      const changedInput = { ...submissionInput(note), bindingDigest: noteInput(1, changed).bindingDigest };
      await assert.rejects(f.one.submit(changed, changedInput, authority), code('photo_submission_conflict'));
      const fresh = await f.notes.save(changed, noteInput(1, changed), authority);
      const saved = await f.one.submit(changed, submissionInput(fresh), authority);
      assert.equal(saved.noteVersion, 2); assert.equal(saved.candidate.sourceRevision, '2');
      await assert.rejects(f.one.detail({ ...changed, ingredientId: 'jiang' }), code('photo_identity_changed'));
      await assert.rejects(f.one.detail({ ...changed, ingredientId: 'not-an-ingredient' }), code('ingredient_not_found'));
    } finally { await f.close(); }
  });
  test(`${engine}: simultaneous writers serialize both heads and append exactly one submission`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-admin', fixturePassword, 'submission-concurrent'), authority = { account: login.info.user, token: login.token };
      const note = await f.notes.save(notePhoto(), noteInput(), authority);
      const results = await Promise.allSettled([f.one.submit(notePhoto(), submissionInput(note), authority), f.two.submit(notePhoto(), submissionInput(note), authority)]);
      assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
      const rejected = results.find(item => item.status === 'rejected'); assert(rejected?.status === 'rejected'); assert(code('photo_submission_conflict')(rejected.reason));
      assert.equal((await f.two.detail(notePhoto())).history.length, 1);
    } finally { await f.close(); }
  });
  test(`${engine}: current role/session/identity and explicit confirmation are required inside the transaction`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-editor', fixturePassword, 'submission-auth'), authority = { account: login.info.user, token: login.token };
      const note = await f.notes.save(notePhoto(), noteInput(), authority), input = submissionInput(note);
      for (const invalid of [{ ...input, submissionConfirmed: false }, { ...input, approved: true }, { ...input, caption: ' ' }]) await assert.rejects(f.one.submit(notePhoto(), invalid, authority), code('invalid_photo_submission'));
      await assert.rejects(f.one.submit(notePhoto(), input, { ...authority, account: { ...authority.account, username: 'forged' } }), code('forbidden'));
      const reviewer = await f.auth.login('migration-reviewer', fixturePassword, 'submission-reviewer');
      await assert.rejects(f.one.submit(notePhoto(), input, { account: reviewer.info.user, token: reviewer.token }), code('forbidden'));
      await f.auth.logout(login.token, authority.account.username);
      await assert.rejects(f.one.submit(notePhoto(), input, authority), code('unauthorized'));
      assert.equal((await f.one.detail(notePhoto())).version, 0);
    } finally { await f.close(); }
  });
}
