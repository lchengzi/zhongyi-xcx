import type { Account, ProfessionalKind } from './contracts.js';
import { parsePrivatePhoto, type PrivatePhoto } from './private-photos.js';
import type { PhotoRightsDetail } from './photo-rights.js';
import { PHOTO_PROFESSIONAL_SCHEMA, parsePhotoProfessionalInput, parsePhotoProfessionalReview, type PhotoProfessionalInput, type PhotoProfessionalReview, type PhotoProfessionalDetail } from './photo-professional.js';
import { object, choice, digest, id, invalid, literal, number } from './workflow-response.js';

const professions: readonly ProfessionalKind[] = ['tcm_physician', 'pharmacist'];
const reasons = ['missing_current_submission', 'rights_not_current', 'physician_pending', 'pharmacist_pending', 'review_basis_changed', 'qualification_changed', 'contributor_conflict', 'test_evidence', 'revoked', 'returned', 'distinct_signers_required'] as const;
export interface PhotoProfessionalCredential { userId: string; revision: number; digest: string; profession: ProfessionalKind; evidenceKind: 'manual-verification' | 'test-fixture' }
export function parsePhotoProfessionalCredential(value: unknown): PhotoProfessionalCredential {
  const r = object(value, 'userId revision digest profession evidenceKind');
  return { userId: id(r.userId), revision: number(r.revision), digest: digest(r.digest), profession: choice(r.profession, ['tcm_physician', 'pharmacist'] as const), evidenceKind: choice(r.evidenceKind, ['manual-verification', 'test-fixture'] as const) };
}
function same(a: PhotoProfessionalReview, b: PhotoProfessionalReview): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function current(item: PhotoProfessionalReview, detail: PhotoProfessionalDetail): boolean {
  return item.bindingDigest === detail.bindingDigest && item.submissionVersion === detail.submissionVersion && item.submissionDigest === detail.submissionDigest &&
    item.noteVersion === detail.noteVersion && item.noteDigest === detail.noteDigest && item.rightsVersion === detail.rightsVersion && item.rightsDigest === detail.rightsDigest;
}
export function parsePhotoProfessionalDetail(value: unknown, expected: { candidateId: string; ingredientId?: string; bindingDigest: string }): PhotoProfessionalDetail {
  const r = object(value, 'schemaVersion candidateId bindingDigest submissionVersion submissionDigest noteVersion noteDigest rightsVersion rightsDigest version history latestReviews state reasons publicationEligible');
  if (r.schemaVersion !== PHOTO_PROFESSIONAL_SCHEMA || r.candidateId !== expected.candidateId || r.bindingDigest !== expected.bindingDigest ||
    !Array.isArray(r.history) || r.history.length > 50 || !Array.isArray(r.latestReviews) || r.latestReviews.length > 2 || !Array.isArray(r.reasons) || r.reasons.length > reasons.length) invalid();
  const result: PhotoProfessionalDetail = { schemaVersion: PHOTO_PROFESSIONAL_SCHEMA, candidateId: expected.candidateId, bindingDigest: expected.bindingDigest,
    submissionVersion: number(r.submissionVersion, 0), submissionDigest: r.submissionDigest === null ? null : digest(r.submissionDigest), noteVersion: number(r.noteVersion, 0), noteDigest: r.noteDigest === null ? null : digest(r.noteDigest),
    rightsVersion: number(r.rightsVersion, 0), rightsDigest: r.rightsDigest === null ? null : digest(r.rightsDigest), version: number(r.version, 0),
    history: r.history.map(parsePhotoProfessionalReview), latestReviews: r.latestReviews.map(parsePhotoProfessionalReview),
    state: choice(r.state, ['pending', 'changes_requested', 'recorded', 'eligible_for_derivative_review', 'revoked', 'stale'] as const),
    reasons: r.reasons.map((entry: unknown) => choice(entry, reasons)), publicationEligible: literal(r.publicationEligible, false) };
  if (result.version > 10000 || result.history.length !== Math.min(result.version, 50) || new Set(result.reasons).size !== result.reasons.length ||
    new Set(result.latestReviews.map(item => item.profession)).size !== result.latestReviews.length ||
    (result.noteVersion === 0 ? result.noteDigest !== null : result.noteDigest === null) ||
    (result.submissionVersion === 0 ? result.submissionDigest !== null : result.submissionDigest === null || result.noteVersion === 0) ||
    (result.rightsVersion === 0 ? result.rightsDigest !== null : result.rightsDigest === null || result.submissionVersion === 0) ||
    (result.version === 0 ? result.latestReviews.length !== 0 || result.state !== 'pending' : result.latestReviews.length === 0 || result.state === 'pending')) invalid();
  const all = [...result.history, ...result.latestReviews];
  for (const item of all) {
    if (item.candidateId !== expected.candidateId || (expected.ingredientId !== undefined && item.ingredientId !== expected.ingredientId) || item.version > result.version ||
      item.submissionVersion > result.submissionVersion || item.noteVersion > result.noteVersion || item.rightsVersion > result.rightsVersion ||
      (item.submissionVersion === result.submissionVersion && item.submissionDigest !== result.submissionDigest) || (item.noteVersion === result.noteVersion && item.noteDigest !== result.noteDigest) ||
      (item.rightsVersion === result.rightsVersion && item.rightsDigest !== result.rightsDigest) ||
      (item.decision !== 'revoke' && item.qualificationUserId !== item.actorId) || (item.decision === 'approve' && [item.identity, item.part, item.processing].some(v => v !== 'matches'))) invalid();
  }
  for (const [index, item] of result.history.entries()) {
    const older = result.history[index + 1];
    if (item.version !== result.version - index || (older && (item.submissionVersion < older.submissionVersion || item.noteVersion < older.noteVersion || item.rightsVersion < older.rightsVersion || Date.parse(item.createdAt) < Date.parse(older.createdAt)))) invalid();
    const previous = result.history.slice(index + 1).find(entry => entry.profession === item.profession);
    if (item.decision === 'revoke' && previous && (previous.decision !== 'approve' || previous.qualificationUserId !== item.qualificationUserId || previous.qualificationRevision !== item.qualificationRevision || previous.qualificationDigest !== item.qualificationDigest || previous.evidenceKind !== item.evidenceKind ||
      previous.bindingDigest !== item.bindingDigest || previous.submissionVersion !== item.submissionVersion || previous.submissionDigest !== item.submissionDigest || previous.noteVersion !== item.noteVersion || previous.noteDigest !== item.noteDigest || previous.rightsVersion !== item.rightsVersion || previous.rightsDigest !== item.rightsDigest ||
      (item.actorRole !== 'admin' && item.actorId !== previous.actorId))) invalid();
  }
  for (const profession of professions) {
    const visible = result.history.find(item => item.profession === profession), latest = result.latestReviews.find(item => item.profession === profession);
    if (visible ? !latest || !same(visible, latest) : latest && latest.version >= (result.history.at(-1)?.version ?? 0)) invalid();
  }
  if (result.latestReviews.some((item, index) => index > 0 && professions.indexOf(item.profession) <= professions.indexOf(result.latestReviews[index - 1].profession))) invalid();
  if (result.version > 0 && !result.latestReviews.some(item => item.version === result.version)) invalid();
  const matching = result.latestReviews.filter(item => current(item, result)), approved = matching.filter(item => item.decision === 'approve');
  if (result.state === 'eligible_for_derivative_review' && (result.reasons.length !== 0 || approved.length !== 2 || new Set(approved.map(item => item.actorId)).size !== 2 || approved.some(item => item.evidenceKind !== 'manual-verification'))) invalid();
  if (result.state !== 'pending' && result.state !== 'stale' && matching.length !== result.latestReviews.length) invalid();
  if (result.state === 'recorded' && (approved.length === 0 || matching.some(item => item.decision !== 'approve'))) invalid();
  if (result.state === 'changes_requested' && (!matching.some(item => item.decision === 'return') || !result.reasons.includes('returned'))) invalid();
  if (result.state === 'revoked' && (!matching.some(item => item.decision === 'revoke') || matching.some(item => item.decision === 'return') || !result.reasons.includes('revoked'))) invalid();
  return result;
}
export function photoProfessionalBasisMatches(detail: PhotoProfessionalDetail, rights: PhotoRightsDetail): boolean {
  const headsMatch = detail.candidateId === rights.candidateId && detail.bindingDigest === rights.bindingDigest && detail.submissionVersion === rights.submissionVersion && detail.submissionDigest === rights.submissionDigest &&
    detail.noteVersion === rights.noteVersion && detail.noteDigest === rights.noteDigest && detail.rightsVersion === rights.version && detail.rightsDigest === (rights.history[0]?.digest ?? null);
  if (!headsMatch) return false;
  if (detail.state === 'pending' || detail.state === 'stale') return true;
  const latest = rights.history[0];
  if (!latest || latest.decision !== 'approve' || !['recorded', 'rights_verified'].includes(rights.state)) return false;
  return detail.state !== 'eligible_for_derivative_review' || (rights.state === 'rights_verified' && latest.evidenceKind === 'manual-verification');
}
export function matchesPhotoProfessionalAttempt(value: PhotoProfessionalReview, candidate: PrivatePhoto, raw: PhotoProfessionalInput, actor: Account, rawCredential: PhotoProfessionalCredential): boolean {
  const item = parsePhotoProfessionalReview(value), input = parsePhotoProfessionalInput(raw), photo = parsePrivatePhoto(candidate), credential = parsePhotoProfessionalCredential(rawCredential);
  return item.candidateId === photo.id && item.ingredientId === photo.ingredientId && item.bindingDigest === input.bindingDigest && item.version === input.expectedVersion + 1 &&
    item.submissionVersion === input.expectedSubmissionVersion && item.submissionDigest === input.submissionDigest && item.noteVersion === input.expectedNoteVersion && item.noteDigest === input.noteDigest && item.rightsVersion === input.expectedRightsVersion && item.rightsDigest === input.rightsDigest &&
    item.profession === input.profession && credential.profession === input.profession && item.qualificationUserId === credential.userId && (input.decision === 'revoke' || credential.userId === actor.id) &&
    credential.revision === input.expectedQualificationRevision && credential.digest === input.qualificationDigest && item.qualificationRevision === credential.revision && item.qualificationDigest === credential.digest && item.evidenceKind === credential.evidenceKind &&
    item.decision === input.decision && item.identity === input.identity && item.part === input.part && item.processing === input.processing && item.evidenceReference === input.evidenceReference && item.comment === input.comment &&
    item.actorId === actor.id && item.actorName === actor.username && item.actorRole === actor.role && item.accountRevision === actor.revision;
}
export function parseSavedPhotoProfessional(value: unknown, candidate: PrivatePhoto, input: PhotoProfessionalInput, actor: Account, credential: PhotoProfessionalCredential): PhotoProfessionalReview {
  const item = parsePhotoProfessionalReview(value); if (!matchesPhotoProfessionalAttempt(item, candidate, input, actor, credential)) invalid(); return item;
}
export function parseReloadedPhotoProfessional(value: unknown, previous: PhotoProfessionalDetail): PhotoProfessionalDetail {
  const result = parsePhotoProfessionalDetail(value, { ...previous, ingredientId: previous.history[0]?.ingredientId });
  if (result.version < previous.version || result.submissionVersion < previous.submissionVersion || result.noteVersion < previous.noteVersion || result.rightsVersion < previous.rightsVersion ||
    (result.submissionVersion === previous.submissionVersion && result.submissionDigest !== previous.submissionDigest) || (result.noteVersion === previous.noteVersion && result.noteDigest !== previous.noteDigest) ||
    (result.rightsVersion === previous.rightsVersion && result.rightsDigest !== previous.rightsDigest)) invalid();
  for (const old of [...previous.history, ...previous.latestReviews]) {
    const item = [...result.history, ...result.latestReviews].find(current => current.version === old.version);
    if (item ? !same(item, old) : old.version >= result.version - 49) invalid();
  }
  for (const old of previous.latestReviews) {
    const item = result.latestReviews.find(current => current.profession === old.profession);
    if (!item || item.version < old.version || (item.version === old.version && !same(item, old))) invalid();
  }
  return result;
}
