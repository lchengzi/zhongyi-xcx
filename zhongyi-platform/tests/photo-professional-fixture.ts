import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProfessionalKind } from '../shared/contracts.js';
import type { PhotoProfessionalInput } from '../shared/photo-professional.js';
import type { RepositoryBundle, WriteAuthority } from '../server/stores.js';
import type { PhotoProfessionalStore } from '../server/photo-professional-policy.js';
import { credentialInput } from './professional-fixture.js';
import { prepareRights, rightsInput, rightsCode } from './photo-rights-fixture.js';
import { fixturePassword } from './migration-fixture.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';

export async function preparePhotoProfessional(stores: RepositoryBundle) {
  const basis = await prepareRights(stores), photo = notePhoto();
  await stores.photoRights.review(photo, rightsInput(basis.submission), basis.reviewAuthority);
  const adminLogin = await stores.auth.login('migration-admin', fixturePassword, 'photo-professional-admin');
  const admin: WriteAuthority = { account: adminLogin.info.user, token: adminLogin.token };
  const authorities = new Map<ProfessionalKind, WriteAuthority>();
  for (const [profession, name] of [['tcm_physician', 'db-photo-physician'], ['pharmacist', 'db-photo-pharmacist']] as const) {
    const user = await stores.auth.createUser(name, fixturePassword, 'reviewer', 'ENGINEERING_SIMULATION_NOT_REAL');
    const login = await stores.auth.login(name, fixturePassword, name);
    authorities.set(profession, { account: login.info.user, token: login.token });
    await stores.workflow.saveQualification(user.id, { ...credentialInput(profession), evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:database-test' }, 0, admin.account, admin.token);
  }
  const authority = (profession: ProfessionalKind) => { const value = authorities.get(profession); if (!value) throw new Error('Missing fixture account'); return value; };
  async function input(profession: ProfessionalKind, decision: PhotoProfessionalInput['decision'] = 'approve'): Promise<PhotoProfessionalInput> {
    const detail = await stores.photoProfessional.detail(photo), qualification = (await stores.workflow.qualificationHistory(authority(profession).account.id))[0];
    const previous = detail.latestReviews.find(item => item.profession === profession);
    const credential = decision === 'revoke' && previous ? { revision: previous.qualificationRevision, digest: previous.qualificationDigest } : qualification;
    if (!detail.submissionDigest || !detail.noteDigest || !detail.rightsDigest || !credential) throw new Error('Fixture basis incomplete');
    return { bindingDigest: detail.bindingDigest, expectedVersion: detail.version, expectedSubmissionVersion: detail.submissionVersion, submissionDigest: detail.submissionDigest,
      expectedNoteVersion: detail.noteVersion, noteDigest: detail.noteDigest, expectedRightsVersion: detail.rightsVersion, rightsDigest: detail.rightsDigest,
      profession, expectedQualificationRevision: credential.revision, qualificationDigest: credential.digest, decision, identity: 'matches', part: 'matches', processing: 'matches',
      evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:fixed-evidence', comment: '工程演练：不是真人鉴定、专业批准或可食性结论。', verificationConfirmed: true };
  }
  return { basis, photo, admin, authority, input };
}
export interface PhotoProfessionalBackend { stores: RepositoryBundle; second: PhotoProfessionalStore; close(): Promise<void> }
export function registerPhotoProfessionalTests(engine: string, backend: () => Promise<PhotoProfessionalBackend>) {
  test(`${engine}: real persisted professional opinions bind two credentials and four heads, own caller input and stay private`, async () => {
    const f = await backend(); try {
      const p = await preparePhotoProfessional(f.stores), before = await f.stores.catalog.publicSnapshot(), input = await p.input('tcm_physician');
      const original = input.comment, candidate = structuredClone(p.photo), pending = f.stores.photoProfessional.review(candidate, input, p.authority('tcm_physician'));
      input.comment = 'caller mutation'; candidate.concerns.push('caller mutation'); const saved = await pending;
      assert.equal(saved.comment, original); assert.equal(saved.actorId, p.authority('tcm_physician').account.id); assert.equal(saved.evidenceKind, 'test-fixture');
      const second = await f.second.review(p.photo, await p.input('pharmacist'), p.authority('pharmacist'));
      const detail = await f.stores.photoProfessional.detail(p.photo); assert.deepEqual(detail.history, [second, saved]); assert.equal(detail.latestReviews.length, 2);
      assert.equal(detail.state, 'recorded'); assert.equal(detail.publicationEligible, false); assert.deepEqual(await f.stores.catalog.publicSnapshot(), before);
      detail.history[0].comment = 'caller result mutation'; assert.equal((await f.second.detail(p.photo)).history[0].comment, second.comment);
    } finally { await f.close(); }
  });
  test(`${engine}: distinct connections enforce all-head CAS with exactly one winner and never retry a write`, async () => {
    const f = await backend(); try {
      const p = await preparePhotoProfessional(f.stores), one = await p.input('tcm_physician'), two = await p.input('pharmacist');
      const result = await Promise.allSettled([f.stores.photoProfessional.review(p.photo, one, p.authority('tcm_physician')), f.second.review(p.photo, two, p.authority('pharmacist'))]);
      assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); const failed = result.find(r => r.status === 'rejected');
      assert(failed?.status === 'rejected'); assert(rightsCode('photo_professional_conflict')(failed.reason)); assert.equal((await f.second.detail(p.photo)).version, 1);
    } finally { await f.close(); }
  });
  test(`${engine}: live sessions, exact actor and full contributor history remain authoritative`, async () => {
    const f = await backend(); try {
      const p = await preparePhotoProfessional(f.stores), input = await p.input('tcm_physician'), actor = p.authority('tcm_physician');
      await assert.rejects(f.second.review(p.photo, input, { ...actor, account: { ...actor.account, username: 'forged' } }), rightsCode('forbidden'));
      await assert.rejects(f.second.review(p.photo, input, p.basis.authority), rightsCode('forbidden'));
      // A credentialed admin contributed an earlier note, which a newer editor note does not erase.
      await f.stores.auth.updateUser(actor.account.id, 'admin', true, 1, p.admin.account.username, p.admin.token);
      const login = await f.stores.auth.login(actor.account.username, fixturePassword, 'contributor-admin');
      const contributor = { account: login.info.user, token: login.token };
      await f.stores.workflow.saveQualification(actor.account.id, credentialInput('tcm_physician'), 1, p.admin.account, p.admin.token);
      await f.stores.photoNotes.save(p.photo, noteInput(1), contributor);
      let note = await f.stores.photoNotes.save(p.photo, noteInput(2), p.basis.authority);
      for (let index = 0; index < 51; index++) note = await f.stores.photoNotes.save(p.photo, noteInput(note.version), p.basis.authority);
      assert(!(await f.stores.photoNotes.detail(p.photo)).history.some(item => item.actorId === contributor.account.id));
      const submission = await f.stores.photoSubmissions.submit(p.photo, submissionInput(note, 1), p.basis.authority);
      await f.stores.photoRights.review(p.photo, rightsInput(submission, 1), p.basis.reviewAuthority);
      await assert.rejects(f.second.review(p.photo, await p.input('tcm_physician'), contributor), rightsCode('photo_professional_independence'));
      await f.stores.auth.logout(p.authority('pharmacist').token, p.authority('pharmacist').account.username);
      await assert.rejects(f.second.review(p.photo, await p.input('pharmacist'), p.authority('pharmacist')), rightsCode('unauthorized'));
      assert.equal((await f.second.detail(p.photo)).version, 0);
    } finally { await f.close(); }
  });
  test(`${engine}: return needs a new submission; unknown conclusions cannot approve; changed basis invalidates old opinions`, async () => {
    const f = await backend(); try {
      const p = await preparePhotoProfessional(f.stores), input = await p.input('tcm_physician');
      await assert.rejects(f.second.review(p.photo, { ...input, part: 'uncertain' }, p.authority('tcm_physician')), rightsCode('photo_match_required'));
      const returned = await f.second.review(p.photo, { ...input, decision: 'return', part: 'mismatch' }, p.authority('tcm_physician'));
      await assert.rejects(f.second.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician')), rightsCode('photo_professional_revision_required'));
      const note = await f.stores.photoNotes.save(p.photo, noteInput(1), p.basis.authority);
      const submission = await f.stores.photoSubmissions.submit(p.photo, submissionInput(note, 1), p.basis.authority);
      assert.equal((await f.second.detail(p.photo)).state, 'stale');
      await f.stores.photoRights.review(p.photo, rightsInput(submission, 1), p.basis.reviewAuthority);
      const saved = await f.second.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician'));
      assert.equal(saved.submissionVersion, 2); assert.deepEqual((await f.second.detail(p.photo)).history, [saved, returned]);
    } finally { await f.close(); }
  });
  test(`${engine}: credential revocation invalidates approval; only original signer or admin can revoke with its old fixed credential`, async () => {
    const f = await backend(); try {
      const p = await preparePhotoProfessional(f.stores), saved = await f.second.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician'));
      await f.stores.workflow.saveQualification(saved.actorId, { ...credentialInput('tcm_physician'), status: 'revoked' }, 1, p.admin.account, p.admin.token);
      assert.equal((await f.second.detail(p.photo)).state, 'stale');
      const input = await p.input('tcm_physician', 'revoke');
      await assert.rejects(f.second.review(p.photo, input, p.authority('pharmacist')), rightsCode('photo_professional_independence'));
      const revoked = await f.second.review(p.photo, input, p.admin); assert.equal(revoked.qualificationRevision, 1); assert.equal(revoked.qualificationUserId, saved.actorId);
      assert.equal((await f.second.detail(p.photo)).state, 'revoked'); assert.equal((await f.second.detail(p.photo)).publicationEligible, false);
    } finally { await f.close(); }
  });
}
