import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { failureCode, type FailureCode } from './failure-diagnostics.js';

export type InitializationPhase = 'arguments' | 'seed-read' | 'postgres-configuration' | 'seed-validation' |
  'sqlite-create' | 'sqlite-snapshot' | 'snapshot-validation' | 'postgres-acquire' | 'postgres-begin' |
  'postgres-setup' | 'postgres-lock' | 'postgres-target-check' | 'postgres-schema' | 'postgres-copy' |
  'postgres-verify' | 'postgres-audit' | 'postgres-commit' | 'sqlite-cleanup' | 'postgres-close';
type Outcome = 'not_started' | 'completed' | 'failed';
type CleanupResource = 'sqlite' | 'postgres';
interface Observation { outcome: Outcome; code: FailureCode | null }
export interface InitializationObserver {
  phase(value: InitializationPhase): void;
  failure(error: unknown): void;
  rollback(value: Exclude<Outcome, 'not_started'>, error?: unknown): void;
  cleanup(resource: CleanupResource, value: Exclude<Outcome, 'not_started'>, error?: unknown): void;
}
export interface InitializationRecord {
  event: 'postgres_initialization'; schemaVersion: 1; operationId: string; startedAt: string; durationMs: number;
  outcome: 'success' | 'failed'; phase: InitializationPhase; code: FailureCode | null;
  rollback: Readonly<Observation>; cleanup: Readonly<Record<CleanupResource, Readonly<Observation>>>;
  phases: ReadonlyArray<Readonly<{ phase: InitializationPhase; elapsedMs: number }>>; omittedPhases: number;
}
export type InitializationSink = (record: InitializationRecord) => void | Promise<void>;

// Only fixed phase/code projections. Never retain SQL, schema/paths, input,
// passwords, source data, error messages, stacks, causes or driver objects.
export function initializationDiagnostics(sink: InitializationSink, clock = () => performance.now()) {
  const operationId = randomUUID(), startedAt = new Date().toISOString(), start = clock();
  let phase: InitializationPhase = 'arguments', first: { phase: InitializationPhase; code: FailureCode } | undefined, done = false, omittedPhases = 0;
  const phases: { phase: InitializationPhase; elapsedMs: number }[] = [];
  let rollback: Observation = { outcome: 'not_started', code: null };
  const cleanup: Record<CleanupResource, Observation> = { sqlite: { outcome: 'not_started', code: null }, postgres: { outcome: 'not_started', code: null } };
  const elapsed = () => { const value = clock() - start; return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0; };
  const observer: InitializationObserver = {
    phase(value) { if (done) return; phase = value; if (phases.length < 32) phases.push({ phase, elapsedMs: elapsed() }); else omittedPhases++; },
    failure(error) { if (!done && !first) first = { phase, code: failureCode(error) }; },
    rollback(outcome, error) { if (!done) rollback = { outcome, code: outcome === 'failed' ? failureCode(error) : null }; },
    cleanup(resource, outcome, error) { if (!done) cleanup[resource] = { outcome, code: outcome === 'failed' ? failureCode(error) : null }; }
  };
  return { observer, finish(success: boolean): void {
    if (done) return; done = true;
    const record: InitializationRecord = Object.freeze({ event: 'postgres_initialization', schemaVersion: 1, operationId, startedAt, durationMs: elapsed(),
      outcome: success && !first ? 'success' : 'failed', phase: first?.phase ?? phase, code: first?.code ?? (success ? null : 'other'),
      rollback: Object.freeze({ ...rollback }), cleanup: Object.freeze({ sqlite: Object.freeze({ ...cleanup.sqlite }), postgres: Object.freeze({ ...cleanup.postgres }) }),
      phases: Object.freeze(phases.map(item => Object.freeze({ ...item }))), omittedPhases });
    try { void Promise.resolve(sink(record)).catch(() => {}); } catch { /* Observation cannot change initialization. */ }
  } };
}
function observe(work: () => void): void { try { work(); } catch { /* Optional instrumentation is never business authority. */ } }
export const initializationPhase = (observer: InitializationObserver | undefined, phase: InitializationPhase) => observe(() => observer?.phase(phase));
export const initializationFailed = (observer: InitializationObserver | undefined, error: unknown) => observe(() => observer?.failure(error));
export const initializationRollback = (observer: InitializationObserver | undefined, outcome: Exclude<Outcome, 'not_started'>, error?: unknown) => observe(() => observer?.rollback(outcome, error));
export const initializationCleanup = (observer: InitializationObserver | undefined, resource: CleanupResource, outcome: Exclude<Outcome, 'not_started'>, error?: unknown) => observe(() => observer?.cleanup(resource, outcome, error));
