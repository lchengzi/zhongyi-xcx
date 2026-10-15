import { performance } from 'node:perf_hooks';
import { requestCategory, type RequestCategory, type RequestLogRecord } from '../server/request-log.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'OTHER'];
const categories = ['health', 'readiness', 'public', 'authentication', 'accounts', 'editorial', 'catalog', 'other'];
const fields = ['category', 'durationMs', 'event', 'method', 'outcome', 'requestId', 'status', 'timestamp'];
const errors = ['OWNED_REQUEST_TIMEOUT', 'OWNED_RESPONSE_ABORTED', 'OWNED_REQUEST_CLOSED', 'ECONNREFUSED', 'ECONNRESET',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED'];
const milliseconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400000;

// A strict projection, not a raw stdout archive. Unknown fields reject the line.
export function safeRequestLog(line: string): RequestLogRecord | null {
  if (line.length > 4096) return null;
  try {
    const v = JSON.parse(line);
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== fields.join() ||
      v.event !== 'api_request' || typeof v.requestId !== 'string' || !uuid.test(v.requestId) ||
      !categories.includes(v.category) || !methods.includes(v.method) || !milliseconds(v.durationMs) ||
      typeof v.timestamp !== 'string' || new Date(v.timestamp).toISOString() !== v.timestamp ||
      !['completed', 'aborted'].includes(v.outcome) || (v.outcome === 'aborted' ? v.status !== null : !Number.isInteger(v.status) || v.status < 100 || v.status > 599)) return null;
    return Object.freeze({ event: 'api_request', timestamp: v.timestamp, requestId: v.requestId, category: v.category,
      method: v.method, status: v.status, durationMs: v.durationMs, outcome: v.outcome });
  } catch { return null; }
}

export class RequestLogCollector {
  readonly records: RequestLogRecord[] = [];
  private pending = ''; private oversized = false;
  dropped = 0;
  push(chunk: string): void {
    // Bound incomplete lines as well as accepted entries, including giant chunks.
    for (const character of chunk) {
      if (character === '\n') {
        if (!this.oversized) {
          const record = safeRequestLog(this.pending.replace(/\r$/, ''));
          if (record) {
            if (this.records.length < 1024) this.records.push(record); else this.dropped++;
          }
        }
        this.pending = ''; this.oversized = false;
      } else if (!this.oversized) {
        this.pending += character;
        if (this.pending.length > 4096) { this.pending = ''; this.oversized = true; this.dropped++; }
      }
    }
  }
  end(): void { if (this.pending) this.push('\n'); }
}

type Milestone = 'socket' | 'tcp' | 'tls' | 'flushed' | 'headers' | 'end';
type Phase = 'socket_assignment' | 'tcp_connect' | 'tls_handshake' | 'response_headers' | 'response_body' | 'complete';
export interface ClientRequestTrace {
  sequence: number; application: number | null; startedAt: string; category: RequestCategory; method: string;
  timeoutKind: 'socket_inactivity'; timeoutMs: 3000; reusedSocket: boolean; tlsAuthorized: boolean;
  milestones: Record<Milestone, number | null>; durationMs: number; phase: Phase;
  outcome: 'completed' | 'timed_out' | 'failed'; status: number | null; requestId: string | null; errorCode: string | null;
}
export class RequestTimeline {
  private readonly started: number;
  private readonly milestones: Record<Milestone, number | null> = { socket: null, tcp: null, tls: null, flushed: null, headers: null, end: null };
  private reused = false; private authorized = false; private status: number | null = null; private requestId: string | null = null;
  private result: ClientRequestTrace | undefined;
  private readonly startedAt: string;
  private readonly category: RequestCategory;
  private readonly method: string;
  constructor(private readonly sequence: number, private readonly application: number | null, pathname: string, method: string,
    private readonly now = () => performance.now(), wall = () => new Date().toISOString()) {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || (application !== null && (!Number.isSafeInteger(application) || application < 1))) throw new Error('Owned request sequence required');
    this.started = now(); this.startedAt = wall();
    this.category = requestCategory(pathname.startsWith('/api/') ? pathname.slice(4).split('?')[0] : '/other');
    this.method = methods.includes(method) ? method : 'OTHER';
  }
  private elapsed() { return Math.min(86400000, Math.max(0, Math.round((this.now() - this.started) * 100) / 100)); }
  mark(event: Milestone): void { if (!this.result && this.milestones[event] === null) this.milestones[event] = this.elapsed(); }
  socket(connected: boolean, authorized: boolean, reused: boolean): void {
    this.mark('socket'); this.reused = reused;
    if (connected) this.mark('tcp');
    if (authorized) this.secure(true);
  }
  secure(authorized: boolean): void { this.authorized = authorized; this.mark('tls'); }
  headers(status: number | undefined, id: unknown): void {
    this.mark('headers'); this.status = Number.isInteger(status) && status! >= 100 && status! <= 599 ? status! : null;
    this.requestId = typeof id === 'string' && uuid.test(id) ? id : null;
  }
  finish(outcome: ClientRequestTrace['outcome'], errorCode?: unknown): ClientRequestTrace {
    if (this.result) return this.result;
    const m = this.milestones;
    const phase: Phase = m.end !== null ? 'complete' : m.headers !== null ? 'response_body' : m.tls !== null && this.authorized
      ? 'response_headers' : m.tcp !== null ? 'tls_handshake' : m.socket !== null ? 'tcp_connect' : 'socket_assignment';
    this.result = Object.freeze({ sequence: this.sequence, application: this.application, startedAt: this.startedAt, category: this.category, method: this.method,
      timeoutKind: 'socket_inactivity', timeoutMs: 3000, reusedSocket: this.reused, tlsAuthorized: this.authorized,
      milestones: Object.freeze({ ...m }), durationMs: this.elapsed(), phase, outcome, status: this.status, requestId: this.requestId,
      errorCode: outcome === 'completed' ? null : typeof errorCode === 'string' && errors.includes(errorCode) ? errorCode : 'OTHER' });
    return this.result;
  }
}

export function correlateRequest(client: ClientRequestTrace, server: readonly RequestLogRecord[]) {
  const safe = server.flatMap((record) => { const value = safeRequestLog(JSON.stringify(record)); return value ? [value] : []; });
  if (client.requestId) {
    const matches = safe.filter((record) => record.requestId === client.requestId);
    return { kind: matches.length === 1 ? 'request_id' : matches.length > 1 ? 'ambiguous' : 'none', candidates: matches.map((r) => r.requestId) };
  }
  const start = Date.parse(client.startedAt); const end = start + client.durationMs;
  const matches = safe.filter((r) => r.category === client.category && r.method === client.method &&
    Date.parse(r.timestamp) - r.durationMs <= end && Date.parse(r.timestamp) >= start);
  return { kind: matches.length === 1 ? 'time_window' : matches.length > 1 ? 'ambiguous' : 'none', candidates: matches.map((r) => r.requestId) };
}
