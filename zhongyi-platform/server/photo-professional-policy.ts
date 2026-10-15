import { createHash } from 'node:crypto';
import type { Account, ProfessionalKind, ProfessionalQualification } from '../shared/contracts.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { parsePhotoSubmissionDetail, type PhotoSubmissionDetail } from '../shared/photo-submissions.js';
import type { PhotoRightsDetail } from '../shared/photo-rights.js';
import { parsePhotoRightsDetail } from '../shared/photo-rights-response.js';
import { PHOTO_PROFESSIONAL_SCHEMA, parsePhotoProfessionalInput, parsePhotoProfessionalReview, type PhotoProfessionalInput, type PhotoProfessionalReview, type PhotoProfessionalDetail, type PhotoProfessionalReason } from '../shared/photo-professional.js';
import { AccountError } from './auth.js';
import { photoBindingDigest } from './photo-note-values.js';
import { qualificationActive, qualificationDigest } from './professional-values.js';
import type { WriteAuthority } from './stores.js';

// Transaction adapters must provide a complete review/contributor history and
// current credentials. This pure policy never performs I/O; SQL adapters own it.
export interface PhotoProfessionalFacts {
  candidate: PrivatePhoto; submission: PhotoSubmissionDetail; rights: PhotoRightsDetail;
  reviews: PhotoProfessionalReview[]; qualifications: ProfessionalQualification[]; users: Account[]; contributorIds: string[];
}
export interface PhotoProfessionalStore {
  detail(candidate: PrivatePhoto): Promise<PhotoProfessionalDetail>;
  review(candidate: PrivatePhoto, input: unknown, authority: WriteAuthority): Promise<PhotoProfessionalReview>;
}
const professions: readonly ProfessionalKind[] = ['tcm_physician', 'pharmacist'];
function fail(status: number, code: string, message: string): never { throw new AccountError(status, code, message); }
export function photoProfessionalDigest(value: Omit<PhotoProfessionalReview, 'digest'>): string {
  // Fix a single explicit field order for newly introduced records. Caller
  // insertion order is not evidence; unknown fields still fail the parser.
  const { digest: ignored, ...canonical } = parsePhotoProfessionalReview({ ...value, digest: `sha256:${'0'.repeat(64)}` });
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}
export function verifiedPhotoProfessionalReview(value: unknown): PhotoProfessionalReview {
  try {
    const item = parsePhotoProfessionalReview(value), { digest, ...payload } = item;
    if (photoProfessionalDigest(payload) !== digest) throw new Error('Digest mismatch');
    return item;
  } catch { return fail(409, 'photo_professional_integrity', '图片专业审校记录完整性检查失败。'); }
}
export function ownPhotoProfessional(candidate: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
  let input: PhotoProfessionalInput;
  try { input = parsePhotoProfessionalInput(raw); } catch { return fail(400, 'invalid_photo_professional', '请核对图片、送审、权利和资格版本，填写独立结论与依据并明确确认。'); }
  return { candidate: parsePrivatePhoto(candidate), input, authority: { account: { ...authority.account }, token: authority.token } };
}
export function requirePhotoProfessionalReviewer(current: Account | undefined, authority: WriteAuthority): void {
  if (!current) fail(401, 'unauthorized', '会话已失效。');
  const actor = authority.account;
  if (!current.active || !['admin', 'reviewer'].includes(current.role) || current.id !== actor.id || current.username !== actor.username || current.role !== actor.role || current.revision !== actor.revision) fail(403, 'forbidden', '当前账号不能执行图片专业审校。');
}
const conclusionsMatch = (item: Pick<PhotoProfessionalReview, 'identity' | 'part' | 'processing'>) => item.identity === 'matches' && item.part === 'matches' && item.processing === 'matches';
function sameBasis(a: PhotoProfessionalReview, b: PhotoProfessionalReview): boolean {
  return a.candidateId === b.candidateId && a.bindingDigest === b.bindingDigest && a.submissionVersion === b.submissionVersion && a.submissionDigest === b.submissionDigest &&
    a.noteVersion === b.noteVersion && a.noteDigest === b.noteDigest && a.rightsVersion === b.rightsVersion && a.rightsDigest === b.rightsDigest;
}
function validateFacts(facts: PhotoProfessionalFacts): void {
  const { candidate, submission, rights, reviews, qualifications, users } = facts, binding = photoBindingDigest(candidate);
  try {
    const expected = { candidateId: candidate.id, ingredientId: candidate.ingredientId, bindingDigest: binding };
    parsePhotoSubmissionDetail(submission, expected); parsePhotoRightsDetail(rights, expected);
  } catch { fail(409, 'photo_professional_integrity', '图片审校来源、送审或权利记录结构不完整。'); }
  if (submission.candidateId !== candidate.id || rights.candidateId !== candidate.id || submission.bindingDigest !== binding || rights.bindingDigest !== binding ||
    submission.version !== rights.submissionVersion || (submission.history[0]?.digest ?? null) !== rights.submissionDigest || submission.noteVersion !== rights.noteVersion || submission.noteDigest !== rights.noteDigest ||
    rights.publicationEligible !== false || new Set(users.map(item => item.id)).size !== users.length || new Set(qualifications.map(item => item.userId)).size !== qualifications.length ||
    [...submission.history, ...rights.history].some(item => !facts.contributorIds.includes(item.actorId)) ||
    reviews.length > 10000 || reviews.length !== (reviews[0]?.version ?? 0)) fail(409, 'photo_professional_integrity', '图片审校依据不一致或历史不完整。');
  for (const credential of qualifications) {
    const { digest, ...payload } = credential;
    if (qualificationDigest(payload) !== digest || !users.some(user => user.id === credential.userId)) fail(409, 'photo_professional_integrity', '资格记录摘要或具名账号不匹配。');
  }
  const priorByProfession = new Map<ProfessionalKind, PhotoProfessionalReview>();
  let priorTime = -Infinity, priorSubmission = 0, priorRights = 0;
  for (const [index, value] of reviews.slice().reverse().entries()) {
    const item = verifiedPhotoProfessionalReview(value), previous = priorByProfession.get(item.profession), actor = users.find(user => user.id === item.actorId);
    if (item.candidateId !== candidate.id || item.ingredientId !== candidate.ingredientId || item.version !== index + 1 || !actor || actor.username !== item.actorName || actor.revision < item.accountRevision ||
      !users.some(user => user.id === item.qualificationUserId) || Date.parse(item.createdAt) < priorTime || item.submissionVersion < priorSubmission || item.rightsVersion < priorRights ||
      item.submissionVersion > submission.version || item.noteVersion > submission.noteVersion || item.rightsVersion > rights.version ||
      (item.submissionVersion === submission.version && Date.parse(item.createdAt) < Date.parse(submission.history[0]!.createdAt)) ||
      (item.rightsVersion === rights.version && Date.parse(item.createdAt) < Date.parse(rights.history[0]!.createdAt)) ||
      (item.submissionVersion === submission.version && (item.submissionDigest !== rights.submissionDigest || item.noteVersion !== submission.history[0]?.noteVersion || item.noteDigest !== submission.history[0]?.noteDigest)) ||
      (item.rightsVersion === rights.version && item.rightsDigest !== rights.history[0]?.digest)) fail(409, 'photo_professional_integrity', '图片审校历史的版本或具名账号关系无效。');
    if (item.decision === 'revoke') {
      if (!previous || previous.decision !== 'approve' || !sameBasis(item, previous) || item.qualificationUserId !== previous.qualificationUserId || item.qualificationRevision !== previous.qualificationRevision ||
        item.qualificationDigest !== previous.qualificationDigest || item.evidenceKind !== previous.evidenceKind || (item.actorRole !== 'admin' && item.actorId !== previous.actorId)) fail(409, 'photo_professional_integrity', '图片专业撤销前序无效。');
    } else if (item.qualificationUserId !== item.actorId || (item.decision === 'approve' && !conclusionsMatch(item))) fail(409, 'photo_professional_integrity', '图片专业意见与资格或核对结论不符。');
    priorTime = Date.parse(item.createdAt); priorSubmission = item.submissionVersion; priorRights = item.rightsVersion; priorByProfession.set(item.profession, item);
  }
}
function currentBasis(facts: PhotoProfessionalFacts, now: number): boolean {
  const submission = facts.submission.history[0], rights = facts.rights.history[0];
  const rightsActor = facts.users.find(user => user.id === rights?.actorId);
  return !!submission && !!rights && submission.bindingDigest === facts.submission.bindingDigest && submission.noteVersion === facts.submission.noteVersion && submission.noteDigest === facts.submission.noteDigest &&
    facts.submission.noteBindingDigest === facts.submission.bindingDigest && rights.submissionVersion === submission.version && rights.submissionDigest === submission.digest && rights.bindingDigest === facts.submission.bindingDigest &&
    rights.decision === 'approve' && ['rights_verified', 'recorded'].includes(facts.rights.state) && !!rightsActor?.active && rightsActor.role === rights.actorRole && rightsActor.revision === rights.accountRevision && Date.parse(rights.validUntil) > now;
}
function matchesCurrent(item: PhotoProfessionalReview, facts: PhotoProfessionalFacts): boolean {
  return item.bindingDigest === facts.submission.bindingDigest && item.submissionVersion === facts.submission.version && item.submissionDigest === facts.rights.submissionDigest &&
    item.noteVersion === facts.submission.noteVersion && item.noteDigest === facts.submission.noteDigest && item.rightsVersion === facts.rights.version && item.rightsDigest === facts.rights.history[0]?.digest;
}
export function photoProfessionalDetail(facts: PhotoProfessionalFacts, now = Date.now()): PhotoProfessionalDetail {
  validateFacts(facts);
  const latestReviews = professions.flatMap(profession => facts.reviews.find(item => item.profession === profession) ?? []), reasons: PhotoProfessionalReason[] = [];
  if (!facts.submission.history[0] || facts.submission.noteBindingDigest !== facts.submission.bindingDigest) reasons.push('missing_current_submission');
  if (!currentBasis(facts, now)) reasons.push('rights_not_current');
  let approved = 0, stale = !currentBasis(facts, now) && facts.reviews.length > 0, fixture = facts.rights.state === 'recorded', returned = false, revoked = false;
  const signers = new Set<string>();
  for (const profession of professions) {
    const review = latestReviews.find(item => item.profession === profession);
    if (!review) { reasons.push(profession === 'tcm_physician' ? 'physician_pending' : 'pharmacist_pending'); continue; }
    if (!matchesCurrent(review, facts)) { reasons.push('review_basis_changed'); stale = true; continue; }
    if (review.decision === 'return') { reasons.push('returned'); returned = true; continue; }
    if (review.decision === 'revoke') { reasons.push('revoked'); revoked = true; continue; }
    const qualification = facts.qualifications.find(item => item.userId === review.qualificationUserId), actor = facts.users.find(item => item.id === review.actorId);
    if (!qualificationActive(qualification, actor, now) || !qualification?.verificationConfirmed || qualification.revision !== review.qualificationRevision || qualification.digest !== review.qualificationDigest ||
      qualification.profession !== profession || review.accountRevision !== actor?.revision || review.actorRole !== actor.role || review.evidenceKind !== qualification.evidenceKind) { reasons.push('qualification_changed'); stale = true; continue; }
    if (facts.contributorIds.includes(review.actorId)) { reasons.push('contributor_conflict'); stale = true; continue; }
    approved++; signers.add(review.actorId); fixture ||= review.evidenceKind === 'test-fixture';
  }
  if (fixture && approved) reasons.push('test_evidence');
  if (approved === 2 && signers.size !== 2) { reasons.push('distinct_signers_required'); stale = true; }
  const state: PhotoProfessionalDetail['state'] = stale ? 'stale' : returned ? 'changes_requested' : revoked ? 'revoked' : approved === 2 && !fixture ? 'eligible_for_derivative_review' : approved ? 'recorded' : 'pending';
  return { schemaVersion: PHOTO_PROFESSIONAL_SCHEMA, candidateId: facts.candidate.id, bindingDigest: facts.submission.bindingDigest, submissionVersion: facts.submission.version, submissionDigest: facts.rights.submissionDigest,
    noteVersion: facts.submission.noteVersion, noteDigest: facts.submission.noteDigest, rightsVersion: facts.rights.version, rightsDigest: facts.rights.history[0]?.digest ?? null,
    version: facts.reviews[0]?.version ?? 0, history: facts.reviews.slice(0, 50).map(verifiedPhotoProfessionalReview), latestReviews: latestReviews.map(verifiedPhotoProfessionalReview), state, reasons: [...new Set(reasons)], publicationEligible: false };
}
export function nextPhotoProfessional(facts: PhotoProfessionalFacts, raw: PhotoProfessionalInput, actor: Account, now = Date.now()): PhotoProfessionalReview {
  const input = parsePhotoProfessionalInput(raw), detail = photoProfessionalDetail(facts, now), currentActor = facts.users.find(user => user.id === actor.id);
  if (!currentActor?.active || !['admin', 'reviewer'].includes(currentActor.role) || currentActor.username !== actor.username || currentActor.role !== actor.role || currentActor.revision !== actor.revision) fail(403, 'forbidden', '当前账号不能执行图片专业审校。');
  if (detail.version !== input.expectedVersion || detail.bindingDigest !== input.bindingDigest || detail.submissionVersion !== input.expectedSubmissionVersion || detail.submissionDigest !== input.submissionDigest ||
    detail.noteVersion !== input.expectedNoteVersion || detail.noteDigest !== input.noteDigest || detail.rightsVersion !== input.expectedRightsVersion || detail.rightsDigest !== input.rightsDigest) fail(409, 'photo_professional_conflict', '图片、核对、送审、权利或专业意见版本已变化，请重新读取。');
  if (!currentBasis(facts, now)) fail(409, 'photo_professional_basis_required', '当前送审与权利依据尚未就绪，不能审校。');
  if (!Number.isFinite(now) || now < Date.parse(facts.submission.history[0].createdAt) || now < Date.parse(facts.rights.history[0].createdAt)) fail(409, 'photo_professional_clock', '审校时间不能早于所依据的送审与权利记录，请核对服务器时钟。');
  if (detail.version >= 10000) fail(409, 'photo_professional_limit', '该图片的审校历史达到上限，请联系管理员归档。');
  const previous = detail.latestReviews.find(item => item.profession === input.profession);
  let qualificationUserId = actor.id, evidenceKind: PhotoProfessionalReview['evidenceKind'];
  if (input.decision === 'revoke') {
    if (!previous || previous.decision !== 'approve' || !matchesCurrent(previous, facts) || previous.qualificationRevision !== input.expectedQualificationRevision || previous.qualificationDigest !== input.qualificationDigest) fail(409, 'photo_professional_not_approved', '没有可撤销的当前专业通过记录。');
    if (actor.role !== 'admin' && actor.id !== previous.actorId) fail(403, 'photo_professional_independence', '仅原审校人或管理员可以撤销。');
    qualificationUserId = previous.qualificationUserId; evidenceKind = previous.evidenceKind;
  } else {
    const qualification = facts.qualifications.find(item => item.userId === actor.id);
    if (!qualificationActive(qualification, actor, now) || !qualification?.verificationConfirmed || qualification.profession !== input.profession || qualification.revision !== input.expectedQualificationRevision || qualification.digest !== input.qualificationDigest) fail(403, 'photo_qualification_required', '需当前有效、与账号版本及专业类别一致的资格记录。');
    if (facts.contributorIds.includes(actor.id)) fail(403, 'photo_professional_independence', '参与该图片核对、送审或权利审核的账号不能作专业审校。');
    if (previous?.decision === 'return' && previous.submissionVersion === detail.submissionVersion) fail(409, 'photo_professional_revision_required', '已退回的图片资料须修改并重新送审。');
    if (input.decision === 'approve' && (input.identity !== 'matches' || input.part !== 'matches' || input.processing !== 'matches')) fail(400, 'photo_match_required', '身份、部位及加工形态均须有明确匹配结论，不能以未知或不匹配批准。');
    if (previous?.decision === 'approve' && matchesCurrent(previous, facts) && input.decision === 'approve' && previous.qualificationDigest === qualification.digest) fail(409, 'photo_professional_duplicate', '该专业已通过当前固定版本，不能重复提交批准。');
    evidenceKind = qualification.evidenceKind;
  }
  const actorRole = actor.role;
  if (actorRole !== 'admin' && actorRole !== 'reviewer') return fail(403, 'forbidden', '账号不能专业审校。');
  const payload = { candidateId: facts.candidate.id, ingredientId: facts.candidate.ingredientId, version: detail.version + 1, bindingDigest: input.bindingDigest,
    submissionVersion: input.expectedSubmissionVersion, submissionDigest: input.submissionDigest, noteVersion: input.expectedNoteVersion, noteDigest: input.noteDigest, rightsVersion: input.expectedRightsVersion, rightsDigest: input.rightsDigest,
    profession: input.profession, qualificationUserId, qualificationRevision: input.expectedQualificationRevision, qualificationDigest: input.qualificationDigest, evidenceKind,
    decision: input.decision, identity: input.identity, part: input.part, processing: input.processing, evidenceReference: input.evidenceReference, comment: input.comment, verificationConfirmed: input.verificationConfirmed,
    actorId: actor.id, actorName: actor.username, actorRole, accountRevision: actor.revision, createdAt: new Date(now).toISOString() };
  return { ...payload, digest: photoProfessionalDigest(payload) };
}
