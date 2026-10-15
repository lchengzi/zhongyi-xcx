import type { AssistantResult, DraftContent, EvidenceExcerpt, SummaryField } from './contracts.js';
import { isAssistantResult } from './assistant-result.js';

export const summaryLabels = { identity: '身份', edible_part: '实际食用部位', processing: '加工形态' };
export interface SummaryProposal {
  resultId: string;
  ingredientId: string;
  lockVersion: number;
  basis: string;
  strategy: 'append' | 'replace';
  fields: SummaryField[];
  before: DraftContent;
  after: DraftContent;
  citations: EvidenceExcerpt[];
}
const copy = (input: DraftContent): DraftContent => ({ ...input, sourceRefs: input.sourceRefs.map((ref) => ({ ...ref })) });
const snapshot = (input: DraftContent): string => JSON.stringify([input.ediblePart, input.latinName, input.educationText, input.safetyText,
  input.sourceRefs.map((ref) => [ref.id, ref.revision, ref.locator])]);
export function matchesProposal(proposal: SummaryProposal, ingredientId: string, input: DraftContent, lockVersion: number): boolean {
  return proposal.ingredientId === ingredientId && proposal.lockVersion === lockVersion && proposal.basis === snapshot(input);
}
export function buildSummaryProposal(result: AssistantResult, input: DraftContent, lockVersion: number,
  selected: SummaryField[], strategy: 'append' | 'replace'): SummaryProposal {
  if (!isAssistantResult(result, result.ingredientId, 'summary') || result.mode !== 'summary' || !selected.length ||
    new Set(selected).size !== selected.length || selected.some((field) => !result.sections.some((section) => section.field === field)) ||
    !Number.isSafeInteger(lockVersion) || lockVersion < 0 || (strategy !== 'append' && strategy !== 'replace')) throw new Error('建议依据或选择无效，请重新核对辅助结果。');
  const sections = result.sections.filter((section) => selected.includes(section.field));
  const used = new Set(sections.flatMap((section) => section.evidenceIds));
  const citations = result.citations.filter((citation) => used.has(citation.id));
  const after = copy(input);
  const addition = sections.map((section) => `${summaryLabels[section.field]}：${section.text}`).join('\n');
  after.educationText = strategy === 'append' && input.educationText ? `${input.educationText}\n${addition}` : addition;
  if (!after.educationText.trim() || after.educationText.length > 1600) throw new Error('建议内容超过教育说明 1600 字上限，请缩短原文或减少选中的段落。');
  for (const citation of citations) {
    const existing = after.sourceRefs.find((ref) => ref.id === citation.sourceId);
    if (existing && existing.revision !== citation.sourceRevision) throw new Error('摘录与草稿引用版本不同，请先人工处理版本冲突。');
    if (existing) {
      existing.locator = Array.from(new Set([...existing.locator.split('；'), ...citation.locator.split('；')].filter(Boolean))).join('；');
      if (existing.locator.length > 400) throw new Error('合并后的原文定位超过 400 字，请先人工缩短。');
    } else after.sourceRefs.push({ id: citation.sourceId, revision: citation.sourceRevision, locator: citation.locator });
  }
  if (after.sourceRefs.length > 10) throw new Error('固定来源超过 10 个，请先人工整理。');
  if (snapshot(input) === snapshot(after)) throw new Error('建议与当前输入相同，没有需要采用的修改。');
  return { resultId: result.id, ingredientId: result.ingredientId, lockVersion, basis: snapshot(input), strategy,
    fields: sections.map((section) => section.field), before: copy(input), after, citations };
}
