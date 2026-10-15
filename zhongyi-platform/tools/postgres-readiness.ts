// Fixture-only readiness: a log line is not proof that a new authenticated
// connection can complete. Never change production pool deadlines or retry writes.
export async function waitForPostgresReadiness(
  probe: () => Promise<string>,
  isOwnedProcessLive: () => boolean,
  options: { now?: () => number; wait?: () => Promise<void>; timeoutMs?: number } = {}
): Promise<string> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (() => new Promise<void>((done) => setTimeout(done, 250)));
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid PostgreSQL readiness deadline');
  const deadline = now() + timeoutMs;
  while (true) {
    if (!isOwnedProcessLive()) throw new Error('Owned PostgreSQL process exited during SQL readiness');
    if (now() >= deadline) throw new Error('PostgreSQL authenticated SQL readiness timed out');
    try {
      const version = await probe();
      if (!isOwnedProcessLive()) throw new Error('Owned PostgreSQL process exited during SQL readiness');
      if (now() >= deadline) throw new Error('PostgreSQL authenticated SQL readiness timed out');
      return version;
    } catch {
      // A failed connection is discarded by the probe; retry only this read-only
      // fixture check against the SAME process, never start or signal a server.
      if (!isOwnedProcessLive()) throw new Error('Owned PostgreSQL process exited during SQL readiness');
      if (now() >= deadline) throw new Error('PostgreSQL authenticated SQL readiness timed out');
      await wait();
    }
  }
}
