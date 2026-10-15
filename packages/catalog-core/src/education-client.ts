import { EDUCATION_PATH, parseEducation, parseEducationBinding, publicContentOrigin, type EducationBinding, type EducationDocument } from './education.js';
import type { ConnectivityState } from './connectivity.js';

export interface EducationRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly header: Readonly<{ Accept: 'application/json' }>;
  readonly timeoutMs: number;
}
export interface EducationTransport {
  request(input: EducationRequest): {
    readonly promise: Promise<{ readonly status: number; readonly body: unknown }>;
    abort(): void;
  };
}
export interface EducationScheduler {
  /** Must schedule asynchronously; returns a cancellation function. */
  after(milliseconds: number, callback: () => void): () => void;
}
export type EducationStatus = 'disabled' | 'idle' | 'loading' | 'ready' | 'stale' | 'withdrawn' | 'unavailable' | 'incompatible';
export type EducationError = 'network' | 'timeout' | 'http' | 'invalid_payload' | 'identity_mismatch' | 'source_expired' | 'cache_expired' | 'invalid_clock' | null;
export interface EducationState {
  readonly revision: number;
  readonly status: EducationStatus;
  readonly document: EducationDocument | null;
  readonly verifiedAt: number | null;
  readonly expiresAt: number | null;
  readonly error: EducationError;
}
export interface EducationClient {
  /** Stable immutable snapshot, suitable for an external-store adapter. */
  getSnapshot(): EducationState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<EducationState>;
  /** A known disconnect cancels before aborting and never extends cached data. */
  setConnectivity(status: ConnectivityState['status']): void;
  /** Invalidates the in-flight request before aborting. Old confirmations fail. */
  clear(expectedRevision: number): boolean;
}
interface Operation {
  readonly promise: Promise<EducationState>;
  readonly resolve: (state: EducationState) => void;
  cancelTimeout: () => void;
  abort: () => void;
}
const nothing = () => {};
function safely(action: () => void) { try { action(); } catch { /* Cancellation and observers cannot undo invalidation. */ } }

/** Anonymous, memory-only education updates. Documents never replace catalog
 * identity or deterministic safety rules. HTTPS origin and release are pinned
 * by the application, never learned from a network response. */
export function createEducationClient(options: {
  readonly origin: string | null;
  readonly binding: EducationBinding;
  readonly transport: EducationTransport;
  readonly scheduler: EducationScheduler;
  readonly now: () => number;
  readonly cacheTtlMs?: number;
}): EducationClient {
  const origin = options.origin === null ? null : publicContentOrigin(options.origin);
  if (options.origin !== null && !origin) throw new Error('Invalid public content origin');
  const binding = parseEducationBinding(options.binding);
  const ttl = options.cacheTtlMs ?? 60_000;
  if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 300_000) throw new Error('Invalid content cache duration');
  const listeners = new Set<() => void>();
  let state: EducationState = Object.freeze({ revision: 0, status: origin ? 'idle' : 'disabled', document: null, verifiedAt: null, expiresAt: null, error: null });
  let pending: Operation | null = null;
  let knownOffline = false;
  let cancelExpiry = nothing;
  function commit(next: Omit<EducationState, 'revision'>) {
    safely(cancelExpiry); cancelExpiry = nothing;
    state = Object.freeze({ ...next, revision: state.revision + 1 });
    const current = state;
    if (current.document && current.expiresAt !== null) {
      cancelExpiry = options.scheduler.after(Math.max(0, current.expiresAt - options.now()), () => {
        if (state !== current) return;
        commit({ status: pending ? 'loading' : 'unavailable', document: null, verifiedAt: null, expiresAt: null, error: 'cache_expired' });
      });
    }
    for (const listener of [...listeners]) safely(listener);
  }
  function finish(operation: Operation, next: Omit<EducationState, 'revision'>) {
    if (pending !== operation) return;
    pending = null; safely(operation.cancelTimeout);
    commit(next); operation.resolve(state);
  }
  function empty(status: EducationStatus, error: EducationError): Omit<EducationState, 'revision'> {
    return { status, error, document: null, verifiedAt: null, expiresAt: null };
  }
  function failed(operation: Operation, error: 'network' | 'timeout') {
    if (pending !== operation) return;
    const time = options.now();
    const cached = state.document && state.verifiedAt !== null && state.expiresAt !== null && Number.isFinite(time) && time >= state.verifiedAt && time < state.expiresAt;
    finish(operation, cached ? { ...state, status: 'stale', error } : empty('unavailable', error));
  }
  function disconnect() {
    if (!origin) return;
    const operation = pending; pending = null;
    if (operation) safely(operation.cancelTimeout);
    const time = options.now();
    const cached = state.document && state.verifiedAt !== null && state.expiresAt !== null
      && Number.isFinite(time) && time >= state.verifiedAt && time < state.expiresAt;
    const next: Omit<EducationState, 'revision'> = cached ? { ...state, status: 'stale', error: 'network' } : empty('unavailable', 'network');
    if (operation || state.status !== next.status || state.document !== next.document || state.error !== next.error) commit(next);
    const result = state;
    if (operation) { safely(operation.abort); operation.resolve(result); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh() {
      if (!origin) return Promise.resolve(state);
      if (knownOffline) { disconnect(); return Promise.resolve(state); }
      if (pending) return pending.promise;
      let resolve: (value: EducationState) => void = nothing;
      const promise = new Promise<EducationState>(done => { resolve = done; });
      const operation: Operation = { promise, resolve, cancelTimeout: nothing, abort: nothing };
      pending = operation;
      const now = options.now();
      const cached = state.document && state.verifiedAt !== null && state.expiresAt !== null && Number.isFinite(now) && now >= state.verifiedAt && now < state.expiresAt;
      commit(cached ? { ...state, status: 'loading', error: null } : empty('loading', null));
      // A subscriber may clear synchronously during the loading notification.
      if (pending !== operation) return promise;
      if (!Number.isFinite(now) || now < 0) { finish(operation, empty('unavailable', 'invalid_clock')); return promise; }
      operation.cancelTimeout = options.scheduler.after(6000, () => { failed(operation, 'timeout'); safely(operation.abort); });
      try {
        const task = options.transport.request(Object.freeze({ url: origin + EDUCATION_PATH + binding.ingredientId, method: 'GET', header: Object.freeze({ Accept: 'application/json' }), timeoutMs: 6000 }));
        operation.abort = () => task.abort();
        if (pending !== operation) { safely(operation.abort); return promise; }
        void task.promise.then(response => {
          if (pending !== operation) return;
          if (response.status === 404) { finish(operation, empty('withdrawn', null)); return; }
          if (response.status !== 200) { finish(operation, empty('unavailable', 'http')); return; }
          const time = options.now();
          if (!Number.isFinite(time) || time < now) { finish(operation, empty('unavailable', 'invalid_clock')); return; }
          const parsed = parseEducation(response.body, binding, time);
          if (!parsed.ok) { finish(operation, empty('incompatible', parsed.errorCode)); return; }
          const expiresAt = Math.min(time + ttl, ...parsed.document.sources.map(source => Date.parse(source.validUntil)));
          finish(operation, { status: 'ready', document: parsed.document, verifiedAt: time, expiresAt, error: null });
        }, () => failed(operation, 'network'));
      } catch { failed(operation, 'network'); }
      return promise;
    },
    setConnectivity(status) {
      if (status !== 'offline' && status !== 'connected' && status !== 'unknown') return;
      knownOffline = status === 'offline';
      if (knownOffline) disconnect();
    },
    clear(expectedRevision) {
      if (state.revision !== expectedRevision) return false;
      const operation = pending; pending = null;
      if (operation) safely(operation.cancelTimeout);
      commit(empty(origin ? 'idle' : 'disabled', null));
      if (operation) { safely(operation.abort); operation.resolve(state); }
      return true;
    }
  };
}
