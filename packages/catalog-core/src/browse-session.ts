/** Memory-only list context. It contains no health profile or storage port. */
export type BrowseFilter = 'all' | 'checked' | 'pending';
export interface BrowseState {
  readonly revision: number;
  /** Continuous typing shares a boundary; clear/confirm/filter invalidate it. */
  readonly boundary: number;
  /** Changes that require layout-aware repositioning, unlike loading more. */
  readonly viewportRevision: number;
  readonly query: string;
  readonly filter: BrowseFilter;
  readonly visible: number;
}
export interface BrowseSession {
  getSnapshot(): BrowseState;
  subscribe(listener: () => void): () => void;
  input(value: unknown, expectedBoundary: number): boolean;
  confirm(value: unknown, expectedBoundary: number): boolean;
  clear(expectedRevision: number): boolean;
  filter(value: unknown, expectedRevision: number): boolean;
  more(total: unknown, expectedRevision: number): boolean;
  savePosition(top: unknown, expectedRevision: number): boolean;
  position(): number;
  /** The underlying result set changed; preserve the user's query/filter. */
  resetResults(): void;
  reset(): void;
}

export function createBrowseSession(pageSize = 12): BrowseSession {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid list page size');
  let state: BrowseState = Object.freeze({ revision: 0, boundary: 0, viewportRevision: 0, query: '', filter: 'all', visible: pageSize });
  let scrollTop = 0;
  const listeners = new Set<() => void>();
  function publish(next: Omit<BrowseState, 'revision'>) {
    state = Object.freeze({ ...next, revision: state.revision + 1 });
    for (const listener of [...listeners]) { try { listener(); } catch { /* One observer cannot prevent a privacy reset. */ } }
  }
  function query(value: unknown, expectedBoundary: number, confirmed: boolean) {
    if (state.boundary !== expectedBoundary || typeof value !== 'string') return false;
    const next = value.slice(0, 60);
    if (!confirmed && next === state.query) return false;
    scrollTop = 0;
    publish({ ...state, query: next, visible: pageSize, boundary: state.boundary + (confirmed ? 1 : 0), viewportRevision: state.viewportRevision + 1 });
    return true;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    input: (value, boundary) => query(value, boundary, false),
    confirm: (value, boundary) => query(value, boundary, true),
    clear(revision) {
      if (state.revision !== revision) return false;
      scrollTop = 0;
      publish({ ...state, query: '', visible: pageSize, boundary: state.boundary + 1, viewportRevision: state.viewportRevision + 1 });
      return true;
    },
    filter(value, revision) {
      if (state.revision !== revision || (value !== 'all' && value !== 'checked' && value !== 'pending')) return false;
      scrollTop = 0;
      publish({ ...state, filter: value, visible: pageSize, boundary: state.boundary + 1, viewportRevision: state.viewportRevision + 1 });
      return true;
    },
    more(total, revision) {
      if (state.revision !== revision || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total > 500 || total <= state.visible) return false;
      publish({ ...state, visible: Math.min(state.visible + pageSize, total) });
      return true;
    },
    savePosition(top, revision) {
      if (state.revision !== revision || typeof top !== 'number' || !Number.isFinite(top) || top < 0 || top > 10_000_000) return false;
      // Position changes do not invalidate typing or rerender the whole list.
      scrollTop = top; return true;
    },
    position: () => scrollTop,
    resetResults() {
      scrollTop = 0;
      publish({ ...state, visible: pageSize, boundary: state.boundary + 1, viewportRevision: state.viewportRevision + 1 });
    },
    reset() {
      scrollTop = 0;
      publish({ query: '', filter: 'all', visible: pageSize, boundary: state.boundary + 1, viewportRevision: state.viewportRevision + 1 });
    }
  };
}

export interface BrowseViewport {
  afterRender(callback: () => void): void;
  scrollTo(top: number): Promise<void>;
}

/** Restore only after layout and only for the same visible page/list context. */
export function restoreBrowsePosition(session: BrowseSession, revision: number, isCurrent: () => boolean, viewport: BrowseViewport): Promise<boolean> {
  const top = session.position();
  return new Promise(resolve => {
    try {
      viewport.afterRender(() => {
        if (!isCurrent() || session.getSnapshot().revision !== revision) { resolve(false); return; }
        try { void viewport.scrollTo(top).then(() => resolve(isCurrent() && session.getSnapshot().revision === revision), () => resolve(false)); }
        catch { resolve(false); }
      });
    } catch { resolve(false); }
  });
}
