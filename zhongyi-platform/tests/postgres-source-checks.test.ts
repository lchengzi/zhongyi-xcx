import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { createPostgresPool, insertTables, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { PROFESSIONAL_TABLE_NAMES, identifier, rowCounts, snapshotDigest, validateSnapshot, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { fixturePassword, migrationFixture } from './migration-fixture.js';
import { sourceCheckInput } from './source-check-fixture.js';
import { restartPostgres } from './postgres-control.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('Owned real PostgreSQL fixture required');
const schemaName = () => `source_check_${randomUUID().replaceAll('-', '')}`;

test('real PostgreSQL source-check HTTP and cross-pool writes enforce independent current authority, pinned scope and immutable history without public changes', async () => {
  const fixture = await migrationFixture(undefined, false); const pool = createPostgresPool(connection!); const schema = schemaName();
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined; let two: typeof one; let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); one = await openPostgresStore(connection!, schema, fixture.seed); two = await openPostgresStore(connection!, schema, fixture.seed);
    const source = (await one.workflow.draft('huang-qi'))!.sources[0]; const before = await one.catalog.publicSnapshot(); const content = await one.workflow.draft('huang-qi');
    const origin = 'https://source-check-pg.example.test'; server = createApp(one, { mode: 'accounts', allowedOrigins: [origin] }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const login = await fetch(`${root}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fixture.reviewer.username, password: fixturePassword }) }); assert.equal(login.status, 200);
    const info = await login.json(); const headers = { Origin: origin, Cookie: login.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': info.csrfToken, 'Content-Type': 'application/json' };
    const input = sourceCheckInput(source);
    const [http, direct] = await Promise.all([fetch(`${root}/editorial/source-checks/${source.id}`, { method: 'POST', headers, body: JSON.stringify({ check: input, expectedVersion: 0 }) }), two.workflow.saveSourceCheck(source.id, input, 0, fixture.admin).then(() => 201, (e) => e.status)]);
    assert.deepEqual([http.status, direct].sort(), [201, 409]);
    const preflight = await (await fetch(`${root}/editorial/publication-preflight/huang-qi`, { headers })).json(); assert.equal(preflight.readyForReleaseApproval, false); assert.equal(preflight.publicationEnabled, false); assert(preflight.sources[0].reasons.includes('source_check_test_fixture'));
    assert.deepEqual(await two.catalog.publicSnapshot(), before); assert.deepEqual(await one.workflow.draft('huang-qi'), content);
    const target = identifier(schema);
    for (const sql of [`UPDATE ${target}.source_checks SET comment='tampered'`, `DELETE FROM ${target}.source_checks`, `TRUNCATE ${target}.source_checks CASCADE`]) await assert.rejects(pool.query(sql), (e: any) => e.code === '23514');
    const client = await pool.connect(); await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(61038, hashtext($1))', [schema]);
    try {
      // Queue an account withdrawal first; the later source-check writer must
      // re-read authority after acquiring that SAME schema's write lock.
      const disable = one.auth.updateUser(fixture.reviewer.id, 'reviewer', false, 1, fixture.admin.username, fixture.token);
      await new Promise((done) => setTimeout(done, 100));
      const attempted = two.workflow.saveSourceCheck(source.id, input, 1, fixture.reviewer).then(() => 'unexpected-success', (e) => e.code);
      await client.query('COMMIT'); await disable; assert.equal(await attempted, 'forbidden');
    } finally { await client.query('ROLLBACK'); client.release(); }
  } finally { if (server) await new Promise<void>((done) => server!.close(() => done())); await one?.close(); await two?.close(); await pool.end(); fixture.dispose(); }
});

test('populated source checks survive encrypted recovery and complete PostgreSQL restart while content snapshots remain byte-identical and sessions stay revoked', async () => {
  const fixture = await migrationFixture(undefined, false); const schema = schemaName(); const target = schemaName(); let pool: ReturnType<typeof createPostgresPool> | undefined = createPostgresPool(connection!);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); stores = await openPostgresStore(connection!, schema, fixture.seed);
    const source = (await stores.workflow.draft('huang-qi'))!.sources[0]; const detail = await stores.workflow.saveSourceCheck(source.id, sourceCheckInput(source), 0, fixture.reviewer); const draft = await stores.workflow.draft('huang-qi');
    await stores.close(); stores = undefined;
    const backup = await capturePostgresBackup(pool, schema, fixture.seed); assert.equal(backup.data.tables.source_checks.length, 1);
    const key = randomBytes(32); const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, fixture.seed), fixture.seed);
    assert.equal(report.businessTables, 32); await pool.end(); pool = undefined; await restartPostgres(); pool = createPostgresPool(connection!);
    stores = await openPostgresStore(connection!, target, fixture.seed); assert.deepEqual(await stores.workflow.sourceCheck(source.id, 1), detail); assert.deepEqual(await stores.workflow.draft('huang-qi'), draft);
    assert.equal(await stores.auth.session(fixture.token), undefined); assert.equal((await capturePostgresBackup(pool, target, fixture.seed)).dataDigest, report.restoredDataDigest);
  } finally { await stores?.close(); await pool?.end(); fixture.dispose(); }
});

test('old PostgreSQL v4 business backup restores exactly at v4 then explicitly upgrades to v8 with empty source checks and unchanged historical import digest', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName(); const target = schemaName();
  try {
    const current = fixture.read(); const tables = Object.fromEntries(PROFESSIONAL_TABLE_NAMES.map((name) => [name, name === 'migrations' ? current.tables[name].filter((row) => Number(row.version) <= 6) : current.tables[name]])) as MigrationSnapshot['tables'];
    const payload = { schemaVersion: 4 as const, sourceSchemaVersion: 6 as const, seedDigest: current.seedDigest, tables, sequences: current.sequences };
    const snapshot = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, fixture.seed); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}; SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 4)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, schema, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, 6, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]); await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, schema, fixture.seed); assert.equal(backup.data.postgresMigrations.length, 4); assert.equal(Object.keys(backup.data.tables).length, 23);
    await restorePostgresBackup(pool, target, backup, fixture.seed); const restored = await capturePostgresBackup(pool, target, fixture.seed); assert.deepEqual(restored.data, { ...backup.data, tables: { ...backup.data.tables, sessions: [] } });
    await assert.rejects(openPostgresStore(connection!, target, fixture.seed), (e: any) => e.code === 'schema_changed'); await upgradePostgres(pool, target);
    const upgraded = await capturePostgresBackup(pool, target, fixture.seed); assert.equal(upgraded.data.postgresMigrations.length, 10); assert.equal(upgraded.data.sqliteSchemaVersion, 6);
    assert.deepEqual(upgraded.data.migrationRuns, backup.data.migrationRuns); assert.deepEqual(upgraded.data.tables.source_checks, []);
    for (const name of PROFESSIONAL_TABLE_NAMES) assert.deepEqual(upgraded.data.tables[name], restored.data.tables[name]);
  } finally { await pool.end(); fixture.dispose(); }
});
