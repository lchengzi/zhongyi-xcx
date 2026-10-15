import { createHash } from 'node:crypto';
import { TABLE_NAMES, rowCounts, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { POSTGRES_MIGRATIONS } from '../server/postgres-upgrades.js';
import type { PostgresBackup } from '../server/postgres-backup.js';
import assert from 'node:assert/strict';
import { controlFrom } from '../server/publication-values.js';

export function assertRecoveryData(backup: PostgresBackup, restored: PostgresBackup): void {
  const expected = { ...backup.data, tables: { ...backup.data.tables, sessions: [] } };
  if (backup.data.postgresMigrations.length >= 6) {
    const rows = restored.data.tables.publication_controls;
    assert.equal(rows.length, backup.data.tables.publication_controls.length + 1);
    const row = rows.at(-1)!; const frozen = controlFrom(row);
    assert.equal(frozen.kind, 'recovery'); assert.equal(frozen.action, 'freeze');
    assert.equal(frozen.version, Number(backup.data.tables.publication_controls.at(-1)?.version || 0) + 1);
    assert.equal(frozen.evidenceReference, `backup:${backup.digest}`);
    assert.equal(frozen.actorId, null); assert.equal(frozen.actor, 'backup-restore'); assert.equal(frozen.accountRevision, null);
    assert(!backup.data.tables.publication_controls.some((item) => item.epoch === frozen.epoch));
    assert(Date.parse(frozen.recordedAt) >= Date.parse(backup.capturedAt));
    expected.tables.publication_controls = [...backup.data.tables.publication_controls, row];
  }
  assert.deepEqual(restored.data, expected, 'Only session revocation and the one validated recovery freeze may differ; all original rows, journals and sequences must remain identical.');
}

// Independently compute canonical hashes in tests, including deliberately invalid
// but correctly rehashed payloads. Hash validity is not business validity.
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const backupDigest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
export function rehashBackup(backup: PostgresBackup): PostgresBackup {
  backup.dataDigest = backupDigest(backup.data);
  const { digest: _, ...payload } = backup; backup.digest = backupDigest(payload); return backup;
}
// Synthetic metadata ONLY for crypto/validation unit tests. Real PostgreSQL
// recovery tests capture real journals/imports through capturePostgresBackup.
export function unitBackup(snapshot: MigrationSnapshot): PostgresBackup {
  const date = '2026-10-08T00:00:00.000Z';
  if (Object.keys(snapshot.tables).length !== TABLE_NAMES.length) throw new Error('Current owned fixture required');
  return rehashBackup({ format: 'food-education-postgres-business-backup', version: 1, sourceSchema: 'unit_backup',
    seedDigest: snapshot.seedDigest, capturedAt: date, dataDigest: '', digest: '', data: {
      sqliteSchemaVersion: snapshot.sourceSchemaVersion, tables: snapshot.tables, sequences: snapshot.sequences,
      postgresMigrations: POSTGRES_MIGRATIONS.map((row) => ({ version: row.version, checksum: row.checksum, applied_at: date })),
      migrationRuns: [{ id: 'unit-import', source_digest: snapshot.digest, seed_digest: snapshot.seedDigest,
        source_schema_version: snapshot.sourceSchemaVersion, row_counts: rowCounts(snapshot), migrated_at: date }]
    } });
}
