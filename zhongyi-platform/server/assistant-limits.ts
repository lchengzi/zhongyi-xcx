import type { AssistantLimits, AssistantQuota, AssistantReservation, EvidenceLeaseRef } from '../shared/contracts.js';
import { digestOf } from './assistant-values.js';
import { exact, fail } from './workflow.js';

export const DEFAULT_ASSISTANT_LIMITS: Readonly<AssistantLimits> = Object.freeze({ dailyTotal: 20, dailyPerActor: 5, concurrentTotal: 2, concurrentPerActor: 1, leaseMs: 45000 });
export function validateLimits(value: AssistantLimits): AssistantLimits {
  const keys: (keyof AssistantLimits)[] = ['dailyTotal', 'dailyPerActor', 'concurrentTotal', 'concurrentPerActor', 'leaseMs'];
  if (!exact(value, keys) || keys.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 1) ||
    value.dailyTotal > 10000 || value.dailyPerActor > value.dailyTotal || value.concurrentTotal > 20 || value.concurrentPerActor > value.concurrentTotal || value.leaseMs !== 45000) throw new Error('Invalid assistant quota configuration');
  return { dailyTotal: value.dailyTotal, dailyPerActor: value.dailyPerActor, concurrentTotal: value.concurrentTotal, concurrentPerActor: value.concurrentPerActor, leaseMs: value.leaseMs };
}
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): AssistantLimits {
  const number = (key: string, fallback: number) => env[key] === undefined ? fallback : /^\d+$/.test(env[key]!) ? Number(env[key]) : NaN;
  return validateLimits({ ...DEFAULT_ASSISTANT_LIMITS, dailyTotal: number('AI_DAILY_CALL_LIMIT', 20), dailyPerActor: number('AI_ACTOR_DAILY_CALL_LIMIT', 5) });
}
export interface ReservationRow { id: string; ingredient_id: string; actor_id: string; day_key: string; request_digest: string; evidence_payload: string; created_at: number; expires_at: number }
export interface QuotaDayRow { day_key: string; limits_payload: string; created_at: number }
export const dayKey = (now: number): string => new Date(now).toISOString().slice(0, 10);
export function quotaPolicy(stored: QuotaDayRow | undefined, configured: AssistantLimits): { limits: AssistantLimits; policyMatches: boolean } {
  const limits = stored ? validateLimits(JSON.parse(stored.limits_payload)) : validateLimits(configured);
  return { limits, policyMatches: digestOf(limits) === digestOf(validateLimits(configured)) };
}
export function checkQuota(quota: AssistantQuota): void {
  if (!quota.policyMatches) fail(409, 'assistant_policy_conflict', '同一数据库今日额度已固定，服务实例的配置不一致；请统一配置，不会重置额度。');
  if (quota.activeTotal >= quota.limits.concurrentTotal || quota.activeByActor >= quota.limits.concurrentPerActor) fail(429, 'assistant_busy', '数据库中已有未结束的辅助任务，请稍后重试。');
  if (quota.usedTotal >= quota.limits.dailyTotal || quota.usedByActor >= quota.limits.dailyPerActor) fail(429, 'assistant_quota_exceeded', '今日辅助调用额度已用完；失败或取消的已授权调用也计入额度。');
}
export function leaseFrom(row: ReservationRow): AssistantReservation {
  if (!Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.expires_at) || row.expires_at - row.created_at !== 45000 || dayKey(row.created_at) !== row.day_key) fail(409, 'integrity_failure', '调用授权记录无效。');
  return { id: row.id, ingredientId: row.ingredient_id, actorId: row.actor_id, day: row.day_key, expiresAt: row.expires_at };
}
export function leaseRefs(row: ReservationRow): EvidenceLeaseRef[] {
  const refs: unknown = JSON.parse(row.evidence_payload);
  if (!Array.isArray(refs) || !refs.length || refs.length > 6 || refs.some((ref) => !exact(ref, ['id', 'digest', 'permissionRevision']) ||
    typeof ref.id !== 'string' || typeof ref.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(ref.digest) || !Number.isSafeInteger(ref.permissionRevision) || (ref.permissionRevision as number) < 0) || new Set(refs.map((ref) => ref.id)).size !== refs.length) fail(409, 'integrity_failure', '调用固定引用无效。');
  return refs as EvidenceLeaseRef[];
}
