import assert from 'node:assert/strict';
import test from 'node:test';
import { initializationCleanup, initializationDiagnostics, initializationFailed, initializationPhase,
  initializationRollback, type InitializationObserver, type InitializationPhase, type InitializationRecord } from '../server/initialization-diagnostics.js';
import { withMigrationTransaction } from '../server/migration-transaction.js';

function transactionFixture(failureAt: InitializationPhase | null, rollbackFails = false) {
  const statements: string[] = [], releases: boolean[] = [];
  const error = Object.assign(new Error('private SQL password path'), { code: 'ECONNRESET' });
  let connects = 0;
  const client = {
    async query(sql: string) {
      statements.push(sql);
      const phase = sql.startsWith('BEGIN') ? 'postgres-begin' : sql.startsWith('SET') ? 'postgres-setup'
        : sql === 'COMMIT' ? 'postgres-commit' : 'postgres-copy';
      if (sql === 'ROLLBACK') {
        if (rollbackFails) throw Object.assign(new Error('private rollback password'), { code: 'EPIPE' });
      } else if (failureAt === phase) throw error;
      return { rows: [], rowCount: 0 };
    },
    release(discard = false) { releases.push(discard); }
  };
  const pool = { async connect() { connects++; if (failureAt === 'postgres-acquire') throw error; return client; } };
  return { pool, error, statements, releases, connects: () => connects };
}
function validate(record: InitializationRecord) {
  assert.deepEqual(Object.keys(record).sort(), ['cleanup', 'code', 'durationMs', 'event', 'omittedPhases',
    'operationId', 'outcome', 'phase', 'phases', 'rollback', 'schemaVersion', 'startedAt']);
  assert.equal(record.event, 'postgres_initialization'); assert.equal(record.schemaVersion, 1);
  assert.match(record.operationId, /^[a-f0-9-]{36}$/); assert.equal(new Date(record.startedAt).toISOString(), record.startedAt);
  assert(Number.isFinite(record.durationMs) && record.durationMs >= 0);
  assert(Object.isFrozen(record)); assert(Object.isFrozen(record.phases)); assert(Object.isFrozen(record.cleanup));
  for (const entry of [...record.phases, record.rollback, record.cleanup.sqlite, record.cleanup.postgres]) assert(Object.isFrozen(entry));
  assert.doesNotMatch(JSON.stringify(record), /private|password|SQL|path|stack|cause/);
}

test('real migration transaction owner preserves primary failure, rolls back/releases once and never retries', async () => {
  for (const phase of ['postgres-acquire', 'postgres-begin', 'postgres-setup', 'postgres-copy', 'postgres-commit'] as const) {
    for (const rollbackFails of [false, true]) {
      const f = transactionFixture(phase, rollbackFails), records: InitializationRecord[] = [];
      const diagnostics = initializationDiagnostics(record => { records.push(record); });
      await assert.rejects(withMigrationTransaction(f.pool, async client => {
        initializationPhase(diagnostics.observer, 'postgres-copy'); await client.query('PRIVATE WORK'); return 42;
      }, false, diagnostics.observer), error => error === f.error);
      // Cleanup or an outer catch must never replace the first failing phase.
      initializationPhase(diagnostics.observer, 'sqlite-cleanup');
      initializationCleanup(diagnostics.observer, 'sqlite', 'completed');
      initializationPhase(diagnostics.observer, 'postgres-close');
      initializationFailed(diagnostics.observer, new Error('private secondary close'));
      initializationCleanup(diagnostics.observer, 'postgres', 'failed', { code: 'ENOTFOUND' });
      diagnostics.finish(false);
      assert.equal(f.connects(), 1); assert.equal(records.length, 1); validate(records[0]);
      const acquired = phase !== 'postgres-acquire';
      assert.equal(records[0].phase, phase); assert.equal(records[0].code, 'ECONNRESET'); assert.equal(records[0].outcome, 'failed');
      assert.equal(f.statements.filter(sql => sql === 'ROLLBACK').length, acquired ? 1 : 0);
      assert.deepEqual(f.releases, acquired ? [rollbackFails] : []);
      assert.deepEqual(records[0].rollback, { outcome: acquired ? rollbackFails ? 'failed' : 'completed' : 'not_started', code: acquired && rollbackFails ? 'EPIPE' : null });
      assert.deepEqual(records[0].cleanup.postgres, { outcome: 'failed', code: 'ENOTFOUND' });
      assert.equal(f.statements.filter(sql => sql === 'COMMIT').length, phase === 'postgres-commit' ? 1 : 0);
    }
  }
});

test('successful write/read isolation, timeouts, result and connection release remain unchanged; observation is optional', async () => {
  for (const readOnly of [false, true]) for (const enabled of [false, true]) {
    const f = transactionFixture(null), records: InitializationRecord[] = [];
    const diagnostics = enabled ? initializationDiagnostics(record => { records.push(record); }) : undefined;
    const result = await withMigrationTransaction(f.pool, async client => { await client.query('PRIVATE WORK'); return 42; }, readOnly, diagnostics?.observer);
    diagnostics?.finish(true);
    assert.equal(result, 42); assert.equal(f.connects(), 1); assert.deepEqual(f.releases, [false]);
    assert.deepEqual(f.statements, [readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
      "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'", 'PRIVATE WORK', 'COMMIT']);
    assert.equal(records.length, enabled ? 1 : 0);
    if (enabled) { validate(records[0]); assert.equal(records[0].outcome, 'success'); assert.equal(records[0].code, null); }
  }
});

test('diagnostic projection is bounded, immutable, independent, single-finish and excludes raw errors and getters', () => {
  let now = 100; const records: InitializationRecord[] = [];
  const first = initializationDiagnostics(record => { records.push(record); }, () => now);
  const second = initializationDiagnostics(record => { records.push(record); });
  for (let index = 0; index < 40; index++) { now += 0.5; initializationPhase(first.observer, 'postgres-copy'); }
  initializationFailed(first.observer, { get code() { throw new Error('private getter'); }, message: 'private password' });
  initializationPhase(first.observer, 'postgres-close'); initializationFailed(first.observer, { code: 'EPIPE' });
  initializationRollback(first.observer, 'failed', { code: 'ETIMEDOUT', message: 'private' });
  first.finish(true); first.finish(false); initializationPhase(first.observer, 'arguments'); second.finish(true);
  assert.equal(records.length, 2); records.forEach(validate);
  assert.equal(records[0].phases.length, 32); assert.equal(records[0].omittedPhases, 9); assert.equal(records[0].durationMs, 20);
  assert.equal(records[0].phase, 'postgres-copy'); assert.equal(records[0].code, 'other'); assert.equal(records[0].outcome, 'failed');
  assert.equal(records[1].outcome, 'success'); assert.notEqual(records[0].operationId, records[1].operationId);
});

test('failing observers and synchronous/asynchronous sinks cannot alter transaction outcomes', async () => {
  const hostile: InitializationObserver = {
    phase() { throw new Error('private'); }, failure() { throw new Error('private'); },
    rollback() { throw new Error('private'); }, cleanup() { throw new Error('private'); }
  };
  for (const failure of [null, 'postgres-copy'] as const) {
    const f = transactionFixture(failure);
    const operation = withMigrationTransaction(f.pool, async client => { await client.query('PRIVATE WORK'); return 42; }, false, hostile);
    if (failure) await assert.rejects(operation, error => error === f.error); else assert.equal(await operation, 42);
    initializationCleanup(hostile, 'sqlite', 'failed', new Error('private')); assert.deepEqual(f.releases, [false]);
  }
  for (const sink of [() => { throw new Error('private'); }, async () => { throw new Error('private'); }]) {
    const diagnostics = initializationDiagnostics(sink); diagnostics.finish(true);
  }
  await new Promise(resolve => setImmediate(resolve));
});
