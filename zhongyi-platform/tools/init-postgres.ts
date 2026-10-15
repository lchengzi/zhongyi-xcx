import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializePostgres } from '../server/initialize-postgres.js';
import { identifier, MigrationError } from '../server/migration-snapshot.js';
import { createPostgresPool } from '../server/postgres-migration.js';
import { initializationCleanup, initializationDiagnostics, initializationFailed, initializationPhase } from '../server/initialization-diagnostics.js';

async function main() {
  const diagnostics = process.env.PG_INITIALIZATION_DIAGNOSTICS === 'true' ? initializationDiagnostics(record => { console.error(JSON.stringify(record)); }) : undefined;
  const observer = diagnostics?.observer;
  let successful = false, failed = false;
  try {
    initializationPhase(observer, 'arguments');
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--schema' || !args[1]) throw new Error('Specify exactly --schema NEW_NAME');
    identifier(args[1]);
    if (!process.env.DATABASE_URL) throw new Error('Missing database connection');
    initializationPhase(observer, 'seed-read');
    const seed = JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8'));
    initializationPhase(observer, 'postgres-configuration');
    const pool = createPostgresPool(process.env.DATABASE_URL);
    try { console.log(JSON.stringify(await initializePostgres(pool, args[1], seed, observer), null, 2)); successful = true; }
    catch (error) { failed = true; initializationFailed(observer, error); throw error; }
    finally {
      initializationPhase(observer, 'postgres-close');
      try { await pool.end(); initializationCleanup(observer, 'postgres', 'completed'); }
      catch (error) { initializationCleanup(observer, 'postgres', 'failed', error); initializationFailed(observer, error); if (!failed) throw error; }
    }
  } catch (error) { initializationFailed(observer, error); throw error; }
  finally { diagnostics?.finish(successful && !failed); }
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof MigrationError ? error.code : 'initialization_failed',
    message: 'Initialization did not pass. Specify a new schema and valid connection; existing data is never overwritten and credentials are not printed.' }));
  process.exitCode = 1;
});
