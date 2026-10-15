import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { AccountError, AuthRepository, SESSION_MS, tokenHash } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import type { Account, IngredientDetail, SessionInfo } from '../shared/contracts.js';
import { fixtureSeed } from './fixture.js';
import { instrumentLoginDatabase } from '../tools/login-timing.js';

const origin = 'https://workbench.example.test';
const password = 'test-only-password-long-enough';

test('SQLite login charges both rate limits in one explicit transaction and keeps session commit separate', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    await new AuthRepository(repo.db).createUser('admin-test', password, 'admin', 'fixture');
    const observed = instrumentLoginDatabase(repo.db);
    const result = await new AuthRepository(observed.database).login('admin-test', password, 'test-ip');
    assert.equal(result.info.user.role, 'admin');
    const records = observed.finish().records;
    assert.equal(records.filter((r) => r.stage === 'limit_cleanup' && r.operation === 'run').length, 1);
    const charges = records.filter((r) => r.stage === 'limit_write' && r.operation === 'run');
    assert.equal(charges.length, 2); assert(charges.every((r) => r.explicitTransaction));
    assert.equal(records.filter((r) => r.stage === 'commit').length, 2);
    assert.deepEqual(repo.db.prepare('SELECT attempts FROM login_attempts ORDER BY key').all().map((r) => r.attempts), [1, 1]);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n, 1);
  } finally { repo.close(); }
});

test('SQLite login account-limit rejection durably charges IP while preserving account limit and creating no session', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const now = 1800000;
  try {
    repo.db.prepare('INSERT INTO login_attempts VALUES (?, ?, ?)').run(`user:${tokenHash('admin-test')}`, 10, now + 900000);
    repo.db.prepare('INSERT INTO login_attempts VALUES (?, ?, ?)').run(`ip:${tokenHash('test-ip')}`, 2, now + 900000);
    const observed = instrumentLoginDatabase(repo.db);
    await assert.rejects(new AuthRepository(observed.database, () => now).login('admin-test', password, 'test-ip'), (e: unknown) => e instanceof AccountError && e.code === 'rate_limited');
    assert.equal(repo.db.prepare('SELECT attempts FROM login_attempts WHERE key = ?').get(`ip:${tokenHash('test-ip')}`)?.attempts, 3);
    assert.equal(repo.db.prepare('SELECT attempts FROM login_attempts WHERE key = ?').get(`user:${tokenHash('admin-test')}`)?.attempts, 10);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n, 0);
    const records = observed.finish().records; assert.equal(records.filter((r) => r.stage === 'commit').length, 1);
    assert.equal(records.some((r) => r.stage === 'account_lookup'), false);
  } finally { repo.close(); }
});

test('SQLite login IP-limit rejection does not charge another account and still commits expired-record cleanup', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const now = 1800000;
  try {
    repo.db.prepare('INSERT INTO login_attempts VALUES (?, ?, ?)').run(`ip:${tokenHash('test-ip')}`, 50, now + 900000);
    repo.db.prepare('INSERT INTO login_attempts VALUES (?, ?, ?)').run('expired-fixture-key', 10, now);
    const observed = instrumentLoginDatabase(repo.db);
    await assert.rejects(new AuthRepository(observed.database, () => now).login('admin-test', password, 'test-ip'), (e: unknown) => e instanceof AccountError && e.status === 429);
    assert.deepEqual(repo.db.prepare('SELECT attempts FROM login_attempts').all().map((r) => r.attempts), [50]);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM security_events').get()?.n, 0);
    assert.equal(observed.finish().records.filter((r) => r.stage === 'commit').length, 1);
    repo.db.exec('BEGIN IMMEDIATE'); repo.db.exec('ROLLBACK');
  } finally { repo.close(); }
});

test('SQLite login counter-write failure rolls back both charges and releases transaction before a later valid login', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    await new AuthRepository(repo.db).createUser('admin-test', password, 'admin', 'fixture');
    repo.db.prepare('INSERT INTO login_attempts VALUES (?, ?, ?)').run(`ip:${tokenHash('test-ip')}`, 2, Date.now() + 900000);
    repo.db.exec(`CREATE TRIGGER fail_login_charge BEFORE INSERT ON login_attempts WHEN NEW.key LIKE 'user:%'
      BEGIN SELECT RAISE(ABORT, 'private-fixture-write-failure'); END`);
    const observed = instrumentLoginDatabase(repo.db);
    await assert.rejects(new AuthRepository(observed.database).login('admin-test', password, 'test-ip'));
    assert.equal(repo.db.prepare('SELECT attempts FROM login_attempts WHERE key = ?').get(`ip:${tokenHash('test-ip')}`)?.attempts, 2);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n, 0);
    assert.equal(observed.finish().records.filter((r) => r.stage === 'rollback').length, 1);
    repo.db.exec('DROP TRIGGER fail_login_charge');
    assert.equal((await new AuthRepository(repo.db).login('admin-test', password, 'test-ip')).info.user.role, 'admin');
  } finally { repo.close(); }
});

test('SQLite login does not hold its rate-limit transaction during password derivation and busy rejection remains charged', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    const auth = new AuthRepository(repo.db); await auth.createUser('admin-test', password, 'admin', 'fixture');
    const pending = Array.from({ length: 4 }, () => auth.login('admin-test', password, 'test-ip'));
    repo.db.exec('BEGIN IMMEDIATE'); repo.db.exec('ROLLBACK');
    await assert.rejects(auth.login('admin-test', password, 'test-ip'), (e: unknown) => e instanceof AccountError && e.code === 'busy');
    assert.deepEqual(repo.db.prepare('SELECT attempts FROM login_attempts ORDER BY key').all().map((r) => r.attempts), [5, 5]);
    assert.equal((await Promise.all(pending)).length, 4);
  } finally { repo.close(); }
});

test('SQLite login charge-commit failure cannot create a session or leave partially charged counters', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    await new AuthRepository(repo.db).createUser('admin-test', password, 'admin', 'fixture');
    let fail = true; const injected = new Error('private-fixture-commit-failure');
    const database = new Proxy(repo.db, { get(target, key) {
      if (key === 'exec') return (sql: string) => { if (sql === 'COMMIT' && fail) { fail = false; throw injected; } return target.exec(sql); };
      const member = Reflect.get(target, key, target); return typeof member === 'function' ? member.bind(target) : member;
    } });
    const auth = new AuthRepository(database);
    await assert.rejects(auth.login('admin-test', password, 'test-ip'), (e: unknown) => e === injected);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM login_attempts').get()?.n, 0);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n, 0);
    assert.equal((await auth.login('admin-test', password, 'test-ip')).info.user.role, 'admin');
  } finally { repo.close(); }
});
interface Login { cookie: string; info: SessionInfo }
async function serve(repo: CatalogRepository, secureCookies = false) {
  const server = createApp(repo, { mode: 'accounts', allowedOrigins: [origin], secureCookies }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (path: string, init: RequestInit = {}, session?: Login) => fetch(`${url}/api/v1${path}`, { ...init, headers: {
    Origin: origin, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.info.csrfToken } : {}), ...init.headers
  } });
  const login = async (username: string) => {
    const response = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], info: await response.json() as SessionInfo };
  };
  return { api, login, close: async () => { const closed = once(server, 'close'); server.close(); await closed; } };
}

test('account login: origin, validation, cookie flags, hashed secrets, rotation and logout', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const auth = new AuthRepository(repo.db);
  await auth.createUser('admin-test', password, 'admin', 'test-bootstrap', true);
  const service = await serve(repo, true);
  try {
    assert.equal((await service.api('/auth/config')).status, 200);
    assert.equal((await service.api('/auth/me')).status, 401);
    const loginBody = JSON.stringify({ username: 'admin-test', password });
    assert.equal((await service.api('/auth/login', { method: 'POST', body: loginBody, headers: { Origin: '' } })).status, 403);
    assert.equal((await service.api('/auth/login', { method: 'POST', body: loginBody, headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await service.api('/auth/login', { method: 'POST', body: loginBody, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    for (const body of [null, [], { username: 'admin-test' }, { username: 'admin-test', password, role: 'admin' }, { username: {}, password }]) {
      assert.equal((await service.api('/auth/login', { method: 'POST', body: JSON.stringify(body) })).status, 400);
    }
    const failure = async (username: string) => service.api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'wrong' }) });
    assert.deepEqual(await (await failure('admin-test')).json(), await (await failure('no-such-user')).json());
    const response = await service.api('/auth/login', { method: 'POST', body: loginBody });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie')!;
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag));
    const first = { cookie: setCookie.split(';')[0], info: await response.json() as SessionInfo };
    assert.equal((await service.api('/summary', {}, first)).status, 200);
    assert.equal((await service.api('/summary', { headers: { Authorization: 'Bearer test-local-editor-token-with-32-characters' } }, first)).status, 401);
    const token = first.cookie.split('=')[1];
    const stored = repo.db.prepare('SELECT * FROM sessions').get()!;
    assert.equal(stored.token_hash, tokenHash(token)); assert.ok(!JSON.stringify(stored).includes(token));
    const userRow = repo.db.prepare('SELECT * FROM users').get()!;
    assert.ok(!JSON.stringify(userRow).includes(password)); assert.equal(String(userRow.password_salt).length, 64);
    assert.equal(String(userRow.password_hash).length, 128);
    assert.ok(!JSON.stringify(first.info).includes('password_hash'));
    assert.equal((await service.api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': '' } }, first)).status, 403);
    const rotatedResponse = await service.api('/auth/login', { method: 'POST', body: loginBody }, first);
    const rotated = { cookie: rotatedResponse.headers.get('set-cookie')!.split(';')[0], info: await rotatedResponse.json() as SessionInfo };
    assert.notEqual(rotated.cookie, first.cookie); assert.equal((await service.api('/auth/me', {}, first)).status, 401);
    assert.equal((await service.api('/auth/me', {}, rotated)).status, 200);
    assert.equal((await service.api('/summary', { headers: { Cookie: `${rotated.cookie}; ${rotated.cookie}` } })).status, 401);
    const logout = await service.api('/auth/logout', { method: 'POST' }, rotated);
    assert.equal(logout.status, 200); assert.ok(logout.headers.get('set-cookie')?.includes('Expires=Thu, 01 Jan 1970'));
    assert.equal((await service.api('/auth/me', {}, rotated)).status, 401);
    const audit = JSON.stringify(auth.events());
    for (const secret of [password, token, first.info.csrfToken]) assert.ok(!audit.includes(secret));
  } finally { await service.close(); repo.close(); }
});

test('HTTP RBAC, CSRF, account CRUD, note actor, optimistic permissions and immediate revocation', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const auth = new AuthRepository(repo.db);
  const initialAdmin = await auth.createUser('admin-test', password, 'admin', 'test-bootstrap', true);
  const service = await serve(repo);
  try {
    const admin = await service.login('admin-test');
    const create = (username: string, role: string) => service.api('/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }, admin);
    const editorResponse = await create('editor-test', 'editor'); assert.equal(editorResponse.status, 201); const editorUser = await editorResponse.json() as Account;
    const reviewerResponse = await create('reviewer-test', 'reviewer'); assert.equal(reviewerResponse.status, 201); const reviewerUser = await reviewerResponse.json() as Account;
    assert.equal((await create('editor-test', 'admin')).status, 409);
    assert.equal((await create('bad-role-test', 'doctor')).status, 400);
    assert.equal((await service.api('/users', { method: 'POST', body: JSON.stringify({ username: 'bad-pass', password: 'short', role: 'editor' }) }, admin)).status, 400);
    const editor = await service.login('editor-test'); const reviewer = await service.login('reviewer-test');
    for (const user of [editor, reviewer]) {
      assert.equal((await service.api('/ingredients/huang-qi', {}, user)).status, 200);
      for (const route of ['/users', '/security-events']) assert.equal((await service.api(route, {}, user)).status, 403);
      assert.equal((await service.api('/users', { method: 'POST', body: JSON.stringify({ username: 'escalate', password, role: 'admin' }) }, user)).status, 403);
    }
    const note = { method: 'PUT', body: JSON.stringify({ text: '真实账号编辑', expectedRevision: 0 }) };
    assert.equal((await service.api('/ingredients/huang-qi/note', note, reviewer)).status, 403);
    assert.equal((await service.api('/ingredients/huang-qi/note', { ...note, headers: { 'X-CSRF-Token': 'wrong' } }, editor)).status, 403);
    assert.equal((await service.api('/ingredients/huang-qi/note', { ...note, headers: { Origin: 'https://attacker.example' } }, editor)).status, 403);
    assert.equal(repo.note('huang-qi').revision, 0);
    assert.equal((await service.api('/ingredients/huang-qi/note', note, editor)).status, 200);
    assert.equal(repo.events()[0].actor, 'editor-test'); assert.equal(repo.ingredient('huang-qi')?.professionalReviewState, 'pending');
    const update = (id: string, role: string, active: boolean, expectedRevision: number) => service.api(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ role, active, expectedRevision }) }, admin);
    assert.equal((await update(initialAdmin.id, 'admin', false, 1)).status, 409);
    assert.equal((await update(initialAdmin.id, 'editor', true, 1)).status, 409);
    assert.equal((await update(editorUser.id, 'reviewer', true, 1)).status, 200);
    assert.equal((await service.api('/summary', {}, editor)).status, 401);
    assert.equal((await update(editorUser.id, 'admin', true, 1)).status, 409);
    const downgraded = await service.login('editor-test');
    assert.equal(downgraded.info.user.role, 'reviewer');
    assert.equal((await service.api('/ingredients/huang-qi/note', note, downgraded)).status, 403);
    assert.equal((await update(reviewerUser.id, 'reviewer', false, 1)).status, 200);
    assert.equal((await service.api('/summary', {}, reviewer)).status, 401);
    assert.equal((await service.api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'reviewer-test', password }) })).status, 401);
    const list = await (await service.api('/users', {}, admin)).json();
    assert.ok(!JSON.stringify(list).includes('password')); assert.ok(!JSON.stringify(list).includes('csrf'));
    await assert.rejects(() => auth.createUser('second-bootstrap', password, 'admin', 'cli', true), (error: unknown) => error instanceof AccountError && error.code === 'already_initialized');
    assert.throws(() => auth.updateUser(initialAdmin.id, 'editor', true, 1, 'direct-test'), /至少保留/);
    const admin2Response = await create('admin-second', 'admin'); assert.equal(admin2Response.status, 201);
    const admin2 = await service.login('admin-second');
    assert.equal((await service.api(`/users/${initialAdmin.id}`, { method: 'PUT', body: JSON.stringify({ role: 'admin', active: false, expectedRevision: 1 }) }, admin2)).status, 200);
    assert.equal((await service.api('/users', {}, admin)).status, 401);
  } finally { await service.close(); repo.close(); }
});

test('expiry and persistent login limits are enforced, including after repository restart', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); let now = Date.now();
  const auth = new AuthRepository(repo.db, () => now);
  await auth.createUser('admin-test', password, 'admin', 'fixture');
  try {
    const login = await auth.login('admin-test', password, 'test-ip');
    assert.equal(auth.session(login.token)?.user.username, 'admin-test');
    now += SESSION_MS; assert.equal(auth.session(login.token), undefined);
    for (let index = 0; index < 10; index++) await assert.rejects(auth.login('admin-test', 'wrong', 'test-ip'), (error: unknown) => error instanceof AccountError && error.status === 401);
    const reopened = new AuthRepository(repo.db, () => now);
    await assert.rejects(reopened.login('admin-test', password, 'different-ip'), (error: unknown) => error instanceof AccountError && error.status === 429);
    now += 15 * 60 * 1000;
    assert.equal((await reopened.login('admin-test', password, 'test-ip')).info.user.username, 'admin-test');
    for (let index = 0; index < 50; index++) {
      await assert.rejects(reopened.login(`unknown-${index}`, 'wrong', 'shared-ip'), (error: unknown) => error instanceof AccountError && error.status === 401);
    }
    await assert.rejects(reopened.login('another-user', 'wrong', 'shared-ip'), (error: unknown) => error instanceof AccountError && error.status === 429);
  } finally { repo.close(); }
});

test('permission recheck after async password derivation prevents a revoked administrator creating users', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const auth = new AuthRepository(repo.db);
  try {
    const user = await auth.createUser('admin-test', password, 'admin', 'fixture');
    await auth.createUser('admin-backup', password, 'admin', 'fixture');
    const session = await auth.login('admin-test', password, 'test-ip');
    const pending = auth.createUser('must-not-exist', password, 'editor', user.username, false, () => {
      if (!auth.session(session.token)) throw new AccountError(401, 'unauthorized', 'revoked');
    });
    auth.updateUser(user.id, 'editor', true, 1, 'admin-backup');
    await assert.rejects(pending, (error: unknown) => error instanceof AccountError && error.status === 401);
    assert.ok(!auth.users().some((item) => item.username === 'must-not-exist'));
    assert.ok(!auth.events().some((item) => item.target === 'must-not-exist'));
  } finally { repo.close(); }
});

test('migration from real P1 schema preserves notes/events and account sessions survive full HTTP restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-auth-test-')); const filename = join(directory, 'test.sqlite');
  const seed = fixtureSeed();
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(`CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE ingredients (id TEXT PRIMARY KEY, name TEXT NOT NULL, search_text TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE editorial_notes (ingredient_id TEXT PRIMARY KEY REFERENCES ingredients(id), text TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), updated_at TEXT NOT NULL);
      CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient_id TEXT NOT NULL REFERENCES ingredients(id), action TEXT NOT NULL CHECK(action IN ('note_saved','note_cleared')), revision INTEGER NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO migrations VALUES (1, '2026-10-07');`);
    for (const item of seed.ingredients) legacy.prepare('INSERT INTO ingredients VALUES (?, ?, ?, ?)').run(item.id, item.name, item.name, JSON.stringify(item));
    legacy.prepare('INSERT INTO metadata VALUES (?, ?)').run('seedDigest', seed.digest);
    legacy.prepare('INSERT INTO editorial_notes VALUES (?, ?, ?, ?)').run('huang-qi', '旧备注不可丢失', 8, '2026-10-07');
    legacy.prepare('INSERT INTO audit_events (ingredient_id, action, revision, created_at) VALUES (?, ?, ?, ?)').run('huang-qi', 'note_saved', 8, '2026-10-07');
    legacy.close();
    const first = new CatalogRepository(filename, seed); const auth = new AuthRepository(first.db);
    assert.equal(first.note('huang-qi').text, '旧备注不可丢失'); assert.equal(first.events()[0].actor, 'legacy-local-key');
    await auth.createUser('admin-test', password, 'admin', 'fixture', true);
    const server = await serve(first); let login: Login;
    try { login = await server.login('admin-test'); }
    finally { await server.close(); first.close(); }
    const second = new CatalogRepository(filename, seed); const restarted = await serve(second);
    try {
      assert.equal((await restarted.api('/auth/me', {}, login!)).status, 200);
      const detail = await (await restarted.api('/ingredients/huang-qi', {}, login!)).json() as IngredientDetail;
      assert.equal(detail.note.text, '旧备注不可丢失'); assert.equal(detail.note.revision, 8);
      assert.equal(second.db.prepare('SELECT COUNT(*) count FROM migrations WHERE version = 2').get()?.count, 1);
    } finally { await restarted.close(); second.close(); }
  } finally { unlinkSync(filename); rmdirSync(directory); }
});

test('documented bootstrap CLI creates only the first admin and refuses to overwrite existing accounts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-bootstrap-test-')); const filename = join(directory, 'test.sqlite');
  const execute = promisify(execFile);
  const options = { cwd: resolve('.'), env: { ...process.env, DB_PATH: filename, BOOTSTRAP_PASSWORD: password }, windowsHide: true };
  try {
    const first = await execute(process.execPath, ['--import', 'tsx', 'tools/bootstrap-account.ts', 'cli-admin'], options);
    assert.ok(first.stdout.includes('Administrator created: cli-admin')); assert.ok(!first.stdout.includes(password));
    await assert.rejects(execute(process.execPath, ['--import', 'tsx', 'tools/bootstrap-account.ts', 'cli-other'], options), /Already initialized/);
    const repo = new CatalogRepository(filename, JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
    try {
      const auth = new AuthRepository(repo.db);
      assert.equal(auth.users().length, 1); assert.equal(auth.users()[0].role, 'admin');
      assert.equal((await auth.login('cli-admin', password, 'test-ip')).info.user.username, 'cli-admin');
    } finally { repo.close(); }
  } finally { unlinkSync(filename); rmdirSync(directory); }
});

test('production fails closed for local-key mode, nonsecure cookies and HTTP origins', () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createApp(repo, 'test-local-editor-token-with-32-characters'), /Production requires/);
    assert.throws(() => createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }), /Production requires/);
    assert.throws(() => createApp(repo, { mode: 'accounts', secureCookies: true, allowedOrigins: ['http://127.0.0.1:4310'] }), /Invalid trusted origin/);
    assert.throws(() => createApp(repo, { mode: 'accounts', secureCookies: true, allowedOrigins: ['https://workbench.example.test/path'] }), /Invalid trusted origin/);
    assert.doesNotThrow(() => createApp(repo, { mode: 'accounts', secureCookies: true, allowedOrigins: [origin] }));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    repo.close();
  }
});
