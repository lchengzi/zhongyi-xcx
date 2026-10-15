import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestCategory } from './request-log.js';

const codes = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  '28P01', '28000', '53300', '57P01', '57P02', '57P03', '57014', '55P03',
  '25P03', '40001', '40P01', 'pool_acquire_timeout', 'connection_timeout', 'connection_closed', 'other'] as const;
export type FailureCode = typeof codes[number];
export type DatabasePhase = 'acquire' | 'begin' | 'setup' | 'lock' | 'work' | 'commit';
export interface DatabaseFailure {
  readonly engine: 'postgres';
  readonly operation: 'read' | 'write';
  readonly phase: DatabasePhase;
  readonly code: FailureCode;
  readonly rollback: 'not_started' | 'completed' | 'failed';
  readonly rollbackCode: FailureCode | null;
}
export interface FailureRecord {
  readonly event: 'api_failure';
  readonly timestamp: string;
  readonly requestId: string;
  readonly category: RequestCategory;
  readonly method: string;
  readonly status: 500 | 503;
  readonly engine: 'application' | 'postgres';
  readonly operation: 'read' | 'write' | null;
  readonly phase: DatabasePhase | 'application';
  readonly code: FailureCode;
  readonly rollback: DatabaseFailure['rollback'] | null;
  readonly rollbackCode: FailureCode | null;
}
export type FailureSink = (record: FailureRecord) => void | Promise<void>;
interface Scope {
  readonly requestId: string;
  readonly category: RequestCategory;
  readonly method: string;
  readonly sink: FailureSink;
  readonly errors: WeakMap<object, DatabaseFailure>;
  emitted: boolean;
}
const scope = new AsyncLocalStorage<Scope>();

/** Fixed codes only. Never serialize messages, stacks, SQL, params or causes. */
export function failureCode(error: unknown): FailureCode {
  try {
    if (!error || typeof error !== 'object') return 'other';
    const code = 'code' in error ? error.code : undefined;
    const known = codes.find(value => value === code);
    if (known) return known;
    // Exact messages emitted by the installed pg/pg-pool driver; not substrings.
    const message = 'message' in error ? error.message : undefined;
    if (message === 'timeout exceeded when trying to connect') return 'pool_acquire_timeout';
    if (message === 'Connection terminated due to connection timeout' || message === 'timeout expired') return 'connection_timeout';
    if (message === 'Connection terminated' || message === 'Connection terminated unexpectedly') return 'connection_closed';
  } catch { /* Even hostile error properties must not affect a request. */ }
  return 'other';
}

export function withFailureDiagnostics(request: Pick<Scope, 'requestId' | 'category' | 'method'>,
  sink: FailureSink | undefined, next: () => void): void {
  if (!sink) { next(); return; }
  scope.run({ ...request, sink, errors: new WeakMap(), emitted: false }, next);
}

export function markDatabaseFailure(error: unknown, details: Omit<DatabaseFailure, 'engine' | 'code'>): void {
  const current = scope.getStore();
  if (!current || !error || typeof error !== 'object' || current.errors.has(error)) return;
  current.errors.set(error, Object.freeze({ engine: 'postgres', ...details, code: failureCode(error) }));
}

/** Called at the HTTP boundary, including deliberate readiness/public 503s. */
export function reportRequestFailure(error: unknown, status: 500 | 503): void {
  const current = scope.getStore();
  if (!current || current.emitted) return;
  current.emitted = true;
  const database = error && typeof error === 'object' ? current.errors.get(error) : undefined;
  const record: FailureRecord = Object.freeze({ event: 'api_failure', timestamp: new Date().toISOString(),
    requestId: current.requestId, category: current.category, method: current.method, status,
    engine: database?.engine ?? 'application', operation: database?.operation ?? null,
    phase: database?.phase ?? 'application', code: database?.code ?? failureCode(error),
    rollback: database?.rollback ?? null, rollbackCode: database?.rollbackCode ?? null });
  try { void Promise.resolve(current.sink(record)).catch(() => {}); } catch { /* Observation only. */ }
}

export const writeFailureLog: FailureSink = record => { console.log(JSON.stringify(record)); };
