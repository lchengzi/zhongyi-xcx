import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { createPostgresPool, insertTables, migrateSqliteToPostgres, verifyImportedPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { CONTROL_TABLE_NAMES, identifier, rowCounts, snapshotDigest, validateSnapshot, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { migrationFixture, fixturePassword } from './migration-fixture.js';
import { addProfessionalFixture, credentialInput } from './professional-fixture.js';
import { restartPostgres } from './postgres-control.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('Owned real PostgreSQL fixture required');
const schemaName = () => `professional_${randomUUID().replaceAll('-', '')}`;

test('real PostgreSQL professional HTTP decisions serialize across pools, preserve private publication boundary and recheck queued credential revocation', async () => {
  const fixture = await migrationFixture(undefined, false); const pool = createPostgresPool(connection!); const schema = schemaName();
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined; let two: typeof one; let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); one = await openPostgresStore(connection!, schema, fixture.seed); two = await openPostgresStore(connection!, schema, fixture.seed);
    const pro = await addProfessionalFixture(one, fixture.admin); const before = await one.catalog.publicSnapshot();
    const origin = 'https://professional-pg.example.test'; server = createApp(one, { mode: 'accounts', allowedOrigins: [origin] }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const login = await fetch(`${root}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: pro.physician.username, password: fixturePassword }) }); assert.equal(login.status, 200);
    const info = await login.json(); const headers = { Origin: origin, Cookie: login.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': info.csrfToken, 'Content-Type': 'application/json' };
    const input = await pro.input('tcm_physician');
    const parallel = await Promise.all([fetch(`${root}/editorial/professional/huang-qi`, { method: 'POST', headers, body: JSON.stringify(input) }), two.workflow.recordProfessionalReview('huang-qi', input, pro.physician).then(() => 200).catch((error) => error.status)]);
    assert.deepEqual([typeof parallel[0] === 'number' ? parallel[0] : parallel[0].status, parallel[1]].sort(), [200, 409]);
    await two.workflow.recordProfessionalReview('huang-qi', await pro.input('pharmacist'), pro.pharmacist);
    const detail = await one.workflow.professionalDetail('huang-qi'); assert.equal(detail.reviewVersion, 2); assert.equal(detail.state, 'recorded'); assert.equal(detail.publicationEnabled, false);
    assert.deepEqual(await two.catalog.publicSnapshot(), before);
    const client = await pool.connect(); await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(61038, hashtext($1))', [schema]);
    try {
      // Queue revocation BEFORE the second request, then release one owned lock.
      const revoke = one.workflow.saveQualification(pro.pharmacist.id, { ...credentialInput('pharmacist'), status: 'revoked' }, 1, fixture.admin);
      await new Promise((done) => setTimeout(done, 100));
      const attempted = two.workflow.recordProfessionalReview('huang-qi', { ...(await pro.input('pharmacist')), decision: 'return' }, pro.pharmacist).then(() => 'unexpected-success', (error) => error.code);
      await client.query('COMMIT'); await revoke; assert.equal(await attempted, 'qualification_required');
    } finally { await client.query('ROLLBACK'); client.release(); }
    for (const table of ['professional_qualifications', 'professional_reviews']) for (const sql of [`UPDATE ${identifier(schema)}.${table} SET comment = 'tampered'`, `DELETE FROM ${identifier(schema)}.${table}`, `TRUNCATE ${identifier(schema)}.${table} CASCADE`]) {
      await assert.rejects(pool.query(sql), (error: any) => error.code === '23514');
    }
  } finally { if (server) await new Promise<void>((done) => server!.close(() => done())); await one?.close(); await two?.close(); await pool.end(); fixture.dispose(); }
});

test('populated professional credentials and opinions survive encrypted PostgreSQL recovery and a real database restart without reviving old sessions', async () => {
  const fixture = await migrationFixture(undefined, false); const schema = schemaName(); const target = schemaName(); let pool: ReturnType<typeof createPostgresPool> | undefined = createPostgresPool(connection!);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); stores = await openPostgresStore(connection!, schema, fixture.seed);
    const pro = await addProfessionalFixture(stores, fixture.admin); await stores.workflow.recordProfessionalReview('huang-qi', await pro.input('tcm_physician'), pro.physician);
    await stores.workflow.recordProfessionalReview('huang-qi', await pro.input('pharmacist'), pro.pharmacist);
    const before = await stores.workflow.professionalDetail('huang-qi'); const credential = await stores.workflow.qualificationHistory(pro.physician.id);
    await stores.close(); stores = undefined;
    const backup = await capturePostgresBackup(pool, schema, fixture.seed); assert.equal(backup.data.tables.professional_qualifications.length, 2); assert.equal(backup.data.tables.professional_reviews.length, 2);
    const key = randomBytes(32); const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, fixture.seed), fixture.seed); assert.equal(report.businessTables, 32);
    await pool.end(); pool = undefined; await restartPostgres(); pool = createPostgresPool(connection!);
    stores = await openPostgresStore(connection!, target, fixture.seed); assert.deepEqual(await stores.workflow.professionalDetail('huang-qi'), before);
    assert.deepEqual(await stores.workflow.qualificationHistory(pro.physician.id), credential); assert.equal(await stores.auth.session(fixture.token), undefined);
    assert.equal((await capturePostgresBackup(pool, target, fixture.seed)).dataDigest, report.restoredDataDigest);
  } finally { await stores?.close(); await pool?.end(); fixture.dispose(); }
});

test('historical PostgreSQL v3 backup restores exactly as v3, then explicitly upgrades to v10 without manufacturing historical import rows', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName(); const target = schemaName();
  try {
    const current = fixture.read(); const tables = Object.fromEntries(CONTROL_TABLE_NAMES.map((name) => [name, name === 'migrations' ? current.tables[name].filter((row) => Number(row.version) <= 5) : current.tables[name]])) as MigrationSnapshot['tables'];
    const payload = { schemaVersion: 3 as const, sourceSchemaVersion: 5 as const, seedDigest: current.seedDigest, tables, sequences: current.sequences };
    const snapshot = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, fixture.seed); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}; SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 3)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, schema, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, 5, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, schema, fixture.seed); assert.equal(Object.keys(backup.data.tables).length, 21); assert.equal(backup.data.postgresMigrations.length, 3);
    await restorePostgresBackup(pool, target, backup, fixture.seed); const restored = await capturePostgresBackup(pool, target, fixture.seed);
    assert.deepEqual(restored.data, { ...backup.data, tables: { ...backup.data.tables, sessions: [] } });
    await assert.rejects(openPostgresStore(connection!, target, fixture.seed), (error: any) => error.code === 'schema_changed');
    await upgradePostgres(pool, target); const upgraded = await capturePostgresBackup(pool, target, fixture.seed);
    assert.equal(upgraded.data.postgresMigrations.length, 10); assert.equal(upgraded.data.sqliteSchemaVersion, 5); assert.deepEqual(upgraded.data.migrationRuns, backup.data.migrationRuns);
    assert.equal(Object.keys(upgraded.data.tables).length, 32); assert.deepEqual(upgraded.data.tables.professional_reviews, []);
    const original = await verifyImportedPostgres(pool, schema, fixture.seed); assert.equal(original.sourceDigest, snapshot.digest);
  } finally { await pool.end(); fixture.dispose(); }
});
