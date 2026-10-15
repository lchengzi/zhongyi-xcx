import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createPostgresPool, insertTables, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, encryptBackup, decryptBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { identifier, rowCounts } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { migrationFixture, fileDigest, removeEmptyPhotoProfessional } from './migration-fixture.js';
import { assertRecoveryData } from './backup-fixture.js';
import { registerPhotoProfessionalTests, preparePhotoProfessional } from './photo-professional-fixture.js';
import { prepareRights, rightsInput } from './photo-rights-fixture.js';
import { openConfiguredStore } from '../server/store-config.js';
import { notePhoto } from './photo-note-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller required; no emulator or skipped proof');
const schemaName = () => `photo_prof_${randomUUID().replaceAll('-', '')}`;
registerPhotoProfessionalTests('real PostgreSQL professional images', async () => {
  const f = await migrationFixture(undefined, false), bytes = fileDigest(f.filename), schema = schemaName(), pool = createPostgresPool(connection!);
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined, two: typeof one;
  const close = async () => { try { await one?.close(); await two?.close(); } finally { await pool.end(); assert.equal(fileDigest(f.filename), bytes); f.dispose(); } };
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); one = await openPostgresStore(connection!, schema, f.seed); two = await openPostgresStore(connection!, schema, f.seed);
    return { stores: one, second: two.photoProfessional, close };
  } catch (error) { await close(); throw error; }
});
test('real PostgreSQL professional image history survives closed pools and encrypted SQL restoration; history mutations and old sessions are rejected', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); stores = await openPostgresStore(connection!, schema, f.seed);
    const p = await preparePhotoProfessional(stores), saved = await stores.photoProfessional.review(p.photo, await p.input('tcm_physician'), p.authority('tcm_physician'));
    const revokeInput = await p.input('tcm_physician', 'revoke');
    for (const sql of ["UPDATE photo_professional_reviews SET comment='forged'", 'DELETE FROM photo_professional_reviews', 'TRUNCATE photo_professional_reviews'])
      await assert.rejects(pool.query(sql.replace('photo_professional_reviews', `${identifier(schema)}.photo_professional_reviews`)));
    await stores.close(); stores = undefined; stores = await openPostgresStore(connection!, schema, f.seed); assert.deepEqual((await stores.photoProfessional.detail(p.photo)).history, [saved]);
    const backup = await capturePostgresBackup(pool, schema, f.seed), key = randomBytes(32); assert.equal(backup.data.postgresMigrations.length, 10); assert.equal(Object.keys(backup.data.tables).length, 32);
    const report = await restorePostgresBackup(pool, target, decryptBackup(encryptBackup(backup, key), key, f.seed), f.seed);
    assert.equal(report.businessTables, 32); assertRecoveryData(backup, await capturePostgresBackup(pool, target, f.seed));
    await stores.close(); stores = undefined; stores = await openPostgresStore(connection!, target, f.seed);
    assert.deepEqual((await stores.photoProfessional.detail(p.photo)).history, [saved]); assert.equal(await stores.auth.session(p.authority('tcm_physician').token), undefined);
    await assert.rejects(stores.photoProfessional.review(p.photo, revokeInput, p.authority('tcm_physician')), error => error instanceof Error && 'code' in error && error.code === 'unauthorized');
  } finally { await stores?.close(); await pool.end(); f.dispose(); }
});
test('genuine PostgreSQL v9 backup keeps31 tables and populated rights; additive v10 preserves all old rows, journals and source bytes', async () => {
  const f = await migrationFixture(undefined, false), schema = schemaName(), target = schemaName(), pool = createPostgresPool(connection!);
  try {
    const stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
    try { const p = await prepareRights(stores); await stores.photoRights.review(notePhoto(), rightsInput(p.submission), p.reviewAuthority); } finally { await stores.close(); }
    const db = new DatabaseSync(f.filename); try { db.exec('PRAGMA foreign_keys=ON'); removeEmptyPhotoProfessional(db); } finally { db.close(); }
    const bytes = fileDigest(f.filename), snapshot = f.read(), client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}`); await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 9)) { await client.query(migration.sql); await client.query('INSERT INTO postgres_migrations VALUES ($1,$2,$3)', [migration.version, migration.checksum, new Date().toISOString()]); }
      await insertTables(client, schema, snapshot);
      await client.query('INSERT INTO migration_runs VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), snapshot.digest, f.seed.digest, 11, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const backup = await capturePostgresBackup(pool, schema, f.seed); assert.equal(backup.data.postgresMigrations.length, 9); assert.equal(Object.keys(backup.data.tables).length, 31); assert.equal(backup.data.tables.photo_rights_reviews.length, 1);
    assert.equal(Object.hasOwn(backup.data.tables, 'photo_professional_reviews'), false);
    await restorePostgresBackup(pool, target, backup, f.seed); const before = await capturePostgresBackup(pool, target, f.seed); await upgradePostgres(pool, target); const after = await capturePostgresBackup(pool, target, f.seed);
    for (const name of Object.keys(before.data.tables) as (keyof typeof before.data.tables)[]) assert.deepEqual(after.data.tables[name], before.data.tables[name]);
    assert.deepEqual(after.data.tables.photo_professional_reviews, []); assert.deepEqual(after.data.migrationRuns, before.data.migrationRuns); assert.deepEqual(after.data.sequences, before.data.sequences);
    assert.equal(after.data.postgresMigrations.length, 10); assert.equal(after.data.sqliteSchemaVersion, 11); assert.equal(fileDigest(f.filename), bytes);
  } finally { await pool.end(); f.dispose(); }
});
