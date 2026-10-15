import type { Pool } from 'pg';
import { POSTGRES_SCHEMA_SQL } from './postgres-schema.js';
import { hash, identifier, MigrationError } from './migration-snapshot.js';
import { POSTGRES_PROFESSIONAL_SQL } from './professional-schema.js';
import { POSTGRES_SOURCE_CHECK_SQL } from './source-check-schema.js';
import { POSTGRES_PUBLICATION_SQL } from './publication-schema.js';
import { POSTGRES_PHOTO_NOTE_SQL } from './photo-note-schema.js';
import { POSTGRES_PHOTO_SUBMISSION_SQL } from './photo-submission-schema.js';
import { POSTGRES_PHOTO_RIGHTS_SQL } from './photo-rights-schema.js';
import { POSTGRES_PHOTO_PROFESSIONAL_SQL } from './photo-professional-schema.js';

// v1 stays byte-for-byte immutable. Add new migrations, never rewrite old SQL.
export const POSTGRES_ASSISTANT_SQL = `
CREATE TABLE editorial_excerpts (
  id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, locator TEXT NOT NULL, text TEXT NOT NULL,
  allow_external SMALLINT NOT NULL CHECK(allow_external IN (0,1)), digest TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(source_id, source_revision) REFERENCES source_versions(source_id, revision));
CREATE INDEX excerpt_ingredient ON editorial_excerpts(ingredient_id, created_at);
CREATE TABLE assistant_events (
  id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('disabled','openai','test-fixture')), model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','failed','refused')),
  request_digest TEXT NOT NULL, result_digest TEXT, error_code TEXT,
  metrics_payload TEXT NOT NULL CHECK(jsonb_typeof(metrics_payload::jsonb) = 'object'), created_at TEXT NOT NULL);
CREATE INDEX assistant_event_actor ON assistant_events(actor_id, created_at);
CREATE TRIGGER immutable_excerpt_change BEFORE UPDATE OR DELETE ON editorial_excerpts FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_excerpt_truncate BEFORE TRUNCATE ON editorial_excerpts FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_assistant_event_change BEFORE UPDATE OR DELETE ON assistant_events FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_assistant_event_truncate BEFORE TRUNCATE ON assistant_events FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
export const POSTGRES_ASSISTANT_CONTROLS_SQL = `
CREATE TABLE excerpt_permissions (id TEXT PRIMARY KEY, excerpt_id TEXT NOT NULL REFERENCES editorial_excerpts(id),
  revision INTEGER NOT NULL CHECK(revision > 0), allow_external SMALLINT NOT NULL CHECK(allow_external IN (0,1)),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL,
  UNIQUE(excerpt_id, revision));
CREATE TABLE assistant_quota_days (day_key TEXT PRIMARY KEY, limits_payload TEXT NOT NULL CHECK(jsonb_typeof(limits_payload::jsonb) = 'object'), created_at BIGINT NOT NULL);
CREATE TABLE assistant_reservations (id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  actor_id TEXT NOT NULL REFERENCES users(id), day_key TEXT NOT NULL REFERENCES assistant_quota_days(day_key), request_digest TEXT NOT NULL,
  evidence_payload TEXT NOT NULL CHECK(jsonb_typeof(evidence_payload::jsonb) = 'array'), created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL CHECK(expires_at = created_at + 45000));
CREATE INDEX assistant_reservation_actor ON assistant_reservations(day_key, actor_id);
CREATE INDEX assistant_reservation_expiry ON assistant_reservations(expires_at);
CREATE TRIGGER immutable_permission_change BEFORE UPDATE OR DELETE ON excerpt_permissions FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_permission_truncate BEFORE TRUNCATE ON excerpt_permissions FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_quota_day_change BEFORE UPDATE OR DELETE ON assistant_quota_days FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_quota_day_truncate BEFORE TRUNCATE ON assistant_quota_days FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_reservation_change BEFORE UPDATE OR DELETE ON assistant_reservations FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_reservation_truncate BEFORE TRUNCATE ON assistant_reservations FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
export const POSTGRES_MIGRATIONS = [
  { version: 1, sql: POSTGRES_SCHEMA_SQL, checksum: hash(POSTGRES_SCHEMA_SQL) },
  { version: 2, sql: POSTGRES_ASSISTANT_SQL, checksum: hash(POSTGRES_ASSISTANT_SQL) },
  { version: 3, sql: POSTGRES_ASSISTANT_CONTROLS_SQL, checksum: hash(POSTGRES_ASSISTANT_CONTROLS_SQL) },
  { version: 4, sql: POSTGRES_PROFESSIONAL_SQL, checksum: hash(POSTGRES_PROFESSIONAL_SQL) },
  { version: 5, sql: POSTGRES_SOURCE_CHECK_SQL, checksum: hash(POSTGRES_SOURCE_CHECK_SQL) },
  { version: 6, sql: POSTGRES_PUBLICATION_SQL, checksum: hash(POSTGRES_PUBLICATION_SQL) },
  { version: 7, sql: POSTGRES_PHOTO_NOTE_SQL, checksum: hash(POSTGRES_PHOTO_NOTE_SQL) },
  { version: 8, sql: POSTGRES_PHOTO_SUBMISSION_SQL, checksum: hash(POSTGRES_PHOTO_SUBMISSION_SQL) },
  { version: 9, sql: POSTGRES_PHOTO_RIGHTS_SQL, checksum: hash(POSTGRES_PHOTO_RIGHTS_SQL) },
  { version: 10, sql: POSTGRES_PHOTO_PROFESSIONAL_SQL, checksum: hash(POSTGRES_PHOTO_PROFESSIONAL_SQL) }
] as const;
export const LATEST_POSTGRES_VERSION = POSTGRES_MIGRATIONS[POSTGRES_MIGRATIONS.length - 1].version;
export function validatePostgresHistory(rows: { version: number; checksum: string }[], requireLatest = false): number {
  if (!rows.length || rows.length > POSTGRES_MIGRATIONS.length ||
    rows.some((row, index) => row.version !== POSTGRES_MIGRATIONS[index].version || row.checksum !== POSTGRES_MIGRATIONS[index].checksum) ||
    (requireLatest && rows.length !== POSTGRES_MIGRATIONS.length)) {
    throw new MigrationError('schema_changed', 'PostgreSQL 结构版本/摘要不匹配；旧库需先显式升级，不会自动修复。');
  }
  return rows.length;
}
export async function upgradePostgres(pool: Pool, schema: string): Promise<{ schema: string; targetSchemaVersion: number; publicationEnabled: false }> {
  const quoted = identifier(schema); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'");
    await client.query('SELECT pg_advisory_xact_lock(61037, hashtext($1))', [schema]);
    await client.query('SELECT pg_advisory_xact_lock(61038, hashtext($1))', [schema]);
    await client.query(`SET LOCAL search_path TO ${quoted}, pg_catalog`);
    const rows = (await client.query('SELECT version, checksum FROM postgres_migrations ORDER BY version')).rows;
    const current = validatePostgresHistory(rows);
    for (const migration of POSTGRES_MIGRATIONS.slice(current)) {
      await client.query(migration.sql);
      await client.query('INSERT INTO postgres_migrations VALUES ($1, $2, $3)', [migration.version, migration.checksum, new Date().toISOString()]);
    }
    await client.query('COMMIT');
    return { schema, targetSchemaVersion: LATEST_POSTGRES_VERSION, publicationEnabled: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
