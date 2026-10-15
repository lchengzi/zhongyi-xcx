import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrationFixture, fileDigest } from './migration-fixture.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { registerPhotoNoteHttpTests } from './photo-note-http-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller required');
registerPhotoNoteHttpTests('real PostgreSQL', async () => {
  const f = await migrationFixture(undefined, false), before = fileDigest(f.filename), pool = createPostgresPool(connection!), schema = `photo_http_${randomUUID().replaceAll('-', '')}`;
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  const close = async () => { try { await stores?.close(); } finally { await pool.end(); assert.equal(fileDigest(f.filename), before); f.dispose(); } };
  try {
    await migrateSqliteToPostgres(pool, schema, f.read(), f.seed); stores = await openPostgresStore(connection!, schema, f.seed);
    return { stores, admin: f.admin, editor: f.editor, reviewer: f.reviewer, close };
  } catch (error) { await close(); throw error; }
});
