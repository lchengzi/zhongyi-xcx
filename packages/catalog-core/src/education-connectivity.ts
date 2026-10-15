import type { ConnectivityState } from './connectivity.js';
import type { EducationClient } from './education-client.js';

export interface EducationConnectivityPort {
  getSnapshot(): ConnectivityState;
  subscribe(listener: () => void): () => void;
}

/** Reconnect is a reason to revalidate, not evidence that a service is healthy.
 * The owner supplies live visibility/health/privacy guards; no health data
 * enters the transport. Initial reading and showing a page remain explicit. */
export function watchEducationConnectivity(client: EducationClient, connection: EducationConnectivityPort, canRead: () => boolean): () => void {
  let active = true, waitingForReconnect = false, generation = 0;
  let previous: ConnectivityState['status'] = 'unknown';
  const update = () => {
    if (!active) return;
    const current = ++generation;
    const status = connection.getSnapshot().status;
    const reconnect = status === 'connected' && previous !== 'connected' && waitingForReconnect;
    if (status === 'offline') waitingForReconnect = true;
    else if (reconnect) waitingForReconnect = false;
    previous = status;
    client.setConnectivity(status);
    if (reconnect && active && current === generation) {
      const revision = client.getSnapshot().revision;
      let allowed = false;
      try { allowed = canRead(); } catch { /* Unknown owner state is not permission to read. */ }
      if (active && allowed && current === generation && client.getSnapshot().revision === revision) void client.refresh();
    }
  };
  const stop = connection.subscribe(update);
  update();
  return () => { active = false; generation++; stop(); };
}
