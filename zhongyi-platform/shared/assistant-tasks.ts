import type { AssistantConfig, AssistantMode } from './contracts.js';

export function isAssistantMode(value: unknown): value is AssistantMode {
  return value === 'extract' || value === 'summary' || value === 'review';
}
export function supportsAssistantMode(config: AssistantConfig, mode: AssistantMode): boolean {
  return mode === 'extract' || config.scope === 'editorial_extracts_summary_and_review' ||
    (mode === 'summary' && config.scope === 'editorial_extracts_and_summary');
}
