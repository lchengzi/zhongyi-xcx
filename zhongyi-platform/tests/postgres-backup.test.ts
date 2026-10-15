import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { readFileSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup, writeBackupFile, readBackupFile } from '../server/postgres-backup.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { BASE_TABLE_NAMES, EXCERPT_TABLE_NAMES, identifier, snapshotDigest, validateSnapshot, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { validateSeed } from '../server/seed.js';
import { DEFAULT_ASSISTANT_LIMITS } from '../server/assistant-limits.js';
import { fileDigest, fixturePassword, migrationFixture } from './migration-fixture.js';
import { assertRecoveryData, rehashBackup } from './backup-fixture.js';
import { restartPostgres } from './postgres-control.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('Real isolated PostgreSQL required; use npm run test:postgres.');
const schemaName = () => `recovery_${randomUUID().replaceAll('-', '')}`;
const poolFor = () => createPostgresPool(connection!);
function removeOwnedFile(filename: string) {
  assert(lstatSync(filename).isFile()); assert(!lstatSync(filename).isSymbolicLink()); assert.equal(realpathSync(filename), filename); unlinkSync(filename);
}

test('real PostgreSQL encrypted business recovery preserves all 31 tables/3 sequence high-water marks, then revokes old sessions; HTTP login/read/write works', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const source = schemaName(); const target = schemaName();
  const filename = join(fixture.directory, 'recovery.zfbackup'); let written = false;
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    const sqliteBefore = fileDigest(fixture.filename);
    await migrateSqliteToPostgres(pool, source, fixture.read(), fixture.seed);
    // Back up LIVE PostgreSQL changes, not just replay the original SQLite import.
    const live = await openPostgresStore(connection!, source, fixture.seed);
    try {
      const session = await live.auth.login(fixture.editor.username, fixturePassword, 'before-backup');
      await live.catalog.saveNote('huang-qi', '导入之后在 PostgreSQL 修改的私有备注', 4, fixture.editor.username, { account: session.info.user, token: session.token });
      await live.workflow.saveSource({ title: '导入之后在 PostgreSQL 修订的来源', publisher: '工程测试', url: 'https://example.org/migration-source' }, session.info.user, fixture.sourceId, 2, session.token);
    } finally { await live.close(); }
    const backup = await capturePostgresBackup(pool, source, fixture.seed);
    assert.equal(Object.keys(backup.data.tables).length, 32); assert.equal(backup.data.postgresMigrations.length, 10);
    assert.equal(backup.data.migrationRuns.length, 1); assert(backup.data.tables.sessions.length > 0);
    assert.equal(backup.data.tables.editorial_notes[0].revision, 5);
    assert.equal(backup.data.tables.source_records[0].revision, 3);
    assert(backup.data.tables.audit_events.length > backup.data.migrationRuns[0].row_counts.audit_events);
    const key = randomBytes(32); writeBackupFile(filename, encryptBackup(backup, key)); written = true;
    const report = await restorePostgresBackup(pool, target, decryptBackup(readBackupFile(filename), key, fixture.seed), fixture.seed);
    assert.equal(report.verified, true); assert.equal(report.sessionsRevoked, backup.data.tables.sessions.length);
    assert.equal(report.publicationEnabled, false); assert.notEqual(report.dataDigest, report.restoredDataDigest);
    const restored = await capturePostgresBackup(pool, target, fixture.seed);
    assertRecoveryData(backup, restored); assert.equal(report.publicationFrozen, true); assert.equal(report.publicationFreezeVersion, 1);
    assert.equal(restored.dataDigest, report.restoredDataDigest);
    assert.equal((await capturePostgresBackup(pool, source, fixture.seed)).dataDigest, backup.dataDigest);
    assert.equal(fileDigest(fixture.filename), sqliteBefore);
    const quoted = identifier(target);
    for (const [table, column] of [['source_versions', 'title'], ['content_revisions', 'payload'], ['postgres_migrations', 'checksum'], ['migration_runs', 'source_digest'], ['excerpt_permissions', 'digest']]) {
      for (const sql of [`UPDATE ${quoted}.${table} SET ${column} = 'changed'`, `DELETE FROM ${quoted}.${table}`, `TRUNCATE ${quoted}.${table} CASCADE`]) await assert.rejects(pool.query(sql), (e: any) => e.code === '23514');
    }
    stores = await openPostgresStore(connection!, target, fixture.seed);
    assert.equal(await stores.auth.session(fixture.token), undefined);
    assert.equal((await stores.assistant.quota(fixture.admin.id, DEFAULT_ASSISTANT_LIMITS)).usedByActor, 1);
    const origin = 'https://recovery.example.test';
    server = createApp(stores, { mode: 'accounts', allowedOrigins: [origin] }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    assert.equal((await fetch(`${url}/summary`, { headers: { Cookie: `food_session=${fixture.token}` } })).status, 401);
    const login = await fetch(`${url}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fixture.editor.username, password: fixturePassword }) });
    assert.equal(login.status, 200); const info = await login.json(); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': info.csrfToken };
    assert.equal((await fetch(`${url}/ingredients/huang-qi`, { headers })).status, 200);
    const saved = await fetch(`${url}/ingredients/huang-qi/note`, { method: 'PUT', headers, body: JSON.stringify({ text: '恢复后真实 HTTP 写入 🌿', expectedRevision: 5 }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await pool.query(`SELECT text FROM ${quoted}.editorial_notes WHERE ingredient_id = 'huang-qi'`)).rows[0].text, '恢复后真实 HTTP 写入 🌿');
    assert.equal((await pool.query(`SELECT MAX(id) AS id FROM ${quoted}.audit_events`)).rows[0].id, backup.data.sequences.audit_events + 1);
    assert.equal((await pool.query(`SELECT MAX(id) AS id FROM ${quoted}.security_events`)).rows[0].id, backup.data.sequences.security_events + 1);
    const revisedSource = await fetch(`${url}/editorial/sources/${fixture.sourceId}`, { method: 'PUT', headers, body: JSON.stringify({ source: { title: '恢复后修订来源', publisher: '工程测试', url: 'https://example.org/migration-source' }, expectedRevision: 3 }) });
    assert.equal(revisedSource.status, 200, await revisedSource.clone().text());
    assert.equal((await pool.query(`SELECT MAX(id) AS id FROM ${quoted}.workflow_events`)).rows[0].id, backup.data.sequences.workflow_events + 1);
    const publicText = await (await fetch(`${url}/public/catalog`)).text();
    for (const secret of ['恢复后真实 HTTP 写入', '私有测试草稿', 'migration-editor', 'password_hash']) assert.equal(publicText.includes(secret), false);
  } finally {
    if (server) { const closed = once(server, 'close'); server.close(); await closed; }
    await stores?.close(); await pool.end(); if (written) removeOwnedFile(filename); fixture.dispose();
  }
});

test('real PostgreSQL backup waits for the cooperative writer BEFORE the snapshot and releases maintenance locks', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const schema = schemaName(); const writer = await pool.connect();
  let outcome: Promise<any> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed);
    await writer.query('BEGIN'); await writer.query('SELECT pg_advisory_xact_lock(61038, hashtext($1))', [schema]);
    await writer.query(`UPDATE ${identifier(schema)}.editorial_notes SET text = '写锁提交后的备注', revision = 5 WHERE ingredient_id = 'huang-qi'`);
    const next = (await writer.query(`INSERT INTO ${identifier(schema)}.audit_events (ingredient_id, action, revision, created_at, actor) VALUES ('huang-qi','note_saved',5,$1,'test') RETURNING id`, [new Date().toISOString()])).rows[0].id;
    outcome = capturePostgresBackup(pool, schema, fixture.seed).then((backup) => ({ backup }), (error) => ({ error }));
    let queued = false;
    for (let attempt = 0; attempt < 80 && !queued; attempt++) {
      queued = (await pool.query("SELECT COUNT(*) AS count FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE 'SELECT pg_catalog.pg_advisory_lock(61038,%'")).rows[0].count > 0;
      if (!queued) await new Promise((done) => setTimeout(done, 25));
    }
    assert(queued, 'Observe actual blocked backup connection, not a timer assumption.');
    await writer.query('COMMIT'); const result = await outcome; assert.equal(result.error, undefined);
    assert.equal(result.backup.data.tables.editorial_notes[0].text, '写锁提交后的备注'); assert.equal(result.backup.data.sequences.audit_events, next);
    await writer.query('BEGIN'); assert.equal((await writer.query('SELECT pg_try_advisory_xact_lock(61037, hashtext($1)) AS locked', [schema])).rows[0].locked, true); await writer.query('ROLLBACK');
    await pool.query(`CREATE TABLE ${identifier(schema)}.unknown_test_table (value text)`);
    await assert.rejects(capturePostgresBackup(pool, schema, fixture.seed), (e: any) => e.code === 'unsupported_backup_schema');
    await writer.query('BEGIN');
    for (const lock of [61037, 61038]) assert.equal((await writer.query('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked', [lock, schema])).rows[0].locked, true);
    await writer.query('ROLLBACK');
  } finally { await writer.query('ROLLBACK').catch(() => {}); await outcome; writer.release(); await pool.end(); fixture.dispose(); }
});

test('real PostgreSQL recovery refuses existing targets, serializes competing restores and rolls back a mid-copy constraint failure', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const source = schemaName(); const target = schemaName(); const broken = schemaName();
  try {
    await migrateSqliteToPostgres(pool, source, fixture.read(), fixture.seed); const backup = await capturePostgresBackup(pool, source, fixture.seed);
    await assert.rejects(restorePostgresBackup(pool, source, backup, fixture.seed), (e: any) => e.code === 'target_exists');
    const results = await Promise.allSettled([restorePostgresBackup(pool, target, backup, fixture.seed), restorePostgresBackup(pool, target, backup, fixture.seed)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'target_exists');
    const bad = structuredClone(backup); bad.data.tables.editorial_notes[0].ingredient_id = 'missing-ingredient'; rehashBackup(bad);
    await assert.rejects(restorePostgresBackup(pool, broken, bad, fixture.seed), (e: any) => e.code === '23503');
    assert.equal((await pool.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [broken])).rowCount, 0);
    assert.equal((await capturePostgresBackup(pool, source, fixture.seed)).dataDigest, backup.dataDigest);
    const restored = await capturePostgresBackup(pool, target, fixture.seed); assertRecoveryData(backup, restored);
    assert.equal(restored.dataDigest, (results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value.restoredDataDigest);
  } finally { await pool.end(); fixture.dispose(); }
});

test('real PostgreSQL recovery retains historical SQLite v3/v4 journals and import digests without inventing migrations', async () => {
  const fixture = await migrationFixture(); const pool = poolFor();
  try {
    const original = fixture.read();
    for (const version of [3, 4] as const) {
      const names = version === 3 ? BASE_TABLE_NAMES : EXCERPT_TABLE_NAMES;
      const tables = Object.fromEntries(names.map((name) => [name, name === 'migrations' ? original.tables[name].filter((row) => Number(row.version) <= version) : original.tables[name]])) as MigrationSnapshot['tables'];
      const payload = { schemaVersion: version === 3 ? 1 as const : 2 as const, sourceSchemaVersion: version, seedDigest: original.seedDigest, tables, sequences: original.sequences };
      const snapshot = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, fixture.seed);
      const source = schemaName(); const target = schemaName(); await migrateSqliteToPostgres(pool, source, snapshot, fixture.seed);
      // This is a current PG v8 schema whose historical SQLite journal is older.
      const backup = await capturePostgresBackup(pool, source, fixture.seed); await restorePostgresBackup(pool, target, backup, fixture.seed);
      const restored = await capturePostgresBackup(pool, target, fixture.seed);
      assert.equal(restored.data.sqliteSchemaVersion, version); assert.equal(Object.keys(restored.data.tables).length, 32);
      assert.deepEqual(restored.data.tables.migrations, snapshot.tables.migrations);
      assert.deepEqual(restored.data.migrationRuns, backup.data.migrationRuns);
      assert.equal(restored.data.migrationRuns[0].source_digest, snapshot.digest);
      assert.equal(Object.keys(restored.data.migrationRuns[0].row_counts).length, names.length);
      assert.deepEqual(restored.data.postgresMigrations, backup.data.postgresMigrations);
    }
  } finally { await pool.end(); fixture.dispose(); }
});

test('real PostgreSQL backup refuses an unknown column rather than silently omitting its data', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const schema = schemaName();
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed);
    await pool.query(`ALTER TABLE ${identifier(schema)}.editorial_notes ADD COLUMN unknown_private_field TEXT`);
    await pool.query(`UPDATE ${identifier(schema)}.editorial_notes SET unknown_private_field = 'must-not-be-silently-lost'`);
    await assert.rejects(capturePostgresBackup(pool, schema, fixture.seed), (e: any) => e.code === 'unsupported_backup_schema');
    assert.equal((await pool.query(`SELECT unknown_private_field FROM ${identifier(schema)}.editorial_notes`)).rows[0].unknown_private_field, 'must-not-be-silently-lost');
  } finally { await pool.end(); fixture.dispose(); }
});

async function cli(args: string[], key: string, compiled = false) {
  const child = spawn(process.execPath, [...(compiled ? ['build/tools/backup-postgres.js'] : ['--import', 'tsx', 'tools/backup-postgres.ts']), ...args], {
    windowsHide: true, env: { ...process.env, DATABASE_URL: connection, BACKUP_ENCRYPTION_KEY: key }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (bytes) => { stdout += bytes; }); child.stderr.on('data', (bytes) => { stderr += bytes; });
  const [code] = await once(child, 'close'); return { code, stdout, stderr };
}

test('real backup/restore CLI and compiled entry use explicit encrypted files and emit safe reports, never credentials/private rows', async () => {
  const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const fixture = await migrationFixture(seed); const pool = poolFor(); const schema = schemaName(); const target = schemaName(); const badTarget = schemaName();
  const filename = join(fixture.directory, 'cli.zfbackup'); let written = false; const key = randomBytes(32).toString('base64');
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), seed);
    const saved = await cli(['--schema', schema, '--output', filename], key); written = saved.code === 0; assert.equal(saved.code, 0, saved.stderr);
    assert.equal(JSON.parse(saved.stdout).recoveryVerified, false); assert.equal(JSON.parse(saved.stdout).businessTables, 32);
    const originalBytes = readBackupFile(filename);
    const restored = await cli(['--restore', '--input', filename, '--schema', target], key, true); assert.equal(restored.code, 0, restored.stderr);
    assert.equal(JSON.parse(restored.stdout).verified, true); assert.equal(JSON.parse(restored.stdout).sessionsRevoked, 1);
    const existing = await cli(['--schema', schema, '--output', filename], key); assert.equal(existing.code, 1); assert.deepEqual(readBackupFile(filename), originalBytes);
    const wrong = await cli(['--restore', '--input', filename, '--schema', badTarget], randomBytes(32).toString('base64')); assert.equal(wrong.code, 1); assert.match(wrong.stderr, /backup_authentication_failed/);
    const noArgs = await cli([], key); assert.equal(noArgs.code, 1); assert.match(noArgs.stderr, /invalid_arguments/);
    const badArgs = await cli(['--schema', schema, '--output', filename, '--key', 'not-allowed'], key); assert.equal(badArgs.code, 1);
    assert.equal((await pool.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [badTarget])).rowCount, 0);
    for (const result of [saved, restored, existing, wrong, noArgs, badArgs]) for (const secret of [key, connection!, fixturePassword, fixture.token, '第四版私有备注', '私有测试草稿']) assert.equal((result.stdout + result.stderr).includes(secret), false);
  } finally { await pool.end(); if (written) removeOwnedFile(filename); fixture.dispose(); }
});

test('recovered PostgreSQL data, permission epochs and quota reservations survive a complete server restart with old logins still rejected', async () => {
  const fixture = await migrationFixture(); const source = schemaName(); const target = schemaName(); let pool: ReturnType<typeof poolFor> | undefined = poolFor();
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  try {
    await migrateSqliteToPostgres(pool, source, fixture.read(), fixture.seed); const backup = await capturePostgresBackup(pool, source, fixture.seed);
    const report = await restorePostgresBackup(pool, target, backup, fixture.seed);
    await pool.end(); pool = undefined; await restartPostgres(); pool = poolFor();
    assert.equal((await capturePostgresBackup(pool, target, fixture.seed)).dataDigest, report.restoredDataDigest);
    stores = await openPostgresStore(connection!, target, fixture.seed);
    assert.equal(await stores.auth.session(fixture.token), undefined);
    const login = await stores.auth.login(fixture.admin.username, fixturePassword, 'restart-fixture'); assert.equal(login.info.user.id, fixture.admin.id);
    assert.equal((await stores.catalog.note('huang-qi')).text, '第四版私有备注 🌿');
    assert.equal((await stores.assistant.quota(fixture.admin.id, DEFAULT_ASSISTANT_LIMITS)).usedByActor, 1);
    assert.deepEqual((await capturePostgresBackup(pool, target, fixture.seed)).data.tables.excerpt_permissions, backup.data.tables.excerpt_permissions);
  } finally { await stores?.close(); await pool?.end(); fixture.dispose(); }
});
