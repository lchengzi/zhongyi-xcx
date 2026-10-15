import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';

const phases = ['created', 'dns', 'tcp', 'tls_start', 'tls_ready', 'authentication', 'ready'] as const;
type Phase = typeof phases[number];
const codes = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', '28P01', '28000', '53300', '57P03', 'connection_closed', 'other'] as const;
type Code = typeof codes[number];
export interface PostgresConnectionTrace {
  event: 'postgres_connection'; schemaVersion: 1; connection: number;
  startedAt: string; outcome: 'ready' | 'failed'; durationMs: number; code: Code | null;
  phases: Readonly<Partial<Record<Phase, number>>>;
}
interface ObservedDriver extends EventEmitter {
  readonly connection: EventEmitter & { readonly stream: Duplex };
}
let sequence = 0;
const retained: PostgresConnectionTrace[] = []; let dropped = 0;
export function postgresConnectionDiagnostics() {
  return Object.freeze({ traces: Object.freeze([...retained]), dropped });
}
function errorCode(error: unknown): Code {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return codes.find(allowed => allowed === code) || 'other';
}

/** Observe only: no retries, timeout changes, socket options or auth interception.
 * pg's sslconnect means TLS started, NOT that the handshake has completed. */
export function observePostgresConnection(client: ObservedDriver,
  publish: (trace: PostgresConnectionTrace) => void, now: () => number = () => performance.now()) {
  const started = now(); const startedAt = new Date().toISOString(); const id = ++sequence;
  const times: Partial<Record<Phase, number>> = { created: 0 };
  const detach: Array<() => void> = []; let finished = false;
  const elapsed = () => Math.max(0, Math.round((now() - started) * 100) / 100);
  const once = (target: EventEmitter, event: string, listener: (...args: unknown[]) => void) => {
    target.once(event, listener); detach.push(() => target.removeListener(event, listener));
  };
  const mark = (phase: Phase) => { if (!finished && times[phase] === undefined) times[phase] = elapsed(); };
  const finish = (outcome: 'ready' | 'failed', code: Code | null) => {
    if (finished) return;
    finished = true; for (const remove of detach) remove();
    // Diagnostics must never change a driver callback's success/failure.
    try {
      const trace: PostgresConnectionTrace = Object.freeze({ event: 'postgres_connection', schemaVersion: 1, connection: id,
        startedAt, outcome, durationMs: elapsed(), code, phases: Object.freeze({ ...times }) });
      if (retained.length === 256) { retained.shift(); dropped++; }
      retained.push(trace); publish(trace);
    } catch {}
  };
  once(client.connection.stream, 'lookup', () => mark('dns'));
  once(client.connection, 'connect', () => mark('tcp'));
  once(client.connection, 'sslconnect', () => {
    mark('tls_start'); once(client.connection.stream, 'secureConnect', () => mark('tls_ready'));
  });
  for (const event of ['authenticationCleartextPassword', 'authenticationMD5Password', 'authenticationSASL']) {
    once(client.connection, event, () => mark('authentication'));
  }
  once(client, 'connect', () => { mark('ready'); finish('ready', null); });
  once(client.connection, 'error', error => finish('failed', errorCode(error)));
  once(client.connection, 'end', () => finish('failed', 'connection_closed'));
}

/** Explicit projection for retained diagnostics; unknown/raw fields rejected. */
export function parsePostgresConnectionTrace(input: unknown): PostgresConnectionTrace | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = Object.fromEntries(Object.entries(input));
  if (Object.keys(value).sort().join() !== 'code,connection,durationMs,event,outcome,phases,schemaVersion,startedAt'
    || value.event !== 'postgres_connection' || value.schemaVersion !== 1
    || typeof value.connection !== 'number' || !Number.isSafeInteger(value.connection) || value.connection < 1
    || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0
    || typeof value.startedAt !== 'string' || value.startedAt.length !== 24 || !Number.isFinite(Date.parse(value.startedAt))
    || new Date(value.startedAt).toISOString() !== value.startedAt
    || (value.outcome !== 'ready' && value.outcome !== 'failed')
    || (value.outcome === 'ready' ? value.code !== null : !codes.some(code => code === value.code))
    || !value.phases || typeof value.phases !== 'object' || Array.isArray(value.phases)) return null;
  const timings: Partial<Record<Phase, number>> = {};
  for (const [phase, timing] of Object.entries(value.phases)) {
    const allowed = phases.find(known => known === phase);
    if (!allowed || typeof timing !== 'number' || !Number.isFinite(timing) || timing < 0 || timing > value.durationMs) return null;
    timings[allowed] = timing;
  }
  if (timings.created !== 0 || (value.outcome === 'ready' && timings.ready === undefined)) return null;
  const code = value.code === null ? null : codes.find(known => known === value.code);
  if (code === undefined) return null;
  return { event: 'postgres_connection', schemaVersion: 1, connection: value.connection,
    startedAt: value.startedAt, outcome: value.outcome, durationMs: value.durationMs, code, phases: timings };
}
