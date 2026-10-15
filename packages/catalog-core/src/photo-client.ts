import { parseEducationBinding, publicContentOrigin, type EducationBinding } from './education.js';
import type { EducationScheduler, EducationTransport } from './education-client.js';
import { PHOTO_PATH, parsePublicPhotoGallery, type PublicPhotoGallery } from './photos.js';

export interface PhotoState {
  readonly revision: number;
  readonly status: 'disabled' | 'idle' | 'loading' | 'ready' | 'withdrawn' | 'unavailable' | 'expired';
  readonly gallery: PublicPhotoGallery | null;
}
export interface PhotoClient {
  getSnapshot(): PhotoState; subscribe(listener: () => void): () => void;
  refresh(): Promise<void>; clear(): void;
}
const noop = () => {};
function safely(action: () => void) { try { action(); } catch { /* A subscriber cannot undo invalidation. */ } }
/** Memory only; hide/offline/reset drops photos. No offline freshness promise. */
export function createPhotoClient(options: { origin: string | null; binding: EducationBinding; now: () => number; transport: EducationTransport; scheduler: EducationScheduler }): PhotoClient {
  const origin = options.origin === null ? null : publicContentOrigin(options.origin), binding = parseEducationBinding(options.binding);
  if (options.origin !== null && !origin) throw new Error('Invalid public photo origin');
  let state: PhotoState = Object.freeze({ revision: 0, status: origin ? 'idle' : 'disabled', gallery: null });
  let cancelExpiry = noop;
  let pending: { promise: Promise<void>; resolve: () => void; abort: () => void; cancel: () => void } | null = null;
  const listeners = new Set<() => void>();
  function commit(status: PhotoState['status'], gallery: PublicPhotoGallery | null = null) {
    safely(cancelExpiry); cancelExpiry = noop;
    state = Object.freeze({ revision: state.revision + 1, status, gallery });
    for (const listener of [...listeners]) safely(listener);
  }
  function clear() {
    const operation = pending; pending = null;
    if (operation) safely(operation.cancel);
    commit(origin ? 'idle' : 'disabled');
    if (operation) { safely(operation.abort); operation.resolve(); }
  }
  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, clear,
    refresh() {
      if (!origin) return Promise.resolve();
      if (pending) return pending.promise;
      let resolve = noop; const promise = new Promise<void>(done => { resolve = done; });
      const operation = { promise, resolve, abort: noop, cancel: noop }; pending = operation;
      const started = options.now(); commit('loading');
      if (pending !== operation) return promise;
      const finish = (status: PhotoState['status'], gallery: PublicPhotoGallery | null = null) => {
        if (pending !== operation) return;
        pending = null; safely(operation.cancel); commit(status, gallery); resolve();
        // Subscribers can synchronously clear or start a new read.
        if (gallery && state.gallery === gallery) {
          const snapshot = state;
          cancelExpiry = options.scheduler.after(Math.max(0, Math.min(60_000, Date.parse(gallery.validUntil) - options.now())), () => {
            if (state === snapshot) commit('expired');
          });
        }
      };
      if (!Number.isFinite(started) || started < 0) { finish('unavailable'); return promise; }
      operation.cancel = options.scheduler.after(6000, () => { finish('unavailable'); safely(operation.abort); });
      try {
        const request = options.transport.request({ url: origin + PHOTO_PATH + binding.ingredientId, method: 'GET', header: { Accept: 'application/json' }, timeoutMs: 6000 });
        operation.abort = () => request.abort();
        if (pending !== operation) { safely(operation.abort); return promise; }
        void request.promise.then(response => {
          if (pending !== operation) return;
          if (response.status === 404 || response.status === 410) { finish('withdrawn'); return; }
          const time = options.now();
          if (response.status !== 200 || !Number.isFinite(time) || time < started) { finish('unavailable'); return; }
          try { finish('ready', parsePublicPhotoGallery(response.body, binding, time)); } catch { finish('unavailable'); }
        }, () => finish('unavailable'));
      } catch { finish('unavailable'); }
      return promise;
    } };
}
