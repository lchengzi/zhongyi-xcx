import type { Account } from '../shared/contracts.js';
import type { PrivatePhoto } from '../shared/private-photos.js';
import { AccountError } from './auth.js';
import { photoNoteFrom } from './photo-note-values.js';
import { photoNoteDetail } from './photo-note-service.js';
import { photoSubmissionFrom } from './photo-submission-values.js';
import { photoSubmissionDetail } from './photo-submission-service.js';
import { photoRightsFrom } from './photo-rights-values.js';
import { photoRightsDetail } from './photo-rights-service.js';
import { qualificationFrom } from './professional-values.js';
import { photoProfessionalFrom } from './photo-professional-values.js';
import { validPhotoProfessionalHistory, type PhotoProfessionalHistory } from './photo-professional-history.js';
import type { PhotoProfessionalFacts } from './photo-professional-policy.js';

export interface PhotoProfessionalRows {
  notes: Record<string, unknown>[]; submissions: Record<string, unknown>[]; rights: Record<string, unknown>[];
  reviews: Record<string, unknown>[]; qualifications: Record<string, unknown>[];
}
export function requirePhotoProfessionalHistory(history: PhotoProfessionalHistory): void {
  if (!validPhotoProfessionalHistory(history)) throw new AccountError(409, 'photo_professional_integrity', '图片专业审校历史固定依据或独立性检查失败。');
}
export function photoProfessionalData(candidate: PrivatePhoto, rows: PhotoProfessionalRows, users: Account[], exists: boolean, now: number) {
  const history: PhotoProfessionalHistory = { notes: rows.notes.map(photoNoteFrom), submissions: rows.submissions.map(photoSubmissionFrom), rights: rows.rights.map(photoRightsFrom),
    reviews: rows.reviews.map(photoProfessionalFrom), qualifications: rows.qualifications.map(qualificationFrom), users };
  requirePhotoProfessionalHistory(history);
  const notes = photoNoteDetail(candidate, history.notes.slice(0, 50), exists);
  const submission = photoSubmissionDetail(candidate, notes, history.submissions.slice(0, 50));
  const rights = photoRightsDetail(candidate, submission, history.rights.slice(0, 50), users, now);
  const qualifications = [...new Map(history.qualifications.slice().sort((a, b) => a.revision - b.revision).map(q => [q.userId, q])).values()];
  const facts: PhotoProfessionalFacts = { candidate, submission, rights, reviews: history.reviews, qualifications, users,
    contributorIds: [...new Set([...history.notes, ...history.submissions, ...history.rights].map(item => item.actorId))] };
  return { facts, history };
}
