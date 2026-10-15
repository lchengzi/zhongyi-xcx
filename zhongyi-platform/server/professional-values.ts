import { createHash } from 'node:crypto';
import type { Account, ContentDraft, ContentRevision, ProfessionalDecisionInput, ProfessionalDetail, ProfessionalKind, ProfessionalQualification, ProfessionalReview, QualificationInput } from '../shared/contracts.js';
import { exact, fail, verifyContentRevision, version } from './workflow.js';

const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const kinds = ['tcm_physician', 'pharmacist'] as const;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !!value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validateQualification(input: unknown, now = Date.now(), historical = false): QualificationInput {
  if (!exact(input, ['profession', 'status', 'evidenceKind', 'evidenceReference', 'validUntil', 'comment', 'verificationConfirmed']) ||
    !kinds.includes(input.profession as ProfessionalKind) || !['verified', 'revoked'].includes(String(input.status)) ||
    !['manual-verification', 'test-fixture'].includes(String(input.evidenceKind)) || !text(input.evidenceReference, 200) || !text(input.comment, 1000) ||
    !iso(input.validUntil) || typeof input.verificationConfirmed !== 'boolean' ||
    (input.status === 'verified' && (!input.verificationConfirmed || (!historical && Date.parse(input.validUntil) <= now)))) {
    fail(400, 'invalid_qualification', '请提供专业类别、核验依据编号、有效期、说明和明确核验确认；测试记录不代表真实资格。');
  }
  return { profession: input.profession as ProfessionalKind, status: input.status as QualificationInput['status'], evidenceKind: input.evidenceKind as QualificationInput['evidenceKind'],
    evidenceReference: input.evidenceReference.trim(), validUntil: input.validUntil, comment: input.comment.trim(), verificationConfirmed: input.verificationConfirmed };
}
export function validateProfessionalDecision(input: unknown): ProfessionalDecisionInput {
  if (!exact(input, ['profession', 'decision', 'contentRevision', 'contentDigest', 'expectedLockVersion', 'expectedReviewVersion', 'expectedQualificationRevision', 'comment']) ||
    !kinds.includes(input.profession as ProfessionalKind) || !['approve', 'return', 'revoke'].includes(String(input.decision)) ||
    !version(input.contentRevision) || !version(input.expectedLockVersion) || !version(input.expectedReviewVersion, true) || !version(input.expectedQualificationRevision) ||
    typeof input.contentDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.contentDigest) || !text(input.comment, 1000)) fail(400, 'invalid_professional_decision', '审校需绑定内容摘要、协作版本、资格版本和明确意见。');
  return { ...(input as unknown as ProfessionalDecisionInput), comment: input.comment.trim() };
}

export const qualificationDigest = (item: Omit<ProfessionalQualification, 'digest'>) => hash(item);
export const professionalReviewDigest = (item: Omit<ProfessionalReview, 'digest'>) => hash(item);
export function qualificationFrom(row: Record<string, any>): ProfessionalQualification {
  const input = validateQualification({ profession: row.profession, status: row.status, evidenceKind: row.evidence_kind, evidenceReference: row.evidence_reference,
    validUntil: row.valid_until, comment: row.comment, verificationConfirmed: row.verification_confirmed === 1 }, 0, true);
  const item = { ...input, userId: row.user_id as string, revision: row.revision as number, accountRevision: row.account_revision as number,
    recordedById: row.actor_id as string, recordedBy: row.actor_name as string, recordedAt: row.created_at as string };
  if (!version(item.revision) || !version(item.accountRevision) || !iso(item.recordedAt) || !text(item.userId, 80) || !text(item.recordedById, 80) ||
    !text(item.recordedBy, 40) || ![0, 1].includes(row.verification_confirmed) || qualificationDigest(item) !== row.digest) fail(409, 'qualification_integrity', '资格记录完整性校验失败。');
  return { ...item, digest: row.digest };
}
export function reviewFrom(row: Record<string, any>): ProfessionalReview {
  const item: Omit<ProfessionalReview, 'digest'> = { ingredientId: row.ingredient_id, version: row.version, contentRevision: row.content_revision,
    contentDigest: row.content_digest, profession: row.profession, decision: row.decision, qualificationUserId: row.qualification_user_id,
    qualificationRevision: row.qualification_revision, actorId: row.actor_id, actor: row.actor_name, accountRevision: row.account_revision,
    comment: row.comment, recordedAt: row.created_at };
  if (!version(item.version) || !version(item.accountRevision) || !iso(item.recordedAt) || !text(item.ingredientId, 80) || !text(item.actorId, 80) || !text(item.actor, 40) ||
    !text(item.qualificationUserId, 80) || !kinds.includes(item.profession) || !['approve', 'return', 'revoke'].includes(item.decision) || !version(item.contentRevision) ||
    !version(item.qualificationRevision) || !/^sha256:[a-f0-9]{64}$/.test(item.contentDigest) || !text(item.comment, 1000) || professionalReviewDigest(item) !== row.digest) fail(409, 'professional_integrity', '审校记录完整性校验失败。');
  return { ...item, digest: row.digest };
}
export interface ProfessionalFacts {
  ingredientId: string;
  draft?: ContentDraft;
  reviews: ProfessionalReview[]; // Complete history for validity, not the UI's last 20.
  qualifications: ProfessionalQualification[]; // Latest credential for each historical signer.
  users: Account[];
  contributorIds: string[]; // Full content/source author and editorial-decision history.
}
export function qualificationActive(item: ProfessionalQualification | undefined, user: Account | undefined, now = Date.now()): boolean {
  return !!item && !!user && user.active && ['admin', 'reviewer'].includes(user.role) && item.status === 'verified' &&
    item.accountRevision === user.revision && Date.parse(item.validUntil) > now;
}
export function professionalDetail(facts: ProfessionalFacts, now = Date.now()): ProfessionalDetail {
  if (!text(facts.ingredientId, 80) || (facts.draft && facts.draft.ingredientId !== facts.ingredientId) || facts.reviews.some(item => item.ingredientId !== facts.ingredientId)) fail(409, 'professional_integrity', '审校对象完整性校验失败。');
  if (facts.draft) verifyContentRevision(facts.draft);
  const latest = (profession: ProfessionalKind) => facts.reviews.find((item) => item.profession === profession && item.contentRevision === facts.draft?.revision) || facts.reviews.find((item) => item.profession === profession);
  const reasons: string[] = []; let approved = 0; let returned = false; const signers = new Set<string>();
  for (const profession of kinds) {
    const review = latest(profession);
    if (!review || review.decision !== 'approve') {
      if (review?.decision === 'return' && review.contentRevision === facts.draft?.revision) returned = true;
      reasons.push(`${profession}:pending_or_revoked`); continue;
    }
    const qualification = facts.qualifications.find((item) => item.userId === review.qualificationUserId);
    const user = facts.users.find((item) => item.id === review.actorId);
    if (!facts.draft || facts.draft.state !== 'editorial_accepted' || facts.draft.revision !== review.contentRevision || facts.draft.digest !== review.contentDigest) reasons.push(`${profession}:content_changed`);
    else if (!qualificationActive(qualification, user, now) || qualification!.revision !== review.qualificationRevision || qualification!.profession !== profession ||
      review.actorId !== review.qualificationUserId || review.accountRevision !== user!.revision || facts.contributorIds.includes(review.actorId)) reasons.push(`${profession}:qualification_or_independence_changed`);
    else if (qualification!.evidenceKind === 'test-fixture') reasons.push(`${profession}:test_fixture_not_professional_evidence`);
    else { approved += 1; signers.add(review.actorId); }
  }
  return { scope: 'ingredient_education', ingredientId: facts.ingredientId, draft: facts.draft || null, reviews: facts.reviews.slice(0, 20), latestReviews: kinds.flatMap((kind) => latest(kind) || []), reviewVersion: facts.reviews[0]?.version || 0,
    state: approved === 2 && signers.size === 2 && !returned ? 'eligible_for_publication_approval' : returned ? 'changes_requested' : facts.reviews.some((item) => item.decision === 'approve' && item.contentRevision === facts.draft?.revision) ? 'recorded' : 'pending',
    reasons, publicationEnabled: false, visibility: 'private' };
}
export function newQualification(input: QualificationInput, previous: ProfessionalQualification | undefined, expectedRevision: number, target: Account, actor: Account, now = Date.now()): ProfessionalQualification {
  const value = validateQualification(input, now);
  if ((previous?.revision || 0) !== expectedRevision) fail(409, 'revision_conflict', '资格已被修改，请重新加载。');
  if (value.status === 'verified' && (actor.id === target.id || !target.active || !['admin', 'reviewer'].includes(target.role))) fail(403, 'qualification_independence', '资格须由其他管理员核验，目标需是启用的审阅或管理员账号。');
  if (value.status === 'revoked' && (!previous || previous.status !== 'verified' || previous.profession !== value.profession || previous.evidenceKind !== value.evidenceKind)) fail(409, 'invalid_transition', '只能撤销已有有效状态的同类资格记录。');
  const item = { ...value, userId: target.id, revision: expectedRevision + 1, accountRevision: target.revision, recordedById: actor.id, recordedBy: actor.username, recordedAt: new Date(now).toISOString() };
  return { ...item, digest: qualificationDigest(item) };
}
export function newProfessionalReview(id: string, input: ProfessionalDecisionInput, facts: ProfessionalFacts, revision: ContentRevision | undefined, actor: Account, now = Date.now()): ProfessionalReview {
  const value = validateProfessionalDecision(input); const latest = facts.reviews.find((item) => item.profession === value.profession && item.contentRevision === value.contentRevision);
  if ((facts.reviews[0]?.version || 0) !== value.expectedReviewVersion || !facts.draft || facts.draft.lockVersion !== value.expectedLockVersion ||
    !revision || revision.revision !== value.contentRevision || revision.digest !== value.contentDigest) fail(409, 'revision_conflict', '内容、审校或协作版本已变化，请重新加载。');
  verifyContentRevision(revision);
  let qualificationUserId = actor.id;
  if (value.decision === 'revoke') {
    if (!latest || latest.decision !== 'approve' || latest.contentRevision !== value.contentRevision || latest.contentDigest !== value.contentDigest || latest.qualificationRevision !== value.expectedQualificationRevision) fail(409, 'invalid_transition', '只能撤销所指向的当前审校通过记录。');
    if (actor.role !== 'admin' && actor.id !== latest.actorId) fail(403, 'forbidden', '仅原审校人或管理员可以撤销该意见。');
    qualificationUserId = latest.qualificationUserId;
  } else {
    const qualification = facts.qualifications.find((item) => item.userId === actor.id);
    if (!qualificationActive(qualification, actor, now) || qualification!.revision !== value.expectedQualificationRevision || qualification!.profession !== value.profession) fail(403, 'qualification_required', '需当前有效、已核验且与账号版本一致的对应专业资格记录。');
    if (facts.contributorIds.includes(actor.id)) fail(403, 'self_review', '参与此条目编辑、来源整理或编辑审阅的账号不能作专业审校。');
    if (facts.draft.state !== 'editorial_accepted' || facts.draft.revision !== value.contentRevision || facts.draft.digest !== value.contentDigest) fail(409, 'editorial_required', '先完成当前固定版本的独立编辑审阅。');
    if (latest?.contentRevision === value.contentRevision && (latest.decision === 'return' || (latest.decision === 'approve' && value.decision === 'approve'))) fail(409, 'invalid_transition', '已退回版本须修订后重新编辑审阅；已通过意见不能重复提交。');
  }
  const item: Omit<ProfessionalReview, 'digest'> = { ingredientId: id, version: value.expectedReviewVersion + 1, contentRevision: value.contentRevision,
    contentDigest: value.contentDigest, profession: value.profession, decision: value.decision, qualificationUserId, qualificationRevision: value.expectedQualificationRevision,
    actorId: actor.id, actor: actor.username, accountRevision: actor.revision, comment: value.comment, recordedAt: new Date(now).toISOString() };
  return { ...item, digest: professionalReviewDigest(item) };
}

export const QUALIFICATION_INSERT = 'INSERT INTO professional_qualifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const qualificationValues = (item: ProfessionalQualification) => [item.userId, item.revision, item.profession, item.status, item.evidenceKind, item.evidenceReference, item.validUntil, item.comment, Number(item.verificationConfirmed), item.accountRevision, item.recordedById, item.recordedBy, item.recordedAt, item.digest];
export const REVIEW_INSERT = 'INSERT INTO professional_reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const reviewValues = (item: ProfessionalReview) => [item.ingredientId, item.version, item.contentRevision, item.contentDigest, item.profession, item.decision, item.qualificationUserId, item.qualificationRevision, item.actorId, item.actor, item.accountRevision, item.comment, item.recordedAt, item.digest];
export const CONTRIBUTOR_SQL = `SELECT author_id id FROM content_revisions WHERE ingredient_id = ?
  UNION SELECT submitted_by_id id FROM review_tasks WHERE ingredient_id = ?
  UNION SELECT reviewed_by_id id FROM review_tasks WHERE ingredient_id = ? AND reviewed_by_id IS NOT NULL
  UNION SELECT s.author_id id FROM revision_sources r JOIN source_versions s ON s.source_id = r.source_id AND s.revision = r.source_revision WHERE r.ingredient_id = ?`;
