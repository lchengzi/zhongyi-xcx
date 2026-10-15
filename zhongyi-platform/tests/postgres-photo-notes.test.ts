import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createPostgresPool, insertTables, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { identifier, rowCounts } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { migrationFixture, fileDigest, removeEmptyPhotoNotes } from './migration-fixture.js';
import { assertRecoveryData } from './backup-fixture.js';
import { noteInput, notePhoto, registerPhotoNoteTests } from './photo-note-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller required; no SQLite fallback or skips');
const schemaName = () => `photo_${randomUUID().replaceAll('-', '')}`;

registerPhotoNoteTests('real PostgreSQL two independent pools', async () => {
  const f = await migrationFixture(undefined, false), before = fileDigest(f.filename), schema = schemaName(), pool = createPostgresPool(connection!);
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined, two: typeof one;
  const close = async () => { try { await one?.close(); await two?.close(); } finally { await pool.end(); assert.equal(fileDigest(f.filename), before); f.dispose(); } };
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); one = await openPostgresStore(connection!, schema, f.seed); two = await openPostgresStore(connection!, schema, f.seed);
    return { auth: one.auth, one: one.photoNotes, two: two.photoNotes, close };
  } catch (error) { await close(); throw error; }
});

test('real PostgreSQL populated photo history survives encrypted backup/new-schema recovery; UPDATE/DELETE/TRUNCATE forbidden', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined, recovered: typeof stores;
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); stores = await openPostgresStore(connection!, schema, f.seed);
    const note = await stores.photoNotes.save(notePhoto(), noteInput(), { account: f.admin, token: f.token });
    for (const sql of ["UPDATE photo_notes SET text='forged'", 'DELETE FROM photo_notes', 'TRUNCATE photo_notes']) await assert.rejects(pool.query(sql.replace('photo_notes', `${identifier(schema)}.photo_notes`)));
    const backup = await capturePostgresBackup(pool, schema, f.seed), key = randomBytes(32);
    assert.equal(backup.data.postgresMigrations.length, 10); assert.equal(Object.keys(backup.data.tables).length, 32); assert.equal(backup.data.tables.photo_notes.length, 1);
    const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, f.seed), f.seed);
    assert.equal(report.businessTables, 32); const restored = await capturePostgresBackup(pool, target, f.seed); assertRecoveryData(backup, restored);
    recovered = await openPostgresStore(connection!, target, f.seed); assert.deepEqual((await recovered.photoNotes.detail(notePhoto())).history, [note]);
    assert.equal(await recovered.auth.session(f.token), undefined);
    await assert.rejects(recovered.photoNotes.save(notePhoto(), noteInput(1), { account: f.admin, token: f.token }));
  } finally { await recovered?.close(); await stores?.close(); await pool.end(); f.dispose(); }
});

test('real PostgreSQL v6 backup stays 28-table restorable; explicit v10 upgrade preserves old rows and starts empty photo history', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  try {
    const db = new DatabaseSync(f.filename); try { removeEmptyPhotoNotes(db); } finally { db.close(); }
    const snapshot = f.read(), client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}`); await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 6)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, schema, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, 8, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, schema, f.seed); assert.equal(backup.data.postgresMigrations.length, 6); assert.equal(Object.keys(backup.data.tables).length, 28);
    await restorePostgresBackup(pool, target, backup, f.seed); const before = await capturePostgresBackup(pool, target, f.seed); assertRecoveryData(backup, before);
    await assert.rejects(openPostgresStore(connection!, target, f.seed)); await upgradePostgres(pool, target); const after = await capturePostgresBackup(pool, target, f.seed);
    for (const name of Object.keys(before.data.tables) as (keyof typeof before.data.tables)[]) assert.deepEqual(after.data.tables[name], before.data.tables[name]);
    assert.deepEqual(after.data.tables.photo_notes, []); assert.deepEqual(after.data.migrationRuns, before.data.migrationRuns); assert.deepEqual(after.data.sequences, before.data.sequences);
    assert.equal(after.data.postgresMigrations.length, 10); assert.equal(after.data.sqliteSchemaVersion, 8);
  } finally { await pool.end(); f.dispose(); }
});
