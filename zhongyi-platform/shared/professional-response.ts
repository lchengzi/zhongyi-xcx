// Private management response checks; no credential authentication, digest
// recomputation, professional approval or publication permission is inferred.
import type { Account, ProfessionalDecisionInput, ProfessionalDetail, ProfessionalQualification, ProfessionalReview, QualificationHistory, QualificationInput, SessionInfo } from './contracts.js';
import { choice, date, digest, id, invalid, list, literal, number, object, parseReviewDraft, text, unique } from './workflow-response.js';
const kinds = ['tcm_physician', 'pharmacist'] as const;
const reasonCodes = kinds.flatMap(kind => ['pending_or_revoked', 'content_changed', 'qualification_or_independence_changed', 'test_fixture_not_professional_evidence'].map(code => `${kind}:${code}`));

export function parseQualification(value: unknown, userId: string): ProfessionalQualification {
  const item = object(value, 'profession status evidenceKind evidenceReference validUntil comment verificationConfirmed userId revision accountRevision recordedById recordedBy recordedAt digest');
  if (typeof item.verificationConfirmed !== 'boolean') invalid();
  const result: ProfessionalQualification = {
    profession: choice(item.profession, kinds), status: choice(item.status, ['verified', 'revoked']), evidenceKind: choice(item.evidenceKind, ['manual-verification', 'test-fixture']),
    evidenceReference: text(item.evidenceReference, 200), validUntil: date(item.validUntil), comment: text(item.comment, 1000), verificationConfirmed: item.verificationConfirmed,
    userId: id(item.userId), revision: number(item.revision), accountRevision: number(item.accountRevision), recordedById: id(item.recordedById),
    recordedBy: text(item.recordedBy, 40), recordedAt: date(item.recordedAt), digest: digest(item.digest),
  };
  // Old/expired/account-invalidated records remain readable history.
  if (result.userId !== userId || (result.status === 'verified' && !result.verificationConfirmed)) invalid();
  return result;
}
export function parseQualificationHistory(value: unknown, userId: string): QualificationHistory {
  const item = object(value, 'userId items');
  const result = { userId: id(item.userId), items: list(item.items, entry => parseQualification(entry, userId), 20) };
  if (result.userId !== userId || result.items.length !== Math.min(result.items[0]?.revision || 0, 20) ||
      result.items.some((entry, index) => entry.revision !== result.items[0].revision - index)) invalid();
  return result;
}
export function parseSavedQualification(value: unknown, target: Account, previousRevision: number, input: QualificationInput, session: SessionInfo): ProfessionalQualification {
  const result = parseQualification(value, target.id);
  if (result.revision !== previousRevision + 1 || result.accountRevision !== target.revision || result.recordedById !== session.user.id || result.recordedBy !== session.user.username ||
      result.profession !== input.profession || result.status !== input.status || result.evidenceKind !== input.evidenceKind || result.evidenceReference !== input.evidenceReference.trim() ||
      result.validUntil !== input.validUntil || result.comment !== input.comment.trim() || result.verificationConfirmed !== input.verificationConfirmed) invalid();
  return result;
}
export function parseProfessionalReview(value: unknown, ingredientId: string): ProfessionalReview {
  const item = object(value, 'ingredientId version contentRevision contentDigest profession decision qualificationUserId qualificationRevision actorId actor accountRevision comment recordedAt digest');
  const result: ProfessionalReview = { ingredientId: id(item.ingredientId), version: number(item.version), contentRevision: number(item.contentRevision), contentDigest: digest(item.contentDigest),
    profession: choice(item.profession, kinds), decision: choice(item.decision, ['approve', 'return', 'revoke']), qualificationUserId: id(item.qualificationUserId), qualificationRevision: number(item.qualificationRevision),
    actorId: id(item.actorId), actor: text(item.actor, 40), accountRevision: number(item.accountRevision), comment: text(item.comment, 1000), recordedAt: date(item.recordedAt), digest: digest(item.digest) };
  if (result.ingredientId !== ingredientId || (result.decision !== 'revoke' && result.actorId !== result.qualificationUserId)) invalid();
  return result;
}
export function parseProfessionalDetail(value: unknown, ingredientId: string): ProfessionalDetail {
  const item = object(value, 'scope ingredientId draft reviews latestReviews reviewVersion state reasons publicationEnabled visibility');
  const result: ProfessionalDetail = { scope: literal(item.scope, 'ingredient_education'), ingredientId: id(item.ingredientId),
    draft: item.draft === null ? null : parseReviewDraft(item.draft, ingredientId), reviews: list(item.reviews, entry => parseProfessionalReview(entry, ingredientId), 20),
    latestReviews: list(item.latestReviews, entry => parseProfessionalReview(entry, ingredientId), 2), reviewVersion: number(item.reviewVersion, 0),
    state: choice(item.state, ['pending', 'changes_requested', 'recorded', 'eligible_for_publication_approval']), reasons: list(item.reasons, entry => choice(entry, reasonCodes), 2),
    publicationEnabled: literal(item.publicationEnabled, false), visibility: literal(item.visibility, 'private') };
  unique(result.latestReviews.map(review => review.profession)); unique(result.reasons);
  if (result.ingredientId !== ingredientId || result.reviews.length !== Math.min(result.reviewVersion, 20) || result.reviews.some((review, index) => review.version !== result.reviewVersion - index)) invalid();
  for (const kind of kinds) {
    const latest = result.latestReviews.find(review => review.profession === kind);
    const recentCurrent = result.reviews.find(review => review.profession === kind && review.contentRevision === result.draft?.revision);
    const recent = recentCurrent || (latest?.contentRevision === result.draft?.revision ? undefined : result.reviews.find(review => review.profession === kind));
    if (!latest && result.reviews.some(review => review.profession === kind)) invalid();
    if (latest && (latest.version > result.reviewVersion || (recent ? JSON.stringify(latest) !== JSON.stringify(recent) : latest.version >= (result.reviews.at(-1)?.version ?? 0)))) invalid();
    const reasons = result.reasons.filter(reason => reason.startsWith(`${kind}:`));
    if (reasons.length > 1) invalid();
    if (!latest || latest.decision !== 'approve') { if (reasons[0] !== `${kind}:pending_or_revoked`) invalid(); }
    else if (!result.draft || result.draft.state !== 'editorial_accepted' || result.draft.revision !== latest.contentRevision || result.draft.digest !== latest.contentDigest) {
      if (reasons[0] !== `${kind}:content_changed`) invalid();
    } else if (reasons[0] === `${kind}:pending_or_revoked` || reasons[0] === `${kind}:content_changed`) invalid();
  }
  const returned = result.latestReviews.some(review => review.decision === 'return' && review.contentRevision === result.draft?.revision);
  const eligible = result.reasons.length === 0 && result.latestReviews.length === 2 && new Set(result.latestReviews.map(review => review.actorId)).size === 2;
  const expectedState = eligible ? 'eligible_for_publication_approval' : returned ? 'changes_requested' : result.reviews.some(review => review.decision === 'approve' && review.contentRevision === result.draft?.revision) ? 'recorded' : 'pending';
  // Server uses complete history, so an approval for the current revision may
  // lie outside the 20-row UI window while its other profession stays latest.
  // A revoked current-revision approval can also have fallen outside the
  // window. With a truncated history its former existence is not observable.
  const unseenApprovalPossible = result.reviewVersion > 20 && !!result.draft;
  if (result.state !== expectedState && !(result.state === 'recorded' && !eligible && !returned &&
      (unseenApprovalPossible || result.latestReviews.some(review => review.decision === 'approve' && review.contentRevision === result.draft?.revision)))) invalid();
  if (!eligible && result.state === 'eligible_for_publication_approval') invalid();
  return result;
}
export function parseProfessionalDecision(value: unknown, ingredientId: string, previous: ProfessionalDetail, input: ProfessionalDecisionInput, session: SessionInfo): ProfessionalDetail {
  const result = parseProfessionalDetail(value, ingredientId), review = result.reviews[0];
  const prior = previous.latestReviews.find(item => item.profession === input.profession);
  if (!review || result.reviewVersion !== previous.reviewVersion + 1 || JSON.stringify(result.draft) !== JSON.stringify(previous.draft === null ? null : parseReviewDraft(previous.draft, ingredientId)) ||
      review.actorId !== session.user.id || review.actor !== session.user.username || review.accountRevision !== session.user.revision || review.profession !== input.profession || review.decision !== input.decision ||
      review.contentRevision !== input.contentRevision || review.contentDigest !== input.contentDigest || review.qualificationRevision !== input.expectedQualificationRevision || review.comment !== input.comment.trim() ||
      review.qualificationUserId !== (input.decision === 'revoke' ? prior?.qualificationUserId : session.user.id) ||
      !result.latestReviews.some(item => item.profession === review.profession && item.version === review.version && item.digest === review.digest)) invalid();
  if (JSON.stringify(result.reviews.slice(1)) !== JSON.stringify(previous.reviews.slice(0, 19).map(item => parseProfessionalReview(item, ingredientId))) ||
      JSON.stringify(result.latestReviews.filter(item => item.profession !== input.profession)) !== JSON.stringify(previous.latestReviews.filter(item => item.profession !== input.profession).map(item => parseProfessionalReview(item, ingredientId)))) invalid();
  return result;
}
