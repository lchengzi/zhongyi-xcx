// Test-only setup. Never call it from the production server or account bootstrap.
import { mkdtempSync, realpathSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { readSqliteSnapshot } from '../server/migration-snapshot.js';
import { openPostgresStore } from '../server/postgres-store.js';
import type { CatalogSeed } from '../shared/contracts.js';

export async function browserPostgresStore(connection: string, seed: CatalogSeed, accounts: boolean) {
  if (!/^[a-f0-9]{32}$/.test(process.env.PG_TEST_NONCE || '')) throw new Error('Owned PostgreSQL browser controller nonce required; no SQLite fallback');
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-pg-browser-'));
  const filename = join(directory, 'fixture.sqlite');
  const catalog = new CatalogRepository(filename, seed);
  try {
    if (accounts) {
      const auth = new AuthRepository(catalog.db);
      for (const role of ['admin', 'editor', 'reviewer'] as const) await auth.createUser(`browser-${role}`, `test-only-${role}-password-2026`, role, 'test-fixture');
      await auth.createUser('browser-recovery-admin', 'test-only-recovery-admin-password-2026', 'admin', 'test-fixture');
      await auth.createUser('browser-source-admin', 'test-only-source-admin-password-2026', 'admin', 'test-fixture');
      await auth.createUser('browser-assistant-review-editor', 'test-only-assistant-review-editor-password-2026', 'editor', 'test-fixture');
      await auth.createUser('browser-assistant-proposal-editor', 'test-only-assistant-proposal-editor-password-2026', 'editor', 'test-fixture');
      await auth.createUser('browser-response-editor', 'test-only-response-editor-password-2026', 'editor', 'test-fixture');
      await auth.createUser('browser-response-reviewer', 'test-only-response-reviewer-password-2026', 'reviewer', 'test-fixture');
      await auth.createUser('browser-auth-editor', 'test-only-auth-editor-password-2026', 'editor', 'test-fixture');
      await auth.createUser('browser-auth-reviewer', 'test-only-auth-reviewer-password-2026', 'reviewer', 'test-fixture');
      await auth.createUser('browser-assistant-response-editor', 'test-only-assistant-response-editor-password-2026', 'editor', 'test-fixture');
    }
  } finally { catalog.close(); }
  const schema = `browser_${randomUUID().replaceAll('-', '')}`;
  const pool = createPostgresPool(connection);
  try { await migrateSqliteToPostgres(pool, schema, readSqliteSnapshot(filename, seed), seed); }
  finally {
    await pool.end();
    const actual = realpathSync(filename); const parent = realpathSync(directory);
    if (actual.toLowerCase() !== resolve(parent, 'fixture.sqlite').toLowerCase() || lstatSync(filename).isSymbolicLink() || !lstatSync(filename).isFile()) throw new Error('Unsafe browser fixture cleanup target');
    unlinkSync(actual); rmdirSync(parent);
  }
  return openPostgresStore(connection, schema, seed);
}
