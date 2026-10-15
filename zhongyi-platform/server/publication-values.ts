import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Account, ContentRevision, ProfessionalQualification, PublicationActionInput, PublicationApproval, PublicationApprovalInput, PublicationBasis, PublicationControl, PublicationControlInput, PublicationEvent, PublicationSnapshot, PublicationSnapshotInput, PublicationWorkspace, PublishedEducation } from '../shared/contracts.js';
import { exact, fail, validateContent, validateSource, verifyContentRevision, version } from './workflow.js';
import { professionalDetail, qualificationFrom, qualificationValues, reviewFrom, reviewValues, type ProfessionalFacts } from './professional-values.js';
import { publicationPreflight, sourceCheckDetail, sourceCheckFrom, sourceCheckValues, type SourceCheckFacts } from './source-check-values.js';

export const publicationDigest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const signed = <T extends object>(item: T): T & { digest: string } => ({ ...item, digest: publicationDigest(item) });
export interface EditorialProof { taskId: string; contentRevision: number; contentDigest: string; status: string; reviewerId: string | null }
export interface PublicationFacts {
  ingredientId: string; ingredientName: string; professional: ProfessionalFacts; sources: SourceCheckFacts[]; editorial: EditorialProof[];
  snapshots: PublicationSnapshot[]; approvals: PublicationApproval[]; events: PublicationEvent[]; controls: PublicationControl[];
  revisions: ContentRevision[]; qualificationHistory: ProfessionalQualification[];
}
export function validateSnapshotInput(value: unknown): PublicationSnapshotInput {
  if (!exact(value, ['expectedBasisDigest', 'comment', 'confirmed']) || !digest(value.expectedBasisDigest) || !text(value.comment, 1000) || value.confirmed !== true) fail(400, 'invalid_publication', '固定快照需绑定资料摘要、说明并明确确认。');
  return { expectedBasisDigest: value.expectedBasisDigest, comment: value.comment.trim(), confirmed: true };
}
export function validateApprovalInput(value: unknown): PublicationApprovalInput {
  if (!exact(value, ['snapshotId', 'snapshotDigest', 'expectedApprovalVersion', 'expectedControlVersion', 'decision', 'comment', 'confirmed']) || !text(value.snapshotId, 80) || !digest(value.snapshotDigest) ||
    !version(value.expectedApprovalVersion, true) || !version(value.expectedControlVersion, true) || !['approve', 'revoke'].includes(String(value.decision)) || !text(value.comment, 1000) || value.confirmed !== true) fail(400, 'invalid_publication', '批准需绑定固定快照、批准及冻结版本，并明确确认。');
  return { ...value, comment: value.comment.trim() } as unknown as PublicationApprovalInput;
}
export function validateActionInput(value: unknown): PublicationActionInput {
  if (!exact(value, ['action', 'snapshotId', 'expectedVersion', 'expectedControlVersion', 'comment', 'confirmed']) || !['publish', 'withdraw', 'rollback'].includes(String(value.action)) || !text(value.snapshotId, 80) ||
    !version(value.expectedVersion, true) || !version(value.expectedControlVersion, true) || !text(value.comment, 1000) || value.confirmed !== true) fail(400, 'invalid_publication', '操作需绑定快照、发布及冻结版本，填写说明并明确确认。');
  return { ...value, comment: value.comment.trim() } as unknown as PublicationActionInput;
}
export function validateControlInput(value: unknown): PublicationControlInput {
  if (!exact(value, ['action', 'expectedVersion', 'evidenceReference', 'comment', 'confirmed']) || !['freeze', 'resume'].includes(String(value.action)) || !version(value.expectedVersion, true) ||
    !text(value.evidenceReference, 200) || !text(value.comment, 1000) || value.confirmed !== true) fail(400, 'invalid_publication_control', '冻结/恢复须绑定当前版本、内部核对编号、说明并明确确认；恢复前核对备份后撤销及人员权限。');
  return { ...value, evidenceReference: value.evidenceReference.trim(), comment: value.comment.trim() } as unknown as PublicationControlInput;
}
export function currentBasis(facts: PublicationFacts, now = Date.now()): { basis: PublicationBasis | null; preflight: ReturnType<typeof publicationPreflight> } {
  const professional = professionalDetail(facts.professional, now);
  const preflight = publicationPreflight(facts.ingredientId, professional, facts.sources.map((source) => sourceCheckDetail(source, now)));
  const draft = facts.professional.draft;
  const task = facts.editorial.find((item) => item.contentRevision === draft?.revision && item.contentDigest === draft.digest && item.status === 'accepted');
  const reviewer = facts.professional.users.find((item) => item.id === task?.reviewerId);
  if (!task || !reviewer?.active || !['admin', 'reviewer'].includes(reviewer.role)) preflight.reasons.push('editorial_authority_changed');
  preflight.readyForReleaseApproval = preflight.reasons.length === 0;
  if (!preflight.readyForReleaseApproval || !draft || !task || !reviewer) return { basis: null, preflight };
  const reviews = professional.latestReviews;
  return { preflight, basis: { scope: 'ingredient_education', ingredientName: facts.ingredientName, draft,
    editorial: { taskId: task.taskId, reviewerId: reviewer.id, accountRevision: reviewer.revision },
    professionalReviews: reviews, qualifications: reviews.map((review) => facts.professional.qualifications.find((item) => item.userId === review.qualificationUserId)!),
    sourceChecks: draft.content.sourceRefs.map((ref) => sourceCheckDetail(facts.sources.find((source) => source.source.id === ref.id && source.source.revision === ref.revision)!, now).latest!) } };
}
export function snapshotReasons(snapshot: PublicationSnapshot, facts: PublicationFacts, now = Date.now()): string[] {
  verifyContentRevision(snapshot.basis.draft);
  const reasons: string[] = []; const basis = snapshot.basis; const fixed = basis.draft;
  if (snapshot.ingredientId !== facts.ingredientId || basis.ingredientName !== facts.ingredientName) reasons.push('snapshot_identity_changed');
  const task = facts.editorial.find((item) => item.taskId === basis.editorial.taskId);
  const reviewer = facts.professional.users.find((item) => item.id === basis.editorial.reviewerId);
  if (task?.status !== 'accepted' || task.contentRevision !== fixed.revision || task.contentDigest !== fixed.digest || task.reviewerId !== reviewer?.id ||
    !reviewer?.active || !['admin', 'reviewer'].includes(reviewer.role) || reviewer.revision !== basis.editorial.accountRevision) reasons.push('editorial_authority_changed');
  // New drafts must not replace the evidence for a previously published revision.
  // Revocations are selected for THIS fixed content revision, across full history.
  const fixedFacts: ProfessionalFacts = { ...facts.professional, draft: fixed, reviews: facts.professional.reviews.filter((item) => item.contentRevision === fixed.revision) };
  const professional = professionalDetail(fixedFacts, now);
  for (const review of basis.professionalReviews) if (professional.latestReviews.find((item) => item.profession === review.profession)?.digest !== review.digest) reasons.push('professional_opinion_changed');
  for (const qualification of basis.qualifications) if (fixedFacts.qualifications.find((item) => item.userId === qualification.userId)?.digest !== qualification.digest) reasons.push('qualification_changed');
  const sourceDetails = fixed.content.sourceRefs.map((ref) => {
    const source = facts.sources.find((item) => item.source.id === ref.id && item.source.revision === ref.revision);
    return source ? sourceCheckDetail(source, now) : null;
  });
  for (const check of basis.sourceChecks) if (sourceDetails.find((item) => item?.source.id === check.sourceId)?.latest?.digest !== check.digest) reasons.push('source_check_changed');
  if (sourceDetails.some((item) => !item)) reasons.push('source_missing');
  else reasons.push(...publicationPreflight(facts.ingredientId, professional, sourceDetails.filter((item) => item !== null)).reasons);
  return [...new Set(reasons)];
}
const restricted = (snapshot: PublicationSnapshot, facts: PublicationFacts) => new Set([snapshot.actorId, ...facts.professional.contributorIds,
  ...facts.sources.flatMap((item) => item.authorIds), ...snapshot.basis.professionalReviews.map((item) => item.actorId), ...snapshot.basis.sourceChecks.map((item) => item.actorId)]);
function requireAdmin(actor: Account, facts: PublicationFacts) {
  const current = facts.professional.users.find((user) => user.id === actor.id);
  if (!current?.active || current.role !== 'admin' || current.revision !== actor.revision || actor.role !== 'admin') fail(403, 'forbidden', '需当前启用且版本一致的管理员账号。');
}
export function newSnapshot(input: PublicationSnapshotInput, facts: PublicationFacts, actor: Account, now = Date.now()): PublicationSnapshot {
  const currentActor = facts.professional.users.find((user) => user.id === actor.id);
  if (!currentActor?.active || currentActor.revision !== actor.revision || currentActor.role !== actor.role || !['admin', 'editor'].includes(actor.role)) fail(403, 'forbidden', '仅当前有效的管理员或编辑可以整理发布快照。');
  const value = validateSnapshotInput(input); const current = currentBasis(facts, now);
  if (!current.basis) fail(409, 'publication_prerequisites', '固定资料条件未齐备，不能生成待批准快照。');
  const basisDigest = publicationDigest(current.basis);
  if (basisDigest !== value.expectedBasisDigest) fail(409, 'revision_conflict', '正文、意见或来源已变化，请重新读取。');
  if (facts.snapshots.some((item) => item.basisDigest === basisDigest)) fail(409, 'duplicate_snapshot', '相同固定资料已有快照，不重复生成。');
  return signed({ id: randomUUID(), ingredientId: facts.ingredientId, version: (facts.snapshots[0]?.version || 0) + 1, basis: current.basis, basisDigest,
    actorId: actor.id, actor: actor.username, accountRevision: actor.revision, comment: value.comment, recordedAt: new Date(now).toISOString() });
}
function controlVersion(facts: PublicationFacts, expected: number) {
  if ((facts.controls[0]?.version || 0) !== expected) fail(409, 'revision_conflict', '发布冻结状态已变化，请重新读取。');
}
export function newApproval(input: PublicationApprovalInput, facts: PublicationFacts, actor: Account, now = Date.now()): PublicationApproval {
  requireAdmin(actor, facts); const value = validateApprovalInput(input); controlVersion(facts, value.expectedControlVersion);
  const snapshot = facts.snapshots.find((item) => item.id === value.snapshotId) || fail(404, 'not_found', '固定快照不存在。');
  const previous = facts.approvals.find((item) => item.snapshotId === snapshot.id);
  if (snapshot.digest !== value.snapshotDigest || (previous?.version || 0) !== value.expectedApprovalVersion) fail(409, 'revision_conflict', '快照或批准记录已变化。');
  if (value.decision === 'approve') {
    if (facts.controls[0]?.action !== 'resume') fail(409, 'publication_frozen', '发布保持冻结，先核对恢复后的人员、撤销和来源情况。');
    if (restricted(snapshot, facts).has(actor.id)) fail(403, 'self_approval', '快照整理、编辑审阅、专业审校或来源核验参与者不能自行批准发布。');
    if (snapshotReasons(snapshot, facts, now).length) fail(409, 'publication_prerequisites', '固定快照依据已缺失或失效，不能批准。');
    // Approval after withdrawal or a new recovery epoch is explicit, not resurrection.
    const withdrawal = facts.events.find((item) => item.action === 'withdraw' && item.snapshotId === snapshot.id);
    if (previous?.decision === 'approve' && previous.controlEpoch === facts.controls[0].epoch && (!withdrawal || withdrawal.approvalVersion < previous.version)) fail(409, 'duplicate_approval', '该快照已有当前有效批准；不能重复批准。');
  } else if (!previous || previous.decision !== 'approve') fail(409, 'invalid_transition', '只能撤销当前批准，不删除历史。');
  return signed({ snapshotId: snapshot.id, version: value.expectedApprovalVersion + 1, snapshotDigest: snapshot.digest, decision: value.decision,
    controlEpoch: facts.controls[0]?.epoch || 'uninitialized', actorId: actor.id, actor: actor.username, accountRevision: actor.revision, comment: value.comment, recordedAt: new Date(now).toISOString() });
}
export function approvalReasons(snapshot: PublicationSnapshot, facts: PublicationFacts, now = Date.now()): string[] {
  const reasons = snapshotReasons(snapshot, facts, now); const approval = facts.approvals.find((item) => item.snapshotId === snapshot.id);
  if (!approval || approval.decision !== 'approve' || approval.snapshotDigest !== snapshot.digest) reasons.push('publication_approval_required');
  const approver = facts.professional.users.find((user) => user.id === approval?.actorId);
  if (!approver?.active || approver.role !== 'admin' || approver.revision !== approval?.accountRevision || (approver && restricted(snapshot, facts).has(approver.id))) reasons.push('publication_approver_changed');
  if (facts.controls[0]?.action !== 'resume') reasons.push('publication_frozen');
  if (!approval || approval.controlEpoch !== facts.controls[0]?.epoch) reasons.push('publication_recovery_epoch_changed');
  const withdrawal = facts.events.find((item) => item.action === 'withdraw' && item.snapshotId === snapshot.id);
  if (withdrawal && (!approval || approval.version <= withdrawal.approvalVersion)) reasons.push('withdrawn_snapshot_requires_new_approval');
  return [...new Set(reasons)];
}
export function newPublicationEvent(input: PublicationActionInput, facts: PublicationFacts, actor: Account, enabled = false, now = Date.now()): PublicationEvent {
  requireAdmin(actor, facts); const value = validateActionInput(input); controlVersion(facts, value.expectedControlVersion);
  const previous = facts.events[0];
  if ((previous?.version || 0) !== value.expectedVersion) fail(409, 'revision_conflict', '发布版本已变化，请重新读取。');
  const snapshot = facts.snapshots.find((item) => item.id === value.snapshotId) || fail(404, 'not_found', '固定快照不存在。');
  const approval = facts.approvals.find((item) => item.snapshotId === snapshot.id);
  if (value.action === 'withdraw') {
    if (!previous || previous.action === 'withdraw' || previous.snapshotId !== snapshot.id) fail(409, 'invalid_transition', '只能撤回当前发布指针，历史仍保留。');
  } else {
    if (!enabled) fail(409, 'publication_disabled', '公开教育内容功能未显式启用；不会改变历史目录接口。');
    if (approvalReasons(snapshot, facts, now).length) fail(409, 'publication_prerequisites', '缺少当前有效批准或来源/专业依据，不能发布或回滚。');
    if (previous && previous.action !== 'withdraw' && previous.snapshotId === snapshot.id && previous.approvalVersion === approval!.version && previous.controlEpoch === facts.controls[0]?.epoch) fail(409, 'duplicate_publication', '该快照已是当前版本。');
    if (value.action === 'rollback' && !facts.events.some((item) => item.snapshotId === snapshot.id && item.action !== 'withdraw')) fail(409, 'invalid_rollback', '只能回滚到曾正式发布且当前仍有效的快照。');
  }
  return signed({ ingredientId: facts.ingredientId, version: value.expectedVersion + 1, action: value.action, snapshotId: snapshot.id,
    approvalVersion: value.action === 'withdraw' ? approval?.version || previous!.approvalVersion : approval!.version,
    controlEpoch: facts.controls[0]?.epoch || 'uninitialized', previousDigest: previous?.digest || null,
    actorId: actor.id, actor: actor.username, accountRevision: actor.revision, comment: value.comment, recordedAt: new Date(now).toISOString() });
}
export function newControl(input: PublicationControlInput, previous: PublicationControl | undefined, actor: Account, now = Date.now()): PublicationControl {
  const value = validateControlInput(input);
  if (actor.role !== 'admin' || !actor.active) fail(403, 'forbidden', '仅管理员可以操作发布冻结。');
  if ((previous?.version || 0) !== value.expectedVersion) fail(409, 'revision_conflict', '发布冻结版本已变化。');
  if (value.action === 'resume' && previous?.action === 'resume') fail(409, 'invalid_transition', '当前不是冻结状态。');
  return signed({ version: value.expectedVersion + 1, action: value.action, epoch: value.action === 'freeze' || !previous ? randomUUID() : previous.epoch, kind: 'operator' as const,
    actorId: actor.id, actor: actor.username, accountRevision: actor.revision, evidenceReference: value.evidenceReference, comment: value.comment, recordedAt: new Date(now).toISOString() });
}
export function recoveryFreeze(previous: PublicationControl | undefined, evidenceReference: string, now = Date.now()): PublicationControl {
  return signed({ version: (previous?.version || 0) + 1, action: 'freeze' as const, epoch: randomUUID(), kind: 'recovery' as const,
    actorId: null, actor: 'backup-restore', accountRevision: null, evidenceReference, comment: '恢复后发布冻结；核对备份后撤销、账号、资格和来源，再由管理员明确恢复。', recordedAt: new Date(now).toISOString() });
}
export function activePublication(facts: PublicationFacts, enabled = false, now = Date.now()): { snapshot: PublicationSnapshot | null; reasons: string[] } {
  if (!enabled) return { snapshot: null, reasons: ['publication_disabled'] };
  const event = facts.events[0];
  if (!event || event.action === 'withdraw') return { snapshot: null, reasons: [event ? 'publication_withdrawn' : 'publication_missing'] };
  const snapshot = facts.snapshots.find((item) => item.id === event.snapshotId) || fail(409, 'publication_integrity', '发布指针引用缺失。');
  const reasons = approvalReasons(snapshot, facts, now); const approval = facts.approvals.find((item) => item.snapshotId === snapshot.id);
  if (event.approvalVersion !== approval?.version || event.controlEpoch !== facts.controls[0]?.epoch) reasons.push('published_approval_changed');
  return { snapshot: reasons.length ? null : snapshot, reasons: [...new Set(reasons)] };
}
export function publicEducation(facts: PublicationFacts, enabled = false, now = Date.now()): PublishedEducation | null {
  const current = activePublication(facts, enabled, now); if (!current.snapshot) return null;
  const snapshot = current.snapshot; const draft = snapshot.basis.draft;
  return { scope: 'ingredient_education', ingredientId: snapshot.ingredientId, name: snapshot.basis.ingredientName, snapshotId: snapshot.id, snapshotVersion: snapshot.version,
    contentRevision: draft.revision, baseReleaseId: draft.baseReleaseId, publishedAt: facts.events[0].recordedAt,
    ediblePart: draft.content.ediblePart, latinName: draft.content.latinName, educationText: draft.content.educationText, safetyText: draft.content.safetyText,
    sources: draft.sources.map((source, index) => { const check = snapshot.basis.sourceChecks.find((item) => item.sourceId === source.id)!;
      return { title: source.title, publisher: source.publisher, url: source.url, locator: draft.content.sourceRefs[index].locator, checkedAt: check.checkedAt, validUntil: check.validUntil }; }),
    boundary: '非医疗食养教育，不用于诊断、治疗、个体化开方或用药指导。' };
}
export function publicationWorkspace(facts: PublicationFacts, enabled = false, focusVersion?: number): PublicationWorkspace {
  const basis = currentBasis(facts); const active = activePublication(facts, enabled);
  const snapshots = facts.snapshots.slice(0, 20);
  if (active.snapshot && !snapshots.some((item) => item.id === active.snapshot!.id)) snapshots.push(active.snapshot);
  if (focusVersion !== undefined) {
    if (!version(focusVersion)) fail(400, 'invalid_publication', '固定快照版本无效。');
    const focused = facts.snapshots.find((item) => item.version === focusVersion) || fail(404, 'not_found', '固定快照版本不存在。');
    if (!snapshots.some((item) => item.id === focused.id)) snapshots.push(focused);
  }
  const visible = new Set(snapshots.map((item) => item.id)); const latest = new Map<string, PublicationApproval>();
  for (const approval of facts.approvals) if (visible.has(approval.snapshotId) && !latest.has(approval.snapshotId)) latest.set(approval.snapshotId, approval);
  return { ingredientId: facts.ingredientId, preflight: basis.preflight, basisDigest: basis.basis ? publicationDigest(basis.basis) : null,
    snapshots, approvals: [...latest.values()], events: facts.events.slice(0, 20), eventVersion: facts.events[0]?.version || 0,
    control: facts.controls[0] || null, enabled, activeSnapshotId: active.snapshot?.id || null, blockedReasons: active.reasons };
}

// Stored rows are strict, digest-bound records; JSON payloads are never public projections.
const integrity = () => fail(409, 'publication_integrity', '发布历史完整性校验失败。');
function checked<T extends object>(item: T, storedDigest: unknown): T & { digest: string } {
  if (!digest(storedDigest) || publicationDigest(item) !== storedDigest) integrity();
  return { ...item, digest: storedDigest as string };
}
export function snapshotFrom(row: Record<string, any>): PublicationSnapshot {
  // Treat nested payloads as untrusted too. Re-hashing the outer JSON must not
  // make malformed/extra child fields or forged child digests acceptable.
  try { return readSnapshot(row); } catch { return integrity(); }
}
function readSnapshot(row: Record<string, any>): PublicationSnapshot {
  const basis = JSON.parse(row.basis_payload) as PublicationBasis;
  if (!exact(basis, ['scope', 'ingredientName', 'draft', 'editorial', 'professionalReviews', 'qualifications', 'sourceChecks']) || basis.scope !== 'ingredient_education' || !text(basis.ingredientName, 200) || !basis.draft ||
    !exact(basis.editorial, ['taskId', 'reviewerId', 'accountRevision']) || !text(basis.editorial.taskId, 80) || !text(basis.editorial.reviewerId, 80) || !version(basis.editorial.accountRevision) ||
    !Array.isArray(basis.professionalReviews) || basis.professionalReviews.length !== 2 || !Array.isArray(basis.qualifications) || basis.qualifications.length !== 2 ||
    !Array.isArray(basis.sourceChecks)) integrity();
  const draft = basis.draft;
  if (!exact(draft, ['ingredientId', 'revision', 'content', 'sources', 'digest', 'baseReleaseId', 'authorId', 'author', 'createdAt', 'lockVersion', 'state', 'ownerId', 'owner', 'updatedAt', 'visibility', 'professionalReviewState', 'publicationEnabled']) ||
    !text(draft.ingredientId, 80) || !version(draft.revision) || !version(draft.lockVersion) || !digest(draft.digest) || !text(draft.baseReleaseId, 200) ||
    !text(draft.authorId, 80) || !text(draft.author, 40) || !text(draft.ownerId, 80) || !text(draft.owner, 40) || !iso(draft.createdAt) || !iso(draft.updatedAt) ||
    draft.state !== 'editorial_accepted' || draft.visibility !== 'private' || draft.professionalReviewState !== 'pending' || draft.publicationEnabled !== false ||
    !isDeepStrictEqual(validateContent(draft.content), draft.content) || !Array.isArray(draft.sources) || !draft.content.sourceRefs.length || basis.sourceChecks.length !== draft.content.sourceRefs.length) integrity();
  for (const source of draft.sources) {
    if (!exact(source, ['id', 'revision', 'title', 'publisher', 'url', 'recordedBy', 'recordedAt', 'verificationState', 'visibility']) || !text(source.id, 80) || !version(source.revision) ||
      !text(source.recordedBy, 40) || !iso(source.recordedAt) || source.verificationState !== 'pending' || source.visibility !== 'private' ||
      !isDeepStrictEqual(validateSource({ title: source.title, publisher: source.publisher, url: source.url }), { title: source.title, publisher: source.publisher, url: source.url })) integrity();
  }
  const rowOf = (columns: string[], values: unknown[]) => Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  for (const qualification of basis.qualifications) {
    const canonical = qualificationFrom(rowOf(['user_id', 'revision', 'profession', 'status', 'evidence_kind', 'evidence_reference', 'valid_until', 'comment', 'verification_confirmed', 'account_revision', 'actor_id', 'actor_name', 'created_at', 'digest'], qualificationValues(qualification)));
    if (!isDeepStrictEqual(qualification, canonical)) integrity();
  }
  for (const review of basis.professionalReviews) {
    const canonical = reviewFrom(rowOf(['ingredient_id', 'version', 'content_revision', 'content_digest', 'profession', 'decision', 'qualification_user_id', 'qualification_revision', 'actor_id', 'actor_name', 'account_revision', 'comment', 'created_at', 'digest'], reviewValues(review)));
    if (!isDeepStrictEqual(review, canonical)) integrity();
  }
  for (const check of basis.sourceChecks) {
    const canonical = sourceCheckFrom(rowOf(['source_id', 'version', 'source_revision', 'source_digest', 'decision', 'evidence_kind', 'scope_payload', 'authority', 'checked_at', 'valid_until', 'evidence_reference', 'comment', 'verification_confirmed', 'actor_id', 'actor_name', 'account_revision', 'created_at', 'digest'], sourceCheckValues(check)));
    if (!isDeepStrictEqual(check, canonical)) integrity();
  }
  verifyContentRevision(basis.draft);
  if (!text(row.id, 80) || !version(row.version) || row.ingredient_id !== basis.draft.ingredientId || row.content_revision !== basis.draft.revision || publicationDigest(basis) !== row.basis_digest || !text(row.comment, 1000) || !iso(row.created_at) || !text(row.actor_id, 80) || !text(row.actor_name, 40) || !version(row.account_revision)) integrity();
  return checked({ id: row.id, ingredientId: row.ingredient_id, version: row.version, basis, basisDigest: row.basis_digest,
    actorId: row.actor_id, actor: row.actor_name, accountRevision: row.account_revision, comment: row.comment, recordedAt: row.created_at }, row.digest);
}
export function approvalFrom(row: Record<string, any>): PublicationApproval {
  if (!text(row.snapshot_id, 80) || !version(row.version) || !digest(row.snapshot_digest) || !['approve', 'revoke'].includes(row.decision) || !text(row.control_epoch, 80) ||
    !text(row.actor_id, 80) || !text(row.actor_name, 40) || !version(row.account_revision) || !text(row.comment, 1000) || !iso(row.created_at)) integrity();
  return checked({ snapshotId: row.snapshot_id, version: row.version, snapshotDigest: row.snapshot_digest, decision: row.decision, controlEpoch: row.control_epoch,
    actorId: row.actor_id, actor: row.actor_name, accountRevision: row.account_revision, comment: row.comment, recordedAt: row.created_at }, row.digest);
}
export function eventFrom(row: Record<string, any>): PublicationEvent {
  if (!text(row.ingredient_id, 80) || !version(row.version) || !['publish', 'withdraw', 'rollback'].includes(row.action) || !text(row.snapshot_id, 80) || !version(row.approval_version) || !text(row.control_epoch, 80) ||
    !(row.previous_digest === null || digest(row.previous_digest)) || !text(row.actor_id, 80) || !text(row.actor_name, 40) || !version(row.account_revision) || !text(row.comment, 1000) || !iso(row.created_at)) integrity();
  return checked({ ingredientId: row.ingredient_id, version: row.version, action: row.action, snapshotId: row.snapshot_id, approvalVersion: row.approval_version,
    controlEpoch: row.control_epoch, previousDigest: row.previous_digest, actorId: row.actor_id, actor: row.actor_name, accountRevision: row.account_revision, comment: row.comment, recordedAt: row.created_at }, row.digest);
}
export function controlFrom(row: Record<string, any>): PublicationControl {
  if (!version(row.version) || !['freeze', 'resume'].includes(row.action) || !text(row.epoch, 80) || !['operator', 'recovery'].includes(row.kind) || !text(row.actor_name, 40) ||
    !text(row.evidence_reference, 200) || !text(row.comment, 1000) || !iso(row.created_at) ||
    (row.kind === 'operator' ? !text(row.actor_id, 80) || !version(row.account_revision) : row.actor_id !== null || row.account_revision !== null || row.action !== 'freeze' || row.actor_name !== 'backup-restore')) integrity();
  return checked({ version: row.version, action: row.action, epoch: row.epoch, kind: row.kind, actorId: row.actor_id, actor: row.actor_name, accountRevision: row.account_revision,
    evidenceReference: row.evidence_reference, comment: row.comment, recordedAt: row.created_at }, row.digest);
}
export const SNAPSHOT_INSERT = 'INSERT INTO publication_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const snapshotValues = (item: PublicationSnapshot) => [item.id, item.ingredientId, item.version, item.basis.draft.revision, JSON.stringify(item.basis), item.basisDigest, item.actorId, item.actor, item.accountRevision, item.comment, item.recordedAt, item.digest];
export const APPROVAL_INSERT = 'INSERT INTO publication_approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const approvalValues = (item: PublicationApproval) => [item.snapshotId, item.version, item.snapshotDigest, item.decision, item.controlEpoch, item.actorId, item.actor, item.accountRevision, item.comment, item.recordedAt, item.digest];
export const PUBLICATION_EVENT_INSERT = 'INSERT INTO publication_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const publicationEventValues = (item: PublicationEvent) => [item.ingredientId, item.version, item.action, item.snapshotId, item.approvalVersion, item.controlEpoch, item.previousDigest, item.actorId, item.actor, item.accountRevision, item.comment, item.recordedAt, item.digest];
export const CONTROL_INSERT = 'INSERT INTO publication_controls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const controlValues = (item: PublicationControl) => [item.version, item.action, item.epoch, item.kind, item.actorId, item.actor, item.accountRevision, item.evidenceReference, item.comment, item.recordedAt, item.digest];
