// A named editorial submission is not a rights/professional/publication approval.
import type { Account } from './contracts.js';
import type { PhotoNoteDetail } from './photo-notes.js';
import { parsePrivatePhoto, type PrivatePhoto } from './private-photos.js';
import { date, digest, id, invalid, literal, number, object, text } from './workflow-response.js';

export const PHOTO_SUBMISSION_SCHEMA = 'private-photo-submissions.1';
export interface PhotoSubmissionInput {
  bindingDigest: string; expectedVersion: number; expectedNoteVersion: number; noteDigest: string;
  caption: string; partDescription: string; processingDescription: string; evidenceReference: string; submissionConfirmed: true;
}
export interface PhotoSubmission {
  candidate: PrivatePhoto; bindingDigest: string; version: number; noteVersion: number; noteDigest: string;
  caption: string; partDescription: string; processingDescription: string; evidenceReference: string; submissionConfirmed: true;
  actorId: string; actorName: string; accountRevision: number; createdAt: string; digest: string;
}
export interface PhotoSubmissionDetail {
  schemaVersion: typeof PHOTO_SUBMISSION_SCHEMA; candidateId: string; bindingDigest: string;
  noteVersion: number; noteDigest: string | null; noteBindingDigest: string | null; version: number; history: PhotoSubmission[];
}
function field(value: unknown, maximum: number): string {
  const result = text(value, maximum);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) invalid();
  return result.trim();
}
export function parsePhotoSubmissionInput(value: unknown): PhotoSubmissionInput {
  const r = object(value, 'bindingDigest expectedVersion expectedNoteVersion noteDigest caption partDescription processingDescription evidenceReference submissionConfirmed');
  return { bindingDigest: digest(r.bindingDigest), expectedVersion: number(r.expectedVersion, 0), expectedNoteVersion: number(r.expectedNoteVersion), noteDigest: digest(r.noteDigest),
    caption: field(r.caption, 180), partDescription: field(r.partDescription, 120), processingDescription: field(r.processingDescription, 120), evidenceReference: field(r.evidenceReference, 400), submissionConfirmed: literal(r.submissionConfirmed, true) };
}
export function parsePhotoSubmission(value: unknown): PhotoSubmission {
  const r = object(value, 'candidate bindingDigest version noteVersion noteDigest caption partDescription processingDescription evidenceReference submissionConfirmed actorId actorName accountRevision createdAt digest');
  return { candidate: parsePrivatePhoto(r.candidate), bindingDigest: digest(r.bindingDigest), version: number(r.version), noteVersion: number(r.noteVersion), noteDigest: digest(r.noteDigest),
    caption: field(r.caption, 180), partDescription: field(r.partDescription, 120), processingDescription: field(r.processingDescription, 120), evidenceReference: field(r.evidenceReference, 400), submissionConfirmed: literal(r.submissionConfirmed, true),
    actorId: id(r.actorId), actorName: id(r.actorName), accountRevision: number(r.accountRevision), createdAt: date(r.createdAt), digest: digest(r.digest) };
}
export function parsePhotoSubmissionDetail(value: unknown, expected: { candidateId: string; bindingDigest: string; ingredientId?: string }): PhotoSubmissionDetail {
  const r = object(value, 'schemaVersion candidateId bindingDigest noteVersion noteDigest noteBindingDigest version history');
  if (r.schemaVersion !== PHOTO_SUBMISSION_SCHEMA || r.candidateId !== expected.candidateId || r.bindingDigest !== expected.bindingDigest || !Array.isArray(r.history) || r.history.length > 50) invalid();
  const version = number(r.version, 0), noteVersion = number(r.noteVersion, 0);
  const noteDigest = r.noteDigest === null ? null : digest(r.noteDigest), noteBindingDigest = r.noteBindingDigest === null ? null : digest(r.noteBindingDigest);
  if (noteVersion === 0 ? noteDigest !== null || noteBindingDigest !== null : noteDigest === null || noteBindingDigest === null) invalid();
  const history = r.history.map((item: unknown) => parsePhotoSubmission(item));
  if (history.length !== Math.min(version, 50) || history.some((item, index) => item.candidate.id !== expected.candidateId || item.version !== version - index || item.noteVersion > noteVersion ||
    (index > 0 && item.noteVersion > history[index - 1].noteVersion) ||
    (item.noteVersion === noteVersion && (item.noteDigest !== noteDigest || item.bindingDigest !== noteBindingDigest)) ||
    (expected.ingredientId !== undefined && item.candidate.ingredientId !== expected.ingredientId))) invalid();
  return { schemaVersion: PHOTO_SUBMISSION_SCHEMA, candidateId: expected.candidateId, bindingDigest: expected.bindingDigest, noteVersion, noteDigest, noteBindingDigest, version, history };
}
export function parseSavedPhotoSubmission(value: unknown, candidate: PrivatePhoto, raw: PhotoSubmissionInput, actor: Account): PhotoSubmission {
  const item = parsePhotoSubmission(value);
  if (!matchesPhotoSubmissionAttempt(item, candidate, raw, actor)) invalid();
  return item;
}
export function matchesPhotoSubmissionAttempt(item: PhotoSubmission, candidate: PrivatePhoto, raw: PhotoSubmissionInput, actor: Account): boolean {
  const input = parsePhotoSubmissionInput(raw);
  return JSON.stringify(item.candidate) === JSON.stringify(parsePrivatePhoto(candidate)) && item.bindingDigest === input.bindingDigest && item.version === input.expectedVersion + 1 &&
    item.noteVersion === input.expectedNoteVersion && item.noteDigest === input.noteDigest && item.caption === input.caption && item.partDescription === input.partDescription && item.processingDescription === input.processingDescription &&
    item.evidenceReference === input.evidenceReference && item.actorId === actor.id && item.actorName === actor.username && item.accountRevision === actor.revision;
}
// Separate HTTP reads are not an atomic snapshot. Accept only a consistent pair;
// the server must still recheck both heads in its native write transaction.
export function photoSubmissionBasisMatches(detail: PhotoSubmissionDetail, notes: PhotoNoteDetail): boolean {
  return detail.candidateId === notes.candidateId && detail.bindingDigest === notes.bindingDigest && detail.noteVersion === notes.version &&
    detail.noteDigest === (notes.history[0]?.digest ?? null) && detail.noteBindingDigest === (notes.history[0]?.bindingDigest ?? null);
}
export function parseReloadedPhotoSubmissions(value: unknown, previous: PhotoSubmissionDetail): PhotoSubmissionDetail {
  const result = parsePhotoSubmissionDetail(value, previous);
  if (result.version < previous.version || result.noteVersion < previous.noteVersion ||
    (result.noteVersion === previous.noteVersion && (result.noteDigest !== previous.noteDigest || result.noteBindingDigest !== previous.noteBindingDigest)) || previous.history.some(old => {
      const current = result.history.find(item => item.version === old.version);
      return current ? JSON.stringify(current) !== JSON.stringify(old) : old.version >= result.version - 49;
    })) invalid();
  return result;
}
