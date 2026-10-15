import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { PostgresRuntime } from '../server/postgres-runtime.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { createApp } from '../server/app.js';
import type { FailureRecord } from '../server/failure-diagnostics.js';
import type { RequestLogRecord } from '../server/request-log.js';
import { migrationFixture } from './migration-fixture.js';

test('real PostgreSQL statement failure correlates HTTP 500/503 with work/57014/rollback, without changing public data', async () => {
  const connection = process.env.PG_TEST_DATABASE_URL;
  if (!connection || !/^[a-f0-9]{32}$/.test(process.env.PG_TEST_NONCE || '')) throw new Error('Owned real PostgreSQL controller required; no skipped or SQLite fallback');
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection);
  const schema = `failure_${randomUUID().replaceAll('-', '')}`;
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed);
    stores = await openPostgresStore(connection, schema, fixture.seed);
    const before = await stores.catalog.publicSnapshot();
    const snapshot = stores.catalog.publicSnapshot.bind(stores.catalog);
    const runtime = new PostgresRuntime(pool, schema);
    const fail = async () => runtime.read(async context => {
      // Transaction-local timeout solely in this owned test; production limits stay unchanged.
      await context.run("SET LOCAL statement_timeout = '30ms'");
      await context.run('SELECT pg_catalog.pg_sleep(0.2)');
      return before;
    });
    stores.catalog.publicSnapshot = fail;
    const records: FailureRecord[] = []; const requests: RequestLogRecord[] = [];
    server = createApp(stores, { mode: 'local-key', token: 'test-only-diagnostic-editor-token-2026' }, undefined,
      { failureLog: record => { records.push(record); }, requestLog: record => { requests.push(record); } }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Both a deliberately caught 503 and a generic 500 retain the same underlying stage/code.
    for (const [path, status] of [['/api/ready', 503], ['/api/v1/public/catalog', 503], ['/api/v1/summary', 500]] as const) {
      if (status === 500) stores.catalog.summary = async () => { await fail(); throw new Error('unreachable'); };
      const response = await fetch(base + path, { headers: { Authorization: 'Bearer test-only-diagnostic-editor-token-2026' } });
      assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /57014|pg_sleep|password|ROLLBACK/);
      const record = records.at(-1)!;
      assert.equal(record.requestId, response.headers.get('x-request-id')); assert.equal(record.requestId, requests.at(-1)?.requestId);
      assert.equal(record.status, status); assert.equal(record.engine, 'postgres'); assert.equal(record.operation, 'read');
      assert.equal(record.phase, 'work'); assert.equal(record.code, '57014'); assert.equal(record.rollback, 'completed'); assert.equal(record.rollbackCode, null);
    }
    assert.equal(records.length, 3); assert.equal(new Set(records.map(record => record.requestId)).size, 3);
    assert.doesNotMatch(JSON.stringify(records), /pg_sleep|statement_timeout|postgres:\/\/|test-only|password|SELECT|stack|cause/);
    stores.catalog.publicSnapshot = snapshot;
    assert.deepEqual(await stores.catalog.publicSnapshot(), before);
    const ready = await fetch(`${base}/api/ready`); assert.equal(ready.status, 200); await ready.text();
    assert.equal(records.length, 3);
  } finally {
    if (server) { const closed = once(server, 'close'); server.close(); await closed; }
    await stores?.close(); await pool.end(); fixture.dispose();
  }
});
