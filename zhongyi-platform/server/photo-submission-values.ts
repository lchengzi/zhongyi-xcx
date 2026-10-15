import { createHash } from 'node:crypto';
import { parsePrivatePhoto } from '../shared/private-photos.js';
import { parsePhotoSubmission, type PhotoSubmission } from '../shared/photo-submissions.js';
import { photoBindingDigest } from './photo-note-values.js';
import { AccountError } from './auth.js';

export const photoSubmissionDigest = (value: Omit<PhotoSubmission, 'digest'>): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
export const PHOTO_SUBMISSION_COLUMNS = ['candidate_id', 'ingredient_id', 'version', 'candidate_payload', 'binding_digest', 'note_version', 'note_digest', 'caption', 'part_description', 'processing_description', 'evidence_reference', 'submission_confirmed', 'actor_id', 'actor_name', 'account_revision', 'created_at', 'digest'] as const;
export const PHOTO_SUBMISSION_INSERT = `INSERT INTO photo_submissions (${PHOTO_SUBMISSION_COLUMNS.join(', ')}) VALUES (${PHOTO_SUBMISSION_COLUMNS.map(() => '?').join(', ')})`;
export function photoSubmissionValues(item: PhotoSubmission): (string | number)[] {
  return [item.candidate.id, item.candidate.ingredientId, item.version, JSON.stringify(item.candidate), item.bindingDigest, item.noteVersion, item.noteDigest,
    item.caption, item.partDescription, item.processingDescription, item.evidenceReference, 1, item.actorId, item.actorName, item.accountRevision, item.createdAt, item.digest];
}
export function photoSubmissionFrom(row: Record<string, unknown>): PhotoSubmission {
  try {
    if (Object.keys(row).length !== PHOTO_SUBMISSION_COLUMNS.length || PHOTO_SUBMISSION_COLUMNS.some(key => !Object.hasOwn(row, key)) || typeof row.candidate_payload !== 'string' || row.submission_confirmed !== 1) throw new Error('Invalid submission row');
    const candidate = parsePrivatePhoto(JSON.parse(row.candidate_payload));
    const item = parsePhotoSubmission({ candidate, bindingDigest: row.binding_digest, version: row.version, noteVersion: row.note_version, noteDigest: row.note_digest,
      caption: row.caption, partDescription: row.part_description, processingDescription: row.processing_description, evidenceReference: row.evidence_reference, submissionConfirmed: true,
      actorId: row.actor_id, actorName: row.actor_name, accountRevision: row.account_revision, createdAt: row.created_at, digest: row.digest });
    const { digest, ...payload } = item;
    if (candidate.id !== row.candidate_id || candidate.ingredientId !== row.ingredient_id || row.candidate_payload !== JSON.stringify(candidate) || row.caption !== item.caption || row.part_description !== item.partDescription ||
      row.processing_description !== item.processingDescription || row.evidence_reference !== item.evidenceReference || photoBindingDigest(candidate) !== item.bindingDigest || photoSubmissionDigest(payload) !== digest) throw new Error('Submission integrity mismatch');
    return item;
  } catch { throw new AccountError(409, 'photo_submission_integrity', '图片送审记录完整性检查失败，请联系管理员。'); }
}
