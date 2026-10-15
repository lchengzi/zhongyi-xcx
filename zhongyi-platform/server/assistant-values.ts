import { createHash } from 'node:crypto';
import type { AssistantEvent, EvidenceExcerpt, EvidenceLeaseRef, ExcerptInput } from '../shared/contracts.js';
import { exact, fail, version } from './workflow.js';

export const digestOf = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
// A deliberately limited minimization guard, not a personal-data classifier.
export const containsPrivateData = (text: string): boolean => /\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|患者姓名|身份证号|病历号/.test(text.normalize('NFKC'));
export function validateExcerpt(value: unknown): ExcerptInput {
  if (!exact(value, ['sourceId', 'sourceRevision', 'locator', 'text', 'allowExternal']) ||
    typeof value.sourceId !== 'string' || !value.sourceId || value.sourceId.length > 80 || !version(value.sourceRevision) ||
    typeof value.locator !== 'string' || !value.locator.trim() || value.locator.length > 400 ||
    typeof value.text !== 'string' || !value.text.trim() || value.text.length > 1800 ||
    typeof value.allowExternal !== 'boolean' || [value.sourceId, value.locator, value.text].some((text) => text.includes('\0'))) {
    fail(400, 'invalid_excerpt', '摘录需包含固定来源版本、原文定位和最多 1800 字原文；外部使用许可必须明确。');
  }
  // This is a minimization guard, not a complete personal-data classifier.
  if ([value.locator, value.text].some(containsPrivateData)) fail(400, 'private_data', '请勿输入个人身份、健康档案或联系方式。');
  return { sourceId: value.sourceId, sourceRevision: value.sourceRevision, locator: value.locator.trim(), text: value.text.trim(), allowExternal: value.allowExternal };
}
export const excerptDigest = (ingredientId: string, input: ExcerptInput): string => digestOf({ ingredientId, ...input });
export interface ExcerptRow {
  id: string; ingredient_id: string; source_id: string; source_revision: number; locator: string; text: string;
  allow_external: number; digest: string; author_id: string; author_name: string; created_at: string;
}
export function excerptFrom(row: ExcerptRow): EvidenceExcerpt {
  const input = validateExcerpt({ sourceId: row.source_id, sourceRevision: row.source_revision, locator: row.locator, text: row.text, allowExternal: row.allow_external === 1 });
  if (![0, 1].includes(row.allow_external) || excerptDigest(row.ingredient_id, input) !== row.digest) fail(409, 'integrity_failure', '摘录摘要校验失败。');
  return { id: row.id, ingredientId: row.ingredient_id, ...input, digest: row.digest, recordedBy: row.author_name,
    recordedAt: row.created_at, visibility: 'private', verificationState: 'pending', externalPermission: { allowed: input.allowExternal, revision: 0, updatedBy: row.author_name, updatedAt: row.created_at } };
}
export interface PermissionRow { id: string; excerpt_id: string; revision: number; allow_external: number; actor_id: string; actor_name: string; created_at: string; digest: string }
export const permissionDigest = (excerpt: EvidenceExcerpt, row: Omit<PermissionRow, 'digest'>): string => digestOf({ excerptDigest: excerpt.digest,
  id: row.id, excerpt_id: row.excerpt_id, revision: row.revision, allow_external: row.allow_external,
  actor_id: row.actor_id, actor_name: row.actor_name, created_at: row.created_at });
export function withPermission(excerpt: EvidenceExcerpt, row?: PermissionRow): EvidenceExcerpt {
  if (!row) return excerpt;
  const { digest, ...payload } = row;
  if (row.excerpt_id !== excerpt.id || !Number.isSafeInteger(row.revision) || row.revision < 1 || ![0, 1].includes(row.allow_external) || permissionDigest(excerpt, payload) !== digest) fail(409, 'integrity_failure', '摘录外部许可历史校验失败。');
  return { ...excerpt, externalPermission: { allowed: row.allow_external === 1, revision: row.revision, updatedBy: row.actor_name, updatedAt: row.created_at } };
}
export function checkEvidence(excerpt: EvidenceExcerpt | undefined, ingredientId: string, ref: EvidenceLeaseRef): void {
  if (!excerpt || excerpt.ingredientId !== ingredientId || excerpt.digest !== ref.digest || !excerpt.externalPermission.allowed || excerpt.externalPermission.revision !== ref.permissionRevision) fail(403, 'external_permission_changed', '摘录外部许可已撤回或发生变化，任务不能继续授权或交付；已发出的资料无法撤回。');
}
export interface AssistantEventRow {
  id: string; ingredient_id: string; actor_id: string; actor_name: string; provider: AssistantEvent['provider']; model: string;
  status: AssistantEvent['status']; request_digest: string; result_digest: string | null; error_code: string | null; metrics_payload: string; created_at: string;
}
export function eventFrom(row: AssistantEventRow): AssistantEvent {
  return { id: row.id, ingredientId: row.ingredient_id, actorId: row.actor_id, actor: row.actor_name, provider: row.provider, model: row.model,
    status: row.status, requestDigest: row.request_digest, resultDigest: row.result_digest, errorCode: row.error_code,
    metrics: JSON.parse(row.metrics_payload), createdAt: row.created_at };
}
