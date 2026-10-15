import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createPostgresPool, migrateSqliteToPostgres, verifyImportedPostgres } from '../server/postgres-migration.js';
import { identifier, MigrationError, snapshotDigest, TABLE_NAMES } from '../server/migration-snapshot.js';
import { validateSeed } from '../server/seed.js';
import { tokenHash } from '../server/auth.js';
import { migrationFixture, fixturePassword, fileDigest } from './migration-fixture.js';
import { restartPostgres } from './postgres-control.js';

const databaseUrl = process.env.PG_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Use npm run test:postgres: a real isolated PostgreSQL server is required, not an optional skipped test.');
const schemaName = () => `pgtest_${randomUUID().replaceAll('-', '')}`;
const poolFor = () => createPostgresPool(databaseUrl);

test('real PostgreSQL preserves all rows, hashed credentials, sessions, pinned revisions and private review decisions', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const schema = schemaName();
  try {
    const before = fileDigest(fixture.filename); const snapshot = fixture.read();
    const report = await migrateSqliteToPostgres(pool, schema, snapshot, fixture.seed);
    assert.equal(report.verified, true); assert.equal(report.publicationEnabled, false); assert.equal(Object.keys(report.rowCounts).length, 32);
    assert.deepEqual(await verifyImportedPostgres(pool, schema, fixture.seed), report); assert.equal(fileDigest(fixture.filename), before);
    const account = (await pool.query(`SELECT * FROM ${identifier(schema)}.users WHERE id = $1`, [fixture.admin.id])).rows[0];
    const derived = scryptSync(fixturePassword, account.password_salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
    assert.equal(timingSafeEqual(derived, Buffer.from(account.password_hash, 'hex')), true);
    const session = (await pool.query(`SELECT * FROM ${identifier(schema)}.sessions WHERE token_hash = $1`, [tokenHash(fixture.token)])).rows[0];
    assert.equal(session.user_id, fixture.admin.id); assert.equal(typeof session.expires_at, 'number'); assert(session.expires_at > Date.now());
    assert.equal((await pool.query(`SELECT text FROM ${identifier(schema)}.editorial_notes`)).rows[0].text, '第四版私有备注 🌿');
    const pinned = (await pool.query(`SELECT source_revision FROM ${identifier(schema)}.revision_sources WHERE ingredient_id = 'huang-qi' AND content_revision = 2`)).rows;
    assert.equal(pinned.length, 1); assert.equal(pinned[0].source_revision, 1);
    assert.equal((await pool.query(`SELECT revision FROM ${identifier(schema)}.source_records WHERE id = $1`, [fixture.sourceId])).rows[0].revision, 2);
  } finally { await pool.end(); fixture.dispose(); }
});

test('PostgreSQL enforces immutable update/delete/truncate, FK, roles and one pending task', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const schema = schemaName(); const target = identifier(schema);
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed);
    for (const table of ['source_versions', 'content_revisions', 'revision_sources', 'postgres_migrations', 'migration_runs']) {
      const column = ({ source_versions: 'title', content_revisions: 'payload', revision_sources: 'locator', postgres_migrations: 'checksum', migration_runs: 'source_digest' } as Record<string, string>)[table];
      for (const sql of [`UPDATE ${target}.${table} SET ${column} = 'changed'`, `DELETE FROM ${target}.${table}`, `TRUNCATE ${target}.${table} CASCADE`]) {
        await assert.rejects(pool.query(sql), (error: any) => error.code === '23514');
      }
    }
    await assert.rejects(pool.query(`UPDATE ${target}.users SET role = 'doctor'`), (error: any) => error.code === '23514');
    await assert.rejects(pool.query(`INSERT INTO ${target}.editorial_notes VALUES ('unknown', 'x', 1, 'date')`), (error: any) => error.code === '23503');
    await assert.rejects(pool.query(`INSERT INTO ${target}.review_tasks SELECT $1, ingredient_id, content_revision, digest, status, submitted_by_id, submitted_by_name, submitted_at, reviewed_by_id, reviewed_by_name, reviewed_at, comment FROM ${target}.review_tasks WHERE status = 'pending'`, [randomUUID()]), (error: any) => error.code === '23505');
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`INSERT INTO ${target}.source_records VALUES ('orphan', 99, 'https://example.org/orphan')`);
      await assert.rejects(client.query('COMMIT'), (error: any) => error.code === '23503'); await client.query('ROLLBACK');
    } finally { client.release(); }
    assert.equal((await pool.query(`SELECT * FROM ${target}.source_records WHERE id = 'orphan'`)).rowCount, 0);
    assert.equal((await verifyImportedPostgres(pool, schema, fixture.seed)).verified, true);
  } finally { await pool.end(); fixture.dispose(); }
});

test('a mid-copy constraint failure rolls back the entire new namespace, preserving source and other targets', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const good = schemaName(); const bad = schemaName();
  try {
    const original = fixture.read(); const before = fileDigest(fixture.filename);
    const report = await migrateSqliteToPostgres(pool, good, original, fixture.seed);
    const corrupted = JSON.parse(JSON.stringify(original)); corrupted.tables.editorial_notes[0].ingredient_id = 'unknown-ingredient';
    const { digest: _old, ...payload } = corrupted; corrupted.digest = snapshotDigest(payload);
    await assert.rejects(migrateSqliteToPostgres(pool, bad, corrupted, fixture.seed), (error: any) => error.code === '23503');
    assert.equal((await pool.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [bad])).rowCount, 0);
    assert.deepEqual(await verifyImportedPostgres(pool, good, fixture.seed), report); assert.equal(fileDigest(fixture.filename), before);
  } finally { await pool.end(); fixture.dispose(); }
});

test('an existing target is never overwritten; competing migrations leave exactly one verified result', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const schema = schemaName();
  try {
    const snapshot = fixture.read();
    const results = await Promise.allSettled([migrateSqliteToPostgres(pool, schema, snapshot, fixture.seed), migrateSqliteToPostgres(pool, schema, snapshot, fixture.seed)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejection.reason instanceof MigrationError, true); assert.equal(rejection.reason.code, 'target_exists');
    const report = await verifyImportedPostgres(pool, schema, fixture.seed);
    await assert.rejects(migrateSqliteToPostgres(pool, schema, snapshot, fixture.seed), (error: any) => error.code === 'target_exists');
    assert.deepEqual(await verifyImportedPostgres(pool, schema, fixture.seed), report);
  } finally { await pool.end(); fixture.dispose(); }
});

test('all event sequences retain high-water marks and issue new nonconflicting IDs; BIGINT is never rounded', async () => {
  const fixture = await migrationFixture(); const pool = poolFor(); const schema = schemaName(); const target = identifier(schema);
  try {
    const snapshot = fixture.read(); await migrateSqliteToPostgres(pool, schema, snapshot, fixture.seed);
    const queries = {
      audit_events: { sql: `INSERT INTO ${target}.audit_events (ingredient_id, action, revision, created_at, actor) VALUES ('huang-qi','note_saved',5,$1,'test') RETURNING id`, args: [new Date().toISOString()] },
      security_events: { sql: `INSERT INTO ${target}.security_events (actor, action, target, created_at) VALUES ('test','logout',NULL,$1) RETURNING id`, args: [new Date().toISOString()] },
      workflow_events: { sql: `INSERT INTO ${target}.workflow_events (ingredient_id, source_id, revision, action, actor_id, actor_name, created_at) VALUES ('huang-qi',NULL,2,'draft_saved',$1,$2,$3) RETURNING id`, args: [fixture.editor.id, fixture.editor.username, new Date().toISOString()] }
    };
    for (const name of Object.keys(queries) as (keyof typeof queries)[]) {
      const query = queries[name]; assert.equal((await pool.query(query.sql, query.args)).rows[0].id, snapshot.sequences[name] + 1);
    }
    assert.equal((await pool.query('SELECT 1790000000000::bigint AS expiry')).rows[0].expiry, 1790000000000);
    await assert.rejects(pool.query('SELECT 9007199254740993::bigint AS unsafe'), (error: any) => error.code === 'unsafe_integer');
  } finally { await pool.end(); fixture.dispose(); }
});

test('actual 106-row migration survives a complete PostgreSQL server stop/restart and pool reconstruction', async () => {
  const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const fixture = await migrationFixture(seed); const schema = schemaName(); let pool: ReturnType<typeof poolFor> | null = poolFor();
  try {
    const snapshot = fixture.read(); assert.equal(snapshot.tables.ingredients.length, 106);
    const report = await migrateSqliteToPostgres(pool, schema, snapshot, seed);
    const oldPool = pool; pool = null; await oldPool.end(); await restartPostgres(); pool = poolFor();
    assert.deepEqual(await verifyImportedPostgres(pool, schema, seed), report);
    assert.equal((await pool.query(`SELECT COUNT(*) AS count FROM ${identifier(schema)}.ingredients`)).rows[0].count, 106);
    assert.equal(Object.keys(report.rowCounts).length, TABLE_NAMES.length);
  } finally { await pool?.end(); fixture.dispose(); }
});

async function cli(args: string[], compiled = false) {
  const child = spawn(process.execPath, [...(compiled ? ['build/tools/migrate-postgres.js'] : ['--import', 'tsx', 'tools/migrate-postgres.ts']), ...args], {
    windowsHide: true, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close'); return { code, stdout, stderr };
}

test('migration CLI performs real full import/verification and reports safe errors without printing credentials or private rows', async () => {
  const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const fixture = await migrationFixture(seed); const schema = schemaName();
  try {
    const before = fileDigest(fixture.filename);
    const imported = await cli(['--source', fixture.filename, '--schema', schema]); assert.equal(imported.code, 0, imported.stderr);
    const report = JSON.parse(imported.stdout); assert.equal(report.rowCounts.ingredients, 106); assert.equal(report.verified, true);
    const verified = await cli(['--verify', '--schema', schema]); assert.equal(verified.code, 0, verified.stderr); assert.deepEqual(JSON.parse(verified.stdout), report);
    const built = await cli(['--verify', '--schema', schema], true); assert.equal(built.code, 0, built.stderr); assert.deepEqual(JSON.parse(built.stdout), report);
    const refused = await cli(['--source', fixture.filename, '--schema', schema]); assert.equal(refused.code, 1); assert.match(refused.stderr, /target_exists/);
    const invalid = await cli(['--source', fixture.filename, '--schema', 'public']); assert.equal(invalid.code, 1); assert.match(invalid.stderr, /invalid_schema/);
    for (const response of [imported, verified, built, refused, invalid]) {
      for (const secret of [fixturePassword, fixture.token, databaseUrl!, '第四版私有备注', '私有测试草稿']) assert.equal((response.stdout + response.stderr).includes(secret), false);
    }
    assert.equal(fileDigest(fixture.filename), before);
  } finally { fixture.dispose(); }
});

test('owned PostgreSQL pool shutdown waits for the actual connected driver before requesting a database restart', async () => {
  const pool = poolFor(); let ended = false;
  pool.on('connect', client => { client.once('end', () => { ended = true; }); });
  try {
    assert.equal((await pool.query('SELECT 1 AS ok')).rows[0].ok, 1);
    assert.equal(ended, false);
  } finally { await pool.end(); }
  assert.equal(ended, true);
});

await import('./postgres-runtime.test.js');
await import('./postgres-failure-diagnostics.test.js');
await import('./postgres-assistant.test.js');
await import('./postgres-backup.test.js');
await import('./postgres-deployment.test.js');
await import('./postgres-professional.test.js');
await import('./postgres-source-checks.test.js');
await import('./postgres-publication.test.js');
await import('./postgres-publication-http.test.js');
await import('./postgres-tls.test.js');
await import('./postgres-permissions.test.js');
await import('./postgres-photo-notes.test.js');
await import('./postgres-photo-note-http.test.js');
await import('./postgres-photo-submissions.test.js');
await import('./postgres-photo-submission-http.test.js');
await import('./postgres-photo-rights.test.js');
await import('./postgres-photo-rights-http.test.js');
await import('./postgres-photo-professional.test.js');
await import('./postgres-photo-professional-http.test.js');
await import('./postgres-photo-publication.test.js');
