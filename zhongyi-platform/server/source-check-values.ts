import { createHash } from 'node:crypto';
import type { Account, ManagedSource, ProfessionalDetail, PublicationPreflight, SourceCheck, SourceCheckDetail, SourceCheckInput, SourceDomain } from '../shared/contracts.js';
import { exact, fail, version } from './workflow.js';

export const SOURCE_DOMAINS: SourceDomain[] = ['identity', 'edible_part', 'processing', 'safety_boundary', 'directory_scope'];
const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const sourceDigest = (source: ManagedSource) => hash({ id: source.id, revision: source.revision, title: source.title, publisher: source.publisher, url: source.url, recordedBy: source.recordedBy, recordedAt: source.recordedAt });
export const sourceCheckDigest = (item: Omit<SourceCheck, 'digest'>) => hash(item);
export function validateSourceCheck(input: unknown, now = Date.now(), historical = false): SourceCheckInput {
  if (!exact(input, ['sourceRevision', 'sourceDigest', 'decision', 'evidenceKind', 'ingredientIds', 'domains', 'authority', 'checkedAt', 'validUntil', 'evidenceReference', 'comment', 'verificationConfirmed']) ||
    !version(input.sourceRevision) || !digest(input.sourceDigest) || !['verified', 'return', 'revoke'].includes(String(input.decision)) || !['manual-check', 'test-fixture'].includes(String(input.evidenceKind)) ||
    !Array.isArray(input.ingredientIds) || !input.ingredientIds.length || input.ingredientIds.length > 200 || input.ingredientIds.some((id) => !text(id, 80)) || new Set(input.ingredientIds).size !== input.ingredientIds.length ||
    !Array.isArray(input.domains) || !input.domains.length || input.domains.length > SOURCE_DOMAINS.length || input.domains.some((domain) => !SOURCE_DOMAINS.includes(domain as SourceDomain)) || new Set(input.domains).size !== input.domains.length ||
    !['official', 'research', 'reference'].includes(String(input.authority)) || !iso(input.checkedAt) || !iso(input.validUntil) || Date.parse(input.validUntil) <= Date.parse(input.checkedAt) || (!historical && Date.parse(input.checkedAt) > now) ||
    !text(input.evidenceReference, 200) || !text(input.comment, 1000) || typeof input.verificationConfirmed !== 'boolean' ||
    (input.decision === 'verified' && (!input.verificationConfirmed || (!historical && (Date.parse(input.checkedAt) > now || Date.parse(input.validUntil) <= now))))) {
    fail(400, 'invalid_source_check', '核验须绑定来源摘要、适用食材/信息域、人工依据、UTC 查证与复核截止时间，并明确确认；测试核验不代表真实依据。');
  }
  return { sourceRevision: input.sourceRevision, sourceDigest: input.sourceDigest, decision: input.decision as SourceCheckInput['decision'], evidenceKind: input.evidenceKind as SourceCheckInput['evidenceKind'],
    ingredientIds: input.ingredientIds as string[], domains: input.domains as SourceDomain[], authority: input.authority as SourceCheckInput['authority'], checkedAt: input.checkedAt,
    validUntil: input.validUntil, evidenceReference: input.evidenceReference.trim(), comment: input.comment.trim(), verificationConfirmed: input.verificationConfirmed };
}
export function sourceCheckFrom(row: Record<string, any>): SourceCheck {
  const scope = JSON.parse(row.scope_payload);
  if (!exact(scope, ['ingredientIds', 'domains'])) fail(409, 'source_check_integrity', '来源核验范围完整性失败。');
  const input = validateSourceCheck({ sourceRevision: row.source_revision, sourceDigest: row.source_digest, decision: row.decision, evidenceKind: row.evidence_kind,
    ingredientIds: scope.ingredientIds, domains: scope.domains, authority: row.authority, checkedAt: row.checked_at, validUntil: row.valid_until,
    evidenceReference: row.evidence_reference, comment: row.comment, verificationConfirmed: row.verification_confirmed === 1 }, 0, true);
  const item = { ...input, sourceId: row.source_id as string, version: row.version as number, actorId: row.actor_id as string, actor: row.actor_name as string, accountRevision: row.account_revision as number, recordedAt: row.created_at as string };
  if (!text(item.sourceId, 80) || !version(item.version) || !text(item.actorId, 80) || !text(item.actor, 40) || !version(item.accountRevision) || !iso(item.recordedAt) ||
    ![0, 1].includes(row.verification_confirmed) || sourceCheckDigest(item) !== row.digest) fail(409, 'source_check_integrity', '来源核验记录完整性失败。');
  return { ...item, digest: row.digest };
}
export interface SourceCheckFacts { source: ManagedSource; checks: SourceCheck[]; users: Account[]; authorIds: string[] }
export function sourceCheckDetail(facts: SourceCheckFacts, now = Date.now()): SourceCheckDetail {
  const latest = facts.checks.find((item) => item.sourceRevision === facts.source.revision) || null;
  let state: SourceCheckDetail['state'] = 'pending'; const reasons: string[] = [];
  if (!latest) reasons.push('source_check_missing');
  else if (latest.sourceDigest !== sourceDigest(facts.source)) { state = 'invalidated'; reasons.push('source_changed'); }
  else if (latest.decision !== 'verified') { state = latest.decision === 'return' ? 'returned' : 'revoked'; reasons.push(`source_check_${state}`); }
  else if (Date.parse(latest.checkedAt) > now || Date.parse(latest.validUntil) <= now) { state = 'expired'; reasons.push('source_check_expired'); }
  else {
    const actor = facts.users.find((user) => user.id === latest.actorId);
    if (!actor?.active || !['admin', 'reviewer'].includes(actor.role) || actor.revision !== latest.accountRevision || facts.authorIds.includes(actor.id)) { state = 'invalidated'; reasons.push('source_check_authority_changed'); }
    else if (latest.evidenceKind === 'test-fixture') { state = 'recorded'; reasons.push('source_check_test_fixture'); }
    else state = 'verified';
  }
  return { source: facts.source, sourceDigest: sourceDigest(facts.source), checks: facts.checks.slice(0, 20), latest, checkVersion: facts.checks[0]?.version || 0,
    state, reasons, publicationEnabled: false, visibility: 'private' };
}
export function newSourceCheck(input: SourceCheckInput, expectedVersion: number, facts: SourceCheckFacts, actor: Account, now = Date.now()): SourceCheck {
  const value = validateSourceCheck(input, now);
  if ((facts.checks[0]?.version || 0) !== expectedVersion || value.sourceRevision !== facts.source.revision || value.sourceDigest !== sourceDigest(facts.source)) fail(409, 'revision_conflict', '来源或核验版本已变化，请重新加载；当前输入保留。');
  const previous = facts.checks.find((item) => item.sourceRevision === value.sourceRevision);
  if (value.decision === 'revoke') {
    if (!previous || previous.decision !== 'verified' || previous.sourceDigest !== value.sourceDigest || previous.evidenceKind !== value.evidenceKind) fail(409, 'invalid_transition', '只能撤销该固定来源版本的当前核验通过记录。');
    if (actor.role !== 'admin' && actor.id !== previous.actorId) fail(403, 'forbidden', '仅原核验人或管理员可以撤销。');
  } else if (facts.authorIds.includes(actor.id)) fail(403, 'self_review', '参与过此来源登记或修订的账号不能自行核验。');
  const item = { ...value, sourceId: facts.source.id, version: expectedVersion + 1, actorId: actor.id, actor: actor.username, accountRevision: actor.revision, recordedAt: new Date(now).toISOString() };
  return { ...item, digest: sourceCheckDigest(item) };
}
export function publicationPreflight(ingredientId: string, professional: ProfessionalDetail, details: SourceCheckDetail[]): PublicationPreflight {
  const draft = professional.draft; const reasons: string[] = []; const covered = new Set<SourceDomain>(); let officialDirectory = false;
  if (!draft) reasons.push('content_missing');
  if (draft && draft.state !== 'editorial_accepted') reasons.push('editorial_review_required');
  if (professional.state !== 'eligible_for_publication_approval') reasons.push('professional_review_required');
  if (draft && (!draft.content.ediblePart || !draft.content.educationText || !draft.content.safetyText)) reasons.push('education_fields_incomplete');
  if (!draft?.content.sourceRefs.length) reasons.push('source_references_required');
  const sources = (draft?.content.sourceRefs || []).map((ref) => {
    const detail = details.find((item) => item.source.id === ref.id && item.source.revision === ref.revision);
    const item = detail?.latest; const problems = [...(detail?.reasons || ['source_check_missing'])];
    if (detail?.state !== 'verified' && !problems.length) problems.push('source_check_required');
    if (item && !item.ingredientIds.includes(ingredientId)) problems.push('source_scope_mismatch');
    const ready = !!detail && detail.state === 'verified' && problems.length === 0;
    if (ready) { item!.domains.forEach((domain) => covered.add(domain)); if (item!.authority === 'official' && item!.domains.includes('directory_scope')) officialDirectory = true; }
    return { sourceId: ref.id, sourceRevision: ref.revision, checkVersion: detail?.checkVersion || 0, checkDigest: item?.digest || null, ready, reasons: problems };
  });
  if (sources.some((item) => !item.ready)) reasons.push('source_checks_required');
  const required = SOURCE_DOMAINS;
  const missingDomains = required.filter((domain) => !covered.has(domain));
  if (missingDomains.length) reasons.push('source_domains_incomplete');
  if (!officialDirectory) reasons.push('official_directory_scope_required');
  return { ingredientId, contentRevision: draft?.revision || null, contentDigest: draft?.digest || null, baseReleaseId: draft?.baseReleaseId || null,
    lockVersion: draft?.lockVersion || 0, professionalReviewVersion: professional.reviewVersion, sources, missingDomains, reasons, readyForReleaseApproval: reasons.length === 0, publicationEnabled: false, visibility: 'private' };
}
export const SOURCE_CHECK_INSERT = 'INSERT INTO source_checks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const sourceCheckValues = (item: SourceCheck) => [item.sourceId, item.version, item.sourceRevision, item.sourceDigest, item.decision, item.evidenceKind,
  JSON.stringify({ ingredientIds: item.ingredientIds, domains: item.domains }), item.authority, item.checkedAt, item.validUntil, item.evidenceReference, item.comment, Number(item.verificationConfirmed), item.actorId, item.actor, item.accountRevision, item.recordedAt, item.digest];
