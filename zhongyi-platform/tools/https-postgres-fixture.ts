import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Pool } from 'pg';
import { restorePostgresBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { identifier, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { configurePostgresRuntimePermissions } from '../server/postgres-permissions.js';
import type { CatalogSeed } from '../shared/contracts.js';
import { ownedHttpsPostgres } from './https-test-plan.js';

/** An acquisition failure must still close its owned pool. The callback is
 * invoked once only; this does not retry connections or database writes. */
export async function withOwnedPoolClient<C extends { release(): void }, T>(
  pool: { connect(): Promise<C>; end(): Promise<void> }, work: (client: C) => Promise<T>): Promise<T> {
  try {
    const client = await pool.connect();
    try { return await work(client); } finally { client.release(); }
  } finally { await pool.end(); }
}

// Only the live, nonce-bound temporary cluster is accepted. Each fixture gets
// separate owner/runtime roles; neither credential is persisted in public proof.
export async function prepareHttpsPostgresRuntime(env: NodeJS.ProcessEnv, schema: string, snapshot: MigrationSnapshot, seed: CatalogSeed) {
  const { ownerConnection, runtimeConnection } = await prepareOwnedRuntime(env, schema, async pool => {
    await migrateSqliteToPostgres(pool, schema, snapshot, seed);
  });
  return { ownerConnection, runtimeConnection };
}

export async function prepareHttpsPostgresRecovery(env: NodeJS.ProcessEnv, schema: string, input: unknown, seed: CatalogSeed) {
  const backup = validatePostgresBackup(input, seed);
  return prepareOwnedRuntime(env, schema, pool => restorePostgresBackup(pool, schema, backup, seed));
}

async function prepareOwnedRuntime<T>(env: NodeJS.ProcessEnv, schema: string, initialize: (pool: Pool) => Promise<T>) {
  const owned = ownedHttpsPostgres(env, process.connected === true);
  const suffix = /^https_(?:workbench|publication|recovery)_([a-f0-9]{32})$/.exec(schema)?.[1];
  if (!suffix) throw new Error('Owned HTTPS namespace required for restricted database roles');
  const owner = `https_owner_${suffix}`, role = `https_runtime_${suffix}`;
  const ownerPassword = randomBytes(32).toString('hex'), runtimePassword = randomBytes(32).toString('hex');
  const urlFor = (name: string, password: string) => { const url = new URL(owned.connection); url.username = name; url.password = password; return url.toString(); };
  const ownerConnection = urlFor(owner, ownerPassword), runtimeConnection = urlFor(role, runtimePassword);
  const admin = createPostgresPool(owned.connection);
  await withOwnedPoolClient<PoolClient, void>(admin, async client => {
    try {
      // The entire cluster belongs exclusively to this live test controller.
      // Never run this preparation against a shared or working database.
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${identifier(owner)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${ownerPassword}'`);
      await client.query(`CREATE ROLE ${identifier(role)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`);
      await client.query('REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC');
      await client.query(`GRANT CONNECT ON DATABASE postgres TO ${identifier(owner)}, ${identifier(role)}`);
      await client.query(`GRANT CREATE ON DATABASE postgres TO ${identifier(owner)}`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
  const migration = createPostgresPool(ownerConnection);
  try {
    const result = await initialize(migration);
    // Avoid PUBLIC callable functions crossing otherwise isolated namespaces.
    await migration.query(`REVOKE EXECUTE ON FUNCTION ${identifier(schema)}.deny_history_change() FROM PUBLIC`);
    await configurePostgresRuntimePermissions(migration, schema, role, true);
    return { ownerConnection, runtimeConnection, result };
  } finally { await migration.end(); }
}

export function ownedHttpsRuntimeConnection(env: NodeJS.ProcessEnv, schema: string, connected = process.connected === true): string {
  const owned = ownedHttpsPostgres(env, connected);
  const suffix = /^https_workbench_([a-f0-9]{32})$/.exec(schema)?.[1];
  const value = env.HTTPS_TEST_RUNTIME_DATABASE_URL;
  if (!suffix || !value) throw new Error('Owned HTTPS runtime connection required');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Valid owned HTTPS runtime connection required'); }
  const expected = new URL(owned.connection);
  if (url.username !== `https_runtime_${suffix}` || !/^[a-f0-9]{64}$/.test(url.password)) throw new Error('Owned restricted HTTPS role required');
  expected.username = url.username; expected.password = url.password;
  if (expected.toString() !== url.toString()) throw new Error('Runtime URL must remain inside the same owned TLS cluster');
  return value;
}
