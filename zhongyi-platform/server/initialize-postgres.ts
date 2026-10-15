import { mkdtempSync, lstatSync, realpathSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import { openConfiguredStore } from './store-config.js';
import { validateSeed } from './seed.js';
import { identifier, readSqliteSnapshot } from './migration-snapshot.js';
import { migrateSqliteToPostgres } from './postgres-migration.js';
import { initializationCleanup, initializationFailed, initializationPhase, type InitializationObserver } from './initialization-diagnostics.js';

export async function initializePostgres(pool: Pool, schema: string, input: unknown, observer?: InitializationObserver) {
  initializationPhase(observer, 'seed-validation');
  identifier(schema);
  const seed = validateSeed(input);
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-seed-init-'));
  const filename = join(directory, 'initial.sqlite');
  let failed = false;
  try {
    // Real migrations and approved seed only; never inherit a working DB_PATH.
    initializationPhase(observer, 'sqlite-create');
    const stores = await openConfiguredStore(seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: filename });
    await stores.close();
    initializationPhase(observer, 'sqlite-snapshot');
    const snapshot = readSqliteSnapshot(filename, seed);
    return await migrateSqliteToPostgres(pool, schema, snapshot, seed, observer);
  } catch (error) {
    failed = true; initializationFailed(observer, error); throw error;
  } finally {
    initializationPhase(observer, 'sqlite-cleanup');
    try {
      const parent = realpathSync(directory);
      const names = readdirSync(directory);
      if (lstatSync(directory).isSymbolicLink() || names.some((name) => name !== 'initial.sqlite')) throw new Error('Unexpected initialization temporary files; retained for inspection');
      if (names.length) {
        const actual = realpathSync(filename);
        if (actual !== resolve(parent, 'initial.sqlite') || lstatSync(filename).isSymbolicLink() || !lstatSync(filename).isFile()) throw new Error('Unsafe initialization cleanup target');
        unlinkSync(actual);
      }
      rmdirSync(parent);
      initializationCleanup(observer, 'sqlite', 'completed');
    } catch (error) {
      initializationCleanup(observer, 'sqlite', 'failed', error); initializationFailed(observer, error);
      if (!failed) throw error;
    }
  }
}
