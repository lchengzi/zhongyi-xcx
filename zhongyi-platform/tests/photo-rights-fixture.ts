import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RepositoryBundle, WriteAuthority } from '../server/stores.js';
import type { PhotoRightsStore } from '../server/photo-rights-service.js';
import type { PhotoRightsInput } from '../shared/photo-rights.js';
import type { PhotoSubmission } from '../shared/photo-submissions.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { fixturePassword } from './migration-fixture.js';

export const rightsInput = (submission: PhotoSubmission, version = 0): PhotoRightsInput => ({ bindingDigest: submission.bindingDigest, expectedVersion: version,
  expectedSubmissionVersion: submission.version, submissionDigest: submission.digest, expectedNoteVersion: submission.noteVersion, noteDigest: submission.noteDigest,
  decision: 'approve', evidenceKind: 'test-fixture', evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:rights-reference', attributionPlan: '工程模拟：署名、来源、许可链接及修改说明，未获真实权利批准。',
  alterationPlan: '工程模拟：仅私有原件，公开衍生脱敏及同方式共享另审。', validUntil: new Date(Date.now() + 86400000).toISOString(), comment: '工程模拟，非真实图片权利审核或专业批准。', verificationConfirmed: true });
export const rightsCode = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
type Backend = { stores: RepositoryBundle; second: PhotoRightsStore; close(): void | Promise<void> };
export async function prepareRights(stores: RepositoryBundle) {
  const editor = await stores.auth.login('migration-editor', fixturePassword, 'rights-editor'), reviewer = await stores.auth.login('migration-reviewer', fixturePassword, 'rights-reviewer');
  const authority = { account: editor.info.user, token: editor.token }, reviewAuthority = { account: reviewer.info.user, token: reviewer.token };
  const note = await stores.photoNotes.save(notePhoto(), noteInput(), authority), submission = await stores.photoSubmissions.submit(notePhoto(), submissionInput(note), authority);
  return { authority, reviewAuthority, note, submission };
}
export function registerPhotoRightsTests(engine: string, backend: () => Promise<Backend>): void {
  test(`${engine}: rights pins immutable submission/original/source, named actor and usage plans; engineering records cannot grant publication`, async () => {
    const f = await backend();
    try {
      const prepared = await prepareRights(f.stores), input = rightsInput(prepared.submission), before = await f.stores.catalog.publicSnapshot();
      const photo = notePhoto(), pending = f.stores.photoRights.review(photo, input, prepared.reviewAuthority);
      input.comment = 'caller mutation'; photo.concerns.push('caller mutation');
      const saved = await pending;
      assert.equal(saved.comment, '工程模拟，非真实图片权利审核或专业批准。'); assert.equal(saved.actorRole, 'reviewer');
      assert.equal(saved.submissionDigest, prepared.submission.digest);
      const detail = await f.second.detail(notePhoto()); assert.equal(detail.state, 'recorded'); assert.equal(detail.publicationEligible, false); assert.deepEqual(detail.history, [saved]);
      detail.history[0].attributionPlan = 'detached'; assert.deepEqual((await f.stores.photoRights.detail(notePhoto())).history, [saved]);
      assert.deepEqual(await f.stores.catalog.publicSnapshot(), before);
      assert.equal(notePhoto().professionalReview, 'pending'); assert.equal(notePhoto().rightsReview, 'pending');
    } finally { await f.close(); }
  });
  test(`${engine}: metadata, latest note and latest submission are all transaction-bound; stale approvals never transfer`, async () => {
    const f = await backend();
    try {
      const p = await prepareRights(f.stores), input = rightsInput(p.submission);
      const saved = await f.stores.photoRights.review(notePhoto(), input, p.reviewAuthority);
      const changed = { ...notePhoto(), sourceRevision: '2' };
      assert.equal((await f.second.detail(changed)).state, 'stale');
      await assert.rejects(f.second.review(changed, { ...input, expectedVersion: 1 }, p.reviewAuthority), rightsCode('photo_rights_conflict'));
      const note = await f.stores.photoNotes.save(notePhoto(), noteInput(1), p.authority);
      assert.equal((await f.second.detail(notePhoto())).state, 'stale');
      await assert.rejects(f.second.review(notePhoto(), { ...input, expectedVersion: 1 }, p.reviewAuthority), rightsCode('photo_rights_conflict'));
      const submission = await f.stores.photoSubmissions.submit(notePhoto(), submissionInput(note, 1), p.authority);
      await assert.rejects(f.second.review(notePhoto(), { ...rightsInput(submission, 1), decision: 'revoke' }, p.reviewAuthority), rightsCode('photo_rights_not_approved'));
      const next = await f.second.review(notePhoto(), rightsInput(submission, 1), p.reviewAuthority);
      assert.equal(next.submissionVersion, 2); assert.deepEqual((await f.stores.photoRights.detail(notePhoto())).history, [next, saved]);
    } finally { await f.close(); }
  });
  test(`${engine}: reviewers must be independent of every earlier note/submitter; current roles, account revisions and live sessions are rechecked`, async () => {
    const f = await backend();
    try {
      const admin = await f.stores.auth.login('migration-admin', fixturePassword, 'rights-admin'), adminAuthority: WriteAuthority = { account: admin.info.user, token: admin.token };
      await f.stores.photoNotes.save(notePhoto(), noteInput(), adminAuthority);
      const editor = await f.stores.auth.login('migration-editor', fixturePassword, 'rights-editor'), editorAuthority = { account: editor.info.user, token: editor.token };
      const note = await f.stores.photoNotes.save(notePhoto(), noteInput(1), editorAuthority), submission = await f.stores.photoSubmissions.submit(notePhoto(), submissionInput(note), editorAuthority), input = rightsInput(submission);
      await assert.rejects(f.second.review(notePhoto(), input, adminAuthority), rightsCode('photo_rights_independence'));
      await assert.rejects(f.second.review(notePhoto(), input, editorAuthority), rightsCode('forbidden'));
      const reviewer = await f.stores.auth.login('migration-reviewer', fixturePassword, 'rights-reviewer'), authority = { account: reviewer.info.user, token: reviewer.token };
      await assert.rejects(f.second.review(notePhoto(), input, { ...authority, account: { ...authority.account, username: 'forged' } }), rightsCode('forbidden'));
      await f.stores.auth.logout(reviewer.token, authority.account.username);
      await assert.rejects(f.second.review(notePhoto(), input, authority), rightsCode('unauthorized'));
      assert.equal((await f.second.detail(notePhoto())).version, 0);
    } finally { await f.close(); }
  });
  test(`${engine}: competing rights decisions append one winner; return and authorized revocation preserve all earlier versions`, async () => {
    const f = await backend();
    try {
      const p = await prepareRights(f.stores), input = rightsInput(p.submission);
      const results = await Promise.allSettled([f.stores.photoRights.review(notePhoto(), input, p.reviewAuthority), f.second.review(notePhoto(), input, p.reviewAuthority)]);
      assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
      const failed = results.find(item => item.status === 'rejected'); assert(failed?.status === 'rejected'); assert(rightsCode('photo_rights_conflict')(failed.reason));
      const revoked = await f.second.review(notePhoto(), { ...rightsInput(p.submission, 1), decision: 'revoke' }, p.reviewAuthority);
      assert.equal((await f.second.detail(notePhoto())).state, 'revoked'); assert.equal(revoked.version, 2);
      const returned = await f.second.review(notePhoto(), { ...rightsInput(p.submission, 2), decision: 'return' }, p.reviewAuthority);
      assert.equal((await f.second.detail(notePhoto())).state, 'changes_requested'); assert.equal(returned.version, 3);
      await assert.rejects(f.second.review(notePhoto(), { ...rightsInput(p.submission, 3), decision: 'revoke' }, p.reviewAuthority), rightsCode('photo_rights_not_approved'));
      assert.equal((await f.second.detail(notePhoto())).history.length, 3);
    } finally { await f.close(); }
  });
  test(`${engine}: approval requires bounded future validity; actor deactivation invalidates current evidence without deleting history`, async () => {
    const f = await backend();
    try {
      const p = await prepareRights(f.stores), input = rightsInput(p.submission);
      for (const validUntil of [new Date(0).toISOString(), new Date(Date.now() + 367 * 86400000).toISOString()]) await assert.rejects(f.second.review(notePhoto(), { ...input, validUntil }, p.reviewAuthority), rightsCode('invalid_photo_rights_expiry'));
      const saved = await f.second.review(notePhoto(), input, p.reviewAuthority);
      await f.stores.auth.updateUser(p.reviewAuthority.account.id, 'reviewer', false, p.reviewAuthority.account.revision, 'engineering-admin');
      const current = await f.second.detail(notePhoto()); assert.equal(current.state, 'stale'); assert.deepEqual(current.history, [saved]);
      await assert.rejects(f.second.review(notePhoto(), { ...input, expectedVersion: 1 }, p.reviewAuthority), rightsCode('unauthorized'));
    } finally { await f.close(); }
  });
}
