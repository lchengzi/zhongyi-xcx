import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { identifier, MigrationError, TABLES, normalizeRow, validateBusinessTables, snapshotTableNames, SOURCE_SCHEMA_VERSIONS, type Row, type TableName, type MigrationSnapshot } from './migration-snapshot.js';
import { insertTables, readTables, readSequences } from './postgres-migration.js';
import { POSTGRES_MIGRATIONS, validatePostgresHistory } from './postgres-upgrades.js';
import { validateSeed } from './seed.js';
import { CONTROL_INSERT, controlFrom, controlValues, recoveryFreeze } from './publication-values.js';
export { backupKey } from './backup-key.js';

const FORMAT = 'food-education-postgres-business-backup';
const MAX_BYTES = 32 * 1024 * 1024;
function fail(code: string, message: string): never { throw new MigrationError(code, message); }
const exact = (value: unknown, keys: string[]): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys.slice().sort().join();
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
interface PgMigration { version: number; checksum: string; applied_at: string }
interface ImportRun { id: string; source_digest: string; seed_digest: string; source_schema_version: MigrationSnapshot['sourceSchemaVersion']; row_counts: Record<string, number>; migrated_at: string }
export interface BackupData {
  sqliteSchemaVersion: MigrationSnapshot['sourceSchemaVersion'];
  tables: Record<TableName, Row[]>;
  sequences: MigrationSnapshot['sequences'];
  postgresMigrations: PgMigration[];
  migrationRuns: ImportRun[];
}
export interface PostgresBackup {
  format: typeof FORMAT;
  version: 1;
  sourceSchema: string;
  seedDigest: string;
  capturedAt: string;
  data: BackupData;
  dataDigest: string;
  digest: string;
}
export interface BackupReport {
  format: typeof FORMAT; backupDigest: string; dataDigest: string; capturedAt: string;
  businessTables: number; totalRows: number; publicationEnabled: false;
}
export const backupReport = (backup: PostgresBackup): BackupReport => ({ format: FORMAT, backupDigest: backup.digest, dataDigest: backup.dataDigest,
  capturedAt: backup.capturedAt, businessTables: Object.keys(backup.data.tables).length, totalRows: Object.values(backup.data.tables).reduce((sum, rows) => sum + rows.length, 0), publicationEnabled: false });

export function validatePostgresBackup(input: unknown, seedInput: unknown): PostgresBackup {
  const seed = validateSeed(seedInput);
  if (!exact(input, ['format', 'version', 'sourceSchema', 'seedDigest', 'capturedAt', 'data', 'dataDigest', 'digest']) || input.format !== FORMAT || input.version !== 1 ||
    typeof input.sourceSchema !== 'string' || input.seedDigest !== seed.digest || !timestamp(input.capturedAt) || !digestPattern.test(input.digest) || !digestPattern.test(input.dataDigest)) fail('invalid_backup', '备份格式或目录版本不匹配。');
  identifier(input.sourceSchema); const data = input.data;
  if (!exact(data, ['sqliteSchemaVersion', 'tables', 'sequences', 'postgresMigrations', 'migrationRuns']) || !Array.isArray(data.postgresMigrations) || !Array.isArray(data.migrationRuns) || !data.migrationRuns.length) fail('invalid_backup', '备份业务数据或历史记录不完整。');
  const { digest: _digest, ...payload } = input;
  if (digest(payload) !== input.digest || digest(data) !== input.dataDigest) fail('backup_changed', '备份摘要不一致，拒绝恢复。');
  if (data.postgresMigrations.some((row: unknown) => !exact(row, ['version', 'checksum', 'applied_at']) || !timestamp(row.applied_at))) fail('invalid_backup', '结构迁移历史无效。');
  const pgVersion = validatePostgresHistory(data.postgresMigrations);
  if (pgVersion < 3) fail('invalid_backup', '业务备份至少需要 PostgreSQL v3 的完整控制表。');
  validateBusinessTables(data.tables, data.sequences, seed, data.sqliteSchemaVersion, pgVersion as MigrationSnapshot['schemaVersion']);
  const ids = new Set<string>();
  for (const run of data.migrationRuns) {
    if (!exact(run, ['id', 'source_digest', 'seed_digest', 'source_schema_version', 'row_counts', 'migrated_at'])) fail('invalid_backup', '原导入记录无效。');
    const names = snapshotTableNames({ schemaVersion: (run.source_schema_version - 2) as MigrationSnapshot['schemaVersion'] });
    if (!exact(run, ['id', 'source_digest', 'seed_digest', 'source_schema_version', 'row_counts', 'migrated_at']) || typeof run.id !== 'string' || !run.id || ids.has(run.id) ||
      !SOURCE_SCHEMA_VERSIONS.some((version) => version === run.source_schema_version) || run.seed_digest !== seed.digest || !digestPattern.test(run.source_digest) || !timestamp(run.migrated_at) ||
      !exact(run.row_counts, names) || Object.values(run.row_counts).some((count) => !Number.isSafeInteger(count) || (count as number) < 0)) fail('invalid_backup', '原导入记录无效，不补造或覆盖历史。');
    ids.add(run.id);
  }
  const latest = data.migrationRuns[data.migrationRuns.length - 1];
  if (latest.source_schema_version !== data.sqliteSchemaVersion) fail('invalid_backup', '历史源库版本与原导入记录不一致。');
  return input as unknown as PostgresBackup;
}

async function readData(client: PoolClient, schema: string): Promise<BackupData> {
  const qualified = identifier(schema);
  const postgresMigrations = (await client.query(`SELECT version, checksum, applied_at FROM ${qualified}.postgres_migrations ORDER BY version`)).rows;
  const pgVersion = validatePostgresHistory(postgresMigrations);
  if (pgVersion < 3) fail('unsupported_backup_schema', '旧库需先显式升级后使用业务备份。');
  const names = snapshotTableNames({ schemaVersion: pgVersion as MigrationSnapshot['schemaVersion'] });
  const expected = [...names, 'postgres_migrations', 'migration_runs'].sort();
  const actual = (await client.query('SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename COLLATE "C"', [schema])).rows;
  if (actual.map((row) => row.name).join() !== expected.join()) fail('unsupported_backup_schema', '备份只接受当前完整业务 schema；未知或缺失表拒绝遗漏。');
  const columns = (await client.query('SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1', [schema])).rows;
  const extraColumns = { postgres_migrations: ['version', 'checksum', 'applied_at'], migration_runs: ['id', 'source_digest', 'seed_digest', 'source_schema_version', 'row_counts', 'migrated_at'] };
  for (const [name, keys] of [...names.map((name) => [name, TABLES[name].columns] as const), ...Object.entries(extraColumns)]) {
    if (columns.filter((row) => row.table_name === name).map((row) => row.column_name).sort().join() !== keys.slice().sort().join()) fail('unsupported_backup_schema', '备份发现未知或缺失字段，拒绝遗漏数据。');
  }
  const tables = await readTables(client, schema, names); const sequences = await readSequences(client, schema);
  return { sqliteSchemaVersion: tables.migrations.length as MigrationSnapshot['sourceSchemaVersion'], tables, sequences,
    postgresMigrations,
    migrationRuns: (await client.query(`SELECT id, source_digest, seed_digest, source_schema_version, row_counts, migrated_at FROM ${qualified}.migration_runs ORDER BY migrated_at COLLATE "C", id COLLATE "C"`)).rows };
}

export async function capturePostgresBackup(pool: Pool, schema: string, seedInput: unknown): Promise<PostgresBackup> {
  identifier(schema); const seed = validateSeed(JSON.parse(JSON.stringify(seedInput))); const client = await pool.connect();
  try {
    await client.query("SET lock_timeout = '5s'; SET statement_timeout = '15s'");
    // Get the cooperative maintenance/write locks BEFORE starting the snapshot.
    // Sequences are not MVCC snapshots; holding the normal writer lock matters.
    await client.query('SELECT pg_catalog.pg_advisory_lock(61037, pg_catalog.hashtext($1))', [schema]);
    await client.query('SELECT pg_catalog.pg_advisory_lock(61038, pg_catalog.hashtext($1))', [schema]);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data = await readData(client, schema);
    const capturedAt = (await client.query('SELECT transaction_timestamp()::text AS value')).rows[0].value;
    const payload = { format: FORMAT, version: 1 as const, sourceSchema: schema, seedDigest: seed.digest, capturedAt, data, dataDigest: digest(data) };
    const backup = validatePostgresBackup({ ...payload, digest: digest(payload) }, seed);
    if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BYTES) fail('backup_too_large', '业务备份超过 32 MiB，应使用受控原生数据库备份方案。');
    await client.query('COMMIT'); return backup;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(true); } // Closing the dedicated connection releases ALL session locks/settings.
}

export async function restorePostgresBackup(pool: Pool, schema: string, input: unknown, seedInput: unknown) {
  identifier(schema); const seed = validateSeed(JSON.parse(JSON.stringify(seedInput)));
  // Validate/own the whole payload before acquiring a destination connection.
  const backup = validatePostgresBackup(JSON.parse(JSON.stringify(input)), seed); const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'");
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(61037, pg_catalog.hashtext($1))', [schema]);
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(61038, pg_catalog.hashtext($1))', [schema]);
    if ((await client.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [schema])).rowCount) fail('target_exists', '恢复只允许全新 schema，不覆盖原库或已有目标。');
    await client.query(`CREATE SCHEMA ${identifier(schema)}`); await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
    // Rebuild only trusted, versioned application DDL; never execute SQL from a backup.
    for (const migration of POSTGRES_MIGRATIONS.slice(0, backup.data.postgresMigrations.length)) await client.query(migration.sql);
    await insertTables(client, schema, { schemaVersion: backup.data.postgresMigrations.length as MigrationSnapshot['schemaVersion'], tables: backup.data.tables, sequences: backup.data.sequences });
    for (const row of backup.data.postgresMigrations) await client.query('INSERT INTO postgres_migrations VALUES ($1, $2, $3)', [row.version, row.checksum, row.applied_at]);
    for (const row of backup.data.migrationRuns) await client.query('INSERT INTO migration_runs VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [row.id, row.source_digest, row.seed_digest, row.source_schema_version, JSON.stringify(row.row_counts), row.migrated_at]);
    if (digest(await readData(client, schema)) !== backup.dataDigest) fail('restore_mismatch', '恢复后的完整行、历史和序列不一致，事务拒绝提交。');
    // A recovery must not revive old login cookies. Password hashes/roles remain;
    // operators must review recovered permissions and log in afresh before cutover.
    const sessionsRevoked = backup.data.tables.sessions.length;
    await client.query('DELETE FROM sessions');
    const expected = { ...backup.data, tables: { ...backup.data.tables, sessions: [] } };
    let publicationFreezeVersion: number | null = null;
    if (backup.data.postgresMigrations.length >= 6) {
      const prior = backup.data.tables.publication_controls.at(-1);
      const frozen = recoveryFreeze(prior ? controlFrom(prior) : undefined, `backup:${backup.digest}`);
      let parameter = 0;
      await client.query(CONTROL_INSERT.replace(/\?/g, () => `$${++parameter}`), controlValues(frozen));
      const values = controlValues(frozen);
      const row = normalizeRow('publication_controls', Object.fromEntries(TABLES.publication_controls.columns.map((column, index) => [column, values[index]])));
      expected.tables.publication_controls = [...backup.data.tables.publication_controls, row];
      publicationFreezeVersion = frozen.version;
    }
    const restored = await readData(client, schema);
    validateBusinessTables(restored.tables, restored.sequences, seed, restored.sqliteSchemaVersion, restored.postgresMigrations.length as MigrationSnapshot['schemaVersion']);
    const restoredDataDigest = digest(restored);
    if (restoredDataDigest !== digest(expected)) fail('restore_mismatch', '恢复会话撤销或发布冻结后的数据不一致，事务拒绝提交。');
    await client.query('COMMIT');
    return { ...backupReport(backup), restoredSchema: schema, restoredDataDigest, sessionsRevoked, publicationFrozen: publicationFreezeVersion !== null, publicationFreezeVersion,
      verified: true, verification: publicationFreezeVersion === null ? 'all-data-and-history; then-session-revocation; legacy-schema-without-publication' : 'all-data-and-history; then-session-revocation-and-publication-freeze' };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export function encryptBackup(backup: PostgresBackup, key: Buffer): Buffer {
  if (key.length !== 32) fail('invalid_backup_key', '备份密钥格式无效。');
  const plain = Buffer.from(JSON.stringify(backup)); if (plain.length > MAX_BYTES) fail('backup_too_large', '业务备份超过大小上限。');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(`${FORMAT}:1`));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.from(JSON.stringify({ format: FORMAT, version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') }));
}
export function decryptBackup(bytes: Buffer, key: Buffer, seed: unknown): PostgresBackup {
  if (bytes.length > MAX_BYTES * 1.5 || key.length !== 32) fail('invalid_backup', '备份文件大小或密钥无效。');
  try {
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (!exact(envelope, ['format', 'version', 'algorithm', 'iv', 'tag', 'ciphertext']) || envelope.format !== FORMAT || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error();
    const decode = (value: unknown, length?: number) => {
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
      const buffer = Buffer.from(value, 'base64'); if (buffer.toString('base64') !== value || (length !== undefined && buffer.length !== length)) throw new Error(); return buffer;
    };
    const decipher = createDecipheriv('aes-256-gcm', key, decode(envelope.iv, 12)); decipher.setAAD(Buffer.from(`${FORMAT}:1`)); decipher.setAuthTag(decode(envelope.tag, 16));
    const plain = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]); if (plain.length > MAX_BYTES) throw new Error();
    return validatePostgresBackup(JSON.parse(plain.toString('utf8')), seed);
  } catch { return fail('backup_authentication_failed', '备份无法认证或验证，拒绝恢复；请检查完整文件、独立密钥和目录版本。'); }
}
function ordinaryPath(filename: string, exists: boolean): string {
  const absolute = resolve(filename); const parent = dirname(absolute);
  const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  // Inspect every ancestor to reject links/junctions instead of only inspecting
  // the final file. Existing parent is required; no implicit directory creation.
  for (let current = parent; ; current = dirname(current)) {
    if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink() || !samePath(realpathSync(current), current)) fail('unsafe_backup_path', '备份父目录不能经过链接或重解析目录。');
    if (dirname(current) === current) break;
  }
  if (exists && (!lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink() || !samePath(realpathSync(absolute), absolute))) fail('unsafe_backup_path', '备份输入必须是明确普通文件。');
  return absolute;
}
export function writeBackupFile(filename: string, encrypted: Buffer): void {
  const absolute = ordinaryPath(filename, false); const fd = openSync(absolute, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
  try { if (!fstatSync(fd).isFile()) fail('unsafe_backup_path', '备份输出不是普通文件。'); writeFileSync(fd, encrypted); fsyncSync(fd); }
  finally { closeSync(fd); } // On failure retain the exact partial encrypted file; never delete/overwrite.
}
export function readBackupFile(filename: string): Buffer {
  const absolute = ordinaryPath(filename, true); const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > MAX_BYTES * 1.5) fail('invalid_backup', '备份文件类型或大小无效。'); return readFileSync(fd); }
  finally { closeSync(fd); }
}
