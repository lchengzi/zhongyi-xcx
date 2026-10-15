import type { PhotoProfessionalReview } from '../shared/photo-professional.js';
import { verifiedPhotoProfessionalReview } from './photo-professional-policy.js';
import { AccountError } from './auth.js';
export const PHOTO_PROFESSIONAL_COLUMNS = ['candidate_id', 'ingredient_id', 'version', 'binding_digest', 'submission_version', 'submission_digest', 'note_version', 'note_digest', 'rights_version', 'rights_digest',
  'profession', 'qualification_user_id', 'qualification_revision', 'qualification_digest', 'evidence_kind', 'decision', 'identity_match', 'part_match', 'processing_match', 'evidence_reference', 'comment', 'verification_confirmed',
  'actor_id', 'actor_name', 'actor_role', 'account_revision', 'created_at', 'digest'] as const;
export const PHOTO_PROFESSIONAL_INSERT = `INSERT INTO photo_professional_reviews (${PHOTO_PROFESSIONAL_COLUMNS.join(', ')}) VALUES (${PHOTO_PROFESSIONAL_COLUMNS.map(() => '?').join(', ')})`;
export function photoProfessionalValues(item: PhotoProfessionalReview): (string | number)[] {
  return [item.candidateId, item.ingredientId, item.version, item.bindingDigest, item.submissionVersion, item.submissionDigest, item.noteVersion, item.noteDigest, item.rightsVersion, item.rightsDigest,
    item.profession, item.qualificationUserId, item.qualificationRevision, item.qualificationDigest, item.evidenceKind, item.decision, item.identity, item.part, item.processing, item.evidenceReference, item.comment, 1,
    item.actorId, item.actorName, item.actorRole, item.accountRevision, item.createdAt, item.digest];
}
export function photoProfessionalFrom(row: Record<string, unknown>): PhotoProfessionalReview {
  try {
    if (Object.keys(row).length !== PHOTO_PROFESSIONAL_COLUMNS.length || PHOTO_PROFESSIONAL_COLUMNS.some(key => !Object.hasOwn(row, key)) || row.verification_confirmed !== 1) throw new Error('Invalid professional image row');
    const item = verifiedPhotoProfessionalReview({ candidateId: row.candidate_id, ingredientId: row.ingredient_id, version: row.version, bindingDigest: row.binding_digest,
      submissionVersion: row.submission_version, submissionDigest: row.submission_digest, noteVersion: row.note_version, noteDigest: row.note_digest, rightsVersion: row.rights_version, rightsDigest: row.rights_digest,
      profession: row.profession, qualificationUserId: row.qualification_user_id, qualificationRevision: row.qualification_revision, qualificationDigest: row.qualification_digest, evidenceKind: row.evidence_kind,
      decision: row.decision, identity: row.identity_match, part: row.part_match, processing: row.processing_match, evidenceReference: row.evidence_reference, comment: row.comment, verificationConfirmed: true,
      actorId: row.actor_id, actorName: row.actor_name, actorRole: row.actor_role, accountRevision: row.account_revision, createdAt: row.created_at, digest: row.digest });
    const values = photoProfessionalValues(item);
    if (PHOTO_PROFESSIONAL_COLUMNS.some((key, index) => row[key] !== values[index])) throw new Error('Noncanonical professional image row');
    return item;
  } catch { throw new AccountError(409, 'photo_professional_integrity', '图片专业审校历史完整性检查失败。'); }
}
