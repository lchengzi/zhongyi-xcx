import { initializationFailed, initializationPhase, initializationRollback, type InitializationObserver } from './initialization-diagnostics.js';

interface MigrationClient { query(sql: string): Promise<unknown>; release(destroy?: boolean): void }
// Minimal structural boundary lets tests exercise the real transaction owner,
// not a duplicate transaction implementation or an asserted fake pg client.
export async function withMigrationTransaction<T, Client extends MigrationClient>(pool: { connect(): Promise<Client> },
  work: (client: Client) => Promise<T>, readOnly = false, observer?: InitializationObserver): Promise<T> {
  initializationPhase(observer, 'postgres-acquire');
  let client: Client;
  try { client = await pool.connect(); }
  catch (error) { initializationFailed(observer, error); throw error; }
  let discard = false;
  try {
    initializationPhase(observer, 'postgres-begin');
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    initializationPhase(observer, 'postgres-setup');
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'");
    const result = await work(client);
    initializationPhase(observer, 'postgres-commit'); await client.query('COMMIT'); return result;
  } catch (error) {
    initializationFailed(observer, error);
    try { await client.query('ROLLBACK'); initializationRollback(observer, 'completed'); }
    catch (rollbackError) { discard = true; initializationRollback(observer, 'failed', rollbackError); }
    // Preserve the original failure. An unsuccessful rollback must not mask it
    // or return a possibly poisoned connection to another migration.
    throw error;
  } finally { client.release(discard); }
}
