import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { createPostgresPool, migrateSqliteToPostgres, verifyImportedPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { POSTGRES_SCHEMA_SQL } from '../server/postgres-schema.js';
import { POSTGRES_MIGRATIONS, upgradePostgres } from '../server/postgres-upgrades.js';
import { BASE_TABLE_NAMES, EXCERPT_TABLE_NAMES, TABLES, SEQUENCE_TABLES, identifier, rowCounts, snapshotDigest, snapshotTableNames, validateSnapshot, type MigrationSnapshot } from '../server/migration-snapshot.js';
import { AssistantService } from '../server/assistant-service.js';
import { DEFAULT_ASSISTANT_LIMITS } from '../server/assistant-limits.js';
import { fixtureOutput } from './assistant-fixture.js';
import { fixtureAssistant } from './assistant-fixture.js';
import { migrationFixture, fixturePassword } from './migration-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('Real isolated PostgreSQL is required; use npm run test:postgres.');
const schemaName = () => `assistant_${randomUUID().replaceAll('-', '')}`;

test('real PostgreSQL imports excerpt/call audit rows and enforces immutable history; HTTP generation stays private', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName(); const target = identifier(schema);
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined;
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    const snapshot = fixture.read(); const report = await migrateSqliteToPostgres(pool, schema, snapshot, fixture.seed);
    assert.equal(report.sourceSchemaVersion, 12); assert.equal(report.targetSchemaVersion, 10);
    assert.equal(report.rowCounts.editorial_excerpts, 1); assert.equal(report.rowCounts.assistant_events, 1);
    assert.deepEqual(await verifyImportedPostgres(pool, schema, fixture.seed), report);
    for (const [table, column] of [['editorial_excerpts', 'text'], ['assistant_events', 'model']]) {
      for (const sql of [`UPDATE ${target}.${table} SET ${column} = 'tampered'`, `DELETE FROM ${target}.${table}`, `TRUNCATE ${target}.${table} CASCADE`]) await assert.rejects(pool.query(sql), (error: any) => error.code === '23514');
    }
    stores = await openPostgresStore(connection!, schema, fixture.seed);
    const before = await stores.catalog.publicSnapshot();
    const session = await stores.auth.login(fixture.editor.username, fixturePassword, '127.0.0.1');
    const origin = 'https://pg-assistant.example.test';
    server = createApp(stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { assistantProvider: fixtureAssistant() }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/editorial/assistant/ingredients/gou-qi-zi`;
    const headers = { Origin: origin, Cookie: `food_session=${session.token}`, 'X-CSRF-Token': session.info.csrfToken, 'Content-Type': 'application/json' };
    const response = await fetch(`${base}/excerpts`, { method: 'POST', headers, body: JSON.stringify({ sourceId: fixture.sourceId, sourceRevision: 1, locator: '测试身份段落', text: '测试所列部位为果实，形态为干燥品。', allowExternal: true }) });
    assert.equal(response.status, 201); const excerpt = await response.json();
    const generated = await fetch(`${base}/generate`, { method: 'POST', headers, body: JSON.stringify({ evidenceIds: [excerpt.id], confirmExternalTransfer: true }) });
    assert.equal(generated.status, 200); const result = await generated.json(); assert.equal(result.simulated, true); assert.equal(result.publicationEnabled, false);
    assert.equal(result.citations[0].digest, excerpt.digest); assert.equal(result.citations[0].sourceRevision, 1);
    assert.equal((await stores.workflow.detail('gou-qi-zi')).draft, null);
    assert.deepEqual(await stores.catalog.publicSnapshot(), before);
    assert.equal((await stores.assistant.events()).length, 2);
    const read = await fetch(`${base}/excerpts?q=${encodeURIComponent("' OR 1=1 --")}`, { headers }); assert.equal((await read.json()).items.length, 0);
    await assert.rejects(pool.query(`INSERT INTO ${target}.editorial_excerpts SELECT $1, ingredient_id, source_id, 99, locator, text, allow_external, digest, author_id, author_name, created_at FROM ${target}.editorial_excerpts LIMIT 1`, [randomUUID()]), (error: any) => error.code === '23503');
    // A stale actor cannot save after session revocation, even through a direct store call.
    await stores.auth.updateUser(session.info.user.id, 'reviewer', true, session.info.user.revision, 'test-fixture');
    await assert.rejects(async () => stores!.assistant.saveExcerpt('gou-qi-zi', { sourceId: fixture.sourceId, sourceRevision: 1, locator: '位置', text: '测试果实', allowExternal: false }, session.info.user, session.token));
  } finally {
    if (server) { const closed = once(server, 'close'); server.close(); await closed; }
    await stores?.close(); await pool.end(); fixture.dispose();
  }
});

test('real PostgreSQL review HTTP shares quotas, preserves private drafts and records malformed findings without plaintext', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName();
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined; let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); stores = await openPostgresStore(connection!, schema, fixture.seed);
    const session = await stores.auth.login(fixture.editor.username, fixturePassword, '127.0.0.1'); const origin = 'https://pg-review.example.test';
    let invalid = false; const provider = fixtureAssistant(); const generate = provider.generate;
    provider.generate = async (input, signal) => invalid ? { value: { statements: [], findings: [] }, inputTokens: 4, outputTokens: 3, estimatedCostUsd: null } : generate(input, signal);
    server = createApp(stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { assistantProvider: provider }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const headers = { Origin: origin, Cookie: `food_session=${session.token}`, 'X-CSRF-Token': session.info.csrfToken, 'Content-Type': 'application/json' };
    const before = await stores.catalog.publicSnapshot(); const draftBefore = await stores.workflow.detail('huang-qi');
    const excerpt = await stores.assistant.saveExcerpt('huang-qi', { sourceId: fixture.sourceId, sourceRevision: 1, locator: '测试检查页', text: '测试记载为根，记录形态为干燥切片。', allowExternal: true }, session.info.user, session.token);
    const route = `${base}/editorial/assistant/ingredients/huang-qi/generate`; const body = { evidenceIds: [excerpt.id], confirmExternalTransfer: true, mode: 'review' };
    const quotaBefore = await stores.assistant.quota(session.info.user.id, { ...DEFAULT_ASSISTANT_LIMITS });
    const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.mode, 'review'); assert.equal(result.findings.length, 3); assert.equal(result.findings[1].kind, 'candidate');
    assert.deepEqual(result.citations, [excerpt]); assert.equal(result.publicationEnabled, false); assert.equal(result.professionalReviewState, 'pending');
    assert.deepEqual(result.gaps, ['identity', 'processing', 'safety_boundary']);
    invalid = true; const rejected = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(rejected.status, 502); assert.equal((await rejected.json()).error, 'unsupported_output');
    assert.equal((await stores.assistant.quota(session.info.user.id, { ...DEFAULT_ASSISTANT_LIMITS })).usedByActor, quotaBefore.usedByActor + 2);
    assert.deepEqual(await stores.workflow.detail('huang-qi'), draftBefore); assert.deepEqual(await stores.catalog.publicSnapshot(), before);
    const events = await stores.assistant.events(); assert.equal(events.find((event) => event.errorCode === 'unsupported_output')!.resultDigest, null);
    assert.equal(JSON.stringify(events).includes(excerpt.text), false);
  } finally { if (server) { const closed = once(server, 'close'); server.close(); await closed; } await stores?.close(); await pool.end(); fixture.dispose(); }
});

function legacySnapshot(fixture: Awaited<ReturnType<typeof migrationFixture>>, version: 3 | 4 = 3): MigrationSnapshot {
  const current = fixture.read();
  const names = version === 3 ? BASE_TABLE_NAMES : EXCERPT_TABLE_NAMES;
  const tables = Object.fromEntries(names.map((name) => [name, name === 'migrations' ? current.tables[name].filter((row) => Number(row.version) <= version) : current.tables[name]])) as MigrationSnapshot['tables'];
  const payload = { schemaVersion: version === 3 ? 1 as const : 2 as const, sourceSchemaVersion: version, seedDigest: current.seedDigest, tables, sequences: current.sequences };
  return validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, fixture.seed);
}

test('real PostgreSQL summary HTTP preserves fixed sources, shares extract quota and rejects invalid output without draft publication', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName();
  let stores: Awaited<ReturnType<typeof openPostgresStore>> | undefined; let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); stores = await openPostgresStore(connection!, schema, fixture.seed);
    const session = await stores.auth.login(fixture.editor.username, fixturePassword, '127.0.0.1'); const origin = 'https://pg-summary.example.test';
    let invalid = false; const provider = fixtureAssistant(); const generate = provider.generate;
    provider.generate = async (input, signal) => invalid ? { value: { ...fixtureOutput(input), sections: [{ field: 'processing', text: '测试形态', evidenceIds: ['invented'] }] }, inputTokens: 4, outputTokens: 3, estimatedCostUsd: null } : generate(input, signal);
    server = createApp(stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { assistantProvider: provider }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`; const headers = { Origin: origin, Cookie: `food_session=${session.token}`, 'X-CSRF-Token': session.info.csrfToken, 'Content-Type': 'application/json' };
    const before = await stores.catalog.publicSnapshot(); const draftBefore = await stores.workflow.detail('huang-qi');
    const excerpt = await stores.assistant.saveExcerpt('huang-qi', { sourceId: fixture.sourceId, sourceRevision: 1, locator: '测试摘要页', text: '测试记载为根，记录形态为干燥切片。', allowExternal: true }, session.info.user, session.token);
    const body = { evidenceIds: [excerpt.id], confirmExternalTransfer: true, mode: 'summary' }; const route = `${base}/editorial/assistant/ingredients/huang-qi/generate`;
    const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.mode, 'summary'); assert.equal(result.sections.length, 1); assert.deepEqual(result.citations, [excerpt]); assert.equal(result.publicationEnabled, false); assert.ok(result.gaps.includes('safety_boundary'));
    invalid = true; const rejected = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(rejected.status, 502); assert.equal((await rejected.json()).error, 'unsupported_output');
    assert.equal((await stores.assistant.quota(session.info.user.id, { ...DEFAULT_ASSISTANT_LIMITS })).usedByActor, 2);
    assert.deepEqual(await stores.workflow.detail('huang-qi'), draftBefore);
    assert.deepEqual(await stores.catalog.publicSnapshot(), before);
    const events = await stores.assistant.events(); assert.equal(events.find((event) => event.errorCode === 'unsupported_output')!.resultDigest, null); assert.equal(JSON.stringify(events).includes(excerpt.text), false);
  } finally { if (server) { const closed = once(server, 'close'); server.close(); await closed; } await stores?.close(); await pool.end(); fixture.dispose(); }
});
async function createLegacyNamespace(pool: ReturnType<typeof createPostgresPool>, schema: string, snapshot: MigrationSnapshot) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${identifier(schema)}; SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
    for (const migration of POSTGRES_MIGRATIONS.slice(0, snapshot.schemaVersion)) {
      await client.query(migration.sql);
      await client.query('INSERT INTO postgres_migrations VALUES ($1, $2, $3)', [migration.version, migration.checksum, new Date().toISOString()]);
    }
    for (const name of snapshotTableNames(snapshot)) {
      const columns = TABLES[name].columns;
      for (const row of snapshot.tables[name]) await client.query(`INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, columns.map((column) => row[column]));
    }
    for (const name of SEQUENCE_TABLES) {
      const value = snapshot.sequences[name]; await client.query('SELECT pg_catalog.setval($1::regclass, $2::bigint, $3)', [`${schema}.${name}_id_seq`, value || 1, value > 0]);
    }
    await client.query('INSERT INTO migration_runs VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [randomUUID(), snapshot.digest, snapshot.seedDigest, snapshot.sourceSchemaVersion, JSON.stringify(rowCounts(snapshot)), new Date().toISOString()]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

test('real legacy PostgreSQL v1 requires explicit idempotent v9 upgrade and preserves the original 16-table import digest', async () => {
  const fixture = await migrationFixture(undefined, false); const pool = createPostgresPool(connection!); const schema = schemaName(); const imported = schemaName();
  try {
    const snapshot = legacySnapshot(fixture); await createLegacyNamespace(pool, schema, snapshot);
    const before = await verifyImportedPostgres(pool, schema, fixture.seed); assert.equal(before.targetSchemaVersion, 1);
    await assert.rejects(openPostgresStore(connection!, schema, fixture.seed), (error: any) => error.code === 'schema_changed');
    const upgraded = await upgradePostgres(pool, schema); assert.equal(upgraded.targetSchemaVersion, 10); assert.equal(upgraded.publicationEnabled, false);
    assert.deepEqual(await upgradePostgres(pool, schema), upgraded);
    const after = await verifyImportedPostgres(pool, schema, fixture.seed);
    assert.deepEqual(after, { ...before, targetSchemaVersion: 10 }); assert.equal(after.sourceDigest, snapshot.digest);
    const stores = await openPostgresStore(connection!, schema, fixture.seed);
    try { assert.deepEqual(await stores.assistant.excerpts('huang-qi'), []); assert.deepEqual(await stores.assistant.events(), []); }
    finally { await stores.close(); }
    const report = await migrateSqliteToPostgres(pool, imported, snapshot, fixture.seed);
    assert.equal(report.sourceSchemaVersion, 3); assert.equal(report.targetSchemaVersion, 10); assert.equal(Object.keys(report.rowCounts).length, 16);
    assert.deepEqual(await verifyImportedPostgres(pool, imported, fixture.seed), report);
  } finally { await pool.end(); fixture.dispose(); }
});

test('real PostgreSQL v2 upgrades only new controls, preserving the 18-table snapshot and original v1/v2 checksums', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName(); const imported = schemaName();
  try {
    const snapshot = legacySnapshot(fixture, 4); await createLegacyNamespace(pool, schema, snapshot);
    const before = await verifyImportedPostgres(pool, schema, fixture.seed); assert.equal(before.targetSchemaVersion, 2); assert.equal(Object.keys(before.rowCounts).length, 18);
    await assert.rejects(openPostgresStore(connection!, schema, fixture.seed));
    assert.equal((await upgradePostgres(pool, schema)).targetSchemaVersion, 10);
    assert.deepEqual(await verifyImportedPostgres(pool, schema, fixture.seed), { ...before, targetSchemaVersion: 10 });
    const journals = (await pool.query(`SELECT version, checksum FROM ${identifier(schema)}.postgres_migrations ORDER BY version`)).rows;
    assert.deepEqual(journals.slice(0, 2), POSTGRES_MIGRATIONS.slice(0, 2).map(({ version, checksum }) => ({ version, checksum })));
    const stores = await openPostgresStore(connection!, schema, fixture.seed);
    try {
      const quota = await stores.assistant.quota(fixture.admin.id, { ...DEFAULT_ASSISTANT_LIMITS }); assert.equal(quota.usedTotal, 0);
      const excerpt = (await stores.assistant.excerpts('huang-qi'))[0]; assert.equal(excerpt.externalPermission.revision, 0); assert.equal(excerpt.externalPermission.allowed, true);
    } finally { await stores.close(); }
    const report = await migrateSqliteToPostgres(pool, imported, snapshot, fixture.seed); assert.equal(report.sourceSchemaVersion, 4); assert.equal(report.targetSchemaVersion, 10);
    assert.deepEqual(await verifyImportedPostgres(pool, imported, fixture.seed), report);
  } finally { await pool.end(); fixture.dispose(); }
});

test('two real PostgreSQL pools coordinate pending leases, daily counters and inconsistent-instance policies', async () => {
  const fixture = await migrationFixture(undefined, false); const pool = createPostgresPool(connection!); const schema = schemaName();
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined; let two: typeof one;
  let release!: () => void; let entered!: () => void; let calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); one = await openPostgresStore(connection!, schema, fixture.seed); two = await openPostgresStore(connection!, schema, fixture.seed);
    const actor = await one.auth.login(fixture.editor.username, fixturePassword, '127.0.0.1'); const admin = (await one.auth.session(fixture.token))!;
    const otherUser = await one.auth.createUser('quota-other-editor', fixturePassword, 'editor', 'test-fixture'); const other = await one.auth.login(otherUser.username, fixturePassword, '127.0.0.1');
    const excerpt = await one.assistant.saveExcerpt('huang-qi', { sourceId: fixture.sourceId, sourceRevision: 1, locator: '测试页', text: '测试材料所列部位为根。', allowExternal: true }, actor.info.user, actor.token);
    const limits = { ...DEFAULT_ASSISTANT_LIMITS, dailyTotal: 2, dailyPerActor: 2 }; const provider = fixtureAssistant();
    provider.generate = async (input) => { calls++; entered(); await gate; return { value: fixtureOutput(input), inputTokens: null, outputTokens: null, estimatedCostUsd: null }; };
    const firstService = new AssistantService(one, provider, limits); const secondService = new AssistantService(two, provider, limits);
    const first = firstService.generate('huang-qi', [excerpt.id], true, actor.info.user, actor.token, new AbortController().signal); await started;
    await assert.rejects(secondService.generate('huang-qi', [excerpt.id], true, actor.info.user, actor.token, new AbortController().signal), (error: any) => error.code === 'assistant_busy');
    const second = secondService.generate('huang-qi', [excerpt.id], true, admin.user, fixture.token, new AbortController().signal);
    for (let attempt = 0; attempt < 30 && calls < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 2);
    const thirdService = new AssistantService(one, provider, limits);
    await assert.rejects(thirdService.generate('huang-qi', [excerpt.id], true, other.info.user, other.token, new AbortController().signal), (error: any) => error.code === 'assistant_busy');
    release(); await Promise.all([first, second]);
    const quota = await two.assistant.quota(actor.info.user.id, limits); assert.equal(quota.usedTotal, 2); assert.equal(quota.activeTotal, 0);
    await assert.rejects(thirdService.generate('huang-qi', [excerpt.id], true, other.info.user, other.token, new AbortController().signal), (error: any) => error.code === 'assistant_quota_exceeded');
    const mismatch = new AssistantService(two, provider, { ...limits, dailyTotal: 10 });
    await assert.rejects(mismatch.generate('huang-qi', [excerpt.id], true, other.info.user, other.token, new AbortController().signal), (error: any) => error.code === 'assistant_policy_conflict');
    assert.equal(calls, 2);
    for (const [table, column] of [['excerpt_permissions', 'actor_name'], ['assistant_quota_days', 'limits_payload'], ['assistant_reservations', 'request_digest']]) {
      // Permissions need a real row for row-level immutable triggers to fire.
      if (table === 'excerpt_permissions') await one.assistant.permission(excerpt.id, false, 0, actor.info.user, actor.token);
      for (const sql of [`UPDATE ${identifier(schema)}.${table} SET ${column} = 'tampered'`, `DELETE FROM ${identifier(schema)}.${table}`, `TRUNCATE ${identifier(schema)}.${table} CASCADE`]) await assert.rejects(pool.query(sql), (error: any) => error.code === '23514');
    }
  } finally { release(); await one?.close(); await two?.close(); await pool.end(); fixture.dispose(); }
});

test('permission changes across PostgreSQL pools reject old in-flight results and preserve immutable original text', async () => {
  const fixture = await migrationFixture(); const pool = createPostgresPool(connection!); const schema = schemaName();
  let one: Awaited<ReturnType<typeof openPostgresStore>> | undefined; let two: typeof one;
  let entered!: () => void; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); one = await openPostgresStore(connection!, schema, fixture.seed); two = await openPostgresStore(connection!, schema, fixture.seed);
    const actor = await one.auth.login(fixture.editor.username, fixturePassword, '127.0.0.1');
    const excerpt = await one.assistant.saveExcerpt('gou-qi-zi', { sourceId: fixture.sourceId, sourceRevision: 1, locator: '测试页', text: '测试材料所列部位为果实。', allowExternal: true }, actor.info.user, actor.token);
    const provider = fixtureAssistant(); provider.generate = async (input) => { entered(); await gate; return { value: fixtureOutput(input), inputTokens: 1, outputTokens: 1, estimatedCostUsd: null }; };
    const service = new AssistantService(one, provider); const task = service.generate('gou-qi-zi', [excerpt.id], true, actor.info.user, actor.token, new AbortController().signal); await started;
    const changes = await Promise.allSettled([one.assistant.permission(excerpt.id, false, 0, actor.info.user, actor.token), two.assistant.permission(excerpt.id, false, 0, actor.info.user, actor.token)]);
    assert.equal(changes.filter((result) => result.status === 'fulfilled').length, 1); assert.equal((changes.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'permission_conflict');
    await two.assistant.permission(excerpt.id, true, 1, actor.info.user, actor.token);
    release(); await assert.rejects(task, (error: any) => error.code === 'external_permission_changed');
    const latest = (await one.assistant.excerpt(excerpt.id))!; assert.equal(latest.digest, excerpt.digest); assert.equal(latest.allowExternal, true); assert.equal(latest.externalPermission.revision, 2);
    const event = (await one.assistant.events()).find((item) => item.errorCode === 'external_permission_changed')!; assert.equal(event.resultDigest, null);
  } finally { release(); await one?.close(); await two?.close(); await pool.end(); fixture.dispose(); }
});

test('unknown journal or partial v2 schema fails explicit upgrade without rewriting v1/history', async () => {
  const fixture = await migrationFixture(undefined, false); const pool = createPostgresPool(connection!); const unknown = schemaName(); const partial = schemaName();
  try {
    const snapshot = legacySnapshot(fixture);
    await createLegacyNamespace(pool, unknown, snapshot); await createLegacyNamespace(pool, partial, snapshot);
    await pool.query(`INSERT INTO ${identifier(unknown)}.postgres_migrations VALUES (3, 'untrusted-future-version', 'test')`);
    await assert.rejects(upgradePostgres(pool, unknown), (error: any) => error.code === 'schema_changed');
    assert.equal((await pool.query(`SELECT COUNT(*) count FROM ${identifier(unknown)}.postgres_migrations`)).rows[0].count, 2);
    await pool.query(`CREATE TABLE ${identifier(partial)}.editorial_excerpts (id TEXT PRIMARY KEY)`);
    await assert.rejects(upgradePostgres(pool, partial), (error: any) => error.code === '42P07');
    assert.equal((await pool.query(`SELECT COUNT(*) count FROM ${identifier(partial)}.postgres_migrations`)).rows[0].count, 1);
    assert.equal((await pool.query('SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2', [partial, 'assistant_events'])).rowCount, 0);
    assert.equal((await verifyImportedPostgres(pool, partial, fixture.seed)).sourceDigest, snapshot.digest);
  } finally { await pool.end(); fixture.dispose(); }
});
