import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPostgresPool, insertTables, migrateSqliteToPostgres, verifyImportedPostgres } from '../server/postgres-migration.js';
import { PostgresRuntime } from '../server/postgres-runtime.js';
import { PostgresPublication } from '../server/postgres-publication.js';
import { WorkflowView } from '../server/postgres-workflow.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { SOURCE_CHECK_TABLE_NAMES, identifier, rowCounts, snapshotDigest, validateSnapshot, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { publicationFixture } from './publication-fixture.js';
import { assertRecoveryData } from './backup-fixture.js';
import { restartPostgres } from './postgres-control.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('Owned real PostgreSQL fixture required');
const schemaName = () => `publication_${randomUUID().replaceAll('-', '')}`;
const repository = (pool: ReturnType<typeof createPostgresPool>, schema: string) => new PostgresPublication(new PostgresRuntime(pool, schema), (context) => new WorkflowView(context));
const comment = 'ENGINEERING_SIMULATION_NOT_REAL：仅隔离数据库验收。';
async function resume(pub: PostgresPublication, actor: Parameters<PostgresPublication['control']>[1]) {
  return pub.control({ action: 'resume', expectedVersion: (await pub.controlHistory())[0]?.version || 0, evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment, confirmed: true }, actor);
}
async function approve(pub: PostgresPublication, id: string, actor: Parameters<PostgresPublication['approve']>[2]) {
  const workspace = await pub.workspace('huang-qi'); const fixed = await pub.snapshot('huang-qi', id);
  return pub.approve('huang-qi', { snapshotId: id, snapshotDigest: fixed.digest, expectedApprovalVersion: workspace.approvals.find((item) => item.snapshotId === id)?.version || 0,
    expectedControlVersion: workspace.control?.version || 0, decision: 'approve', comment, confirmed: true }, actor);
}
async function action(pub: PostgresPublication, id: string, actor: Parameters<PostgresPublication['action']>[2], kind: 'publish' | 'withdraw' | 'rollback' = 'publish') {
  const workspace = await pub.workspace('huang-qi');
  return pub.action('huang-qi', { snapshotId: id, action: kind, expectedVersion: workspace.eventVersion, expectedControlVersion: workspace.control?.version || 0, comment, confirmed: true }, actor, undefined, true);
}

test('real PostgreSQL migration preserves fixed publication history and adds a separate recovery freeze instead of reviving imported authorization', async () => {
  const state = await publicationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName();
  try {
    state.resume(); const fixed = state.snapshot(); state.approve(fixed.id); state.action(fixed.id);
    const source = state.read(); const report = await migrateSqliteToPostgres(pool, schema, source, state.seed);
    assert.equal(report.targetSchemaVersion, 10); assert.equal(report.publicationFrozen, true); assert.equal(report.publicationFreezeVersion, 2);
    assert.deepEqual(await verifyImportedPostgres(pool, schema, state.seed), report);
    const pub = repository(pool, schema); assert.deepEqual(await pub.snapshot('huang-qi', fixed.id), fixed);
    assert.equal(await pub.published('huang-qi', true), null);
    assert.equal((await pub.controlHistory())[0].evidenceReference, `migration:${report.migrationId}:${source.digest}`);
    await resume(pub, state.admin); assert.equal(await pub.published('huang-qi', true), null);
    await assert.rejects(action(pub, fixed.id, state.approver), (e: any) => e.code === 'publication_prerequisites');
    await approve(pub, fixed.id, state.approver); assert.equal(await pub.published('huang-qi', true), null);
    await action(pub, fixed.id, state.approver); assert.equal((await pub.published('huang-qi', true))!.snapshotId, fixed.id);
    assert.equal(await pub.published('huang-qi'), null);
    const backup = await capturePostgresBackup(pool, schema, state.seed); assert.equal(Object.keys(backup.data.tables).length, 32);
    assert.deepEqual(backup.data.tables.publication_snapshots, source.tables.publication_snapshots);
    assert.deepEqual(backup.data.tables.content_revisions, source.tables.content_revisions);
  } finally { await pool.end(); state.close(); }
});

test('real PostgreSQL cross-pool snapshot approval and publication races have one winner; queued revoked authority and immutable history fail closed', async () => {
  const state = await publicationFixture(); const pool = createPostgresPool(connection!); const other = createPostgresPool(connection!); const schema = schemaName();
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, state.read(), state.seed); const one = repository(pool, schema); const two = repository(other, schema);
    await resume(one, state.admin); const workspace = await one.workspace('huang-qi');
    const input = { expectedBasisDigest: workspace.basisDigest!, comment, confirmed: true };
    const snapshots = await Promise.allSettled([one.createSnapshot('huang-qi', input, state.editor), two.createSnapshot('huang-qi', input, state.editor)]);
    assert.equal(snapshots.filter((item) => item.status === 'fulfilled').length, 1); assert.equal((snapshots.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.code, 'duplicate_snapshot');
    const fixed = (snapshots.find((item) => item.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof one.createSnapshot>>>).value;
    const approval = { snapshotId: fixed.id, snapshotDigest: fixed.digest, expectedApprovalVersion: 0, expectedControlVersion: 1, decision: 'approve' as const, comment, confirmed: true };
    await assert.rejects(one.approve('huang-qi', approval, state.admin), (e: any) => e.code === 'self_approval');
    const approvals = await Promise.allSettled([one.approve('huang-qi', approval, state.approver), two.approve('huang-qi', approval, state.approver)]);
    assert.equal(approvals.filter((item) => item.status === 'fulfilled').length, 1); assert.equal((approvals.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.code, 'revision_conflict');
    const publish = { snapshotId: fixed.id, action: 'publish' as const, expectedVersion: 0, expectedControlVersion: 1, comment, confirmed: true };
    const publications = await Promise.allSettled([one.action('huang-qi', publish, state.approver, undefined, true), two.action('huang-qi', publish, state.approver, undefined, true)]);
    assert.equal(publications.filter((item) => item.status === 'fulfilled').length, 1); assert.equal((publications.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.code, 'revision_conflict');
    for (const table of ['publication_snapshots', 'publication_approvals', 'publication_events', 'publication_controls']) {
      for (const sql of [`UPDATE ${identifier(schema)}.${table} SET digest='changed'`, `DELETE FROM ${identifier(schema)}.${table}`, `TRUNCATE ${identifier(schema)}.${table} CASCADE`]) await assert.rejects(pool.query(sql), (e: any) => e.code === '23514');
    }
    stores = await openPostgresStore(connection!, schema, state.seed);
    const writer = await pool.connect(); await writer.query('BEGIN'); await writer.query('SELECT pg_advisory_xact_lock(61038, hashtext($1))', [schema]);
    const blockerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let disabled: Promise<unknown> | undefined; let attempted: Promise<unknown> | undefined;
    try {
      disabled = Promise.resolve(stores.auth.updateUser(state.approver.id, 'admin', false, 1, state.admin.username, state.token));
      let queued = false;
      for (let attempt = 0; attempt < 100 && !queued; attempt++) {
        // Observe this exact blocker, not a spelling of the runtime's SQL or an
        // unrelated schema's waiter. pg_catalog qualification must not hide it.
        queued = Number((await other.query("SELECT COUNT(*) n FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND $1::integer = ANY(pg_blocking_pids(pid))", [blockerPid])).rows[0].n) > 0;
        if (!queued) await new Promise((done) => setTimeout(done, 20));
      }
      assert(queued, 'The authority change must be actually queued before the publication writer.');
      attempted = two.action('huang-qi', { ...publish, action: 'withdraw', expectedVersion: 1 }, state.approver, undefined, true).then(() => 'unexpected-success', (e) => e.code);
      await writer.query('COMMIT'); await disabled; assert.equal(await attempted, 'forbidden');
      assert.equal(await one.published('huang-qi', true), null);
    } finally { await writer.query('ROLLBACK'); writer.release(); await disabled; await attempted; }
  } finally { await stores?.close(); await pool.end(); await other.end(); state.close(); }
});

test('populated PostgreSQL publication backup restores every historical row then freezes; complete restart and resume cannot resurrect old approval', async () => {
  const state = await publicationFixture(); const source = schemaName(); const target = schemaName(); let pool: ReturnType<typeof createPostgresPool> | undefined = createPostgresPool(connection!);
  try {
    state.resume(); const fixed = state.snapshot(); state.approve(fixed.id); state.action(fixed.id);
    await migrateSqliteToPostgres(pool, source, state.read(), state.seed); const original = repository(pool, source);
    await resume(original, state.admin); await approve(original, fixed.id, state.approver); await action(original, fixed.id, state.approver);
    const backup = await capturePostgresBackup(pool, source, state.seed); const key = randomBytes(32);
    const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, state.seed), state.seed);
    assert.equal(report.businessTables, 32); assert.equal(report.publicationFrozen, true); assert.equal(report.publicationFreezeVersion, 4);
    assertRecoveryData(backup, await capturePostgresBackup(pool, target, state.seed));
    assert.equal((await capturePostgresBackup(pool, source, state.seed)).dataDigest, backup.dataDigest);
    await pool.end(); pool = undefined; await restartPostgres(); pool = createPostgresPool(connection!);
    const pub = repository(pool, target); assert.deepEqual(await pub.snapshot('huang-qi', fixed.id), fixed);
    assert.equal((await pub.controlHistory())[0].kind, 'recovery'); assert.equal(await pub.published('huang-qi', true), null);
    const restored = await capturePostgresBackup(pool, target, state.seed); assertRecoveryData(backup, restored); assert.equal(restored.dataDigest, report.restoredDataDigest);
    await resume(pub, state.admin); assert.equal(await pub.published('huang-qi', true), null);
    await assert.rejects(action(pub, fixed.id, state.approver), (e: any) => e.code === 'publication_prerequisites');
    await approve(pub, fixed.id, state.approver); assert.equal(await pub.published('huang-qi', true), null);
    await action(pub, fixed.id, state.approver); assert.equal((await pub.published('huang-qi', true))!.snapshotId, fixed.id);
    await action(pub, fixed.id, state.approver, 'withdraw'); assert.equal(await pub.published('huang-qi', true), null);
    await assert.rejects(action(pub, fixed.id, state.approver, 'rollback'), (e: any) => e.code === 'publication_prerequisites');
    await approve(pub, fixed.id, state.approver); await action(pub, fixed.id, state.approver, 'rollback'); assert(await pub.published('huang-qi', true));
  } finally { await pool?.end(); state.close(); }
});

test('historical PostgreSQL v5 backup restores the exact 24-table schema before additive v9 upgrade; old import digest and populated governance rows remain unchanged', async () => {
  const state = await publicationFixture(); const pool = createPostgresPool(connection!); const source = schemaName(); const target = schemaName();
  try {
    const current = state.read(); const tables = Object.fromEntries(SOURCE_CHECK_TABLE_NAMES.map((name) => [name, name === 'migrations' ? current.tables[name].filter((row) => Number(row.version) <= 7) : current.tables[name]])) as MigrationSnapshot['tables'];
    const payload = { schemaVersion: 5 as const, sourceSchemaVersion: 7 as const, seedDigest: current.seedDigest, tables, sequences: current.sequences };
    const snapshot = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, state.seed); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(source)}; SET LOCAL search_path TO ${identifier(source)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 5)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, source, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, 7, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, source, state.seed); assert.equal(backup.data.postgresMigrations.length, 5); assert.equal(Object.keys(backup.data.tables).length, 24);
    const report = await restorePostgresBackup(pool, target, backup, state.seed); assert.equal(report.publicationFreezeVersion, null); assert.equal(report.publicationFrozen, false);
    const restored = await capturePostgresBackup(pool, target, state.seed); assertRecoveryData(backup, restored);
    await assert.rejects(openPostgresStore(connection!, target, state.seed), (e: any) => e.code === 'schema_changed');
    await upgradePostgres(pool, target); const upgraded = await capturePostgresBackup(pool, target, state.seed);
    assert.equal(upgraded.data.postgresMigrations.length, 10); assert.equal(upgraded.data.sqliteSchemaVersion, 7); assert.deepEqual(upgraded.data.migrationRuns, backup.data.migrationRuns);
    for (const name of SOURCE_CHECK_TABLE_NAMES) assert.deepEqual(upgraded.data.tables[name], restored.data.tables[name]);
    for (const name of ['publication_snapshots', 'publication_approvals', 'publication_events', 'publication_controls'] as const) assert.deepEqual(upgraded.data.tables[name], []);
    assert.equal((await verifyImportedPostgres(pool, source, state.seed)).sourceDigest, snapshot.digest);
    assert.equal((await repository(pool, target).workspace('huang-qi', true)).activeSnapshotId, null);
    assert.deepEqual(await upgradePostgres(pool, target), { schema: target, targetSchemaVersion: 10, publicationEnabled: false });
  } finally { await pool.end(); state.close(); }
});
