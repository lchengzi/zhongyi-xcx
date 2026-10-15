import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { identifier } from '../server/migration-snapshot.js';
import { storeConfig } from '../server/store-config.js';
import type { RepositoryBundle } from '../server/stores.js';
import type { SessionInfo } from '../shared/contracts.js';
import { fileDigest, fixturePassword, migrationFixture } from './migration-fixture.js';
import { restartPostgres } from './postgres-control.js';
import { validateSeed } from '../server/seed.js';
import { fixtureAssistant } from './assistant-fixture.js';
import { DEFAULT_ASSISTANT_LIMITS } from '../server/assistant-limits.js';
import { fixtureApplicationCompletion, fixtureApplicationWrapper } from '../tools/fixture-application.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('A real PostgreSQL test server is required.');
const origin = 'https://postgres-workbench.example.test';
interface Login { cookie: string; info: SessionInfo }
async function serve(stores: RepositoryBundle) {
  const server = createApp(stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { assistantProvider: fixtureAssistant() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (path: string, init: RequestInit = {}, login?: Login) => fetch(`${url}/api/v1${path}`, { ...init, headers: {
    Origin: origin, ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(login ? { Cookie: login.cookie, 'X-CSRF-Token': login.info.csrfToken } : {}), ...init.headers
  } });
  const login = async (username: string) => {
    const response = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password: fixturePassword }) });
    assert.equal(response.status, 200, await response.clone().text());
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], info: await response.json() as SessionInfo };
  };
  return { api, login, close: async () => { const closed = once(server, 'close'); server.close(); await closed; } };
}
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
async function setup() {
  const fixture = await migrationFixture(); const schema = `runtime_${randomUUID().replaceAll('-', '')}`;
  const pool = createPostgresPool(connection!); const digest = fileDigest(fixture.filename);
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed);
    const stores = await openPostgresStore(connection!, schema, fixture.seed);
    return { fixture, schema, pool, stores, dispose: async () => {
      await stores.close(); await pool.end(); assert.equal(fileDigest(fixture.filename), digest); fixture.dispose();
    } };
  } catch (error) { await pool.end(); fixture.dispose(); throw error; }
}

test('real PostgreSQL HTTP catalog/notes: auth, literal search, pagination, cross-pool conflict and atomic audit rollback', async () => {
  const state = await setup(); const service = await serve(state.stores);
  const other = await openPostgresStore(connection!, state.schema, state.fixture.seed); const second = await serve(other);
  const target = identifier(state.schema);
  try {
    assert.equal((await service.api('/summary')).status, 401);
    const admin = await service.login(state.fixture.admin.username); const reviewer = await service.login(state.fixture.reviewer.username);
    const editor = await service.login(state.fixture.editor.username);
    for (const q of ['黄芪', 'huang qi', '生姜']) assert.equal((await (await service.api(`/ingredients?q=${encodeURIComponent(q)}`, {}, editor)).json()).total, 1);
    for (const q of ['%', '_', "' OR 1=1 --"]) assert.equal((await (await service.api(`/ingredients?q=${encodeURIComponent(q)}`, {}, editor)).json()).total, 0);
    assert.equal((await (await service.api('/ingredients?pageSize=1', {}, editor)).json()).items.length, 1);
    assert.equal((await service.api('/ingredients?page=0', {}, editor)).status, 400);
    const saved = { text: 'PostgreSQL 真正持久化 🌿', expectedRevision: 4 };
    assert.equal((await service.api('/ingredients/huang-qi/note', put(saved), reviewer)).status, 403);
    assert.equal((await service.api('/ingredients/huang-qi/note', { ...put(saved), headers: { 'X-CSRF-Token': '' } }, editor)).status, 403);
    const results = await Promise.all([service.api('/ingredients/huang-qi/note', put(saved), editor), second.api('/ingredients/huang-qi/note', put({ ...saved, text: '另一连接池' }), editor)]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await state.stores.catalog.note('huang-qi')).revision, 5);
    const row = (await state.pool.query(`SELECT * FROM ${target}.editorial_notes WHERE ingredient_id = 'huang-qi'`)).rows[0];
    const events = (await state.pool.query(`SELECT COUNT(*) AS count FROM ${target}.audit_events`)).rows[0].count;
    await state.pool.query(`CREATE FUNCTION ${target}.reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback' USING ERRCODE = '23514'; END; $$`);
    await state.pool.query(`CREATE TRIGGER reject_test_audit BEFORE INSERT ON ${target}.audit_events FOR EACH ROW EXECUTE FUNCTION ${target}.reject_test_audit()`);
    assert.equal((await service.api('/ingredients/huang-qi/note', put({ text: '不能部分提交', expectedRevision: 5 }), editor)).status, 500);
    assert.deepEqual((await state.pool.query(`SELECT * FROM ${target}.editorial_notes WHERE ingredient_id = 'huang-qi'`)).rows[0], row);
    assert.equal((await state.pool.query(`SELECT COUNT(*) AS count FROM ${target}.audit_events`)).rows[0].count, events);
    await state.pool.query(`DROP TRIGGER reject_test_audit ON ${target}.audit_events`);
    assert.equal((await service.api('/ingredients/huang-qi/note', put({ text: '', expectedRevision: 5 }), editor)).status, 200);
    const publicData = await (await service.api('/public/catalog')).json();
    assert.equal(publicData.items.length, 3);
    for (const secret of ['私有测试草稿', 'PostgreSQL 真正持久化', 'password_hash', 'migration-admin']) assert.equal(JSON.stringify(publicData).includes(secret), false);
    assert.equal((await service.api('/users', {}, editor)).status, 403);
    assert.equal((await service.api('/users', {}, admin)).status, 200);
  } finally { await second.close(); await other.close(); await service.close(); await state.dispose(); }
});

test('real PostgreSQL HTTP workflow: immutable pinning, parallel submit/review, independent decision and private public boundary', async () => {
  const state = await setup(); const service = await serve(state.stores);
  const other = await openPostgresStore(connection!, state.schema, state.fixture.seed); const second = await serve(other);
  try {
    const editor = await service.login(state.fixture.editor.username); const reviewer = await service.login(state.fixture.reviewer.username);
    const publicBefore = await (await service.api('/public/catalog')).json();
    const original = { title: 'PG 新来源', publisher: '工程测试', url: 'https://example.org/runtime-source' };
    const sourceResponse = await service.api('/editorial/sources', post(original), editor); assert.equal(sourceResponse.status, 201);
    const source = await sourceResponse.json();
    const updates = await Promise.all([service.api(`/editorial/sources/${source.id}`, put({ source: { ...original, title: '窗口甲' }, expectedRevision: 1 }), editor), second.api(`/editorial/sources/${source.id}`, put({ source: { ...original, title: '窗口乙' }, expectedRevision: 1 }), editor)]);
    assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409]);
    const content = { ediblePart: '待核对', latinName: '', educationText: '私有 PG 草稿 🌿', safetyText: '仅测试，不发布。', sourceRefs: [{ id: source.id, revision: 1, locator: '测试页 2' }] };
    const saved = await service.api('/editorial/ingredients/gou-qi-zi', put({ content, expectedLockVersion: 0 }), editor); assert.equal(saved.status, 200);
    const draft = await saved.json(); assert.equal(draft.sources[0].title, original.title); assert.equal(draft.sources[0].revision, 1);
    const submitted = await Promise.all([service.api('/editorial/ingredients/gou-qi-zi/submit', post({ expectedLockVersion: draft.lockVersion }), editor), second.api('/editorial/ingredients/gou-qi-zi/submit', post({ expectedLockVersion: draft.lockVersion }), editor)]);
    assert.deepEqual(submitted.map((response) => response.status).sort(), [200, 409]);
    const task = await submitted.find((response) => response.status === 200)!.json();
    assert.equal((await service.api('/editorial/ingredients/gou-qi-zi', put({ content, expectedLockVersion: task.draft.lockVersion }), editor)).status, 409);
    const decisions = await Promise.all([service.api(`/editorial/tasks/${task.task.id}/decision`, post({ decision: 'accept', comment: '仅编辑审阅', expectedLockVersion: task.draft.lockVersion }), reviewer), second.api(`/editorial/tasks/${task.task.id}/decision`, post({ decision: 'return', comment: '并发测试', expectedLockVersion: task.draft.lockVersion }), reviewer)]);
    assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]);
    const final = await (await service.api('/editorial/ingredients/gou-qi-zi', {}, reviewer)).json();
    assert.equal(final.draft.publicationEnabled, false); assert.equal(final.draft.professionalReviewState, 'pending');
    assert.deepEqual(await (await service.api('/public/catalog')).json(), publicBefore);
    assert.equal((await service.api('/public/publish', post({}), editor)).status, 404);
    assert.equal((await service.api(`/editorial/sources/${source.id}`, post(original), reviewer)).status, 404);
    assert.equal((await service.api('/editorial/sources', post({ ...original, url: 'https://example.org/reviewer' }), reviewer)).status, 403);
    assert.equal((await service.api('/editorial/tasks?status=pending', {}, reviewer)).status, 200);
    const self = await service.login(state.fixture.admin.username);
    const pending = (await state.stores.workflow.tasks('pending', 1, 50)).items.find((item) => item.ingredientId === 'jiang')!;
    const head = (await state.stores.workflow.draft('jiang'))!;
    const selfReview = await service.api(`/editorial/tasks/${pending.id}/decision`, post({ decision: 'accept', comment: '不能自审', expectedLockVersion: head.lockVersion }), self);
    assert.equal(selfReview.status, 403);
    assert.equal((await selfReview.json()).error, 'self_review');
  } finally { await second.close(); await other.close(); await service.close(); await state.dispose(); }
});

test('queued PostgreSQL writes recheck revoked sessions/accounts after hashing or waiting for another writer', async () => {
  const state = await setup(); const target = identifier(state.schema);
  const blocker = await state.pool.connect();
  try {
    const login = await state.stores.auth.login(state.fixture.admin.username, fixturePassword, 'queued-test');
    await blocker.query('BEGIN'); await blocker.query('SELECT pg_advisory_xact_lock(61038, hashtext($1))', [state.schema]);
    const pending = state.stores.auth.createUser('must-not-exist', fixturePassword, 'editor', state.fixture.admin.username, false, undefined, login.token);
    // Attach immediately: a failed assertion must not leave an unhandled rejection.
    const outcome = Promise.resolve(pending).then(() => null, (error: unknown) => error);
    let queued = false;
    for (let attempt = 0; attempt < 80 && !queued; attempt++) {
      const waiting = await state.pool.query("SELECT COUNT(*) AS count FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE 'SELECT pg_catalog.pg_advisory_xact_lock(61038,%'");
      queued = waiting.rows[0].count > 0;
      if (!queued) await new Promise((done) => setTimeout(done, 25));
    }
    assert.equal(queued, true, 'The actual create-account writer must be observed waiting before revocation.');
    await blocker.query(`DELETE FROM ${target}.sessions WHERE user_id = $1`, [state.fixture.admin.id]);
    await blocker.query('COMMIT');
    const error = await outcome as { status: number; code: string };
    assert.equal(error.status, 401); assert.equal(error.code, 'unauthorized');
    assert.equal((await state.stores.auth.users()).some((user) => user.username === 'must-not-exist'), false);
    const editorLogin = await state.stores.auth.login(state.fixture.editor.username, fixturePassword, 'revocation-test');
    await state.stores.auth.updateUser(state.fixture.editor.id, 'reviewer', true, state.fixture.editor.revision, 'test-fixture');
    assert.equal(await state.stores.auth.session(editorLogin.token), undefined);
    await assert.rejects(async () => await state.stores.catalog.saveNote('huang-qi', '禁止写入', 4, state.fixture.editor.username, { account: state.fixture.editor, token: editorLogin.token }), (failure: any) => failure.status === 403);
    await assert.rejects(async () => await state.stores.workflow.saveSource({ title: '禁止来源', publisher: '测试', url: 'https://example.org/revoked' }, state.fixture.editor), (failure: any) => failure.status === 403);
    assert.equal((await state.stores.catalog.note('huang-qi')).revision, 4);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await state.dispose(); }
});

test('PostgreSQL last-admin guard and login rate limits survive separate pools; failures are audited without secrets', async () => {
  const state = await setup(); const other = await openPostgresStore(connection!, state.schema, state.fixture.seed);
  try {
    const second = await state.stores.auth.createUser('runtime-admin2', fixturePassword, 'admin', 'test-fixture');
    const results = await Promise.allSettled([state.stores.auth.updateUser(state.fixture.admin.id, 'editor', true, 1, 'test-fixture'), other.auth.updateUser(second.id, 'editor', true, 1, 'test-fixture')]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'last_admin');
    assert.equal((await state.stores.auth.users()).filter((user) => user.active && user.role === 'admin').length, 1);
    for (let index = 0; index < 10; index++) await assert.rejects(state.stores.auth.login('unknown-runtime', 'wrong', 'runtime-rate-ip'), (error: any) => error.status === 401);
    await assert.rejects(other.auth.login('unknown-runtime', 'wrong', 'another-ip'), (error: any) => error.status === 429);
    const events = await state.stores.auth.events(); assert.equal(events.filter((item) => item.action === 'login_failed').length, 10);
    assert.equal(JSON.stringify(events).includes(fixturePassword), false); assert.equal(JSON.stringify(events).includes('password_hash'), false);
  } finally { await other.close(); await state.dispose(); }
});

test('PostgreSQL startup validates current catalog/schema, never repairs drift or silently falls back to SQLite', async () => {
  const state = await setup(); const target = identifier(state.schema);
  try {
    assert.equal(storeConfig({}).engine, 'sqlite');
    assert.throws(() => storeConfig({ DATABASE_PROVIDER: 'pg' }), /DATABASE_PROVIDER/);
    assert.throws(() => storeConfig({ DATABASE_PROVIDER: 'postgres', DATABASE_URL: connection }), /DATABASE_SCHEMA/);
    assert.throws(() => storeConfig({ DATABASE_PROVIDER: 'postgres', DATABASE_URL: connection, DATABASE_SCHEMA: 'public' }), /schema/);
    await assert.rejects(openPostgresStore(connection!, 'missing_runtime_schema', state.fixture.seed));
    const payload = (await state.pool.query(`SELECT payload FROM ${target}.ingredients WHERE id = 'huang-qi'`)).rows[0].payload;
    const changed = JSON.parse(payload); changed.professionalReviewState = 'approved';
    await state.pool.query(`UPDATE ${target}.ingredients SET payload = $1 WHERE id = 'huang-qi'`, [JSON.stringify(changed)]);
    await assert.rejects(openPostgresStore(connection!, state.schema, state.fixture.seed));
    const service = await serve(state.stores);
    try { assert.equal((await service.api('/public/catalog')).status, 503); }
    finally { await service.close(); }
    await state.pool.query(`UPDATE ${target}.ingredients SET payload = $1 WHERE id = 'huang-qi'`, [payload]);
    const reopened = await openPostgresStore(connection!, state.schema, state.fixture.seed);
    try { assert.equal((await reopened.catalog.publicSnapshot()).digest, state.fixture.seed.digest); }
    finally { await reopened.close(); }
  } finally { await state.dispose(); }
});

test('new PostgreSQL notes, sources, drafts, excerpts, simulated call audit and sessions survive full process restart', async () => {
  const state = await setup(); let stores = state.stores;
  let originalStoresClosed = false;
  const sourceDigest = fileDigest(state.fixture.filename);
  let service: Awaited<ReturnType<typeof serve>> | undefined = await serve(stores);
  try {
    const editor = await service.login(state.fixture.editor.username);
    assert.equal((await service.api('/ingredients/huang-qi/note', put({ text: 'PG 新写入重启后保留', expectedRevision: 4 }), editor)).status, 200);
    const source = await (await service.api('/editorial/sources', post({ title: '重启测试来源', publisher: '测试', url: 'https://example.org/runtime-restart' }), editor)).json();
    const content = { ediblePart: '待核对', latinName: '', educationText: '重启测试私有草稿', safetyText: '不发布', sourceRefs: [{ id: source.id, revision: 1, locator: '测试页 1' }] };
    const saved = await service.api('/editorial/ingredients/gou-qi-zi', put({ content, expectedLockVersion: 0 }), editor); assert.equal(saved.status, 200);
    const draft = await saved.json();
    const submitted = await service.api('/editorial/ingredients/gou-qi-zi/submit', post({ expectedLockVersion: draft.lockVersion }), editor); assert.equal(submitted.status, 200);
    const task = await submitted.json();
    const excerptResponse = await service.api('/editorial/assistant/ingredients/gou-qi-zi/excerpts', post({ sourceId: source.id, sourceRevision: 1, locator: '测试页 1 原文', text: '测试记录：部位为果实，形态为干燥品。', allowExternal: true }), editor);
    assert.equal(excerptResponse.status, 201); const excerpt = await excerptResponse.json();
    const assistantResponse = await service.api('/editorial/assistant/ingredients/gou-qi-zi/generate', post({ evidenceIds: [excerpt.id], confirmExternalTransfer: true }), editor);
    assert.equal(assistantResponse.status, 200); const assistant = await assistantResponse.json(); assert.equal(assistant.simulated, true);
    const summaryResponse = await service.api('/editorial/assistant/ingredients/gou-qi-zi/generate', post({ evidenceIds: [excerpt.id], confirmExternalTransfer: true, mode: 'summary' }), editor);
    assert.equal(summaryResponse.status, 200); const summary = await summaryResponse.json(); assert.equal(summary.mode, 'summary'); assert.equal(summary.sections.length, 1);
    const changedPermission = await stores.assistant.permission(excerpt.id, false, 0, editor.info.user, editor.cookie.slice(editor.cookie.indexOf('=') + 1));
    const quotaBefore = await stores.assistant.quota(editor.info.user.id, { ...DEFAULT_ASSISTANT_LIMITS });
    await service.close(); service = undefined; await stores.close(); originalStoresClosed = true; await state.pool.end();
    await restartPostgres();
    stores = await openPostgresStore(connection!, state.schema, state.fixture.seed); service = await serve(stores);
    assert.equal((await service.api('/auth/me', {}, editor)).status, 200);
    const detail = await (await service.api('/ingredients/huang-qi', {}, editor)).json(); assert.equal(detail.note.text, 'PG 新写入重启后保留'); assert.equal(detail.note.revision, 5);
    const restored = await (await service.api('/editorial/ingredients/gou-qi-zi', {}, editor)).json();
    assert.equal(restored.draft.digest, draft.digest); assert.equal(restored.draft.state, 'submitted'); assert.equal(restored.tasks[0].id, task.task.id);
    assert.equal(restored.draft.sources[0].title, '重启测试来源'); assert.equal(restored.draft.publicationEnabled, false);
    assert.deepEqual(await stores.assistant.excerpt(excerpt.id), changedPermission);
    assert.deepEqual(await stores.assistant.quota(editor.info.user.id, { ...DEFAULT_ASSISTANT_LIMITS }), quotaBefore);
    const audit = (await stores.assistant.events()).find((event) => event.id === assistant.id)!;
    assert.equal(audit.status, 'completed'); assert.equal(audit.provider, 'test-fixture');
    const summaryAudit = (await stores.assistant.events()).find((event) => event.id === summary.id)!; assert.equal(summaryAudit.status, 'completed'); assert.match(summaryAudit.resultDigest!, /^sha256:/);
  } finally {
    await service?.close();
    if (stores !== state.stores) await stores.close();
    // Old pools were deliberately ended before restarting the DB process.
    if (!state.pool.ended) await state.pool.end();
    if (!originalStoresClosed) await state.stores.close();
    assert.equal(fileDigest(state.fixture.filename), sourceDigest);
    state.fixture.dispose();
  }
});

async function compiledServer(schema: string, unusedSqlite: string) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
  // The wrapper only translates a test-owned IPC shutdown to the application's
  // normal signal handler on Windows; production code has no shutdown endpoint.
  const wrapper = fixtureApplicationWrapper('server');
  const child = spawn(process.execPath, ['--input-type=module', '-e', wrapper], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env,
      NODE_ENV: 'test', DATABASE_PROVIDER: 'postgres', DATABASE_URL: connection, DATABASE_SCHEMA: schema,
      DB_PATH: unusedSqlite, AUTH_MODE: 'accounts', PORT: String(port), ALLOWED_ORIGINS: origin }
  });
  let stdout = ''; let stderr = '';
  child.stdout!.on('data', (data) => { stdout += data; }); child.stderr!.on('data', (data) => { stderr += data; });
  const completed = fixtureApplicationCompletion(child);
  try {
    await new Promise<void>((ready, reject) => {
      const timer = setTimeout(() => reject(new Error('Compiled PostgreSQL server startup timed out')), 15000);
      child.stdout!.on('data', () => { if (stdout.includes('Local workbench:')) { clearTimeout(timer); ready(); } });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Compiled PostgreSQL server exited: ${code}`)); });
    });
  } catch (error) {
    if (child.connected) child.send('test-stop'); await completed; throw error;
  }
  return { url: `http://127.0.0.1:${port}`, stop: async () => {
    if (child.connected) child.send('test-stop'); const [code, signal] = await completed;
    assert.equal(code, 0); assert.equal(signal, null); assert.match(stdout, /Database provider: postgres/);
    for (const secret of [connection!, fixturePassword, 'password_hash']) assert.equal((stdout + stderr).includes(secret), false);
    assert.equal(existsSync(unusedSqlite), false);
  } };
}

test('compiled npm-start entry uses PostgreSQL without opening DB_PATH and retains authenticated writes across application restart', async () => {
  const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const fixture = await migrationFixture(seed); const pool = createPostgresPool(connection!); const schema = `compiled_${randomUUID().replaceAll('-', '')}`;
  const unusedSqlite = join(fixture.directory, 'must-not-be-opened.sqlite');
  let service: Awaited<ReturnType<typeof compiledServer>> | undefined;
  try {
    await migrateSqliteToPostgres(pool, schema, fixture.read(), seed);
    service = await compiledServer(schema, unusedSqlite);
    const headers = { Cookie: `food_session=${fixture.token}`, Origin: origin };
    const me = await fetch(`${service.url}/api/v1/auth/me`, { headers }); assert.equal(me.status, 200);
    const session = await me.json();
    const saved = await fetch(`${service.url}/api/v1/ingredients/huang-qi/note`, { method: 'PUT', headers: { ...headers,
      'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify({ text: '编译服务 PG 备注', expectedRevision: 4 }) });
    assert.equal(saved.status, 200); await service.stop(); service = undefined;
    service = await compiledServer(schema, unusedSqlite);
    const detail = await fetch(`${service.url}/api/v1/ingredients/huang-qi`, { headers }); assert.equal(detail.status, 200);
    assert.equal((await detail.json()).note.text, '编译服务 PG 备注');
    const publicResponse = await fetch(`${service.url}/api/v1/public/catalog`); assert.equal(publicResponse.status, 200); assert.equal((await publicResponse.json()).items.length, 106);
  } finally { await service?.stop(); await pool.end(); fixture.dispose(); }
});
