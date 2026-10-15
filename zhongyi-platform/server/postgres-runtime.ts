import type { Pool, PoolClient } from 'pg';
import { identifier, MigrationError, SOURCE_SCHEMA_VERSIONS } from './migration-snapshot.js';
import { validatePostgresHistory } from './postgres-upgrades.js';
import { AccountError } from './auth.js';
import type { Account, SessionInfo } from '../shared/contracts.js';
import { tokenHash } from './auth.js';
import { failureCode, markDatabaseFailure, type DatabasePhase, type FailureCode } from './failure-diagnostics.js';

export const accountColumns = 'id, username, role, active, revision, created_at AS "createdAt"';
export interface StoredAccount extends Omit<Account, 'active'> { active: number }
export const toAccount = (row: StoredAccount): Account => ({ ...row, active: row.active === 1 });

export class PostgresContext {
  constructor(private readonly client: PoolClient) {}
  async all<T>(sql: string, values: unknown[] = []): Promise<T[]> { return (await this.client.query(sql, values)).rows as T[]; }
  async get<T>(sql: string, values: unknown[] = []): Promise<T | undefined> { return (await this.all<T>(sql, values))[0]; }
  async run(sql: string, values: unknown[] = []): Promise<void> { await this.client.query(sql, values); }
}

export async function sessionIn(context: PostgresContext, token: string, now = Date.now()): Promise<SessionInfo | undefined> {
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const row = await context.get<StoredAccount & { csrfToken: string; expiresAt: number }>(`
    SELECT u.id, u.username, u.role, u.active, u.revision, u.created_at AS "createdAt",
      s.csrf_token AS "csrfToken", s.expires_at AS "expiresAt"
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.active = 1`, [tokenHash(token), now]);
  if (!row) return;
  const { csrfToken, expiresAt, ...account } = row;
  return { user: toAccount(account), csrfToken, expiresAt: new Date(expiresAt).toISOString() };
}

export async function checkAccount(context: PostgresContext, actor: Account, roles: Account['role'][], token?: string): Promise<void> {
  const current = await context.get<StoredAccount>(`SELECT ${accountColumns} FROM users WHERE id = $1`, [actor.id]);
  if (!current?.active || current.role !== actor.role || current.revision !== actor.revision || !roles.includes(current.role)) {
    throw new AccountError(403, 'forbidden', '当前账号没有此操作权限，或权限已变化。');
  }
  if (token !== undefined && (await sessionIn(context, token))?.user.id !== actor.id) {
    throw new AccountError(401, 'unauthorized', '会话已失效，请重新登录。');
  }
}

export class PostgresRuntime {
  constructor(readonly pool: Pool, readonly schema: string) { identifier(schema); }
  private async transaction<T>(work: (context: PostgresContext) => Promise<T>, write: boolean): Promise<T> {
    const operation = write ? 'write' : 'read';
    let client: PoolClient;
    try { client = await this.pool.connect(); }
    catch (error) {
      markDatabaseFailure(error, { operation, phase: 'acquire', rollback: 'not_started', rollbackCode: null });
      throw error;
    }
    let broken = false;
    let phase: DatabasePhase = 'begin';
    try {
      await client.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      phase = 'setup';
      await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '20s'");
      await client.query(`SET LOCAL search_path TO ${identifier(this.schema)}, pg_catalog`);
      // The current small editorial workspace serializes writes, as SQLite did.
      // This DB lock also spans distinct pools/processes, not only one JS instance.
      // Acquire it BEFORE reading any account, session or optimistic revision.
      if (write) {
        phase = 'lock';
        await client.query('SELECT pg_catalog.pg_advisory_xact_lock(61038, pg_catalog.hashtext($1))', [this.schema]);
      }
      phase = 'work';
      const result = await work(new PostgresContext(client));
      phase = 'commit';
      await client.query('COMMIT'); return result;
    } catch (error) {
      let rollbackCode: FailureCode | null = null;
      try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = true; rollbackCode = failureCode(rollbackError); }
      markDatabaseFailure(error, { operation, phase, rollback: broken ? 'failed' : 'completed', rollbackCode });
      throw error;
    } finally { client.release(broken); }
  }
  read<T>(work: (context: PostgresContext) => Promise<T>): Promise<T> { return this.transaction(work, false); }
  write<T>(work: (context: PostgresContext) => Promise<T>): Promise<T> { return this.transaction(work, true); }
  async validate(seedDigest: string): Promise<void> {
    await this.read(async (context) => {
      const migrations = await context.all<{ version: number; checksum: string }>('SELECT version, checksum FROM postgres_migrations ORDER BY version');
      validatePostgresHistory(migrations, true);
      const run = await context.get<{ seed_digest: string; source_schema_version: number }>('SELECT seed_digest, source_schema_version FROM migration_runs ORDER BY migrated_at DESC, id DESC LIMIT 1');
      if (!run || run.seed_digest !== seedDigest || !SOURCE_SCHEMA_VERSIONS.some((version) => version === run.source_schema_version)) throw new MigrationError('invalid_run', '缺少匹配目录的正式迁移记录，拒绝启动。');
    });
  }
}
