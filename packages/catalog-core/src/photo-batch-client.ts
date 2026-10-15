import { parseEducationBinding, publicContentOrigin, type EducationBinding } from './education.js';
import type { EducationScheduler, EducationTransport } from './education-client.js';
import { PHOTO_BATCH_SIZE, PHOTO_PATH, parsePublicPhotoBatch, type PublicPhotoGallery } from './photos.js';

export interface PhotoBatchState {
  readonly revision: number; readonly status: 'disabled' | 'idle' | 'loading' | 'ready' | 'unavailable' | 'expired';
  readonly galleries: Readonly<Record<string, PublicPhotoGallery | undefined>>;
}
export interface PhotoBatchClient {
  getSnapshot(): PhotoBatchState; subscribe(listener: () => void): () => void;
  refresh(bindings: readonly EducationBinding[], force?: boolean): Promise<void>; clear(): void;
}
const noop = () => {};
function safe(action: () => void) { try { action(); } catch { /* Observers and abort failures cannot revive content. */ } }
interface Cached { binding: EducationBinding; gallery: PublicPhotoGallery | null; verifiedAt: number; expiresAt: number }
interface Request { cancel(): void; abort(): void }
interface Operation { key: string; queue: EducationBinding[][]; active: Set<Request>; promise: Promise<void>; resolve(): void; failed: boolean }

/** Anonymous memory-only batches, capped at two in flight. Only verified replies
 * (including absence) are cached; errors are not retried by this client. */
export function createPhotoBatchClient(options: { origin: string | null; now: () => number; transport: EducationTransport; scheduler: EducationScheduler }): PhotoBatchClient {
  const origin = options.origin === null ? null : publicContentOrigin(options.origin);
  if (options.origin !== null && !origin) throw new Error('Invalid photo batch origin');
  let state: PhotoBatchState = Object.freeze({ revision: 0, status: origin ? 'idle' : 'disabled', galleries: Object.freeze({}) });
  const listeners = new Set<() => void>(), cache = new Map<string, Cached>();
  let selected: EducationBinding[] = [], pending: Operation | null = null, cancelExpiry = noop;
  function prune(time: number) {
    const ids = new Set(selected.map(item => item.ingredientId));
    for (const [id, item] of cache) if (!ids.has(id) || !Number.isFinite(time) || time < item.verifiedAt || time >= item.expiresAt) cache.delete(id);
  }
  function commit(status: PhotoBatchState['status']) {
    safe(cancelExpiry); cancelExpiry = noop; prune(options.now());
    state = Object.freeze({ revision: state.revision + 1, status,
      galleries: Object.freeze(Object.fromEntries([...cache].flatMap(([id, item]) => item.gallery ? [[id, item.gallery]] : []))) });
    if (cache.size) cancelExpiry = options.scheduler.after(Math.max(0, Math.min(...[...cache.values()].map(item => item.expiresAt)) - options.now()), () => {
      prune(options.now()); commit(pending ? 'loading' : 'expired');
    });
    for (const listener of [...listeners]) safe(listener);
  }
  function cancelPending() {
    const previous = pending; pending = null;
    if (!previous) return;
    previous.queue.length = 0;
    for (const request of previous.active) { safe(request.cancel); safe(request.abort); }
    previous.active.clear(); previous.resolve();
  }
  function pump(operation: Operation) {
    if (pending !== operation) return;
    while (operation.active.size < 2 && operation.queue.length) {
      const bindings = operation.queue.shift()!;
      const started = options.now(), request: Request = { abort: noop, cancel: noop }; operation.active.add(request);
      const finish = (galleries: readonly PublicPhotoGallery[] | null) => {
        if (pending !== operation || !operation.active.delete(request)) return;
        safe(request.cancel);
        const time = options.now();
        if (!galleries || !Number.isFinite(time) || time < started) {
          operation.failed = true; for (const binding of bindings) cache.delete(binding.ingredientId);
        } else {
          for (const binding of bindings) {
            const gallery = galleries.find(item => item.ingredientId === binding.ingredientId) ?? null;
            cache.set(binding.ingredientId, { binding, gallery, verifiedAt: time, expiresAt: Math.min(time + 60_000, gallery ? Date.parse(gallery.validUntil) : Infinity) });
          }
        }
        const done = !operation.queue.length && !operation.active.size;
        if (done) pending = null;
        commit(done ? operation.failed ? 'unavailable' : 'ready' : 'loading');
        if (done) operation.resolve(); else pump(operation);
      };
      request.cancel = options.scheduler.after(6000, () => { safe(request.abort); finish(null); });
      try {
        const task = options.transport.request({ url: `${origin}${PHOTO_PATH}batch/${bindings.map(item => item.ingredientId).join(',')}`,
          method: 'GET', header: { Accept: 'application/json' }, timeoutMs: 6000 });
        request.abort = () => task.abort();
        if (pending !== operation || !operation.active.has(request)) { safe(request.abort); continue; }
        void task.promise.then(reply => {
          if (pending !== operation || !operation.active.has(request)) return;
          try { finish(reply.status === 200 ? parsePublicPhotoBatch(reply.body, bindings, options.now()) : null); } catch { finish(null); }
        }, () => finish(null));
      } catch { finish(null); }
    }
  }
  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear() { cancelPending(); cache.clear(); selected = []; commit(origin ? 'idle' : 'disabled'); },
    refresh(raw, force = false) {
      if (!origin) return Promise.resolve();
      if (!Array.isArray(raw) || raw.length > 120) throw new Error('Invalid selected photo count');
      const bindings = raw.map(parseEducationBinding), key = JSON.stringify(bindings);
      if (new Set(bindings.map(item => item.ingredientId)).size !== bindings.length || bindings.some(item => item.baseReleaseId !== bindings[0]?.baseReleaseId)) throw new Error('Invalid selected photo identities');
      if (pending?.key === key) return pending.promise;
      cancelPending(); selected = bindings; const time = options.now(); prune(time);
      for (const binding of bindings) {
        const current = cache.get(binding.ingredientId);
        if (force || (current && JSON.stringify(current.binding) !== JSON.stringify(binding))) cache.delete(binding.ingredientId);
      }
      if (!Number.isFinite(time) || time < 0) { cache.clear(); commit('unavailable'); return Promise.resolve(); }
      const missing = bindings.filter(binding => !cache.has(binding.ingredientId));
      if (!missing.length) { commit('ready'); return Promise.resolve(); }
      let resolve = noop; const promise = new Promise<void>(done => { resolve = done; });
      const queue: EducationBinding[][] = [];
      for (let index = 0; index < missing.length; index += PHOTO_BATCH_SIZE) queue.push(missing.slice(index, index + PHOTO_BATCH_SIZE));
      const operation: Operation = { key, queue, active: new Set(), promise, resolve, failed: false }; pending = operation;
      commit('loading'); pump(operation); return promise;
    }
  };
}
