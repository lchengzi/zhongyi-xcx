import { isDeepStrictEqual } from 'node:util';
import type { PublicationFacts } from './publication-values.js';
import type { PublicationControl } from '../shared/contracts.js';
import { fail, verifyContentRevision } from './workflow.js';
import { SOURCE_DOMAINS, sourceDigest } from './source-check-values.js';

function invalid(): never { return fail(409, 'publication_integrity', '发布历史与固定依据的完整性校验失败。'); }
const same = (left: unknown, right: unknown) => { if (!isDeepStrictEqual(left, right)) invalid(); };
function contiguous<T>(items: T[], sequence: (item: T) => number): void {
  // Repositories supply complete descending histories, never UI-limited rows.
  items.forEach((item, index) => { if (sequence(item) !== items.length - index) invalid(); });
}
export function verifyPublicationControls(controls: PublicationControl[]): void {
  contiguous(controls, (item) => item.version);
  const epochs = new Set<string>(); let previous: PublicationControl | undefined;
  for (const control of controls.slice().reverse()) {
    if (control.action === 'resume' && previous) {
      if (previous.action !== 'freeze' || control.epoch !== previous.epoch) invalid();
    } else {
      if (epochs.has(control.epoch)) invalid();
      epochs.add(control.epoch);
    }
    previous = control;
  }
}

// Cross-table validation is distinct from current authorization. Expired,
// revoked and disabled historical participants remain valid audit evidence;
// they must NOT make an old publication eligible again. Current eligibility
// is evaluated separately by snapshotReasons/approvalReasons on every read.
export function verifyPublicationHistory(facts: PublicationFacts): void {
  verifyPublicationControls(facts.controls);
  contiguous(facts.snapshots, (item) => item.version);
  contiguous(facts.events, (item) => item.version);
  const users = new Map(facts.professional.users.map((user) => [user.id, user]));
  const actor = (id: string, name: string, revision: number) => {
    const user = users.get(id);
    if (!user || user.username !== name || user.revision < revision) invalid();
  };
  for (const control of facts.controls) if (control.actorId) actor(control.actorId, control.actor, control.accountRevision!);
  const snapshots = new Map(facts.snapshots.map((item) => [item.id, item]));
  if (snapshots.size !== facts.snapshots.length || new Set(facts.snapshots.map((item) => item.basisDigest)).size !== facts.snapshots.length) invalid();
  for (const snapshot of facts.snapshots) {
    actor(snapshot.actorId, snapshot.actor, snapshot.accountRevision);
    const { draft, editorial, professionalReviews, qualifications, sourceChecks } = snapshot.basis;
    const fixed = facts.revisions.find((item) => item.revision === draft.revision);
    if (!fixed || snapshot.ingredientId !== facts.ingredientId || draft.ingredientId !== facts.ingredientId || snapshot.basis.ingredientName !== facts.ingredientName) invalid();
    verifyContentRevision(fixed);
    // Content digests intentionally exclude author/time metadata. Compare those
    // immutable fields too, rather than trusting the digest as a signed record.
    for (const key of ['ingredientId', 'revision', 'content', 'sources', 'digest', 'baseReleaseId', 'authorId', 'author', 'createdAt'] as const) same(draft[key], fixed[key]);
    const task = facts.editorial.find((item) => item.taskId === editorial.taskId);
    if (!task || task.status !== 'accepted' || task.contentRevision !== draft.revision || task.contentDigest !== draft.digest || task.reviewerId !== editorial.reviewerId ||
      !users.has(editorial.reviewerId) || users.get(editorial.reviewerId)!.revision < editorial.accountRevision) invalid();
    if (new Set(professionalReviews.map((item) => item.profession)).size !== 2 || new Set(professionalReviews.map((item) => item.actorId)).size !== 2 ||
      new Set(qualifications.map((item) => item.userId)).size !== 2 || new Set(sourceChecks.map((item) => item.sourceId)).size !== sourceChecks.length) invalid();
    for (const review of professionalReviews) {
      const historical = facts.professional.reviews.find((item) => item.version === review.version);
      same(review, historical);
      const qualification = qualifications.find((item) => item.userId === review.qualificationUserId);
      if (!qualification || review.ingredientId !== facts.ingredientId || review.contentRevision !== draft.revision || review.contentDigest !== draft.digest || review.decision !== 'approve' ||
        review.actorId !== review.qualificationUserId || qualification.revision !== review.qualificationRevision || qualification.profession !== review.profession ||
        qualification.accountRevision !== review.accountRevision || qualification.status !== 'verified' || qualification.evidenceKind !== 'manual-verification' || !qualification.verificationConfirmed ||
        qualification.recordedById === qualification.userId || Date.parse(qualification.validUntil) <= Date.parse(snapshot.recordedAt)) invalid();
      same(qualification, facts.qualificationHistory.find((item) => item.userId === qualification.userId && item.revision === qualification.revision));
      actor(review.actorId, review.actor, review.accountRevision);
      actor(qualification.recordedById, qualification.recordedBy, 1);
    }
    const domains = new Set<string>(); let officialDirectory = false;
    for (const ref of draft.content.sourceRefs) {
      const source = facts.sources.find((item) => item.source.id === ref.id && item.source.revision === ref.revision);
      const check = sourceChecks.find((item) => item.sourceId === ref.id);
      if (!source || !check || check.sourceRevision !== ref.revision || check.sourceDigest !== sourceDigest(source.source) || check.decision !== 'verified' ||
        check.evidenceKind !== 'manual-check' || !check.verificationConfirmed || !check.ingredientIds.includes(facts.ingredientId) ||
        Date.parse(check.checkedAt) > Date.parse(snapshot.recordedAt) || Date.parse(check.validUntil) <= Date.parse(snapshot.recordedAt)) invalid();
      same(check, source.checks.find((item) => item.version === check.version));
      actor(check.actorId, check.actor, check.accountRevision);
      check.domains.forEach((domain) => domains.add(domain));
      if (check.authority === 'official' && check.domains.includes('directory_scope')) officialDirectory = true;
    }
    if (!officialDirectory || SOURCE_DOMAINS.some((domain) => !domains.has(domain)) || !draft.content.ediblePart || !draft.content.educationText || !draft.content.safetyText) invalid();
  }
  for (const snapshot of facts.snapshots) {
    const approvals = facts.approvals.filter((item) => item.snapshotId === snapshot.id);
    contiguous(approvals, (item) => item.version);
    let previous: typeof approvals[number] | undefined;
    for (const approval of approvals.slice().reverse()) {
      actor(approval.actorId, approval.actor, approval.accountRevision);
      if (approval.snapshotDigest !== snapshot.digest || !facts.controls.some((control) => control.epoch === approval.controlEpoch && control.action === 'resume') ||
        (approval.decision === 'revoke' && previous?.decision !== 'approve')) invalid();
      if (approval.decision === 'approve' && [snapshot.actorId, snapshot.basis.editorial.reviewerId, snapshot.basis.draft.authorId,
        ...snapshot.basis.professionalReviews.map((item) => item.actorId), ...snapshot.basis.sourceChecks.map((item) => item.actorId)].includes(approval.actorId)) invalid();
      previous = approval;
    }
  }
  if (facts.approvals.some((item) => !snapshots.has(item.snapshotId))) invalid();
  let previous: typeof facts.events[number] | undefined;
  const published = new Set<string>(); const withdrawals = new Map<string, number>();
  for (const event of facts.events.slice().reverse()) {
    actor(event.actorId, event.actor, event.accountRevision);
    const snapshot = snapshots.get(event.snapshotId);
    const approval = facts.approvals.find((item) => item.snapshotId === event.snapshotId && item.version === event.approvalVersion);
    if (event.ingredientId !== facts.ingredientId || !snapshot || !approval || event.previousDigest !== (previous?.digest || null) || !facts.controls.some((item) => item.epoch === event.controlEpoch)) invalid();
    if (event.action === 'withdraw') {
      if (!previous || previous.action === 'withdraw' || previous.snapshotId !== event.snapshotId || event.approvalVersion < previous.approvalVersion) invalid();
      withdrawals.set(event.snapshotId, event.approvalVersion);
    } else {
      if (approval.decision !== 'approve' || approval.controlEpoch !== event.controlEpoch || (event.action === 'rollback' && !published.has(event.snapshotId)) ||
        event.approvalVersion <= (withdrawals.get(event.snapshotId) || 0) ||
        (previous?.action !== 'withdraw' && previous?.snapshotId === event.snapshotId && previous.approvalVersion === event.approvalVersion && previous.controlEpoch === event.controlEpoch)) invalid();
      published.add(event.snapshotId);
    }
    previous = event;
  }
}
