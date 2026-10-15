import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantResult, DraftContent, EvidenceExcerpt } from '../shared/contracts.js';
import { buildSummaryProposal, matchesProposal } from '../shared/assistant-proposal.js';
import { isAssistantResult } from '../shared/assistant-result.js';

const excerpt = (id: string): EvidenceExcerpt => ({ id, ingredientId: 'test-food', sourceId: `source-${id}`, sourceRevision: 1,
  locator: '第 2 页', text: '测试资料记载部位为根，形态为切片。', allowExternal: true, digest: 'fixed-digest', recordedBy: 'fixture-editor', recordedAt: '2026-10-11',
  visibility: 'private', verificationState: 'pending', externalPermission: { allowed: true, revision: 0, updatedBy: 'fixture-editor', updatedAt: '2026-10-11' } });
const result = (): AssistantResult => ({ id: 'result-fixture', ingredientId: 'test-food', mode: 'summary', statements: [
  { evidenceId: 'a', quote: '部位为根' }, { evidenceId: 'b', quote: '形态为切片' }],
  sections: [{ field: 'edible_part', text: '资料记有根部。', evidenceIds: ['a'] }, { field: 'processing', text: '资料记有切片形态。', evidenceIds: ['b'] }],
  citations: [excerpt('a'), excerpt('b')], gaps: ['identity', 'safety_boundary'], provider: 'test-fixture', model: 'fixture-only', simulated: true,
  metrics: { durationMs: 1, inputTokens: null, outputTokens: null, estimatedCostUsd: null }, publicationEnabled: false, professionalReviewState: 'pending' });
const draft = (): DraftContent => ({ ediblePart: '人工部位', latinName: 'manual', educationText: '原有说明', safetyText: '保留安全边界', sourceRefs: [{ id: 'source-a', revision: 1, locator: '第 1 页' }] });

test('local proposal selects grounded sections, appends and preserves all noneducation fields without mutating inputs', () => {
  const input = draft(); const output = result(); const original = structuredClone({ input, output });
  const proposal = buildSummaryProposal(output, input, 4, ['edible_part'], 'append');
  assert.equal(proposal.after.educationText, '原有说明\n实际食用部位：资料记有根部。');
  assert.deepEqual(proposal.after.sourceRefs, [{ id: 'source-a', revision: 1, locator: '第 1 页；第 2 页' }]);
  assert.deepEqual(proposal.citations.map((item) => item.id), ['a']);
  assert.equal(proposal.after.safetyText, input.safetyText); assert.equal(proposal.after.latinName, input.latinName); assert.equal(proposal.after.ediblePart, input.ediblePart);
  assert.deepEqual({ input, output }, original);
});
test('replace requires explicit strategy; adds only selected fixed references and deduplicates locator tokens', () => {
  const input = draft(); input.sourceRefs[0].locator = '第 1 页；第 2 页';
  const proposal = buildSummaryProposal(result(), input, 0, ['processing', 'edible_part'], 'replace');
  assert.equal(proposal.after.educationText, '实际食用部位：资料记有根部。\n加工形态：资料记有切片形态。');
  assert.equal(proposal.after.sourceRefs[0].locator, input.sourceRefs[0].locator); assert.equal(proposal.after.sourceRefs[1].id, 'source-b');
  assert.equal(proposal.before.educationText, '原有说明');
});
test('proposal is bound to ingredient, lock and every editor field including fixed locator', () => {
  const input = draft(); const proposal = buildSummaryProposal(result(), input, 4, ['edible_part'], 'append');
  assert.equal(matchesProposal(proposal, 'test-food', structuredClone(input), 4), true);
  assert.equal(matchesProposal(proposal, 'other-food', input, 4), false); assert.equal(matchesProposal(proposal, 'test-food', input, 5), false);
  for (const key of ['ediblePart', 'latinName', 'educationText', 'safetyText'] as const) {
    const changed = draft(); changed[key] += '修改'; assert.equal(matchesProposal(proposal, 'test-food', changed, 4), false);
  }
  const changed = draft(); changed.sourceRefs[0].locator += '修改'; assert.equal(matchesProposal(proposal, 'test-food', changed, 4), false);
});
test('proposal refuses empty/duplicate/unavailable selection, wrong mode and invalid lock', () => {
  for (const selection of [[], ['identity'], ['edible_part', 'edible_part']] as const) assert.throws(() => buildSummaryProposal(result(), draft(), 4, [...selection], 'append'));
  const output = result(); output.mode = 'extract'; assert.throws(() => buildSummaryProposal(output, draft(), 4, ['edible_part'], 'append'));
  assert.throws(() => buildSummaryProposal(result(), draft(), -1, ['edible_part'], 'append'));
});
test('proposal enforces text, locator, source count and revision conflict limits', () => {
  const input = draft(); input.educationText = '字'.repeat(1600); assert.throws(() => buildSummaryProposal(result(), input, 4, ['edible_part'], 'append'), /1600/);
  input.educationText = ''; input.sourceRefs[0].revision = 2; assert.throws(() => buildSummaryProposal(result(), input, 4, ['edible_part'], 'replace'), /版本冲突/);
  input.sourceRefs[0].revision = 1; input.sourceRefs[0].locator = '字'.repeat(400); assert.throws(() => buildSummaryProposal(result(), input, 4, ['edible_part'], 'replace'), /400/);
  input.sourceRefs = Array.from({ length: 10 }, (_, index) => ({ id: `other-${index}`, revision: 1, locator: '页码' }));
  assert.throws(() => buildSummaryProposal(result(), input, 4, ['edible_part'], 'replace'), /10/);
});
test('runtime result boundary rejects malformed shape, foreign evidence, mismatched quotes and publication claims', () => {
  assert.equal(isAssistantResult(result(), 'test-food', 'summary'), true);
  for (const value of [null, {}, { ...result(), mode: 'review' }, { ...result(), ingredientId: 'other' }, { ...result(), publicationEnabled: true },
    { ...result(), metrics: { durationMs: 1, inputTokens: null, outputTokens: null, estimatedCostUsd: -1 } },
    { ...result(), statements: [{ evidenceId: 'a', quote: '原文不存在' }] }, { ...result(), citations: [{ ...excerpt('a'), ingredientId: 'other' }, excerpt('b')] },
    { ...result(), sections: [{ field: 'safety', text: '不允许安全结论', evidenceIds: ['a', 'b'] }] },
    { ...result(), sections: [{ field: 'edible_part', text: '无依据', evidenceIds: ['unknown'] }] }]) assert.equal(isAssistantResult(value, 'test-food', 'summary'), false);
});
test('transport validation accepts extract and referenced gap; rejects missing review fields and same-source conflict', () => {
  const base = result(); assert.equal(isAssistantResult({ ...base, mode: 'extract', sections: [] }, 'test-food', 'extract'), true);
  const findings = [{ field: 'identity', kind: 'gap', text: '资料缺少明确身份限定', evidenceIds: ['a'] },
    { field: 'edible_part', kind: 'candidate', text: '原文待核对', evidenceIds: ['b'] }, { field: 'processing', kind: 'gap', text: '资料不足', evidenceIds: [] }];
  assert.equal(isAssistantResult({ ...base, mode: 'review', sections: [], findings }, 'test-food', 'review'), true);
  assert.equal(isAssistantResult({ ...base, mode: 'review', sections: [], findings: findings.slice(1) }, 'test-food', 'review'), false);
  findings[1] = { ...findings[1], kind: 'conflict', evidenceIds: ['a', 'b'] };
  assert.equal(isAssistantResult({ ...base, mode: 'review', sections: [], findings, citations: [excerpt('a'), { ...excerpt('b'), sourceId: 'source-a' }] }, 'test-food', 'review'), false);
});
