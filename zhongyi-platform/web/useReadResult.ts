import { useEffect, useState } from 'react';
import type { SessionInfo } from '../shared/contracts';
import { requestDecoded } from './api';
import { problem } from './workflow-shared';

// Read-only queries own their errors and retry counters; retrying a picker must
// not reload its selected editor or discard that editor's unsent input.
export function useReadResult<T>(path: string | null, session: SessionInfo, revision = 0, delay = 200) {
  return useDecodedReadResult(path, session, legacyDecode<T>, revision, delay);
}
// Existing callers migrate explicitly; this compatibility adapter is not validation.
function legacyDecode<T>(value: unknown): T { return value as T; }
// Keep decode stable with useCallback when it binds a selected object. Changing
// it aborts the previous request, so a late response cannot use a new selection.
export function useDecodedReadResult<T>(path: string | null, session: SessionInfo, decode: (value: unknown) => T, revision = 0, delay = 200) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [owner, setOwner] = useState({ path, session, decode, revision, delay, attempt });
  useEffect(() => {
    const controller = new AbortController();
    setOwner({ path, session, decode, revision, delay, attempt });
    setData(null); setError(''); setLoading(!!path);
    if (!path) return () => controller.abort();
    const timer = setTimeout(() => {
      requestDecoded(path, session, decode, { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setData(value); })
        .catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [path, session, decode, revision, delay, attempt]);
  // Effects run after rendering. Hide old results in the render that changes
  // selection/session/retry, not only after the next effect clears the state.
  const current = owner.path === path && owner.session === session && owner.decode === decode && owner.revision === revision && owner.delay === delay && owner.attempt === attempt;
  return { data: current ? data : null, loading: current ? loading : !!path, error: current ? error : '', retry: () => setAttempt((value) => value + 1) };
}
