import { randomUUID } from 'node:crypto';
import type { Account, AssistantEvent, AssistantLimits, AssistantMode, AssistantResult, EvidenceExcerpt, ReviewFinding, SummaryField, SummarySection } from '../shared/contracts.js';
import { isAssistantMode, supportsAssistantMode } from '../shared/assistant-tasks.js';
import type { RepositoryBundle } from './stores.js';
import type { AssistantProvider, ModelInput, ModelReply } from './assistant-provider.js';
import { ProviderError } from './assistant-provider.js';
import { containsPrivateData, digestOf } from './assistant-values.js';
import { AccountError } from './auth.js';
import { exact, fail } from './workflow.js';
import { DEFAULT_ASSISTANT_LIMITS, validateLimits } from './assistant-limits.js';

const gaps = ['identity', 'edible_part', 'processing', 'safety_boundary'];
const normalized = (text: string) => text.normalize('NFKC').replace(/[\u200b-\u200f\ufeff\u202a-\u202e\u2066-\u2069]/g, '');
export const unsafeExcerpt = (text: string) => /忽略.{0,12}(指令|规则)|系统提示|system\s*prompt|ignore.{0,16}instructions|泄露|api.?key|诊断|处方|辨证|疗程|治疗|治愈|降血糖|降血压|停药|服药|替代药|\d\s*(克|毫克|毫升|mg\b|g\b|ml\b)/i.test(normalized(text));
export function validateModelResult(value: unknown, excerpts: EvidenceExcerpt[]): Pick<AssistantResult, 'statements' | 'gaps'> {
  if (!exact(value, ['statements', 'gaps']) || !Array.isArray(value.statements) || value.statements.length > 6 ||
    !Array.isArray(value.gaps) || value.gaps.length > 4 || value.gaps.some((gap) => typeof gap !== 'string' || !gaps.includes(gap)) ||
    new Set(value.gaps).size !== value.gaps.length) fail(502, 'unsupported_output', '模型结果格式或缺口标记无效，未采用输出。');
  const seen = new Set<string>();
  const statements = value.statements.map((statement) => {
    if (!exact(statement, ['evidenceId', 'quote']) || typeof statement.evidenceId !== 'string' || typeof statement.quote !== 'string' ||
      !statement.quote.trim() || statement.quote.length > 160 || seen.has(statement.evidenceId)) fail(502, 'unsupported_output', '模型引用格式无效，未采用输出。');
    seen.add(statement.evidenceId);
    const source = excerpts.find((item) => item.id === statement.evidenceId);
    if (!source || !source.text.includes(statement.quote) || unsafeExcerpt(statement.quote)) fail(502, 'unsupported_output', '模型引用无法逐字对应允许的摘录，或超出非医疗范围；未采用输出。');
    return { evidenceId: statement.evidenceId, quote: statement.quote };
  });
  return { statements, gaps: value.gaps as AssistantResult['gaps'] };
}
export function validateSummaryResult(value: unknown, excerpts: EvidenceExcerpt[]): Pick<AssistantResult, 'statements' | 'gaps' | 'sections'> {
  if (!exact(value, ['statements', 'gaps', 'sections']) || !Array.isArray(value.sections) || value.sections.length > 3) fail(502, 'unsupported_output', '摘要格式无效，未采用输出。');
  const quoted = validateModelResult({ statements: value.statements, gaps: value.gaps }, excerpts);
  const ids = new Set(quoted.statements.map((statement) => statement.evidenceId));
  const fields: SummaryField[] = ['identity', 'edible_part', 'processing']; const used = new Set<string>(); const seen = new Set<SummaryField>();
  const sections = value.sections.map((section): SummarySection => {
    if (!exact(section, ['field', 'text', 'evidenceIds']) || !fields.includes(section.field as SummaryField) || seen.has(section.field as SummaryField) ||
      typeof section.text !== 'string' || !section.text.trim() || section.text.length > 240 || /[\u0000-\u001f\u007f]|https?:\/\//i.test(section.text) ||
      unsafeExcerpt(section.text) || containsPrivateData(section.text) || /已审[核校]|专业批准|可[以]?发布|适合[你您]|建议[你您]|放心食用/.test(normalized(section.text)) ||
      !Array.isArray(section.evidenceIds) || !section.evidenceIds.length || section.evidenceIds.length > 6 ||
      section.evidenceIds.some((id) => typeof id !== 'string' || !ids.has(id)) || new Set(section.evidenceIds).size !== section.evidenceIds.length) fail(502, 'unsupported_output', '摘要段落缺少逐字依据、重复或超出资料整理范围；未采用输出。');
    const field = section.field as SummaryField; seen.add(field); section.evidenceIds.forEach((id) => used.add(id as string));
    return { field, text: section.text.trim(), evidenceIds: section.evidenceIds as string[] };
  });
  if (used.size !== ids.size) fail(502, 'unsupported_output', '摘要包含未关联段落的引用，未采用输出。');
  // Structural grounding is not semantic entailment. Human review remains required.
  const requiredGaps = fields.filter((field) => !seen.has(field));
  return { statements: quoted.statements, sections, gaps: [...new Set([...quoted.gaps, ...requiredGaps, 'safety_boundary' as const])] };
}
export function validateReviewResult(value: unknown, excerpts: EvidenceExcerpt[]): Pick<AssistantResult, 'statements' | 'gaps'> & { sections: []; findings: ReviewFinding[] } {
  if (!exact(value, ['statements', 'findings']) || !Array.isArray(value.findings) || value.findings.length !== 3) fail(502, 'unsupported_output', '资料检查须逐项覆盖身份、部位和加工形态；未采用输出。');
  const quoted = validateModelResult({ statements: value.statements, gaps: [] }, excerpts);
  const ids = new Set(quoted.statements.map((item) => item.evidenceId));
  const seen = new Set<SummaryField>(); const used = new Set<string>();
  const isField = (field: unknown): field is SummaryField => field === 'identity' || field === 'edible_part' || field === 'processing';
  const findings = value.findings.map((finding): ReviewFinding => {
    if (!exact(finding, ['field', 'kind', 'text', 'evidenceIds']) || !isField(finding.field) || seen.has(finding.field) ||
      (finding.kind !== 'candidate' && finding.kind !== 'gap' && finding.kind !== 'conflict') ||
      typeof finding.text !== 'string' || !finding.text.trim() || finding.text.length > 240 ||
      /[\u0000-\u001f\u007f]|https?:\/\//i.test(finding.text) || unsafeExcerpt(finding.text) || containsPrivateData(finding.text) ||
      /已审[核校]|专业批准|可[以]?发布|适合[你您]|建议[你您]|放心食用/.test(normalized(finding.text)) ||
      !Array.isArray(finding.evidenceIds) || finding.evidenceIds.length > 6 ||
      finding.evidenceIds.some((id: unknown) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(finding.evidenceIds).size !== finding.evidenceIds.length) fail(502, 'unsupported_output', '检查项目或原文依据无效，未采用输出。');
    const evidenceIds: string[] = [];
    for (const id of finding.evidenceIds) {
      if (typeof id !== 'string') fail(502, 'unsupported_output', '检查依据无效。');
      evidenceIds.push(id); used.add(id);
    }
    if (finding.kind === 'candidate' && !evidenceIds.length) fail(502, 'unsupported_output', '资料候选必须关联逐字依据。');
    // Distinct excerpt IDs alone do not establish distinct sources. Nor does this
    // structural check prove that their meanings really conflict.
    if (finding.kind === 'conflict' && new Set(excerpts.filter((item) => evidenceIds.includes(item.id)).map((item) => item.sourceId)).size < 2) fail(502, 'unsupported_output', '来源分歧必须关联至少两个不同来源的逐字依据。');
    seen.add(finding.field);
    return { field: finding.field, kind: finding.kind, text: finding.text.trim(), evidenceIds };
  });
  if (used.size !== ids.size) fail(502, 'unsupported_output', '检查含未关联项目的引用，未采用输出。');
  return { statements: quoted.statements, sections: [], findings,
    gaps: [...findings.filter((item) => item.kind !== 'candidate').map((item) => item.field), 'safety_boundary'] };
}
export class AssistantService {
  private readonly active = new Set<string>();
  private readonly limits: AssistantLimits;
  constructor(private readonly stores: RepositoryBundle, readonly provider: AssistantProvider, limits: AssistantLimits = DEFAULT_ASSISTANT_LIMITS) { this.limits = validateLimits(limits); }
  async generate(ingredientId: string, evidenceIds: string[], consent: boolean, actor: Account, token: string, signal: AbortSignal, mode: AssistantMode = 'extract'): Promise<AssistantResult> {
    if (!isAssistantMode(mode)) fail(400, 'invalid_assistant_request', '辅助任务类型无效。');
    await this.stores.assistant.authorize(actor, token);
    const ingredient = await this.stores.catalog.ingredient(ingredientId);
    if (!ingredient) fail(404, 'not_found', '食材不存在。');
    if (this.active.has(actor.id) || this.active.size >= 2) fail(429, 'assistant_busy', '资料辅助任务繁忙，请等待当前任务完成。');
    this.active.add(actor.id);
    const start = Date.now(); const id = randomUUID(); let reply: ModelReply | undefined;
    let requestDigest = digestOf({ ingredientId, evidenceIds, consent, mode });
    const event: AssistantEvent = { id, ingredientId, actorId: actor.id, actor: actor.username, provider: this.provider.config.provider, model: this.provider.config.model,
      status: 'failed', requestDigest, resultDigest: null, errorCode: null, metrics: { durationMs: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null }, createdAt: new Date().toISOString() };
    try {
      if (!evidenceIds.length) fail(422, 'insufficient_evidence', '没有允许引用的原文摘录，不能补写结论。');
      const excerpts: EvidenceExcerpt[] = [];
      for (const evidenceId of evidenceIds) {
        const item = await this.stores.assistant.excerpt(evidenceId);
        if (!item || item.ingredientId !== ingredientId) fail(400, 'invalid_evidence', '摘录不存在或不属于此食材。');
        if (unsafeExcerpt(item.text)) fail(422, 'scope_refused', '摘录包含指令或超出身份/部位整理范围；请人工处理。');
        excerpts.push(item);
      }
      if (!this.provider.config.enabled) fail(503, 'assistant_not_configured', '真实模型服务未配置；原文检索可用，不会生成模拟答案。');
      if (!supportsAssistantMode(this.provider.config, mode)) fail(503, 'assistant_mode_unavailable', '当前辅助器未提供此任务，未发送资料。');
      if (!consent || excerpts.some((item) => !item.externalPermission.allowed)) fail(403, 'external_transfer_not_allowed', '需逐条允许外部使用并确认本次发送；未发送资料。');
      const input: ModelInput = { ingredient: ingredient.name, ...(mode !== 'extract' ? { mode } : {}), excerpts: [] };
      for (const item of excerpts) {
        const source = await this.stores.workflow.source(item.sourceId, item.sourceRevision);
        if (!source) fail(409, 'integrity_failure', '摘录固定来源缺失。');
        if ([source.title, item.locator, item.text].some((text) => unsafeExcerpt(text) || containsPrivateData(text))) fail(422, 'scope_refused', '发送资料含越界指令或个人信息；请人工处理，未发送资料。');
        input.excerpts.push({ evidenceId: item.id, title: source.title, locator: item.locator, text: item.text,
          ...(mode === 'review' ? { source: { id: item.sourceId, revision: item.sourceRevision } } : {}) });
      }
      const refs = excerpts.map((item) => ({ id: item.id, digest: item.digest, permissionRevision: item.externalPermission.revision }));
      requestDigest = digestOf({ input, refs, provider: event.provider, model: event.model });
      event.requestDigest = requestDigest;
      await this.stores.assistant.authorize(actor, token);
      if (signal.aborted) throw new ProviderError('cancelled_or_timeout');
      await this.stores.assistant.reserve(id, ingredientId, refs, requestDigest, this.limits, actor, token);
      if (signal.aborted) throw new ProviderError('cancelled_or_timeout');
      reply = await this.provider.generate(input, signal);
      if (signal.aborted) throw new ProviderError('cancelled_or_timeout');
      if ([reply.inputTokens, reply.outputTokens].some((count) => count !== null && (!Number.isSafeInteger(count) || count < 0)) ||
        (reply.estimatedCostUsd !== null && (!Number.isFinite(reply.estimatedCostUsd) || reply.estimatedCostUsd < 0))) {
        reply = undefined; throw new ProviderError('invalid_usage');
      }
      const output = mode === 'review' ? { mode, ...validateReviewResult(reply.value, excerpts) } :
        { mode, ...(mode === 'summary' ? validateSummaryResult(reply.value, excerpts) : { ...validateModelResult(reply.value, excerpts), sections: [] }) };
      await this.stores.assistant.authorize(actor, token);
      const used = new Set(output.statements.map((statement) => statement.evidenceId));
      const result: AssistantResult = { id, ingredientId, ...output, citations: excerpts.filter((item) => used.has(item.id)), metrics: { durationMs: Date.now() - start,
        inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, estimatedCostUsd: reply.estimatedCostUsd }, provider: event.provider, model: event.model,
        simulated: this.provider.config.simulated, publicationEnabled: false, professionalReviewState: 'pending' };
      event.status = output.statements.length ? 'completed' : 'refused'; event.errorCode = output.statements.length ? null : 'insufficient_evidence';
      event.resultDigest = digestOf(result); event.metrics = result.metrics;
      await this.stores.assistant.complete(event, actor, token);
      return result;
    } catch (error) {
      event.resultDigest = null;
      event.status = error instanceof AccountError && error.status < 500 || error instanceof ProviderError && error.code === 'model_refused' ? 'refused' : 'failed';
      event.errorCode = error instanceof AccountError ? error.code : error instanceof ProviderError ? error.code : 'assistant_failed';
      const usage = reply || (error instanceof ProviderError ? error.usage : undefined);
      event.metrics = { durationMs: Date.now() - start, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, estimatedCostUsd: usage?.estimatedCostUsd ?? null };
      await this.stores.assistant.record(event);
      if (error instanceof AccountError) throw error;
      fail(502, event.errorCode, '模型调用未完成或结果不符合要求；未改写草稿，请人工核对或稍后重试。');
    } finally { this.active.delete(actor.id); }
  }
}
