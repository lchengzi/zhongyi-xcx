import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { CatalogRepository } from '../server/database.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { createPostgresPool, insertTables, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { identifier, rowCounts } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { migrationFixture, fileDigest, removeEmptyPhotoSubmissions } from './migration-fixture.js';
import { assertRecoveryData } from './backup-fixture.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { registerPhotoSubmissionTests, submissionInput } from './photo-submission-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller required; no emulator or skipped proof');
const schemaName = () => `submission_${randomUUID().replaceAll('-', '')}`;
registerPhotoSubmissionTests('real PostgreSQL independent pools', async () => {
  const f = await migrationFixture(undefined, false), bytes = fileDigest(f.filename), schema = schemaName(), pool = createPostgresPool(connection!);
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined, two: typeof one;
  const close = async () => { try { await one?.close(); await two?.close(); } finally { await pool.end(); assert.equal(fileDigest(f.filename), bytes); f.dispose(); } };
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); one = await openPostgresStore(connection!, schema, f.seed); two = await openPostgresStore(connection!, schema, f.seed);
    return { auth: one.auth, notes: one.photoNotes, one: one.photoSubmissions, two: two.photoSubmissions, close };
  } catch (error) { await close(); throw error; }
});

test('real PostgreSQL immutable submission history survives encrypted new-schema recovery; old session cannot append', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined, recovered: typeof stores;
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); stores = await openPostgresStore(connection!, schema, f.seed);
    const authority = { account: f.admin, token: f.token }, note = await stores.photoNotes.save(notePhoto(), noteInput(), authority);
    const saved = await stores.photoSubmissions.submit(notePhoto(), submissionInput(note), authority);
    for (const sql of ["UPDATE photo_submissions SET caption='forged'", 'DELETE FROM photo_submissions', 'TRUNCATE photo_submissions']) await assert.rejects(pool.query(sql.replace('photo_submissions', `${identifier(schema)}.photo_submissions`)));
    const backup = await capturePostgresBackup(pool, schema, f.seed), key = randomBytes(32);
    assert.equal(backup.data.postgresMigrations.length, 10); assert.equal(Object.keys(backup.data.tables).length, 32); assert.equal(backup.data.tables.photo_submissions.length, 1);
    const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, f.seed), f.seed);
    assert.equal(report.businessTables, 32); assertRecoveryData(backup, await capturePostgresBackup(pool, target, f.seed));
    recovered = await openPostgresStore(connection!, target, f.seed); assert.deepEqual((await recovered.photoSubmissions.detail(notePhoto())).history, [saved]);
    assert.equal(await recovered.auth.session(f.token), undefined); await assert.rejects(recovered.photoSubmissions.submit(notePhoto(), submissionInput(note, 1), authority));
  } finally { await recovered?.close(); await stores?.close(); await pool.end(); f.dispose(); }
});

test('real PostgreSQL v7 backup retains 29 tables and populated notes; explicit latest upgrade adds empty submissions without changing old rows', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  try {
    const repo = new CatalogRepository(f.filename, f.seed);
    try { await new PhotoNoteRepository(repo.db).save(notePhoto(), noteInput(), { account: f.admin, token: f.token }); removeEmptyPhotoSubmissions(repo.db); } finally { repo.close(); }
    const bytes = fileDigest(f.filename), snapshot = f.read(), client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}`); await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 7)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, schema, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, 9, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, schema, f.seed); assert.equal(backup.data.postgresMigrations.length, 7); assert.equal(Object.keys(backup.data.tables).length, 29);
    await restorePostgresBackup(pool, target, backup, f.seed); const before = await capturePostgresBackup(pool, target, f.seed); assertRecoveryData(backup, before);
    await assert.rejects(openPostgresStore(connection!, target, f.seed)); await upgradePostgres(pool, target); const after = await capturePostgresBackup(pool, target, f.seed);
    for (const name of Object.keys(before.data.tables) as (keyof typeof before.data.tables)[]) assert.deepEqual(after.data.tables[name], before.data.tables[name]);
    assert.deepEqual(after.data.tables.photo_submissions, []); assert.deepEqual(after.data.migrationRuns, before.data.migrationRuns); assert.deepEqual(after.data.sequences, before.data.sequences);
    assert.equal(after.data.postgresMigrations.length, 10); assert.equal(after.data.sqliteSchemaVersion, 9); assert.equal(fileDigest(f.filename), bytes);
  } finally { await pool.end(); f.dispose(); }
});
