import { createHash } from 'node:crypto';
import { parsePhotoRightsReview, type PhotoRightsReview } from '../shared/photo-rights.js';
import { AccountError } from './auth.js';
export const photoRightsDigest = (value: Omit<PhotoRightsReview, 'digest'>): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
export const PHOTO_RIGHTS_COLUMNS = ['candidate_id', 'ingredient_id', 'version', 'submission_version', 'submission_digest', 'binding_digest', 'decision', 'evidence_kind', 'evidence_reference', 'attribution_plan', 'alteration_plan', 'valid_until', 'comment', 'verification_confirmed', 'actor_id', 'actor_name', 'actor_role', 'account_revision', 'created_at', 'digest'] as const;
export const PHOTO_RIGHTS_INSERT = `INSERT INTO photo_rights_reviews (${PHOTO_RIGHTS_COLUMNS.join(', ')}) VALUES (${PHOTO_RIGHTS_COLUMNS.map(() => '?').join(', ')})`;
export function photoRightsValues(item: PhotoRightsReview): (string | number)[] {
  return [item.candidateId, item.ingredientId, item.version, item.submissionVersion, item.submissionDigest, item.bindingDigest, item.decision, item.evidenceKind, item.evidenceReference,
    item.attributionPlan, item.alterationPlan, item.validUntil, item.comment, 1, item.actorId, item.actorName, item.actorRole, item.accountRevision, item.createdAt, item.digest];
}
export function photoRightsFrom(row: Record<string, unknown>): PhotoRightsReview {
  try {
    if (Object.keys(row).length !== PHOTO_RIGHTS_COLUMNS.length || PHOTO_RIGHTS_COLUMNS.some(key => !Object.hasOwn(row, key)) || row.verification_confirmed !== 1) throw new Error('Invalid rights row');
    const item = parsePhotoRightsReview({ candidateId: row.candidate_id, ingredientId: row.ingredient_id, version: row.version, submissionVersion: row.submission_version, submissionDigest: row.submission_digest, bindingDigest: row.binding_digest,
      decision: row.decision, evidenceKind: row.evidence_kind, evidenceReference: row.evidence_reference, attributionPlan: row.attribution_plan, alterationPlan: row.alteration_plan, validUntil: row.valid_until, comment: row.comment, verificationConfirmed: true,
      actorId: row.actor_id, actorName: row.actor_name, actorRole: row.actor_role, accountRevision: row.account_revision, createdAt: row.created_at, digest: row.digest });
    const { digest, ...payload } = item;
    if (photoRightsDigest(payload) !== digest || PHOTO_RIGHTS_COLUMNS.some((key, index) => row[key] !== photoRightsValues(item)[index])) throw new Error('Rights integrity mismatch');
    return item;
  } catch { throw new AccountError(409, 'photo_rights_integrity', '图片权利审核历史完整性检查失败，请联系管理员。'); }
}
