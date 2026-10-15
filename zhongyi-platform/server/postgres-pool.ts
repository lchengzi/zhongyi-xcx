import { Pool, type PoolClient, type PoolConfig } from 'pg';

/** pg-pool may remove an idle client and resolve end() before the driver's
 * asynchronous end event. Keep that final interval inside the owned lifecycle.
 * No error listener, retry, timeout extension or forced disconnect is added. */
export function poolClientShutdownBarrier() {
  const pending = new Map<object, Promise<void>>();
  let draining = false;
  const retain = (client: object) => {
    // allowExitOnIdle can unref an idle socket. Awaiting a promise alone does
    // not keep Node alive; retain only the connection we are actually closing.
    if ('ref' in client && typeof client.ref === 'function') client.ref();
  };
  return {
    connected(client: { once(event: 'end', listener: () => void): unknown }) {
      if (pending.has(client)) return;
      let finished = false;
      const closed = new Promise<void>(resolve => {
        client.once('end', () => { finished = true; pending.delete(client); resolve(); });
      });
      if (!finished) { pending.set(client, closed); if (draining) retain(client); }
    },
    async drain(end: () => Promise<void>) {
      // The upstream close still owns shutdown and rejects unchanged on error.
      draining = true; for (const client of pending.keys()) retain(client);
      await end();
      await Promise.all(pending.values());
    }
  };
}

export class OwnedPostgresPool extends Pool {
  private readonly shutdown = poolClientShutdownBarrier();
  constructor(config: PoolConfig) {
    super(config);
    this.on('connect', (client: PoolClient) => this.shutdown.connected(client));
  }
  override end(): Promise<void>;
  override end(callback: () => void): void;
  override end(callback?: (error?: unknown) => void): Promise<void> | void {
    const result = this.shutdown.drain(() => super.end());
    if (callback) { void result.then(() => callback(), error => callback(error)); return; }
    return result;
  }
}
