import type { Account } from '../shared/contracts.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { PHOTO_RIGHTS_SCHEMA, parsePhotoRightsInput, type PhotoRightsInput, type PhotoRightsReview, type PhotoRightsDetail } from '../shared/photo-rights.js';
import type { PhotoSubmissionDetail } from '../shared/photo-submissions.js';
import { AccountError } from './auth.js';
import { photoRightsDigest } from './photo-rights-values.js';
import type { WriteAuthority } from './stores.js';
export interface PhotoRightsStore {
  detail(candidate: PrivatePhoto): Promise<PhotoRightsDetail>;
  review(candidate: PrivatePhoto, input: unknown, authority: WriteAuthority): Promise<PhotoRightsReview>;
}
export function ownPhotoRights(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
  const candidate = parsePrivatePhoto(value); let input: PhotoRightsInput;
  try { input = parsePhotoRightsInput(raw); } catch { throw new AccountError(400, 'invalid_photo_rights', '请核对送审版本、权利依据、署名和修改方案并明确确认。'); }
  return { candidate, input, authority: { account: { ...authority.account }, token: authority.token } };
}
export function requirePhotoRightsReviewer(current: Account | undefined, authority: WriteAuthority): void {
  if (!current) throw new AccountError(401, 'unauthorized', '会话已失效。');
  const actor = authority.account;
  if (!current.active || !['admin', 'reviewer'].includes(current.role) || current.id !== actor.id || current.username !== actor.username || current.role !== actor.role || current.revision !== actor.revision) throw new AccountError(403, 'forbidden', '当前账号不能执行图片权利审核。');
}
export function photoRightsDetail(candidate: PrivatePhoto, basis: PhotoSubmissionDetail, history: PhotoRightsReview[], users: Account[], now: number): PhotoRightsDetail {
  if (history.some((item, index) => item.candidateId !== candidate.id || item.ingredientId !== candidate.ingredientId || item.version !== (history[0]?.version ?? 0) - index) || history.length !== Math.min(history[0]?.version ?? 0, 50)) throw new AccountError(409, 'photo_rights_integrity', '图片权利审核历史不连续。');
  const latest = history[0], submission = basis.history[0], actor = users.find(user => user.id === latest?.actorId);
  const current = submission && submission.bindingDigest === basis.bindingDigest && submission.noteVersion === basis.noteVersion && submission.noteDigest === basis.noteDigest && basis.noteBindingDigest === basis.bindingDigest;
  let state: PhotoRightsDetail['state'] = 'pending';
  if (latest) {
    if (!current || latest.submissionVersion !== submission.version || latest.submissionDigest !== submission.digest || latest.bindingDigest !== basis.bindingDigest) state = 'stale';
    else if (latest.decision === 'revoke') state = 'revoked';
    else if (latest.decision === 'return') state = 'changes_requested';
    else if (!actor?.active || actor.role !== latest.actorRole || actor.revision !== latest.accountRevision || Date.parse(latest.validUntil) <= now) state = 'stale';
    else state = latest.evidenceKind === 'manual-verification' ? 'rights_verified' : 'recorded';
  }
  return { schemaVersion: PHOTO_RIGHTS_SCHEMA, candidateId: candidate.id, bindingDigest: basis.bindingDigest, submissionVersion: basis.version, submissionDigest: submission?.digest ?? null,
    noteVersion: basis.noteVersion, noteDigest: basis.noteDigest, version: latest?.version ?? 0, history, state, publicationEligible: false };
}
export function nextPhotoRights(candidate: PrivatePhoto, basis: PhotoSubmissionDetail, current: PhotoRightsDetail, contributorIds: string[], input: PhotoRightsInput, actor: Account, now: number): PhotoRightsReview {
  const actorRole = actor.role;
  if (actorRole !== 'admin' && actorRole !== 'reviewer') throw new AccountError(403, 'forbidden', '当前账号不能执行图片权利审核。');
  const submission = basis.history[0];
  if (!submission || current.version !== input.expectedVersion || basis.version !== input.expectedSubmissionVersion || submission.digest !== input.submissionDigest || basis.bindingDigest !== input.bindingDigest ||
    submission.bindingDigest !== basis.bindingDigest || basis.noteBindingDigest !== basis.bindingDigest || basis.noteVersion !== input.expectedNoteVersion || basis.noteDigest !== input.noteDigest || submission.noteVersion !== basis.noteVersion || submission.noteDigest !== basis.noteDigest) throw new AccountError(409, 'photo_rights_conflict', '原图、来源、核对或送审版本已变化，请重新读取；本次未审核。');
  if (input.decision === 'revoke' ? actor.role !== 'admin' && current.history[0]?.actorId !== actor.id : contributorIds.includes(actor.id)) throw new AccountError(403, 'photo_rights_independence', '权利审核须独立于核对和送审；撤销须由原审核人或管理员执行。');
  if (input.decision === 'approve' && (Date.parse(input.validUntil) <= now || Date.parse(input.validUntil) > now + 366 * 86400000)) throw new AccountError(400, 'invalid_photo_rights_expiry', '批准有效期须晚于当前时间且不超过366天。');
  if (input.decision === 'revoke' && (current.history[0]?.decision !== 'approve' || current.history[0].submissionVersion !== submission.version || current.history[0].submissionDigest !== submission.digest)) throw new AccountError(409, 'photo_rights_not_approved', '没有可撤销的当前批准记录。');
  if (current.version >= 10000) throw new AccountError(409, 'photo_rights_limit', '该候选审核历史达到上限，请联系管理员归档。');
  const payload = { candidateId: candidate.id, ingredientId: candidate.ingredientId, version: current.version + 1, submissionVersion: submission.version, submissionDigest: submission.digest, bindingDigest: basis.bindingDigest,
    decision: input.decision, evidenceKind: input.evidenceKind, evidenceReference: input.evidenceReference, attributionPlan: input.attributionPlan, alterationPlan: input.alterationPlan, validUntil: input.validUntil, comment: input.comment, verificationConfirmed: input.verificationConfirmed,
    actorId: actor.id, actorName: actor.username, actorRole, accountRevision: actor.revision, createdAt: new Date(now).toISOString() };
  return { ...payload, digest: photoRightsDigest(payload) };
}
