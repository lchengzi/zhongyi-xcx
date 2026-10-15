// Browser-safe management checks, not digest authentication, actual professional
// approval or publication authorization. Full private qualification evidence is
// deliberately not part of the HTTP snapshot projection.
import type { PublicationActionInput, PublicationApproval, PublicationApprovalInput, PublicationControl, PublicationControlInput, PublicationEvent, PublicationQualificationSummary, PublicationSnapshotInput, PublicationSnapshotView, PublicationWorkspaceView, SessionInfo } from './contracts.js';
import { choice, date, digest, id, invalid, list, literal, number, object, parseContentDraft, text, unique } from './workflow-response.js';
import { parseProfessionalReview } from './professional-response.js';
import { parsePublicationPreflight, parseSourceCheck } from './source-check-response.js';

const reasons = ['publication_disabled', 'publication_missing', 'publication_withdrawn', 'publication_frozen', 'publication_approval_required', 'publication_approver_changed',
  'published_approval_changed', 'publication_recovery_epoch_changed', 'withdrawn_snapshot_requires_new_approval', 'professional_opinion_changed', 'qualification_changed',
  'source_check_changed', 'editorial_authority_changed', 'snapshot_identity_changed', 'source_missing', 'content_missing', 'editorial_review_required',
  'professional_review_required', 'education_fields_incomplete', 'source_references_required', 'source_checks_required', 'source_domains_incomplete', 'official_directory_scope_required'] as const;
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function signer(item: Record<string, unknown>) {
  return { actorId: id(item.actorId), actor: text(item.actor, 40), accountRevision: number(item.accountRevision), comment: text(item.comment, 1000), recordedAt: date(item.recordedAt), digest: digest(item.digest) };
}
function qualification(value: unknown): PublicationQualificationSummary {
  const item = object(value, 'userId revision accountRevision profession status evidenceKind validUntil digest');
  return { userId: id(item.userId), revision: number(item.revision), accountRevision: number(item.accountRevision), profession: choice(item.profession, ['tcm_physician', 'pharmacist']),
    status: literal(item.status, 'verified'), evidenceKind: literal(item.evidenceKind, 'manual-verification'), validUntil: date(item.validUntil), digest: digest(item.digest) };
}
export function parsePublicationSnapshot(value: unknown, ingredientId: string): PublicationSnapshotView {
  const item = object(value, 'id ingredientId version basis basisDigest actorId actor accountRevision comment recordedAt digest');
  const basis = object(item.basis, 'scope ingredientName draft editorial professionalReviews qualifications sourceChecks'), editorial = object(basis.editorial, 'taskId reviewerId accountRevision');
  const result: PublicationSnapshotView = { id: id(item.id), ingredientId: id(item.ingredientId), version: number(item.version), basisDigest: digest(item.basisDigest), ...signer(item), basis: {
    scope: literal(basis.scope, 'ingredient_education'), ingredientName: text(basis.ingredientName, 200), draft: parseContentDraft(basis.draft, ingredientId),
    editorial: { taskId: id(editorial.taskId), reviewerId: id(editorial.reviewerId), accountRevision: number(editorial.accountRevision) },
    professionalReviews: list(basis.professionalReviews, entry => parseProfessionalReview(entry, ingredientId), 2), qualifications: list(basis.qualifications, qualification, 2),
    sourceChecks: list(basis.sourceChecks, entry => parseSourceCheck(entry), 10) } };
  const fixed = result.basis, draft = fixed.draft;
  unique(fixed.professionalReviews.map(review => review.profession)); unique(fixed.professionalReviews.map(review => review.actorId)); unique(fixed.qualifications.map(q => q.userId)); unique(fixed.qualifications.map(q => q.profession)); unique(fixed.sourceChecks.map(check => check.sourceId));
  if (result.ingredientId !== ingredientId || draft.state !== 'editorial_accepted' || fixed.professionalReviews.length !== 2 || fixed.qualifications.length !== 2 ||
      !draft.content.sourceRefs.length || fixed.sourceChecks.length !== draft.content.sourceRefs.length) invalid();
  for (const review of fixed.professionalReviews) {
    const q = fixed.qualifications.find(q => q.userId === review.qualificationUserId);
    if (review.decision !== 'approve' || review.contentRevision !== draft.revision || review.contentDigest !== draft.digest || !q || q.profession !== review.profession ||
        q.revision !== review.qualificationRevision || q.accountRevision !== review.accountRevision) invalid();
  }
  for (const ref of draft.content.sourceRefs) {
    const check = fixed.sourceChecks.find(check => check.sourceId === ref.id);
    if (!check || check.sourceRevision !== ref.revision || check.decision !== 'verified' || check.evidenceKind !== 'manual-check' || !check.ingredientIds.includes(ingredientId)) invalid();
  }
  const domains = new Set(fixed.sourceChecks.flatMap(check => check.domains));
  if ((['identity', 'edible_part', 'processing', 'safety_boundary', 'directory_scope'] as const).some(domain => !domains.has(domain)) ||
      !fixed.sourceChecks.some(check => check.domains.includes('directory_scope') && check.authority === 'official')) invalid();
  // Historical expiry is readable; current validity is rechecked by the server.
  return result;
}
export function parsePublicationApproval(value: unknown): PublicationApproval {
  const item = object(value, 'snapshotId version snapshotDigest decision controlEpoch actorId actor accountRevision comment recordedAt digest');
  return { snapshotId: id(item.snapshotId), version: number(item.version), snapshotDigest: digest(item.snapshotDigest), decision: choice(item.decision, ['approve', 'revoke']), controlEpoch: id(item.controlEpoch), ...signer(item) };
}
export function parsePublicationEvent(value: unknown, ingredientId: string): PublicationEvent {
  const item = object(value, 'ingredientId version action snapshotId approvalVersion controlEpoch previousDigest actorId actor accountRevision comment recordedAt digest');
  const result: PublicationEvent = { ingredientId: id(item.ingredientId), version: number(item.version), action: choice(item.action, ['publish', 'withdraw', 'rollback']), snapshotId: id(item.snapshotId),
    approvalVersion: number(item.approvalVersion), controlEpoch: id(item.controlEpoch), previousDigest: item.previousDigest === null ? null : digest(item.previousDigest), ...signer(item) };
  if (result.ingredientId !== ingredientId || (result.version === 1) !== (result.previousDigest === null)) invalid();
  return result;
}
export function parsePublicationControl(value: unknown): PublicationControl {
  const item = object(value, 'version action epoch kind actorId actor accountRevision evidenceReference comment recordedAt digest');
  const result: PublicationControl = { version: number(item.version), action: choice(item.action, ['freeze', 'resume']), epoch: id(item.epoch), kind: choice(item.kind, ['operator', 'recovery']),
    actorId: item.actorId === null ? null : id(item.actorId), actor: text(item.actor, 40), accountRevision: item.accountRevision === null ? null : number(item.accountRevision),
    evidenceReference: text(item.evidenceReference, 200), comment: text(item.comment, 1000), recordedAt: date(item.recordedAt), digest: digest(item.digest) };
  if (result.kind === 'operator' ? result.actorId === null || result.accountRevision === null : result.actorId !== null || result.accountRevision !== null || result.action !== 'freeze' || result.actor !== 'backup-restore') invalid();
  return result;
}
export function parsePublicationWorkspace(value: unknown, ingredientId: string, focusVersion?: number): PublicationWorkspaceView {
  const item = object(value, 'ingredientId preflight basisDigest snapshots approvals events eventVersion control enabled activeSnapshotId blockedReasons');
  const result: PublicationWorkspaceView = { ingredientId: id(item.ingredientId), preflight: parsePublicationPreflight(item.preflight, ingredientId, true), basisDigest: item.basisDigest === null ? null : digest(item.basisDigest),
    snapshots: list(item.snapshots, entry => parsePublicationSnapshot(entry, ingredientId), 22), approvals: list(item.approvals, parsePublicationApproval, 22),
    events: list(item.events, entry => parsePublicationEvent(entry, ingredientId), 20), eventVersion: number(item.eventVersion, 0), control: item.control === null ? null : parsePublicationControl(item.control),
    enabled: boolean(item.enabled), activeSnapshotId: item.activeSnapshotId === null ? null : id(item.activeSnapshotId), blockedReasons: list(item.blockedReasons, entry => choice(entry, reasons), reasons.length) };
  unique(result.snapshots.map(snapshot => snapshot.id)); unique(result.snapshots.map(snapshot => snapshot.version)); unique(result.approvals.map(approval => approval.snapshotId)); unique(result.blockedReasons);
  const recentCount = Math.min(result.snapshots[0]?.version || 0, 20);
  if (result.ingredientId !== ingredientId || (result.basisDigest !== null) !== result.preflight.readyForReleaseApproval || result.snapshots.length < recentCount ||
      result.snapshots.slice(0, recentCount).some((snapshot, index) => snapshot.version !== result.snapshots[0].version - index) ||
      result.snapshots.slice(recentCount).some(snapshot => snapshot.version >= result.snapshots[recentCount - 1].version || (snapshot.id !== result.activeSnapshotId && snapshot.version !== focusVersion)) ||
      (focusVersion !== undefined && !result.snapshots.some(snapshot => snapshot.version === focusVersion)) ||
      result.events.length !== Math.min(result.eventVersion, 20) || result.events.some((event, index) => event.version !== result.eventVersion - index ||
        (result.events[index + 1] && event.previousDigest !== result.events[index + 1].digest))) invalid();
  for (const approval of result.approvals) if (!result.snapshots.some(snapshot => snapshot.id === approval.snapshotId && snapshot.digest === approval.snapshotDigest)) invalid();
  const head = result.events[0];
  const terminalReason = !result.enabled ? 'publication_disabled' : !head ? 'publication_missing' : head.action === 'withdraw' ? 'publication_withdrawn' : null;
  if (terminalReason) { if (result.activeSnapshotId !== null || result.blockedReasons.length !== 1 || result.blockedReasons[0] !== terminalReason) invalid(); }
  else {
    if (result.blockedReasons.some(reason => ['publication_disabled', 'publication_missing', 'publication_withdrawn'].includes(reason)) ||
        (result.blockedReasons.includes('publication_frozen') !== (result.control?.action !== 'resume'))) invalid();
    if (result.blockedReasons.length) { if (result.activeSnapshotId !== null) invalid(); }
    else {
      const active = result.snapshots.find(snapshot => snapshot.id === result.activeSnapshotId), approval = result.approvals.find(approval => approval.snapshotId === result.activeSnapshotId);
      if (!active || active.id !== head.snapshotId || !approval || approval.decision !== 'approve' || approval.version !== head.approvalVersion ||
          approval.controlEpoch !== result.control?.epoch || head.controlEpoch !== result.control?.epoch) invalid();
    }
  }
  return result;
}
function actorMatches(item: { actorId: string | null; actor: string; accountRevision: number | null; comment: string }, comment: string, session: SessionInfo) {
  if (item.actorId !== session.user.id || item.actor !== session.user.username || item.accountRevision !== session.user.revision || item.comment !== comment.trim()) invalid();
}
export function parseSavedPublicationSnapshot(value: unknown, previous: PublicationWorkspaceView, input: PublicationSnapshotInput, session: SessionInfo): PublicationSnapshotView {
  const result = parsePublicationSnapshot(value, previous.ingredientId), fixed = result.basis.draft;
  actorMatches(result, input.comment, session);
  if (result.version !== (previous.snapshots[0]?.version || 0) + 1 || result.basisDigest !== input.expectedBasisDigest || result.basisDigest !== previous.basisDigest ||
      fixed.revision !== previous.preflight.contentRevision || fixed.digest !== previous.preflight.contentDigest || fixed.baseReleaseId !== previous.preflight.baseReleaseId || fixed.lockVersion !== previous.preflight.lockVersion ||
      result.basis.sourceChecks.some(check => !previous.preflight.sources.some(source => source.sourceId === check.sourceId && source.sourceRevision === check.sourceRevision && source.checkVersion === check.version && source.checkDigest === check.digest))) invalid();
  return result;
}
export function parseSavedPublicationApproval(value: unknown, previous: PublicationWorkspaceView, input: PublicationApprovalInput, session: SessionInfo): PublicationApproval {
  const result = parsePublicationApproval(value), snapshot = previous.snapshots.find(snapshot => snapshot.id === input.snapshotId), prior = previous.approvals.find(approval => approval.snapshotId === input.snapshotId);
  actorMatches(result, input.comment, session);
  if (!snapshot || snapshot.digest !== input.snapshotDigest || input.expectedApprovalVersion !== (prior?.version || 0) || input.expectedControlVersion !== (previous.control?.version || 0) ||
      result.snapshotId !== snapshot.id || result.snapshotDigest !== snapshot.digest || result.version !== input.expectedApprovalVersion + 1 || result.decision !== input.decision || result.controlEpoch !== (previous.control?.epoch || 'uninitialized')) invalid();
  return result;
}
export function parseSavedPublicationEvent(value: unknown, previous: PublicationWorkspaceView, input: PublicationActionInput, session: SessionInfo): PublicationEvent {
  const result = parsePublicationEvent(value, previous.ingredientId), head = previous.events[0], approval = previous.approvals.find(approval => approval.snapshotId === input.snapshotId);
  actorMatches(result, input.comment, session);
  if (!previous.snapshots.some(snapshot => snapshot.id === input.snapshotId) || input.expectedVersion !== previous.eventVersion || input.expectedControlVersion !== (previous.control?.version || 0) ||
      result.version !== input.expectedVersion + 1 || result.snapshotId !== input.snapshotId || result.action !== input.action || result.previousDigest !== (head?.digest || null) ||
      result.controlEpoch !== (previous.control?.epoch || 'uninitialized') || result.approvalVersion !== (input.action === 'withdraw' ? approval?.version || head?.approvalVersion : approval?.version)) invalid();
  return result;
}
export function parseSavedPublicationControl(value: unknown, previous: PublicationControl | null, input: PublicationControlInput, session: SessionInfo): PublicationControl {
  const result = parsePublicationControl(value); actorMatches(result, input.comment, session);
  if (result.kind !== 'operator' || input.expectedVersion !== (previous?.version || 0) || result.version !== input.expectedVersion + 1 || result.action !== input.action || result.evidenceReference !== input.evidenceReference.trim() ||
      (previous && (input.action === 'resume' ? result.epoch !== previous.epoch : result.epoch === previous.epoch))) invalid();
  return result;
}
