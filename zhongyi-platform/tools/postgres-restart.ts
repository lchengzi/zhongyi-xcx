import { randomUUID } from 'node:crypto';

export interface RestartChannel {
  connected(): boolean;
  subscribe(message: (value: unknown) => void, disconnect: () => void): () => void;
  send(request: { type: 'restart-postgres'; nonce: string; id: string }, failed: (error: Error | null) => void): void;
}

// Fixture only. Observation intervals do not prove that a checkpoint or its
// controller ended. Keep ONE request pending until its authenticated outcome.
export async function waitForOwnedPostgresRestart(channel: RestartChannel, nonce: string, options: {
  observe?: (tick: () => void) => () => void;
  report?: () => void;
} = {}): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('A verified live test-server controller is required for restart proof');
  const id = randomUUID();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let stopObserving = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; unsubscribe(); stopObserving();
      if (error) reject(error); else resolve();
    };
    unsubscribe = channel.subscribe((value) => {
      if (!value || typeof value !== 'object') return;
      const message = value as Record<string, unknown>;
      if (message.id !== id || message.nonce !== nonce) return;
      if (message.ok === true) finish();
      else if (message.ok === false) finish(new Error('Owned PostgreSQL fixture restart failed; evidence retained'));
    }, () => finish(new Error('Owned PostgreSQL controller disconnected before restart proof')));
    if (!channel.connected()) { finish(new Error('Owned PostgreSQL controller is not connected')); return; }
    const observe = options.observe ?? ((tick: () => void) => {
      const timer = setInterval(tick, 30000); return () => clearInterval(timer);
    });
    stopObserving = observe(() => {
      if (!channel.connected()) { finish(new Error('Owned PostgreSQL controller disconnected before restart proof')); return; }
      // Do not release subsequent tests, send another request, or claim success.
      (options.report ?? (() => console.log('Awaiting the SAME live PostgreSQL restart controller; observation interval is not a terminal result.')))();
    });
    try {
      channel.send({ type: 'restart-postgres', nonce, id }, (error) => {
        if (error) finish(new Error('Owned PostgreSQL restart request could not be delivered'));
      });
    } catch { finish(new Error('Owned PostgreSQL restart request could not be delivered')); }
  });
}
