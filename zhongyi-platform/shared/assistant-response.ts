import type { AssistantConfig, AssistantQuota, EvidenceExcerpt, ExcerptInput } from './contracts.js';
import { choice, date, digest, id, invalid, list, literal, number, object, text, unique } from './workflow-response.js';

const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : invalid();
export function parseAssistantConfig(value: unknown): AssistantConfig {
  const item = object(value, 'enabled provider model simulated scope');
  const result: AssistantConfig = { enabled: boolean(item.enabled), provider: choice(item.provider, ['disabled', 'openai', 'test-fixture']),
    model: text(item.model, 200, false), simulated: boolean(item.simulated),
    scope: choice(item.scope, ['editorial_extracts_only', 'editorial_extracts_and_summary', 'editorial_extracts_summary_and_review']) };
  if (result.provider === 'disabled' ? result.enabled || result.simulated || result.model !== '' :
    !result.enabled || !result.model.trim() || result.simulated !== (result.provider === 'test-fixture')) invalid();
  return result;
}
export function parseAssistantQuota(value: unknown): AssistantQuota {
  const item = object(value, 'day limits usedTotal usedByActor activeTotal activeByActor policyMatches');
  const limits = object(item.limits, 'dailyTotal dailyPerActor concurrentTotal concurrentPerActor leaseMs');
  const day = text(item.day, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) invalid(); date(`${day}T00:00:00.000Z`);
  const result: AssistantQuota = { day, limits: { dailyTotal: number(limits.dailyTotal), dailyPerActor: number(limits.dailyPerActor),
    concurrentTotal: number(limits.concurrentTotal), concurrentPerActor: number(limits.concurrentPerActor), leaseMs: number(limits.leaseMs) },
    usedTotal: number(item.usedTotal, 0), usedByActor: number(item.usedByActor, 0), activeTotal: number(item.activeTotal, 0),
    activeByActor: number(item.activeByActor, 0), policyMatches: boolean(item.policyMatches) };
  if (result.limits.dailyTotal > 10000 || result.limits.dailyPerActor > result.limits.dailyTotal || result.limits.concurrentTotal > 20 ||
    result.limits.concurrentPerActor > result.limits.concurrentTotal || result.limits.leaseMs !== 45000 ||
    result.usedByActor > result.usedTotal || result.activeByActor > result.activeTotal) invalid();
  // Active leases span UTC midnight; they need not be included in today's used count.
  return result;
}
export function parseEvidenceExcerpt(value: unknown, ingredientId: string, expectedId?: string): EvidenceExcerpt {
  const item = object(value, 'id ingredientId sourceId sourceRevision locator text allowExternal digest recordedBy recordedAt visibility verificationState externalPermission');
  const permission = object(item.externalPermission, 'allowed revision updatedBy updatedAt');
  const result: EvidenceExcerpt = { id: id(item.id), ingredientId: id(item.ingredientId), sourceId: id(item.sourceId), sourceRevision: number(item.sourceRevision),
    locator: text(item.locator, 400), text: text(item.text, 1800), allowExternal: boolean(item.allowExternal), digest: digest(item.digest),
    recordedBy: text(item.recordedBy, 80), recordedAt: date(item.recordedAt), visibility: literal(item.visibility, 'private'), verificationState: literal(item.verificationState, 'pending'),
    externalPermission: { allowed: boolean(permission.allowed), revision: number(permission.revision, 0), updatedBy: text(permission.updatedBy, 80), updatedAt: date(permission.updatedAt) } };
  if (result.ingredientId !== ingredientId || (expectedId !== undefined && result.id !== expectedId) ||
    result.locator !== result.locator.trim() || result.text !== result.text.trim() || [result.sourceId, result.locator, result.text].some(value => value.includes('\0')) ||
    (result.externalPermission.revision === 0 && (result.externalPermission.allowed !== result.allowExternal || result.externalPermission.updatedBy !== result.recordedBy || result.externalPermission.updatedAt !== result.recordedAt))) invalid();
  return result;
}
export function parseExcerptList(value: unknown, ingredientId: string): { items: EvidenceExcerpt[]; limit: 50 } {
  const item = object(value, 'items limit'), items = list(item.items, entry => parseEvidenceExcerpt(entry, ingredientId), 50);
  literalLimit(item.limit); unique(items.map(entry => entry.id));
  if (items.some((entry, index) => index > 0 && (items[index - 1].recordedAt < entry.recordedAt ||
    (items[index - 1].recordedAt === entry.recordedAt && items[index - 1].id <= entry.id)))) invalid();
  return { items, limit: 50 };
}
function literalLimit(value: unknown): void { if (value !== 50) invalid(); }
export function matchesExcerptInput(value: EvidenceExcerpt, input: ExcerptInput, actor: string): boolean {
  return value.sourceId === input.sourceId && value.sourceRevision === input.sourceRevision && value.locator === input.locator.trim() &&
    value.text === input.text.trim() && value.allowExternal === input.allowExternal && value.recordedBy === actor;
}
export function parseSavedExcerpt(value: unknown, ingredientId: string, input: ExcerptInput, actor: string): EvidenceExcerpt {
  const result = parseEvidenceExcerpt(value, ingredientId);
  if (!matchesExcerptInput(result, input, actor) || result.externalPermission.revision !== 0) invalid();
  return result;
}
export function sameExcerpt(value: EvidenceExcerpt, previous: EvidenceExcerpt): boolean {
  return value.id === previous.id && value.ingredientId === previous.ingredientId && value.sourceId === previous.sourceId && value.sourceRevision === previous.sourceRevision &&
    value.locator === previous.locator && value.text === previous.text && value.allowExternal === previous.allowExternal && value.digest === previous.digest &&
    value.recordedBy === previous.recordedBy && value.recordedAt === previous.recordedAt;
}
export function parseReloadedExcerpt(value: unknown, previous: EvidenceExcerpt): EvidenceExcerpt {
  const result = parseEvidenceExcerpt(value, previous.ingredientId, previous.id);
  if (!sameExcerpt(result, previous) || result.externalPermission.revision < previous.externalPermission.revision ||
    (result.externalPermission.revision === previous.externalPermission.revision && (result.externalPermission.allowed !== previous.externalPermission.allowed ||
      result.externalPermission.updatedBy !== previous.externalPermission.updatedBy || result.externalPermission.updatedAt !== previous.externalPermission.updatedAt))) invalid();
  return result;
}
export function parseSavedPermission(value: unknown, previous: EvidenceExcerpt, allowed: boolean, actor: string): EvidenceExcerpt {
  const result = parseReloadedExcerpt(value, previous);
  if (result.externalPermission.revision !== previous.externalPermission.revision + 1 || result.externalPermission.allowed !== allowed || result.externalPermission.updatedBy !== actor) invalid();
  return result;
}
