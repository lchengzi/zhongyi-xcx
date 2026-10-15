export interface ConnectivityState {
  readonly revision: number;
  /** A connection is not proof that the public service is reachable. */
  readonly status: 'unknown' | 'connected' | 'offline';
}
export interface ConnectivityPort {
  read(): Promise<boolean | null>;
  watch(listener: (connected: boolean) => void): () => void;
}

export function createConnectivityStore(port: ConnectivityPort) {
  let state: ConnectivityState = Object.freeze({ revision: 0, status: 'unknown' });
  let generation = 0, running = false;
  const listeners = new Set<() => void>();
  function commit(value: unknown) {
    if (value !== null && typeof value !== 'boolean') return;
    state = Object.freeze({ revision: state.revision + 1, status: value === null ? 'unknown' : value ? 'connected' : 'offline' });
    for (const listener of [...listeners]) { try { listener(); } catch { /* Observers cannot interrupt connection updates. */ } }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** One application owner. Duplicate starts do not create duplicate listeners. */
    start(): () => void {
      if (running) return () => {};
      running = true; const current = ++generation;
      let stopWatching = () => {};
      try { stopWatching = port.watch(value => { if (running && generation === current) commit(value); }); } catch { /* Initial read remains useful. */ }
      const revision = state.revision;
      try { void port.read().then(value => { if (running && generation === current && state.revision === revision) commit(value); }, () => {}); } catch { /* Failure is unknown, never assumed offline. */ }
      return () => {
        if (!running || generation !== current) return;
        running = false; generation++;
        try { stopWatching(); } catch { /* The generation guard still invalidates callbacks. */ }
        commit(null);
      };
    }
  };
}
