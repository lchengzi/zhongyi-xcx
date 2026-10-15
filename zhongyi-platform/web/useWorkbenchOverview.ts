import { useEffect, useMemo, useState } from 'react';
import type { AuditEvent, IngredientPage, PlatformSummary } from '../shared/contracts';
import { parseAuditEventList, parseCatalogPage, parsePlatformSummary } from '../shared/workbench-response';
import { requestDecoded, type Credential } from './api';
import { problem } from './workflow-shared';

interface Owner { token: Exclude<Credential, null>; search: string; page: number; revision: number }
interface Overview { result: IngredientPage | null; summary: PlatformSummary | null; events: AuditEvent[]; loading: boolean; error: string }
const pending = (): Overview => ({ result: null, summary: null, events: [], loading: true, error: '' });

export function useWorkbenchOverview(token: Exclude<Credential, null>, search: string, page: number, revision: number): Overview {
  const owner = useMemo<Owner>(() => ({ token, search, page, revision }), [token, search, page, revision]);
  const [read, setRead] = useState<{ owner: Owner; value: Overview } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestDecoded(`/ingredients?q=${encodeURIComponent(search)}&page=${page}`, token,
        value => parseCatalogPage(value, { page, pageSize: 12, query: search }), { signal: controller.signal }),
      requestDecoded('/summary', token, parsePlatformSummary, { signal: controller.signal }),
      requestDecoded('/events', token, parseAuditEventList, { signal: controller.signal })
    ]).then(([result, summary, audit]) => {
      if (!controller.signal.aborted) setRead({ owner, value: { result, summary, events: audit.items, loading: false, error: '' } });
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setRead({ owner, value: { ...pending(), loading: false, error: problem(reason) } });
        controller.abort(); // Stop sibling reads after the batch has failed; never retry implicitly.
      }
    });
    return () => controller.abort();
  }, [owner]);
  // Hide the old batch during the render that changes ownership, before effects.
  return read?.owner === owner ? read.value : pending();
}
