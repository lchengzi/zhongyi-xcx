export type ReadingSize = 'standard' | 'large' | 'extra-large';
export interface ReadingPreferences {
  readonly revision: number;
  readonly size: ReadingSize;
}

/** Reading preferences contain no health data and live only in this runtime. */
export function createReadingPreferences() {
  let state: ReadingPreferences = Object.freeze({ revision: 0, size: 'standard' });
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setSize(size: unknown, expectedRevision: number): boolean {
      if (expectedRevision !== state.revision || (size !== 'standard' && size !== 'large' && size !== 'extra-large')) return false;
      if (size === state.size) return true;
      state = Object.freeze({ revision: state.revision + 1, size });
      for (const listener of [...listeners]) {
        try { listener(); } catch { /* One observer cannot interrupt other readers. */ }
      }
      return true;
    },
  };
}
