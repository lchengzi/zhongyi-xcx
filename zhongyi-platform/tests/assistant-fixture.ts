// Deterministic transport-free test double. Never imported by production code.
import type { AssistantProvider, ModelInput } from '../server/assistant-provider.js';

export const fixtureOutput = (input: ModelInput) => {
  const statements = input.excerpts.map((item) => ({ evidenceId: item.evidenceId, quote: item.text.slice(0, 160) }));
  if (input.mode === 'review') return { statements, findings: [
    { field: 'identity', kind: 'gap', text: '测试模拟：选中资料未明确身份信息。', evidenceIds: [] },
    { field: 'edible_part', kind: statements.length > 1 ? 'conflict' : 'candidate', text: statements.length > 1 ? '测试模拟：不同来源所列部位有分歧，需人工核对。' : '测试模拟：待核对原文所列部位。', evidenceIds: statements.map((item) => item.evidenceId) },
    { field: 'processing', kind: 'gap', text: '测试模拟：加工形态仍需逐项核对。', evidenceIds: [] }
  ] };
  return { statements, gaps: ['safety_boundary'], ...(input.mode === 'summary' ? { sections: statements.length ? [{ field: 'edible_part',
    text: `资料概括（测试模拟）：${statements.map((item) => item.quote).join('；').slice(0, 200)}`, evidenceIds: statements.map((item) => item.evidenceId) }] : [] } : {}) };
};
export function fixtureAssistant(): AssistantProvider {
  return {
    config: { enabled: true, provider: 'test-fixture', model: 'literal-excerpt-test-only', simulated: true, scope: 'editorial_extracts_summary_and_review' },
    generate: async (input) => ({ value: fixtureOutput(input), inputTokens: null, outputTokens: null, estimatedCostUsd: null })
  };
}
