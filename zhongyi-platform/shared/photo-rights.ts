// Private rights decisions are independent of professional review/publication.
import { choice, date, digest, id, invalid, literal, number, object, text } from './workflow-response.js';
export const PHOTO_RIGHTS_SCHEMA = 'private-photo-rights.1';
export interface PhotoRightsInput {
  bindingDigest: string; expectedVersion: number; expectedSubmissionVersion: number; submissionDigest: string;
  expectedNoteVersion: number; noteDigest: string; decision: 'approve' | 'return' | 'revoke';
  evidenceKind: 'manual-verification' | 'test-fixture'; evidenceReference: string;
  attributionPlan: string; alterationPlan: string; validUntil: string; comment: string; verificationConfirmed: true;
}
export interface PhotoRightsReview {
  candidateId: string; ingredientId: string; version: number; submissionVersion: number; submissionDigest: string; bindingDigest: string;
  decision: PhotoRightsInput['decision']; evidenceKind: PhotoRightsInput['evidenceKind']; evidenceReference: string;
  attributionPlan: string; alterationPlan: string; validUntil: string; comment: string; verificationConfirmed: true;
  actorId: string; actorName: string; actorRole: 'admin' | 'reviewer'; accountRevision: number; createdAt: string; digest: string;
}
export interface PhotoRightsDetail {
  schemaVersion: typeof PHOTO_RIGHTS_SCHEMA; candidateId: string; bindingDigest: string;
  submissionVersion: number; submissionDigest: string | null; noteVersion: number; noteDigest: string | null;
  version: number; history: PhotoRightsReview[];
  state: 'pending' | 'changes_requested' | 'recorded' | 'rights_verified' | 'revoked' | 'stale'; publicationEligible: false;
}
function field(value: unknown, maximum: number): string {
  const result = text(value, maximum).trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) invalid();
  return result;
}
function decisionFields(r: Record<string, unknown>) {
  return { decision: choice(r.decision, ['approve', 'return', 'revoke'] as const), evidenceKind: choice(r.evidenceKind, ['manual-verification', 'test-fixture'] as const),
    evidenceReference: field(r.evidenceReference, 400), attributionPlan: field(r.attributionPlan, 500), alterationPlan: field(r.alterationPlan, 500),
    validUntil: date(r.validUntil), comment: field(r.comment, 1200), verificationConfirmed: literal(r.verificationConfirmed, true) };
}
export function parsePhotoRightsInput(value: unknown): PhotoRightsInput {
  const r = object(value, 'bindingDigest expectedVersion expectedSubmissionVersion submissionDigest expectedNoteVersion noteDigest decision evidenceKind evidenceReference attributionPlan alterationPlan validUntil comment verificationConfirmed');
  return { bindingDigest: digest(r.bindingDigest), expectedVersion: number(r.expectedVersion, 0), expectedSubmissionVersion: number(r.expectedSubmissionVersion), submissionDigest: digest(r.submissionDigest),
    expectedNoteVersion: number(r.expectedNoteVersion), noteDigest: digest(r.noteDigest), ...decisionFields(r) };
}
export function parsePhotoRightsReview(value: unknown): PhotoRightsReview {
  const r = object(value, 'candidateId ingredientId version submissionVersion submissionDigest bindingDigest decision evidenceKind evidenceReference attributionPlan alterationPlan validUntil comment verificationConfirmed actorId actorName actorRole accountRevision createdAt digest');
  return { candidateId: id(r.candidateId), ingredientId: id(r.ingredientId), version: number(r.version), submissionVersion: number(r.submissionVersion), submissionDigest: digest(r.submissionDigest), bindingDigest: digest(r.bindingDigest),
    ...decisionFields(r), actorId: id(r.actorId), actorName: id(r.actorName), actorRole: choice(r.actorRole, ['admin', 'reviewer'] as const), accountRevision: number(r.accountRevision), createdAt: date(r.createdAt), digest: digest(r.digest) };
}
