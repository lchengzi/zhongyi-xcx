import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { identifier, readSqliteSnapshot, snapshotDigest, TABLE_NAMES, SOURCE_SCHEMA_VERSIONS, validateSnapshot, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { CatalogRepository } from '../server/database.js';
import { createPostgresPool } from '../server/postgres-migration.js';
import { migrationFixture, fileDigest, removeEmptyPublicationTables } from './migration-fixture.js';
import { PostgresRuntime } from '../server/postgres-runtime.js';
import { LATEST_POSTGRES_VERSION, POSTGRES_MIGRATIONS } from '../server/postgres-upgrades.js';

test('read-only consistent migration snapshot preserves all 32 tables, versions, secrets as hashes and source bytes', async () => {
  const fixture = await migrationFixture();
  try {
    const before = fileDigest(fixture.filename); const snapshot = fixture.read();
    assert.equal(fileDigest(fixture.filename), before); assert.equal(TABLE_NAMES.length, 32);
    assert.equal(snapshot.schemaVersion, 10); assert.equal(snapshot.sourceSchemaVersion, 12);
    assert.equal(snapshot.tables.ingredients.length, 3); assert.equal(snapshot.tables.users.length, 3);
    assert.equal(snapshot.tables.sessions.length, 1); assert.equal(snapshot.tables.source_versions.length, 2);
    assert.equal(snapshot.tables.content_revisions.length, 3); assert.equal(snapshot.tables.review_tasks.length, 3);
    assert.equal(snapshot.tables.editorial_excerpts.length, 1); assert.equal(snapshot.tables.assistant_events.length, 1);
    assert.equal(snapshot.tables.assistant_reservations.length, 1); assert.equal(snapshot.tables.assistant_quota_days.length, 1);
    assert.equal(snapshot.tables.excerpt_permissions.length, 2);
    assert.equal(snapshot.tables.editorial_notes[0].revision, 4);
    assert.equal(snapshot.tables.content_drafts.find((row) => row.ingredient_id === 'huang-qi')?.state, 'editorial_accepted');
    assert.equal(snapshot.tables.content_drafts.find((row) => row.ingredient_id === 'jiang')?.state, 'submitted');
    assert(snapshot.sequences.security_events > Math.max(...snapshot.tables.security_events.map((row) => Number(row.id))));
    assert.equal(JSON.stringify(snapshot).includes(fixture.token), false);
    assert.equal(JSON.stringify(snapshot).includes('migration-test-only-password-2026'), false);
    assert.deepEqual(validateSnapshot(snapshot, fixture.seed), snapshot);
  } finally { fixture.dispose(); }
});

test('legacy SQLite v4 preserves its original 18-table digest and data while a business reopen adds v12 tables', async () => {
  const fixture = await migrationFixture(undefined, false);
  try {
    const db = new DatabaseSync(fixture.filename);
    try {
      for (const table of ['assistant_reservations', 'assistant_quota_days', 'excerpt_permissions']) assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as any).count, 0);
      for (const table of ['source_checks', 'professional_reviews', 'professional_qualifications']) assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as any).count, 0);
      removeEmptyPublicationTables(db);
      db.exec('DROP TABLE source_checks; DROP TABLE professional_reviews; DROP TABLE professional_qualifications; DROP TABLE assistant_reservations; DROP TABLE assistant_quota_days; DROP TABLE excerpt_permissions; DELETE FROM migrations WHERE version >= 5');
    } finally { db.close(); }
    const before = fileDigest(fixture.filename); const snapshot = fixture.read(); assert.equal(snapshot.sourceSchemaVersion, 4); assert.equal(snapshot.schemaVersion, 2); assert.equal(Object.keys(snapshot.tables).length, 18);
    assert.equal(fileDigest(fixture.filename), before);
    const reopened = new CatalogRepository(fixture.filename, fixture.seed); reopened.close(); const upgraded = fixture.read();
    for (const name of Object.keys(snapshot.tables) as (keyof MigrationSnapshot['tables'])[]) if (name !== 'migrations') assert.deepEqual(upgraded.tables[name], snapshot.tables[name]);
    assert.equal(upgraded.sourceSchemaVersion, 12); assert.equal(upgraded.tables.assistant_reservations.length, 0);
  } finally { fixture.dispose(); }
});

test('legacy SQLite v3 remains read-only migratable; explicit business reopen adds v12 without rewriting old content', async () => {
  const fixture = await migrationFixture(undefined, false);
  try {
    const db = new DatabaseSync(fixture.filename);
    // Only the two known, empty, test-owned new tables are removed to create a genuine v3 fixture.
    try {
      assert.equal((db.prepare('SELECT COUNT(*) count FROM editorial_excerpts').get() as any).count, 0);
      assert.equal((db.prepare('SELECT COUNT(*) count FROM assistant_events').get() as any).count, 0);
      for (const table of ['source_checks', 'professional_reviews', 'professional_qualifications']) assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as any).count, 0);
      removeEmptyPublicationTables(db);
      db.exec('DROP TABLE source_checks; DROP TABLE professional_reviews; DROP TABLE professional_qualifications; DROP TABLE assistant_reservations; DROP TABLE assistant_quota_days; DROP TABLE excerpt_permissions; DROP TABLE assistant_events; DROP TABLE editorial_excerpts; DELETE FROM migrations WHERE version >= 4');
    } finally { db.close(); }
    const before = fileDigest(fixture.filename); const legacy = fixture.read();
    assert.equal(legacy.schemaVersion, 1); assert.equal(legacy.sourceSchemaVersion, 3); assert.equal(Object.keys(legacy.tables).length, 16);
    assert.equal(fileDigest(fixture.filename), before);
    const business = new CatalogRepository(fixture.filename, fixture.seed); business.close();
    const after = fixture.read(); assert.equal(after.sourceSchemaVersion, 12); assert.equal(Object.keys(after.tables).length, 32);
    for (const name of Object.keys(legacy.tables) as (keyof MigrationSnapshot['tables'])[]) {
      if (name !== 'migrations') assert.deepEqual(after.tables[name], legacy.tables[name]);
    }
    assert.deepEqual(after.tables.editorial_excerpts, []); assert.deepEqual(after.tables.assistant_events, []);
  } finally { fixture.dispose(); }
});

test('unknown schema/columns and out-of-band identity or provenance changes cannot silently migrate', async () => {
  const mutations = [
    "CREATE TABLE unknown_private_data (secret TEXT)",
    "ALTER TABLE editorial_notes ADD COLUMN unknown_secret TEXT",
    "UPDATE metadata SET value = 'forged' WHERE key = 'seedDigest'",
    "UPDATE ingredients SET search_text = 'bad-index' WHERE id = 'huang-qi'",
    "UPDATE content_drafts SET state = 'draft' WHERE ingredient_id = 'jiang'",
    "UPDATE review_tasks SET digest = 'forged' WHERE ingredient_id = 'huang-qi'",
    "UPDATE source_records SET revision = 99"
  ];
  for (const mutation of mutations) {
    const fixture = await migrationFixture();
    try {
      const writer = new DatabaseSync(fixture.filename); writer.exec(mutation); writer.close();
      const before = fileDigest(fixture.filename);
      assert.throws(() => readSqliteSnapshot(fixture.filename, fixture.seed));
      assert.equal(fileDigest(fixture.filename), before, 'failed validation must not repair or modify the source');
    } finally { fixture.dispose(); }
  }
});

test('real SQLite v5 stays read-only migratable and upgrades additively to v12 without changing old rows or sequences', async () => {
  const fixture = await migrationFixture();
  try {
    const db = new DatabaseSync(fixture.filename);
    try {
      for (const name of ['source_checks', 'professional_reviews', 'professional_qualifications']) assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${name}`).get() as any).count, 0);
      removeEmptyPublicationTables(db);
      db.exec('DROP TABLE source_checks; DROP TABLE professional_reviews; DROP TABLE professional_qualifications; DELETE FROM migrations WHERE version >= 6');
    } finally { db.close(); }
    const beforeBytes = fileDigest(fixture.filename); const before = fixture.read();
    assert.equal(before.sourceSchemaVersion, 5); assert.equal(before.schemaVersion, 3); assert.equal(Object.keys(before.tables).length, 21); assert.equal(fileDigest(fixture.filename), beforeBytes);
    const reopened = new CatalogRepository(fixture.filename, fixture.seed); reopened.close(); const after = fixture.read();
    assert.equal(after.sourceSchemaVersion, 12); assert.deepEqual(after.sequences, before.sequences);
    for (const name of Object.keys(before.tables) as (keyof MigrationSnapshot['tables'])[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.deepEqual(after.tables.professional_reviews, []); assert.deepEqual(after.tables.professional_qualifications, []);
  } finally { fixture.dispose(); }
});

test('snapshot tampering, unsafe integers and missing fixed references are rejected before a destination is used', async () => {
  const fixture = await migrationFixture();
  try {
    const snapshot = fixture.read();
    for (const mutate of [
      (value: MigrationSnapshot) => { value.tables.editorial_notes[0].text = 'changed'; },
      (value: MigrationSnapshot) => { value.sequences.security_events = 0; },
      (value: MigrationSnapshot) => { value.tables.sessions[0].expires_at = Number.MAX_SAFE_INTEGER + 1; },
      (value: MigrationSnapshot) => { value.tables.revision_sources[0].locator = 'changed'; },
      (value: MigrationSnapshot) => { value.tables.source_versions[0].title = 'changed'; },
      (value: MigrationSnapshot) => { value.tables.editorial_notes[0].text = 'null\0character'; }
    ]) {
      const value = JSON.parse(JSON.stringify(snapshot)); mutate(value);
      assert.throws(() => validateSnapshot(value, fixture.seed));
      const { digest: _old, ...payload } = value; value.digest = snapshotDigest(payload);
      // Text-only changes may legitimately be part of a new source snapshot;
      // unsafe values or broken immutable history remain invalid even rehashed.
      if (value.tables.editorial_notes[0].text !== 'changed') assert.throws(() => validateSnapshot(value, fixture.seed));
    }
  } finally { fixture.dispose(); }
});

test('genuine SQLite v6 remains read-only migratable; additive v12 keeps every old row and sequence unchanged', async () => {
  const fixture = await migrationFixture();
  try {
    const db = new DatabaseSync(fixture.filename);
    try { removeEmptyPublicationTables(db); assert.equal((db.prepare('SELECT COUNT(*) count FROM source_checks').get() as any).count, 0); db.exec('DROP TABLE source_checks; DELETE FROM migrations WHERE version = 7'); }
    finally { db.close(); }
    const bytes = fileDigest(fixture.filename); const before = fixture.read(); assert.equal(before.sourceSchemaVersion, 6); assert.equal(before.schemaVersion, 4); assert.equal(Object.keys(before.tables).length, 23); assert.equal(fileDigest(fixture.filename), bytes);
    const reopened = new CatalogRepository(fixture.filename, fixture.seed); reopened.close(); const after = fixture.read(); assert.equal(after.sourceSchemaVersion, 12);
    for (const name of Object.keys(before.tables) as (keyof MigrationSnapshot['tables'])[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.deepEqual(after.tables.source_checks, []); assert.deepEqual(after.sequences, before.sequences);
  } finally { fixture.dispose(); }
});

test('schema and connection parameters cannot select public/system schemas or inject SQL', () => {
  assert.equal(identifier('food_education'), '"food_education"');
  for (const name of ['', 'public', 'pg_catalog', 'information_schema', 'A', 'a.b', 'a; DROP SCHEMA public', 'x'.repeat(64)]) assert.throws(() => identifier(name));
  for (const url of ['', 'https://example.org/database', 'postgres://localhost/', 'postgres://localhost/database#secret']) assert.throws(() => createPostgresPool(url));
});

test('genuine SQLite v7 retains the original 24-table digest; additive v12 preserves all old rows and starts publication frozen', async () => {
  const fixture = await migrationFixture();
  try {
    const db = new DatabaseSync(fixture.filename);
    try { removeEmptyPublicationTables(db); } finally { db.close(); }
    const bytes = fileDigest(fixture.filename); const before = fixture.read();
    assert.equal(before.sourceSchemaVersion, 7); assert.equal(before.schemaVersion, 5); assert.equal(Object.keys(before.tables).length, 24);
    assert.equal(fileDigest(fixture.filename), bytes);
    const business = new CatalogRepository(fixture.filename, fixture.seed); business.close(); const after = fixture.read();
    assert.equal(after.sourceSchemaVersion, 12); assert.equal(after.schemaVersion, 10); assert.equal(Object.keys(after.tables).length, 32);
    for (const name of Object.keys(before.tables) as (keyof MigrationSnapshot['tables'])[]) if (name !== 'migrations') assert.deepEqual(after.tables[name], before.tables[name]);
    assert.deepEqual(after.sequences, before.sequences);
    for (const name of ['publication_snapshots', 'publication_approvals', 'publication_events', 'publication_controls'] as const) assert.deepEqual(after.tables[name], []);
  } finally { fixture.dispose(); }
});

test('PostgreSQL startup validates every supported SQLite import version, rejecting unknown journals and mismatched seed without changing history', async () => {
  assert.equal(LATEST_POSTGRES_VERSION, 10);
  assert.equal(LATEST_POSTGRES_VERSION, POSTGRES_MIGRATIONS.at(-1)?.version);
  // Unit-level query fixture, not a real PostgreSQL or deployment proof. The
  // independent PostgreSQL suite exercises the same gate on actual imports.
  for (const version of [...SOURCE_SCHEMA_VERSIONS, 2, 13]) {
    let releases = 0; const queries: string[] = [];
    const client = { query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT version, checksum')) return { rows: POSTGRES_MIGRATIONS.map(({ version, checksum }) => ({ version, checksum })) };
      if (sql.startsWith('SELECT seed_digest')) return { rows: [{ seed_digest: 'known-seed', source_schema_version: version }] };
      return { rows: [] };
    }, release: () => { releases++; } };
    const runtime = new PostgresRuntime({ connect: async () => client } as any, 'unit_startup');
    if (SOURCE_SCHEMA_VERSIONS.some((supported) => supported === version)) await runtime.validate('known-seed');
    else await assert.rejects(runtime.validate('known-seed'), (e: any) => e.code === 'invalid_run');
    await assert.rejects(runtime.validate('wrong-seed'), (e: any) => e.code === 'invalid_run');
    assert.equal(releases, 2); assert(queries.some((sql) => sql === 'ROLLBACK'));
    assert(!queries.some((sql) => /^(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)));
  }
});
