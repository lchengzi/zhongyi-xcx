import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openConfiguredStore } from '../server/store-config.js';
import { createPostgresPool, insertTables, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { identifier, rowCounts } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { migrationFixture, fileDigest, removeEmptyPhotoRights } from './migration-fixture.js';
import { assertRecoveryData } from './backup-fixture.js';
import { notePhoto } from './photo-note-fixture.js';
import { prepareRights, registerPhotoRightsTests, rightsInput } from './photo-rights-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller required; no emulator or skipped proof');
const schemaName = () => `rights_${randomUUID().replaceAll('-', '')}`;
registerPhotoRightsTests('real PostgreSQL independent pools', async () => {
  const f = await migrationFixture(undefined, false), bytes = fileDigest(f.filename), schema = schemaName(), pool = createPostgresPool(connection!);
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined, two: typeof one;
  const close = async () => { try { await one?.close(); await two?.close(); } finally { await pool.end(); assert.equal(fileDigest(f.filename), bytes); f.dispose(); } };
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); one = await openPostgresStore(connection!, schema, f.seed); two = await openPostgresStore(connection!, schema, f.seed);
    return { stores: one, second: two.photoRights, close };
  } catch (error) { await close(); throw error; }
});

test('real PostgreSQL rights history is immutable and encrypted recovery preserves exact decisions while revoking sessions', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined, recovered: typeof stores;
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); stores = await openPostgresStore(connection!, schema, f.seed);
    const p = await prepareRights(stores), saved = await stores.photoRights.review(notePhoto(), rightsInput(p.submission), p.reviewAuthority);
    for (const sql of ["UPDATE photo_rights_reviews SET comment='forged'", 'DELETE FROM photo_rights_reviews', 'TRUNCATE photo_rights_reviews']) await assert.rejects(pool.query(sql.replace('photo_rights_reviews', `${identifier(schema)}.photo_rights_reviews`)));
    const backup = await capturePostgresBackup(pool, schema, f.seed), key = randomBytes(32);
    assert.equal(backup.data.postgresMigrations.length, 10); assert.equal(Object.keys(backup.data.tables).length, 32);
    const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, f.seed), f.seed);
    assert.equal(report.businessTables, 32); assertRecoveryData(backup, await capturePostgresBackup(pool, target, f.seed));
    recovered = await openPostgresStore(connection!, target, f.seed); assert.deepEqual((await recovered.photoRights.detail(notePhoto())).history, [saved]);
    assert.equal(await recovered.auth.session(p.reviewAuthority.token), undefined);
    await assert.rejects(recovered.photoRights.review(notePhoto(), { ...rightsInput(p.submission, 1), decision: 'revoke' }, p.reviewAuthority));
  } finally { await recovered?.close(); await stores?.close(); await pool.end(); f.dispose(); }
});

test('genuine PostgreSQL v8 backup keeps 30 tables and populated submissions; explicit v10 adds empty rights/professional history', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  try {
    // Produce a genuine v10 SQLite source without overwriting a populated table.
    const source = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
    try { await prepareRights(source); } finally { await source.close(); }
    const db = new DatabaseSync(f.filename); try { db.exec('PRAGMA foreign_keys=ON'); removeEmptyPhotoRights(db); } finally { db.close(); }
    const bytes = fileDigest(f.filename), snapshot = f.read(), client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}`); await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 8)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, schema, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, 10, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, schema, f.seed); assert.equal(backup.data.postgresMigrations.length, 8); assert.equal(Object.keys(backup.data.tables).length, 30); assert.equal(backup.data.tables.photo_submissions.length, 1);
    await restorePostgresBackup(pool, target, backup, f.seed); const before = await capturePostgresBackup(pool, target, f.seed); assertRecoveryData(backup, before);
    await assert.rejects(openPostgresStore(connection!, target, f.seed)); await upgradePostgres(pool, target); const after = await capturePostgresBackup(pool, target, f.seed);
    for (const name of Object.keys(before.data.tables) as (keyof typeof before.data.tables)[]) assert.deepEqual(after.data.tables[name], before.data.tables[name]);
    assert.deepEqual(after.data.tables.photo_rights_reviews, []); assert.deepEqual(after.data.migrationRuns, before.data.migrationRuns); assert.deepEqual(after.data.sequences, before.data.sequences);
    assert.equal(after.data.postgresMigrations.length, 10); assert.equal(after.data.sqliteSchemaVersion, 10); assert.equal(fileDigest(f.filename), bytes);
  } finally { await pool.end(); f.dispose(); }
});
