import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Client, Pool } from 'pg';
import { failureCode, markDatabaseFailure, reportRequestFailure, withFailureDiagnostics,
  type DatabasePhase, type FailureRecord, type FailureSink } from '../server/failure-diagnostics.js';
import { PostgresRuntime } from '../server/postgres-runtime.js';
import { CatalogRepository } from '../server/database.js';
import { createApp } from '../server/app.js';
import { fixtureSeed } from './fixture.js';
import type { RequestLogRecord } from '../server/request-log.js';

const token = 'failure-fixture-editor-token-for-test-only-2026';
const requestId = '12345678-1234-4234-8234-123456789abc';
const metadata = { requestId, category: 'catalog', method: 'GET' } as const;
function observed<T>(sink: FailureSink | undefined, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => withFailureDiagnostics(metadata, sink, () => { void work().then(resolve, reject); }));
}
function validate(record: FailureRecord) {
  assert.deepEqual(Object.keys(record).sort(), ['category', 'code', 'engine', 'event', 'method', 'operation', 'phase',
    'requestId', 'rollback', 'rollbackCode', 'status', 'timestamp']);
  assert.match(record.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(record.timestamp, new Date(record.timestamp).toISOString());
  assert.equal(record.event, 'api_failure'); assert(Object.isFrozen(record));
  assert.doesNotMatch(JSON.stringify(record), /private|SELECT|password|cookie|cause|stack/);
}

test('failure codes project known scalars and exact installed-driver messages, never arbitrary error text or getters', () => {
  for (const [error, expected] of [
    [{ code: 'ECONNRESET', message: 'private password SELECT x' }, 'ECONNRESET'],
    [new Error('timeout exceeded when trying to connect'), 'pool_acquire_timeout'],
    [new Error('Connection terminated due to connection timeout'), 'connection_timeout'],
    [new Error('timeout expired'), 'connection_timeout'],
    [new Error('Connection terminated unexpectedly'), 'connection_closed'],
    [{ code: 'private-code', message: 'private timeout expired' }, 'other'],
    [new Error('private-query'), 'other'], [null, 'other'], ['private', 'other'],
    [{ get code() { throw new Error('private getter'); } }, 'other']
  ] as const) assert.equal(failureCode(error), expected);
});

test('default disabled diagnostics do not emit or retain an error tag; observers never change outcomes', async () => {
  const error = new Error('private');
  await observed(undefined, async () => {
    markDatabaseFailure(error, { operation: 'read', phase: 'acquire', rollback: 'not_started', rollbackCode: null });
    reportRequestFailure(error, 500);
  });
  for (const sink of [() => { throw error; }, async () => { throw error; }]) {
    await observed(sink, async () => { reportRequestFailure(error, 503); });
  }
  const records: FailureRecord[] = [];
  await observed(record => { records.push(record); }, async () => { reportRequestFailure(error, 500); reportRequestFailure(error, 503); });
  assert.equal(records.length, 1); assert.equal(records[0].engine, 'application'); validate(records[0]);
});

test('parallel async requests cannot inherit another request error, operation or request ID', async () => {
  const records: FailureRecord[] = []; const error = Object.assign(new Error('private'), { code: '57014' });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const first = observed(record => { records.push(record); }, async () => {
    markDatabaseFailure(error, { operation: 'write', phase: 'commit', rollback: 'failed', rollbackCode: 'ECONNRESET' });
    await gate; reportRequestFailure(error, 500);
  });
  const secondId = '12345678-1234-4234-9234-123456789abc';
  await new Promise<void>((resolve, reject) => withFailureDiagnostics({ ...metadata, requestId: secondId }, record => { records.push(record); }, () => {
    void Promise.resolve().then(() => { reportRequestFailure(error, 503); resolve(); }).catch(reject);
  }));
  release(); await first;
  assert.equal(records[0].requestId, secondId); assert.equal(records[0].engine, 'application');
  assert.equal(records[1].requestId, requestId); assert.equal(records[1].phase, 'commit');
  assert.equal(records[1].rollbackCode, 'ECONNRESET'); records.forEach(validate);
});

// Test-only driver doubles exercise the unchanged transaction lifecycle. The
// real PostgreSQL browser controller separately checks actual driver behavior.
function runtimeFixture(failureAt: DatabasePhase | null, rollbackFails = false) {
  const statements: string[] = []; const releases: Array<boolean | Error | undefined> = [];
  const error = Object.assign(new Error('private SQL password'), { code: 'ECONNRESET' });
  let connects = 0;
  const actualClient = Object.assign(new Client(), { release(value?: boolean | Error) { releases.push(value); } });
  const client = new Proxy(actualClient, { get(target, key, receiver) {
    if (key === 'query') return async (sql: string) => {
      statements.push(sql);
      const phase = sql.startsWith('BEGIN') ? 'begin' : sql.startsWith('SET') ? 'setup'
        : sql.startsWith('SELECT pg_catalog.pg_advisory') ? 'lock' : sql === 'COMMIT' ? 'commit' : 'work';
      if (sql === 'ROLLBACK') { if (rollbackFails) throw Object.assign(new Error('private rollback'), { code: 'EPIPE' }); }
      else if (phase === failureAt) throw error;
      return { rows: [], rowCount: 0 };
    };
    return Reflect.get(target, key, receiver);
  } });
  const pool = new Proxy(new Pool(), { get(target, key, receiver) {
    if (key === 'connect') return async () => { connects++; if (failureAt === 'acquire') throw error; return client; };
    return Reflect.get(target, key, receiver);
  } });
  return { runtime: new PostgresRuntime(pool, 'diagnostic_fixture'), error, statements, releases, connects: () => connects };
}

test('transaction failures preserve the original error and phase, rollback once, release once and never retry writes', async () => {
  for (const phase of ['acquire', 'begin', 'setup', 'lock', 'work', 'commit'] as const) {
    for (const rollbackFails of [false, true]) {
      const f = runtimeFixture(phase, rollbackFails); const records: FailureRecord[] = [];
      await observed(record => { records.push(record); }, async () => {
        await assert.rejects(f.runtime.write(context => context.run('PRIVATE WORK', ['private param'])), error => {
          assert.strictEqual(error, f.error); reportRequestFailure(error, 500); return true;
        });
      });
      assert.equal(f.connects(), 1); assert.equal(records.length, 1); validate(records[0]);
      assert.equal(records[0].operation, 'write'); assert.equal(records[0].phase, phase);
      assert.equal(records[0].code, 'ECONNRESET');
      assert.equal(f.statements.filter(sql => sql === 'ROLLBACK').length, phase === 'acquire' ? 0 : 1);
      assert.deepEqual(f.releases, phase === 'acquire' ? [] : [rollbackFails]);
      assert.equal(records[0].rollback, phase === 'acquire' ? 'not_started' : rollbackFails ? 'failed' : 'completed');
      assert.equal(records[0].rollbackCode, phase !== 'acquire' && rollbackFails ? 'EPIPE' : null);
    }
  }
});

test('successful read/write transaction values, isolation, locks and release are unchanged and emit no failure', async () => {
  for (const write of [false, true]) {
    const f = runtimeFixture(null); const records: FailureRecord[] = [];
    const result = await observed(record => { records.push(record); }, () => write ? f.runtime.write(async () => 42) : f.runtime.read(async () => 42));
    assert.equal(result, 42); assert.equal(records.length, 0); assert.deepEqual(f.releases, [false]);
    assert.equal(f.statements[0], write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(f.statements.some(sql => sql.includes('pg_advisory_xact_lock')), write);
    assert.equal(f.statements.at(-1), 'COMMIT');
  }
});

test('real HTTP 500 and caught public/readiness/education 503 correlate to their own IDs without revealing database detail', async () => {
  const records: FailureRecord[] = []; const requests: RequestLogRecord[] = [];
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  repo.summary = () => { throw Object.assign(new Error('private summary'), { code: 'private' }); };
  repo.publicSnapshot = () => { throw new Error('private snapshot'); };
  const server = createApp(repo, { mode: 'accounts', allowedOrigins: ['http://127.0.0.1'] }, undefined,
    { publicationEnabled: true, requestLog: record => { requests.push(record); }, failureLog: record => { records.push(record); } }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const path of ['/api/ready', '/api/v1/public/catalog', '/api/v1/public/education/bai-he']) {
      const response = await fetch(base + path, { headers: { 'X-Request-ID': 'private caller ID' } });
      assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private/);
      const record = records.at(-1)!; validate(record);
      assert.equal(record.requestId, response.headers.get('x-request-id')); assert.equal(record.requestId, requests.at(-1)?.requestId);
    }
    // The local-key app below reaches an actual generic 500 without session setup.
    assert.equal(records.length, 3);
  } finally { const closed = once(server, 'close'); server.close(); await closed; repo.close(); }
  const catalog = new CatalogRepository(':memory:', fixtureSeed());
  catalog.summary = () => { throw new Error('private summary'); };
  const app = createApp(catalog, token, undefined, { failureLog: record => { records.push(record); } });
  const local = app.listen(0, '127.0.0.1'); await once(local, 'listening');
  const localBase = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${localBase}/api/v1/summary`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private/);
    assert.equal(records.at(-1)?.requestId, response.headers.get('x-request-id')); validate(records.at(-1)!);
    assert.equal(records.length, 4);
    const ordinary = await fetch(`${localBase}/api/v1/summary`); assert.equal(ordinary.status, 401); await ordinary.text();
    assert.equal(records.length, 4);
  } finally { const closed = once(local, 'close'); local.close(); await closed; catalog.close(); }
});
