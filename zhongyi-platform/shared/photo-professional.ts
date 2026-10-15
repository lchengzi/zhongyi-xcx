// Private image review is NOT ingredient-content review or publication approval.
import type { ProfessionalKind, QualificationInput } from './contracts.js';
import { choice, date, digest, id, literal, number, object, text } from './workflow-response.js';

export const PHOTO_PROFESSIONAL_SCHEMA = 'private-photo-professional.1';
export type PhotoMatchConclusion = 'matches' | 'uncertain' | 'mismatch';
export interface PhotoProfessionalInput {
  bindingDigest: string; expectedVersion: number;
  expectedSubmissionVersion: number; submissionDigest: string;
  expectedNoteVersion: number; noteDigest: string;
  expectedRightsVersion: number; rightsDigest: string;
  profession: ProfessionalKind; expectedQualificationRevision: number; qualificationDigest: string;
  decision: 'approve' | 'return' | 'revoke'; identity: PhotoMatchConclusion; part: PhotoMatchConclusion; processing: PhotoMatchConclusion;
  evidenceReference: string; comment: string; verificationConfirmed: true;
}
export interface PhotoProfessionalReview {
  candidateId: string; ingredientId: string; version: number; bindingDigest: string;
  submissionVersion: number; submissionDigest: string; noteVersion: number; noteDigest: string; rightsVersion: number; rightsDigest: string;
  profession: ProfessionalKind; qualificationUserId: string; qualificationRevision: number; qualificationDigest: string;
  evidenceKind: QualificationInput['evidenceKind']; decision: PhotoProfessionalInput['decision']; identity: PhotoMatchConclusion; part: PhotoMatchConclusion; processing: PhotoMatchConclusion;
  evidenceReference: string; comment: string; verificationConfirmed: true;
  actorId: string; actorName: string; actorRole: 'admin' | 'reviewer'; accountRevision: number; createdAt: string; digest: string;
}
export type PhotoProfessionalReason = 'missing_current_submission' | 'rights_not_current' | 'physician_pending' | 'pharmacist_pending' |
  'review_basis_changed' | 'qualification_changed' | 'contributor_conflict' | 'test_evidence' | 'revoked' | 'returned' | 'distinct_signers_required';
export interface PhotoProfessionalDetail {
  schemaVersion: typeof PHOTO_PROFESSIONAL_SCHEMA; candidateId: string; bindingDigest: string;
  submissionVersion: number; submissionDigest: string | null; noteVersion: number; noteDigest: string | null;
  rightsVersion: number; rightsDigest: string | null; version: number;
  history: PhotoProfessionalReview[]; latestReviews: PhotoProfessionalReview[];
  state: 'pending' | 'changes_requested' | 'recorded' | 'eligible_for_derivative_review' | 'revoked' | 'stale';
  reasons: PhotoProfessionalReason[]; publicationEligible: false;
}
const match = (value: unknown) => choice(value, ['matches', 'uncertain', 'mismatch'] as const);
function field(value: unknown, maximum: number): string {
  const result = text(value, maximum).trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new Error('Invalid photo professional text');
  return result;
}
function decision(r: Record<string, unknown>) {
  return { profession: choice(r.profession, ['tcm_physician', 'pharmacist'] as const), decision: choice(r.decision, ['approve', 'return', 'revoke'] as const),
    identity: match(r.identity), part: match(r.part), processing: match(r.processing), evidenceReference: field(r.evidenceReference, 500), comment: field(r.comment, 1200), verificationConfirmed: literal(r.verificationConfirmed, true) };
}
export function parsePhotoProfessionalInput(value: unknown): PhotoProfessionalInput {
  const r = object(value, 'bindingDigest expectedVersion expectedSubmissionVersion submissionDigest expectedNoteVersion noteDigest expectedRightsVersion rightsDigest profession expectedQualificationRevision qualificationDigest decision identity part processing evidenceReference comment verificationConfirmed');
  return { bindingDigest: digest(r.bindingDigest), expectedVersion: number(r.expectedVersion, 0), expectedSubmissionVersion: number(r.expectedSubmissionVersion), submissionDigest: digest(r.submissionDigest),
    expectedNoteVersion: number(r.expectedNoteVersion), noteDigest: digest(r.noteDigest), expectedRightsVersion: number(r.expectedRightsVersion), rightsDigest: digest(r.rightsDigest),
    expectedQualificationRevision: number(r.expectedQualificationRevision), qualificationDigest: digest(r.qualificationDigest), ...decision(r) };
}
export function parsePhotoProfessionalReview(value: unknown): PhotoProfessionalReview {
  const r = object(value, 'candidateId ingredientId version bindingDigest submissionVersion submissionDigest noteVersion noteDigest rightsVersion rightsDigest profession qualificationUserId qualificationRevision qualificationDigest evidenceKind decision identity part processing evidenceReference comment verificationConfirmed actorId actorName actorRole accountRevision createdAt digest');
  return { candidateId: id(r.candidateId), ingredientId: id(r.ingredientId), version: number(r.version), bindingDigest: digest(r.bindingDigest),
    submissionVersion: number(r.submissionVersion), submissionDigest: digest(r.submissionDigest), noteVersion: number(r.noteVersion), noteDigest: digest(r.noteDigest), rightsVersion: number(r.rightsVersion), rightsDigest: digest(r.rightsDigest),
    qualificationUserId: id(r.qualificationUserId), qualificationRevision: number(r.qualificationRevision), qualificationDigest: digest(r.qualificationDigest),
    evidenceKind: choice(r.evidenceKind, ['manual-verification', 'test-fixture'] as const), ...decision(r),
    actorId: id(r.actorId), actorName: id(r.actorName), actorRole: choice(r.actorRole, ['admin', 'reviewer'] as const), accountRevision: number(r.accountRevision), createdAt: date(r.createdAt), digest: digest(r.digest) };
}
