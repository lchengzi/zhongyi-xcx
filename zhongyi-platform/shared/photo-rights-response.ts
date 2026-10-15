import type { Account } from './contracts.js';
import { parsePrivatePhoto, type PrivatePhoto } from './private-photos.js';
import type { PhotoSubmissionDetail } from './photo-submissions.js';
import { PHOTO_RIGHTS_SCHEMA, parsePhotoRightsInput, parsePhotoRightsReview, type PhotoRightsDetail, type PhotoRightsInput, type PhotoRightsReview } from './photo-rights.js';
import { choice, digest, invalid, literal, number, object } from './workflow-response.js';

export function parsePhotoRightsDetail(value: unknown, expected: { candidateId: string; ingredientId?: string; bindingDigest: string }): PhotoRightsDetail {
  const r = object(value, 'schemaVersion candidateId bindingDigest submissionVersion submissionDigest noteVersion noteDigest version history state publicationEligible');
  if (r.schemaVersion !== PHOTO_RIGHTS_SCHEMA || r.candidateId !== expected.candidateId || r.bindingDigest !== expected.bindingDigest || !Array.isArray(r.history) || r.history.length > 50) invalid();
  const version = number(r.version, 0), submissionVersion = number(r.submissionVersion, 0), noteVersion = number(r.noteVersion, 0);
  const submissionDigest = r.submissionDigest === null ? null : digest(r.submissionDigest), noteDigest = r.noteDigest === null ? null : digest(r.noteDigest);
  if (version > 10000 || (submissionVersion === 0 ? submissionDigest !== null : submissionDigest === null || noteVersion === 0) || (noteVersion === 0 ? noteDigest !== null : noteDigest === null)) invalid();
  const history = r.history.map((entry: unknown) => parsePhotoRightsReview(entry));
  if (history.length !== Math.min(version, 50)) invalid();
  for (const [index, item] of history.entries()) {
    const older = history[index + 1];
    if (item.candidateId !== expected.candidateId || (expected.ingredientId !== undefined && item.ingredientId !== expected.ingredientId) || item.version !== version - index || item.submissionVersion > submissionVersion ||
      (item.submissionVersion === submissionVersion && item.submissionDigest !== submissionDigest) ||
      (older && (item.submissionVersion < older.submissionVersion || Date.parse(item.createdAt) < Date.parse(older.createdAt) ||
        (item.submissionVersion === older.submissionVersion && (item.submissionDigest !== older.submissionDigest || item.bindingDigest !== older.bindingDigest))))) invalid();
    if (item.decision === 'approve' && (Date.parse(item.validUntil) <= Date.parse(item.createdAt) || Date.parse(item.validUntil) > Date.parse(item.createdAt) + 366 * 86400000)) invalid();
    if (item.decision === 'revoke' && older && (older.decision !== 'approve' || older.submissionVersion !== item.submissionVersion || older.submissionDigest !== item.submissionDigest || (item.actorRole !== 'admin' && item.actorId !== older.actorId))) invalid();
  }
  const state = choice(r.state, ['pending', 'changes_requested', 'recorded', 'rights_verified', 'revoked', 'stale'] as const), latest = history[0];
  if (!latest ? state !== 'pending' : state === 'pending') invalid();
  if (latest && state !== 'stale') {
    if (latest.submissionVersion !== submissionVersion || latest.submissionDigest !== submissionDigest || latest.bindingDigest !== expected.bindingDigest) invalid();
    const expectedState = latest.decision === 'return' ? 'changes_requested' : latest.decision === 'revoke' ? 'revoked' : latest.evidenceKind === 'manual-verification' ? 'rights_verified' : 'recorded';
    if (state !== expectedState) invalid();
  }
  return { schemaVersion: PHOTO_RIGHTS_SCHEMA, candidateId: expected.candidateId, bindingDigest: expected.bindingDigest, submissionVersion, submissionDigest, noteVersion, noteDigest, version, history, state, publicationEligible: literal(r.publicationEligible, false) };
}

export function matchesPhotoRightsAttempt(item: PhotoRightsReview, candidate: PrivatePhoto, raw: PhotoRightsInput, actor: Account): boolean {
  const input = parsePhotoRightsInput(raw), photo = parsePrivatePhoto(candidate);
  return item.candidateId === photo.id && item.ingredientId === photo.ingredientId && item.bindingDigest === input.bindingDigest && item.version === input.expectedVersion + 1 &&
    item.submissionVersion === input.expectedSubmissionVersion && item.submissionDigest === input.submissionDigest && item.decision === input.decision && item.evidenceKind === input.evidenceKind &&
    item.evidenceReference === input.evidenceReference && item.attributionPlan === input.attributionPlan && item.alterationPlan === input.alterationPlan && item.validUntil === input.validUntil && item.comment === input.comment &&
    item.actorId === actor.id && item.actorName === actor.username && item.actorRole === actor.role && item.accountRevision === actor.revision;
}
export function parseSavedPhotoRights(value: unknown, candidate: PrivatePhoto, input: PhotoRightsInput, actor: Account): PhotoRightsReview {
  const item = parsePhotoRightsReview(value);
  if (!matchesPhotoRightsAttempt(item, candidate, input, actor)) invalid();
  return item;
}
export function photoRightsBasisMatches(detail: PhotoRightsDetail, submission: PhotoSubmissionDetail): boolean {
  const head = submission.history[0];
  return detail.candidateId === submission.candidateId && detail.bindingDigest === submission.bindingDigest && detail.submissionVersion === submission.version && detail.submissionDigest === (head?.digest ?? null) &&
    detail.noteVersion === submission.noteVersion && detail.noteDigest === submission.noteDigest &&
    (detail.state === 'pending' || detail.state === 'stale' || !!head && head.bindingDigest === submission.bindingDigest && head.noteVersion === submission.noteVersion && head.noteDigest === submission.noteDigest && submission.noteBindingDigest === submission.bindingDigest);
}
export function parseReloadedPhotoRights(value: unknown, previous: PhotoRightsDetail): PhotoRightsDetail {
  const result = parsePhotoRightsDetail(value, { ...previous, ingredientId: previous.history[0]?.ingredientId });
  if (result.version < previous.version || result.submissionVersion < previous.submissionVersion || result.noteVersion < previous.noteVersion ||
    (result.submissionVersion === previous.submissionVersion && result.submissionDigest !== previous.submissionDigest) ||
    (result.noteVersion === previous.noteVersion && result.noteDigest !== previous.noteDigest) || previous.history.some(old => {
      const item = result.history.find(current => current.version === old.version);
      return item ? JSON.stringify(item) !== JSON.stringify(old) : old.version >= result.version - 49;
    })) invalid();
  return result;
}
