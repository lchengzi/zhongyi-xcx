import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTGRES_RUNTIME_POLICY, runtimePermissionStatements } from '../server/postgres-permissions.js';
import { TABLE_NAMES } from '../server/migration-snapshot.js';

test('runtime permission inventory covers exactly the current tables without wildcard, ownership, grant option or DDL grants', () => {
  assert.deepEqual(Object.keys(POSTGRES_RUNTIME_POLICY).sort(), [...TABLE_NAMES, 'postgres_migrations', 'migration_runs'].sort());
  const statements = runtimePermissionStatements('food_workspace', 'food_runtime');
  assert.equal(statements.length, Object.keys(POSTGRES_RUNTIME_POLICY).length + 4);
  assert.equal(statements.filter((sql) => sql.includes('ON SEQUENCE')).length, 3);
  for (const sql of statements) assert.doesNotMatch(sql, /\b(ALL|CREATE|OWNER|TRUNCATE|TRIGGER|REFERENCES|MAINTAIN|REVOKE|PASSWORD|UPDATE ON SEQUENCE)\b|WITH GRANT OPTION/);
});
test('runtime table policy protects catalog/migration/history while allowing only required mutable operations', () => {
  for (const table of ['migrations','postgres_migrations','migration_runs','ingredients','metadata'] as const) assert.deepEqual(POSTGRES_RUNTIME_POLICY[table], ['SELECT']);
  for (const table of ['audit_events','security_events','workflow_events','publication_events','source_versions','photo_notes','photo_submissions','photo_rights_reviews','photo_professional_reviews'] as const) assert.deepEqual(POSTGRES_RUNTIME_POLICY[table], ['SELECT','INSERT']);
  assert.deepEqual(Object.entries(POSTGRES_RUNTIME_POLICY).filter(([, grants]) => (grants as readonly string[]).includes('DELETE')).map(([name]) => name).sort(), ['login_attempts','sessions']);
});
test('runtime grant plan validates both identifiers before generating any SQL', () => {
  for (const bad of ['', 'public', 'pg_owner', 'food; GRANT ALL', 'Food', 'x'.repeat(64), 'food"role']) {
    assert.throws(() => runtimePermissionStatements(bad, 'food_runtime'));
    assert.throws(() => runtimePermissionStatements('food_workspace', bad));
  }
});
