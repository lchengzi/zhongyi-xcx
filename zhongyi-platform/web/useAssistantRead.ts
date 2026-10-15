import { useEffect, useMemo, useState } from 'react';
import type { AssistantConfig, AssistantQuota, EvidenceExcerpt, SessionInfo } from '../shared/contracts';
import { parseAssistantConfig, parseAssistantQuota, parseExcerptList } from '../shared/assistant-response';
import { requestDecoded } from './api';
import { problem } from './workflow-shared';

interface AssistantData { config: AssistantConfig; quota: AssistantQuota; items: EvidenceExcerpt[] }
interface AssistantRead { data: AssistantData | null; loading: boolean; error: string }
const pending = (): AssistantRead => ({ data: null, loading: true, error: '' });
export function useAssistantRead(session: SessionInfo, ingredientId: string, query: string, retry: number): AssistantRead {
  const owner = useMemo(() => ({ session, ingredientId, query, retry }), [session, ingredientId, query, retry]);
  const [read, setRead] = useState<{ owner: typeof owner; value: AssistantRead } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      Promise.all([
        requestDecoded('/editorial/assistant/config', session, parseAssistantConfig, { signal: controller.signal }),
        requestDecoded(`/editorial/assistant/ingredients/${ingredientId}/excerpts?q=${encodeURIComponent(query.trim())}`, session,
          value => parseExcerptList(value, ingredientId), { signal: controller.signal }),
        requestDecoded('/editorial/assistant/quota', session, parseAssistantQuota, { signal: controller.signal })
      ]).then(([config, excerpts, quota]) => {
        if (!controller.signal.aborted) setRead({ owner, value: { data: { config, items: excerpts.items, quota }, loading: false, error: '' } });
      }).catch(reason => {
        if (!controller.signal.aborted) { setRead({ owner, value: { data: null, loading: false, error: problem(reason) } }); controller.abort(); }
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [owner, session, ingredientId, query]);
  // Never show a previous query/session batch, including a repeated A→B→A query.
  return read?.owner === owner ? read.value : pending();
}
