import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProfessionalKind, QualificationInput } from '../shared/contracts.js';
import type { PhotoProfessionalInput, PhotoProfessionalReview } from '../shared/photo-professional.js';
import { parsePhotoProfessionalInput, parsePhotoProfessionalReview } from '../shared/photo-professional.js';
import { nextPhotoProfessional, ownPhotoProfessional, photoProfessionalDetail, photoProfessionalDigest, requirePhotoProfessionalReviewer, verifiedPhotoProfessionalReview, type PhotoProfessionalFacts } from '../server/photo-professional-policy.js';
import type { WriteAuthority } from '../server/stores.js';
import { rightsResponseFixture } from './photo-rights-response-fixture.js';
import { rightsInput } from './photo-rights-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { credentialInput } from './professional-fixture.js';
import { fixturePassword } from './migration-fixture.js';

// Existing SQLite supplies actual accounts, credentials, opinions, submissions
// and rights records. NEW professional-photo records remain in-memory policy
// inputs in this suite: it is not persistence/HTTP/UI/real-professional evidence.
async function fixture(kind: QualificationInput['evidenceKind'] = 'test-fixture') {
  const f = await rightsResponseFixture();
  try {
    const adminLogin = await f.stores.auth.login('migration-admin', fixturePassword, 'photo-professional-admin');
    const admin: WriteAuthority = { account: adminLogin.info.user, token: adminLogin.token };
    const physician = await f.stores.auth.createUser('photo-physician', fixturePassword, 'reviewer', 'ENGINEERING_SIMULATION_NOT_REAL');
    const pharmacist = await f.stores.auth.createUser('photo-pharmacist', fixturePassword, 'reviewer', 'ENGINEERING_SIMULATION_NOT_REAL');
    const physicianLogin = await f.stores.auth.login(physician.username, fixturePassword, 'photo-physician-test');
    const pharmacistLogin = await f.stores.auth.login(pharmacist.username, fixturePassword, 'photo-pharmacist-test');
    const authorities = { tcm_physician: { account: physicianLogin.info.user, token: physicianLogin.token }, pharmacist: { account: pharmacistLogin.info.user, token: pharmacistLogin.token } };
    for (const profession of ['tcm_physician', 'pharmacist'] as const) await f.stores.workflow.saveQualification(authorities[profession].account.id,
      { ...credentialInput(profession), evidenceKind: kind, evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:credential', comment: '仅测试人工分支，不构成真人资格核验。' }, 0, admin.account, admin.token);
    if (kind === 'manual-verification') await f.stores.photoRights.review(f.photo, { ...rightsInput(f.prepared.submission, 1), evidenceKind: kind, comment: 'ENGINEERING_SIMULATION_NOT_REAL：仅测试人工依据分支。' }, f.prepared.reviewAuthority);
    const reviews: PhotoProfessionalReview[] = [], contributors = [f.prepared.authority.account.id, f.prepared.reviewAuthority.account.id];
    async function facts(): Promise<PhotoProfessionalFacts> {
      return { candidate: f.photo, submission: await f.stores.photoSubmissions.detail(f.photo), rights: await f.stores.photoRights.detail(f.photo), reviews: reviews.slice(),
        qualifications: await Promise.all(Object.values(authorities).map(async authority => (await f.stores.workflow.qualificationHistory(authority.account.id))[0])), users: await f.stores.auth.users(), contributorIds: contributors.slice() };
    }
    async function input(profession: ProfessionalKind, decision: PhotoProfessionalInput['decision'] = 'approve'): Promise<PhotoProfessionalInput> {
      const value = await facts(), qualification = value.qualifications.find(q => q.userId === authorities[profession].account.id)!;
      const previous = reviews.find(item => item.profession === profession), credential = decision === 'revoke' && previous ? { revision: previous.qualificationRevision, digest: previous.qualificationDigest } : qualification;
      return { bindingDigest: value.rights.bindingDigest, expectedVersion: reviews[0]?.version ?? 0, expectedSubmissionVersion: value.submission.version, submissionDigest: value.submission.history[0].digest,
        expectedNoteVersion: value.submission.noteVersion, noteDigest: value.submission.noteDigest!, expectedRightsVersion: value.rights.version, rightsDigest: value.rights.history[0].digest,
        profession, expectedQualificationRevision: credential.revision, qualificationDigest: credential.digest, decision, identity: 'matches', part: 'matches', processing: 'matches',
        evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:fixed-reference-location', comment: '仅策略演练，不是真人鉴定、专业批准或可食性结论。', verificationConfirmed: true };
    }
    async function append(raw: PhotoProfessionalInput, authority: WriteAuthority = authorities[raw.profession]) {
      const owned = ownPhotoProfessional(f.photo, raw, authority);
      requirePhotoProfessionalReviewer((await f.stores.auth.session(owned.authority.token))?.user, owned.authority);
      const item = nextPhotoProfessional(await facts(), owned.input, owned.authority.account); reviews.unshift(item); return item;
    }
    return { ...f, admin, authorities, reviews, contributors, facts, input, append };
  } catch (error) { await f.close(); throw error; }
}
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
function rehash(value: PhotoProfessionalReview, changed: Partial<PhotoProfessionalReview>): PhotoProfessionalReview {
  const { digest: ignored, ...payload } = { ...value, ...changed }; return { ...payload, digest: photoProfessionalDigest(payload) };
}

test('photo-professional input/record contracts reject unknown approval, forged actor and unsafe values; owned inputs are detached', async () => {
  const f = await fixture();
  try {
    const input = await f.input('tcm_physician'), authority = f.authorities.tcm_physician;
    assert.deepEqual(parsePhotoProfessionalInput(input), input);
    for (const changed of [{ approved: true }, { publicationEligible: true }, { evidenceKind: 'manual-verification' }, { actorId: authority.account.id }, { verificationConfirmed: false },
      { expectedVersion: -1 }, { expectedRightsVersion: 0 }, { qualificationDigest: 'sha256:bad' }, { processing: 'unknown' }, { comment: '\u0000' }, { evidenceReference: ' '.repeat(10) }]) assert.throws(() => parsePhotoProfessionalInput({ ...input, ...changed }));
    const owned = ownPhotoProfessional(f.photo, input, authority); input.comment = 'caller mutation'; f.photo.concerns.push('caller mutation');
    assert.notEqual(owned.input.comment, input.comment); assert(!owned.candidate.concerns.includes('caller mutation'));
    assert.throws(() => ownPhotoProfessional(f.photo, { ...input, userId: 'forged' }, authority), code('invalid_photo_professional'));
    assert.throws(() => requirePhotoProfessionalReviewer(undefined, authority), code('unauthorized'));
    assert.throws(() => requirePhotoProfessionalReviewer({ ...authority.account, revision: 2 }, authority), code('forbidden'));
  } finally { await f.close(); }
});
test('two independent engineering professions bind all heads and credentials, remain recorded and cannot publish', async () => {
  const f = await fixture();
  try {
    const before = await f.stores.catalog.publicSnapshot(), physician = await f.append(await f.input('tcm_physician'));
    assert.deepEqual(verifiedPhotoProfessionalReview(physician), physician); assert.deepEqual(parsePhotoProfessionalReview(physician), physician);
    assert.equal(physician.evidenceKind, 'test-fixture'); assert.equal(physician.qualificationUserId, f.authorities.tcm_physician.account.id);
    const pharmacist = await f.append(await f.input('pharmacist')), detail = photoProfessionalDetail(await f.facts());
    assert.equal(detail.state, 'recorded'); assert(detail.reasons.includes('test_evidence')); assert.equal(detail.publicationEligible, false);
    assert.equal(detail.history.length, 2); assert.equal(detail.latestReviews.length, 2); assert.equal(pharmacist.rightsDigest, f.saved.digest);
    detail.history[0].comment = 'detached result'; assert.notEqual(f.reviews[0].comment, 'detached result');
    assert.deepEqual(await f.stores.catalog.publicSnapshot(), before); assert.equal(f.photo.professionalReview, 'pending');
    assert.throws(() => verifiedPhotoProfessionalReview({ ...physician, comment: 'tampered' }), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
test('manual-evidence branch needs two distinct professions and only prepares derivative review, never public use', async () => {
  const f = await fixture('manual-verification');
  try {
    const before = await f.stores.catalog.publicSnapshot(); await f.append(await f.input('tcm_physician'));
    assert.equal(photoProfessionalDetail(await f.facts()).state, 'recorded'); await f.append(await f.input('pharmacist'));
    const detail = photoProfessionalDetail(await f.facts()); assert.equal(detail.state, 'eligible_for_derivative_review'); assert.equal(detail.publicationEligible, false);
    assert.equal(new Set(detail.latestReviews.map(item => item.actorId)).size, 2); assert(!detail.reasons.includes('test_evidence')); assert.deepEqual(await f.stores.catalog.publicSnapshot(), before);
    const sameSigner = await f.facts(), physician = sameSigner.reviews[1];
    sameSigner.reviews[0] = rehash(sameSigner.reviews[0], { actorId: physician.actorId, actorName: physician.actorName, qualificationUserId: physician.qualificationUserId, qualificationDigest: physician.qualificationDigest });
    assert.equal(photoProfessionalDetail(sameSigner).state, 'stale');
    const facts = await f.facts(); facts.qualifications[0].comment = 'altered credential'; assert.throws(() => photoProfessionalDetail(facts), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
test('uncertain/mismatched identity, part or processing cannot approve; a return requires revised submission', async () => {
  const f = await fixture();
  try {
    const value = await f.facts(), input = await f.input('tcm_physician');
    for (const field of ['identity', 'part', 'processing'] as const) for (const result of ['uncertain', 'mismatch'] as const) assert.throws(() => nextPhotoProfessional(value, { ...input, [field]: result }, f.authorities.tcm_physician.account), code('photo_match_required'));
    const returned = await f.append({ ...input, decision: 'return', identity: 'uncertain' }); assert.equal(returned.identity, 'uncertain');
    assert.equal(photoProfessionalDetail(await f.facts()).state, 'changes_requested');
    await assert.rejects(f.append(await f.input('tcm_physician')), code('photo_professional_revision_required'));
    assert.equal(f.reviews.length, 1);
  } finally { await f.close(); }
});
test('global CAS rejects old parallel intent; every bound head and qualification reference is checked', async () => {
  const f = await fixture();
  try {
    const physician = await f.input('tcm_physician'), pharmacist = await f.input('pharmacist'); await f.append(physician);
    await assert.rejects(f.append(pharmacist), code('photo_professional_conflict'));
    const facts = await f.facts(), input = await f.input('pharmacist');
    for (const changed of [{ bindingDigest: `sha256:${'1'.repeat(64)}` }, { expectedVersion: 0 }, { expectedSubmissionVersion: 2 }, { submissionDigest: `sha256:${'1'.repeat(64)}` },
      { expectedNoteVersion: 2 }, { noteDigest: `sha256:${'1'.repeat(64)}` }, { expectedRightsVersion: 2 }, { rightsDigest: `sha256:${'1'.repeat(64)}` }]) assert.throws(() => nextPhotoProfessional(facts, { ...input, ...changed }, f.authorities.pharmacist.account), code('photo_professional_conflict'));
    assert.throws(() => nextPhotoProfessional(facts, { ...input, expectedQualificationRevision: 2 }, f.authorities.pharmacist.account), code('photo_qualification_required'));
    assert.throws(() => nextPhotoProfessional(facts, { ...input, profession: 'tcm_physician' }, f.authorities.pharmacist.account), code('photo_qualification_required'));
    await assert.rejects(f.append(await f.input('tcm_physician')), code('photo_professional_duplicate'));
    await f.append(await f.input('pharmacist')); assert.equal(f.reviews.length, 2);
  } finally { await f.close(); }
});
test('actual opinion/submission/rights changes invalidate old photo decisions; new pinned material needs fresh review', async () => {
  const f = await fixture();
  try {
    const original = await f.append(await f.input('tcm_physician')), old = await f.input('pharmacist');
    const note = await f.stores.photoNotes.save(f.photo, noteInput(1, f.photo), f.prepared.authority);
    assert.equal(photoProfessionalDetail(await f.facts()).state, 'stale'); await assert.rejects(f.append(old), code('photo_professional_conflict'));
    await assert.rejects(f.append(await f.input('pharmacist')), code('photo_professional_basis_required'));
    const submission = await f.stores.photoSubmissions.submit(f.photo, submissionInput(note, 1), f.prepared.authority);
    await f.stores.photoRights.review(f.photo, rightsInput(submission, 1), f.prepared.reviewAuthority);
    const fresh = await f.append(await f.input('tcm_physician')); assert.equal(fresh.submissionVersion, 2); assert.equal(fresh.rightsVersion, 2);
    await f.append(await f.input('pharmacist')); assert.equal(photoProfessionalDetail(await f.facts()).state, 'recorded'); assert.deepEqual(f.reviews[2], original);
  } finally { await f.close(); }
});
test('current authority and complete contributor history prevent self-review even outside any displayed window', async () => {
  const f = await fixture();
  try {
    const input = await f.input('tcm_physician'), actor = f.authorities.tcm_physician.account;
    f.contributors.push(actor.id); await assert.rejects(f.append(input), code('photo_professional_independence')); f.contributors.pop();
    const facts = await f.facts(); assert.throws(() => nextPhotoProfessional(facts, input, { ...actor, role: 'admin' }), code('forbidden'));
    assert.throws(() => nextPhotoProfessional(facts, input, { ...actor, username: 'forged' }), code('forbidden'));
    await f.append(input); await f.stores.auth.updateUser(actor.id, 'reviewer', true, actor.revision, f.admin.account.username);
    assert.equal(photoProfessionalDetail(await f.facts()).state, 'stale'); await assert.rejects(f.append(await f.input('tcm_physician')), code('unauthorized'));
    const missingContributors = await f.facts(); missingContributors.contributorIds = []; assert.throws(() => photoProfessionalDetail(missingContributors), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
test('revoked credential invalidates approval but original signer/admin can revoke; foreign reviewer cannot', async () => {
  const f = await fixture();
  try {
    const saved = await f.append(await f.input('tcm_physician')), qualification = (await f.facts()).qualifications[0];
    await f.stores.workflow.saveQualification(qualification.userId, { ...credentialInput('tcm_physician'), status: 'revoked' }, 1, f.admin.account, f.admin.token);
    assert.equal(photoProfessionalDetail(await f.facts()).state, 'stale');
    const input = await f.input('tcm_physician', 'revoke'); await assert.rejects(f.append(input, f.authorities.pharmacist), code('photo_professional_independence'));
    const revoked = await f.append(input, f.admin); assert.equal(revoked.actorId, f.admin.account.id); assert.equal(revoked.qualificationUserId, saved.actorId);
    assert.equal(revoked.qualificationRevision, saved.qualificationRevision); assert.equal(photoProfessionalDetail(await f.facts()).state, 'revoked');
    await assert.rejects(f.append(await f.input('tcm_physician', 'revoke'), f.admin), code('photo_professional_not_approved'));
    assert.deepEqual(f.reviews[1], saved);
  } finally { await f.close(); }
});
test('complete review history is mandatory; validly rehashed foreign qualification/actor/revocation links still fail', async () => {
  const f = await fixture();
  try {
    const saved = await f.append(await f.input('tcm_physician')); await f.append(await f.input('pharmacist'));
    const facts = await f.facts();
    for (const changed of [{ version: 9 }, { candidateId: 'other' }, { ingredientId: 'jiang' }, { actorName: 'forged' }, { qualificationUserId: f.admin.account.id },
      { decision: 'revoke' as const }, { processing: 'uncertain' as const }, { submissionDigest: `sha256:${'1'.repeat(64)}` }, { rightsDigest: `sha256:${'1'.repeat(64)}` }]) {
      const bad = rehash(saved, changed); assert.throws(() => photoProfessionalDetail({ ...facts, reviews: [facts.reviews[0], bad] }), code('photo_professional_integrity'));
    }
    assert.throws(() => photoProfessionalDetail({ ...facts, reviews: facts.reviews.slice(0, 1) }), code('photo_professional_integrity'));
    assert.throws(() => photoProfessionalDetail({ ...facts, rights: { ...facts.rights, publicationEligible: true } as unknown as PhotoProfessionalFacts['rights'] }), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
test('latest per profession survives a 50-row display window; trimming source history cannot fabricate pending status', async () => {
  const f = await fixture();
  try {
    const pharmacist = await f.append(await f.input('pharmacist'));
    for (let index = 0; index < 26; index++) { await f.append(await f.input('tcm_physician')); await f.append(await f.input('tcm_physician', 'revoke')); }
    await f.append(await f.input('tcm_physician'));
    const facts = await f.facts(), detail = photoProfessionalDetail(facts);
    assert.equal(detail.version, 54); assert.equal(detail.history.length, 50); assert(!detail.history.some(item => item.version === 1));
    assert.deepEqual(detail.latestReviews.find(item => item.profession === 'pharmacist'), pharmacist); assert.equal(detail.state, 'recorded');
    assert.throws(() => photoProfessionalDetail({ ...facts, reviews: detail.history }), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
test('rights and credential expiry are rechecked against the policy clock; old cached state cannot authorize new approval', async () => {
  const f = await fixture();
  try {
    await f.append(await f.input('tcm_physician')); const facts = await f.facts(), input = await f.input('pharmacist');
    const now = Date.parse(facts.rights.history[0].validUntil) + 1;
    assert.equal(facts.rights.state, 'recorded'); const expired = photoProfessionalDetail(facts, now); assert.equal(expired.state, 'stale'); assert(expired.reasons.includes('rights_not_current'));
    assert.throws(() => nextPhotoProfessional(facts, input, f.authorities.pharmacist.account, now), code('photo_professional_basis_required'));
    const qualificationExpiry = Date.parse(facts.qualifications[0].validUntil) + 1; assert(photoProfessionalDetail(facts, qualificationExpiry).reasons.includes('qualification_changed'));
  } finally { await f.close(); }
});
test('new photo-professional canonical hash ignores insertion order, not fields or the three match conclusions', async () => {
  const f = await fixture();
  try {
    const item = await f.append(await f.input('tcm_physician')), { digest, ...payload } = item;
    const reversed: unknown = Object.fromEntries(Object.entries(payload).reverse());
    const normalized = parsePhotoProfessionalReview({ ...Object.fromEntries(Object.entries(payload).reverse()), digest });
    assert.deepEqual(verifiedPhotoProfessionalReview({ ...Object.fromEntries(Object.entries(payload).reverse()), digest }), normalized);
    assert.equal(photoProfessionalDigest(payload), digest);
    assert(reversed && typeof reversed === 'object');
    assert.throws(() => verifiedPhotoProfessionalReview({ ...payload, digest, approved: true }), code('photo_professional_integrity'));
    assert.throws(() => verifiedPhotoProfessionalReview({ ...payload, digest, part: 'uncertain' }), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
test('review cannot predate its pinned sources; validly rehashed backdating is rejected on later read', async () => {
  const f = await fixture();
  try {
    const input = await f.input('tcm_physician'), facts = await f.facts(), earlier = Date.parse(facts.rights.history[0].createdAt) - 1;
    assert.throws(() => nextPhotoProfessional(facts, input, f.authorities.tcm_physician.account, earlier), code('photo_professional_clock'));
    const saved = await f.append(input), bad = rehash(saved, { createdAt: new Date(0).toISOString() }), updated = await f.facts();
    assert.throws(() => photoProfessionalDetail({ ...updated, reviews: [bad] }), code('photo_professional_integrity'));
  } finally { await f.close(); }
});
