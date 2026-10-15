import { randomUUID } from 'node:crypto';
import { Client, Pool, types, type ClientConfig, type PoolClient, type PoolConfig } from 'pg';
import { observePostgresConnection } from './postgres-connection-diagnostics.js';
import { OwnedPostgresPool } from './postgres-pool.js';
import { withMigrationTransaction as transaction } from './migration-transaction.js';
import { initializationFailed, initializationPhase, type InitializationObserver } from './initialization-diagnostics.js';
import { readSecretFile } from './secret-file.js';
import { assertNoLinks } from './demo-secrets.js';
import type { CatalogSeed } from '../shared/contracts.js';
import { POSTGRES_SCHEMA_SQL, POSTGRES_SCHEMA_VERSION } from './postgres-schema.js';
import {
  TABLES, TABLE_NAMES, SEQUENCE_TABLES, hash, identifier, MigrationError, normalizeRow,
  rowCounts, snapshotDigest, validateSnapshot, SOURCE_SCHEMA_VERSIONS, type MigrationSnapshot, type Row, type TableName
} from './migration-snapshot.js';
import { snapshotTableNames } from './migration-snapshot.js';
import { LATEST_POSTGRES_VERSION, POSTGRES_MIGRATIONS, validatePostgresHistory } from './postgres-upgrades.js';
import { CONTROL_INSERT, controlFrom, controlValues, recoveryFreeze } from './publication-values.js';
import { verifyPublicationControls } from './publication-integrity.js';

export const postgresMigrationChecksum = hash(POSTGRES_SCHEMA_SQL);

export function postgresConnectionOptions(databaseUrl: string, requireTls = false): Pick<PoolConfig, 'connectionString' | 'ssl' | 'sslnegotiation'> {
  const invalid = () => new MigrationError('invalid_connection', 'PostgreSQL 连接配置无效；TLS 仅接受 verify-full，凭据和文件路径不写入错误信息。');
  let url: URL;
  try { url = new URL(databaseUrl); decodeURIComponent(url.username); decodeURIComponent(url.password); }
  catch { throw invalid(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) {
    throw invalid();
  }
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!['sslmode', 'sslrootcert'].includes(key) || seen.has(key)) throw invalid();
    seen.add(key);
  }
  const mode = url.searchParams.get('sslmode'); const caFile = url.searchParams.get('sslrootcert');
  if ((mode !== null && !['disable', 'verify-full'].includes(mode)) || (caFile !== null && mode !== 'verify-full')) throw invalid();
  if ((requireTls || process.env.NODE_ENV === 'production') && mode !== 'verify-full') {
    throw new MigrationError('tls_required', '生产 PostgreSQL 连接必须显式使用 sslmode=verify-full；拒绝明文或降级，凭据和文件路径不写入错误信息。');
  }
  let ca: Buffer | undefined;
  if (caFile !== null) {
    try { assertNoLinks(caFile); ca = readSecretFile(caFile, 65536); }
    catch { throw invalid(); }
  }
  // Strip URL SSL options before pg parses the URL: its parser would replace
  // the verified ssl object. Explicit false also prevents ambient PGSSLMODE
  // from changing the transport selected by the existing local demo.
  url.search = '';
  return { connectionString: url.toString(), sslnegotiation: 'postgres', ssl: mode === 'verify-full'
    ? { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(ca ? { ca } : {}) } : false };
}
export function createPostgresPool(databaseUrl: string, requireTls = false): Pool {
  const diagnostics = process.env.PG_CONNECTION_DIAGNOSTICS === 'true';
  class ObservedClient extends Client {
    constructor(config?: string | ClientConfig) {
      super(config);
      observePostgresConnection(this, trace => console.log(JSON.stringify(trace)));
    }
  }
  return new OwnedPostgresPool({
    ...(diagnostics ? { Client: ObservedClient } : {}),
    ...postgresConnectionOptions(databaseUrl, requireTls), max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true,
    // Millisecond expiry and BIGINT event IDs fit JS safe integers; never round.
    types: { getTypeParser(oid: number, format?: 'text' | 'binary') {
      if (oid === 20 && format !== 'binary') return (value: string) => {
        const result = Number(value); if (!Number.isSafeInteger(result)) throw new MigrationError('unsafe_integer', 'PostgreSQL 整数超出安全范围。');
        return result;
      };
      return types.getTypeParser(oid, format || 'text');
    } }
  });
}

const qualified = (schema: string, name: TableName) => `${identifier(schema)}."${name}"`;
export async function readTables(client: PoolClient, schema: string, names = TABLE_NAMES): Promise<Record<TableName, Row[]>> {
  const tables = {} as Record<TableName, Row[]>;
  for (const name of names) {
    const { columns, order } = TABLES[name];
    // C ordering matches SQLite BINARY for text. Numeric keys stay numeric.
    const ordering = order.map((key) => {
      const integer = ['version', 'revision', 'content_revision', 'position'].includes(key) ||
        (key === 'id' && SEQUENCE_TABLES.includes(name as typeof SEQUENCE_TABLES[number]));
      return `"${key}"${integer ? '' : ' COLLATE "C"'}`;
    });
    const result = await client.query(`SELECT ${columns.map((key) => `"${key}"`).join(',')} FROM ${qualified(schema, name)} ORDER BY ${ordering.join(',')}`);
    tables[name] = result.rows.map((row) => normalizeRow(name, row));
  }
  return tables;
}

export async function readSequences(client: PoolClient, schema: string): Promise<MigrationSnapshot['sequences']> {
  const result = {} as MigrationSnapshot['sequences'];
  for (const name of SEQUENCE_TABLES) {
    const sequence = await client.query(`SELECT last_value, is_called FROM ${identifier(schema)}."${name}_id_seq"`);
    result[name] = sequence.rows[0].is_called ? sequence.rows[0].last_value : 0;
  }
  return result;
}

export async function insertTables(client: PoolClient, schema: string, snapshot: Pick<MigrationSnapshot, 'schemaVersion' | 'tables' | 'sequences'>): Promise<void> {
  for (const name of snapshotTableNames(snapshot)) {
    const rows = snapshot.tables[name]; const { columns } = TABLES[name];
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200); const parameters: Row[string][] = [];
      const values = batch.map((row) => `(${columns.map((key) => { parameters.push(row[key]); return `$${parameters.length}`; }).join(',')})`);
      await client.query(`INSERT INTO ${qualified(schema, name)} (${columns.map((key) => `"${key}"`).join(',')}) VALUES ${values.join(',')}`, parameters);
    }
  }
  for (const name of SEQUENCE_TABLES) {
    const value = snapshot.sequences[name];
    await client.query('SELECT pg_catalog.setval($1::regclass, $2::bigint, $3::boolean)', [`${schema}.${name}_id_seq`, value || 1, value > 0]);
  }
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
}

export interface MigrationReport {
  migrationId: string;
  schema: string;
  sourceDigest: string;
  seedDigest: string;
  rowCounts: Record<string, number>;
  sourceSchemaVersion: MigrationSnapshot['sourceSchemaVersion'];
  targetSchemaVersion: number;
  verified: true;
  publicationEnabled: false;
  publicationFrozen: boolean;
  publicationFreezeVersion: number | null;
}

export async function migrateSqliteToPostgres(pool: Pool, schema: string, input: MigrationSnapshot, seed: CatalogSeed, observer?: InitializationObserver): Promise<MigrationReport> {
  initializationPhase(observer, 'snapshot-validation');
  identifier(schema);
  // Own and validate a copy before awaiting a connection; a caller cannot mutate
  // an approved snapshot while this transaction waits on the pool or lock.
  const snapshot = validateSnapshot(JSON.parse(JSON.stringify(input)), seed);
  return transaction(pool, async (client: PoolClient) => {
    // Serialize only migrations targeting the same namespace, not all traffic.
    initializationPhase(observer, 'postgres-lock');
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(61037, pg_catalog.hashtext($1))', [schema]);
    initializationPhase(observer, 'postgres-target-check');
    if ((await client.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [schema])).rowCount) {
      throw new MigrationError('target_exists', '目标 schema 已存在；拒绝覆盖，请使用全新目标并保留旧库。');
    }
    initializationPhase(observer, 'postgres-schema');
    await client.query(`CREATE SCHEMA ${identifier(schema)}`);
    await client.query(`SET LOCAL search_path TO ${identifier(schema)}`);
    for (const migration of POSTGRES_MIGRATIONS) {
      await client.query(migration.sql);
      await client.query('INSERT INTO postgres_migrations VALUES ($1, $2, $3)', [migration.version, migration.checksum, new Date().toISOString()]);
    }
    initializationPhase(observer, 'postgres-copy');
    await insertTables(client, schema, snapshot);
    initializationPhase(observer, 'postgres-verify');
    const tables = await readTables(client, schema, snapshotTableNames(snapshot)); const sequences = await readSequences(client, schema);
    const payload = { schemaVersion: snapshot.schemaVersion, sourceSchemaVersion: snapshot.sourceSchemaVersion, seedDigest: seed.digest, tables, sequences };
    const migrated = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, seed);
    if (migrated.digest !== snapshot.digest) throw new MigrationError('roundtrip_mismatch', '目标逐行校验与源快照不一致，事务已拒绝提交。');
    initializationPhase(observer, 'postgres-audit');
    const migrationId = randomUUID(); let publicationFreezeVersion: number | null = null;
    const priorControl = snapshot.tables.publication_controls?.at(-1);
    if (snapshot.tables.publication_snapshots?.length) {
      // Preserve the exact imported baseline above, then prevent an imported
      // publication pointer from silently becoming live in another database.
      const frozen = recoveryFreeze(priorControl ? controlFrom(priorControl) : undefined, `migration:${migrationId}:${snapshot.digest}`);
      let parameter = 0;
      await client.query(CONTROL_INSERT.replace(/\?/g, () => `$${++parameter}`), controlValues(frozen));
      publicationFreezeVersion = frozen.version;
    }
    const report: MigrationReport = { migrationId, schema, sourceDigest: snapshot.digest, seedDigest: seed.digest,
      rowCounts: rowCounts(snapshot), sourceSchemaVersion: snapshot.sourceSchemaVersion, targetSchemaVersion: LATEST_POSTGRES_VERSION, verified: true, publicationEnabled: false,
      publicationFrozen: publicationFreezeVersion !== null || priorControl?.action !== 'resume', publicationFreezeVersion };
    await client.query('INSERT INTO migration_runs VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [report.migrationId, report.sourceDigest, report.seedDigest, report.sourceSchemaVersion, JSON.stringify(report.rowCounts), new Date().toISOString()]);
    return report;
  }, false, observer).catch(error => { initializationFailed(observer, error); throw error; });
}

// Cutover/restart proof: before starting writers, re-read and match the committed
// snapshot. Once new writes begin, this baseline is historical, not a live hash.
export async function verifyImportedPostgres(pool: Pool, schema: string, seed: CatalogSeed): Promise<MigrationReport> {
  identifier(schema);
  return transaction(pool, async (client: PoolClient) => {
    const migration = await client.query(`SELECT version, checksum FROM ${identifier(schema)}.postgres_migrations ORDER BY version`);
    const targetSchemaVersion = validatePostgresHistory(migration.rows);
    const result = await client.query(`SELECT * FROM ${identifier(schema)}.migration_runs ORDER BY migrated_at DESC, id DESC LIMIT 1`);
    const run = result.rows[0];
    const sourceSchemaVersion = run?.source_schema_version as MigrationSnapshot['sourceSchemaVersion'];
    const schemaVersion = (sourceSchemaVersion - 2) as MigrationSnapshot['schemaVersion'];
    const names = snapshotTableNames({ schemaVersion });
    if (!run || run.seed_digest !== seed.digest || !SOURCE_SCHEMA_VERSIONS.includes(sourceSchemaVersion) || !run.row_counts ||
      Object.keys(run.row_counts).sort().join() !== names.slice().sort().join()) throw new MigrationError('invalid_run', '缺少相应的已提交迁移记录。');
    const tables = await readTables(client, schema, names); const sequences = await readSequences(client, schema);
    let publicationFreezeVersion: number | null = null;
    const currentControl = tables.publication_controls?.at(-1);
    if (tables.publication_snapshots?.length) {
      const frozen = currentControl ? controlFrom(currentControl) : undefined;
      if (!frozen || frozen.kind !== 'recovery' || frozen.action !== 'freeze' || frozen.evidenceReference !== `migration:${run.id}:${run.source_digest}`) throw new MigrationError('roundtrip_mismatch', '迁移后的独立发布冻结记录不一致。');
      verifyPublicationControls(tables.publication_controls.map(controlFrom).reverse());
      publicationFreezeVersion = frozen.version;
      // Verify every original row against the original source digest; only the
      // one explicit, independently validated post-copy freeze is additional.
      tables.publication_controls = tables.publication_controls.slice(0, -1);
    }
    const payload = { schemaVersion, sourceSchemaVersion, seedDigest: seed.digest, tables, sequences };
    const snapshot = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, seed);
    if (snapshot.digest !== run.source_digest || JSON.stringify(rowCounts(snapshot)) !== JSON.stringify(Object.fromEntries(names.map((name) => [name, run.row_counts[name]])))) {
      throw new MigrationError('roundtrip_mismatch', '提交后的目标数据已与原迁移快照不同。');
    }
    return { migrationId: run.id, schema, sourceDigest: run.source_digest, seedDigest: seed.digest,
      rowCounts: rowCounts(snapshot), sourceSchemaVersion, targetSchemaVersion, verified: true, publicationEnabled: false,
      publicationFrozen: publicationFreezeVersion !== null || currentControl?.action !== 'resume', publicationFreezeVersion };
  }, true);
}
