import type { AssistantMode, AssistantResult, EvidenceExcerpt, SummaryField } from './contracts.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === 'number' && value >= 1;
const field = (value: unknown): value is SummaryField => value === 'identity' || value === 'edible_part' || value === 'processing';
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 6 && value.every((id) => text(id, 100)) && new Set(value).size === value.length;
const metric = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

export function isEvidenceExcerpt(value: unknown, ingredientId: string): value is EvidenceExcerpt {
  return object(value) && value.ingredientId === ingredientId && text(value.id, 100) && text(value.sourceId, 100) && integer(value.sourceRevision) &&
    text(value.locator, 400) && text(value.text, 1800) && text(value.digest, 100) && typeof value.allowExternal === 'boolean' &&
    text(value.recordedBy, 200) && text(value.recordedAt, 100) && value.visibility === 'private' && value.verificationState === 'pending' &&
    object(value.externalPermission) && typeof value.externalPermission.allowed === 'boolean' && typeof value.externalPermission.revision === 'number' && Number.isSafeInteger(value.externalPermission.revision) && value.externalPermission.revision >= 0 &&
    text(value.externalPermission.updatedBy, 200) && text(value.externalPermission.updatedAt, 100);
}

// This is a transport boundary, not a claim that the quoted text entails the summary.
export function isAssistantResult(value: unknown, ingredientId: string, mode: AssistantMode): value is AssistantResult {
  if (!object(value) || value.ingredientId !== ingredientId || value.mode !== mode || !text(value.id, 100) || !text(value.model, 200) ||
    (value.provider !== 'openai' && value.provider !== 'test-fixture' && value.provider !== 'disabled') || typeof value.simulated !== 'boolean' ||
    value.publicationEnabled !== false || value.professionalReviewState !== 'pending' || !object(value.metrics) ||
    typeof value.metrics.durationMs !== 'number' || !Number.isFinite(value.metrics.durationMs) || value.metrics.durationMs < 0 ||
    !metric(value.metrics.inputTokens) || !metric(value.metrics.outputTokens) || !metric(value.metrics.estimatedCostUsd) ||
    !Array.isArray(value.citations) || value.citations.length > 6 || !value.citations.every((item) => isEvidenceExcerpt(item, ingredientId)) ||
    new Set(value.citations.map((item) => item.id)).size !== value.citations.length ||
    !Array.isArray(value.statements) || value.statements.length > 6 || !Array.isArray(value.gaps) || value.gaps.length > 4 ||
    value.gaps.some((gap) => !field(gap) && gap !== 'safety_boundary') || new Set(value.gaps).size !== value.gaps.length || !Array.isArray(value.sections)) return false;
  const citations = value.citations;
  const statements = value.statements;
  if (!statements.every((item) => {
    if (!object(item) || !text(item.evidenceId, 100) || !text(item.quote, 160)) return false;
    const quote = item.quote;
    return citations.some((source) => source.id === item.evidenceId && source.text.includes(quote));
  }) ||
    new Set(statements.map((item) => item.evidenceId)).size !== statements.length || citations.length !== statements.length) return false;
  const referenced = new Set(statements.map((item) => item.evidenceId));
  if (mode === 'extract') return value.sections.length === 0;
  const entries: unknown = mode === 'summary' ? value.sections : value.findings;
  if (!Array.isArray(entries) || entries.length > 3 || (mode === 'review' && (entries.length !== 3 || value.sections.length !== 0))) return false;
  if (!entries.every((item) => object(item) && field(item.field) && text(item.text, 240) && ids(item.evidenceIds) &&
    item.evidenceIds.every((id) => referenced.has(id)) && (mode === 'summary' ? item.evidenceIds.length > 0 :
      (item.kind === 'gap' || (item.kind === 'candidate' || item.kind === 'conflict') && item.evidenceIds.length > 0))) ||
    new Set(entries.map((item) => item.field)).size !== entries.length) return false;
  if (mode === 'review' && entries.some((item) => item.kind === 'conflict' &&
    new Set(citations.filter((source) => item.evidenceIds.includes(source.id)).map((source) => source.sourceId)).size < 2)) return false;
  return new Set(entries.flatMap((item) => item.evidenceIds)).size === referenced.size;
}
