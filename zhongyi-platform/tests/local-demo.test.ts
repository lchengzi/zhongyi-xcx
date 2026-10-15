import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync, unlinkSync, rmdirSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AssistantConfig, ContentDraft, DraftDetail, IngredientDetail, ManagedSource, ReviewTask, SessionInfo } from '../shared/contracts.js';
import type { publicCatalog } from '../server/public-catalog.js';
import { prepareLocalDemo, startLocalDemo, type DemoCredential } from '../server/local-demo.js';
import { fixtureSeed } from './fixture.js';
import { launchDemoCli } from './local-demo-process.js';
import { launchCompiledDemo } from './compiled-demo-process.js';
// Review-pack provisioning is part of the same isolated local-demo boundary.
import './editorial-review-pack.test.js';
import './local-demo-photos.test.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zhongyi-local-demo-test-'));
  mkdirSync(join(root, 'data')); mkdirSync(join(root, 'dist')); mkdirSync(join(root, '.local'));
  writeFileSync(join(root, 'data', 'catalog.seed.json'), JSON.stringify(fixtureSeed()));
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><title>Test-only static page</title>');
  const working = join(root, '.local', 'editorial.sqlite'); writeFileSync(working, 'working-file sentinel, not a real database');
  const dispose = () => {
    const files: string[] = []; const directories: string[] = [];
    const inspect = (path: string) => {
      assert(path === root || path.startsWith(`${root}${sep}`));
      const stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false); assert.equal(realpathSync(path), resolve(path));
      if (stat.isDirectory()) { for (const name of readdirSync(path)) inspect(join(path, name)); directories.push(path); }
      else { assert(stat.isFile()); files.push(path); }
    };
    inspect(root); assert(files.length <= 30 && directories.length <= 10);
    for (const path of files) unlinkSync(path);
    for (const path of directories) rmdirSync(path);
  };
  return { root, working, dispose };
}
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const credentials = (path: string): DemoCredential[] => JSON.parse(readFileSync(path, 'utf8')).accounts;
test('manual compiled demo commands use the same built CLI without tsx or a working-store shortcut', () => {
  const scripts = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts;
  assert.equal(scripts['demo:prepare:compiled'], 'node build/tools/local-demo.js prepare');
  assert.equal(scripts['demo:start:compiled'], 'node build/tools/local-demo.js start');
  assert(scripts['demo:verify'].startsWith('npm run build &&'));
  assert(scripts['demo:verify'].includes('tests/compiled-demo-cli.test.ts'));
});
async function freePort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done())); return port;
}

test('compiled demo launcher rejects arbitrary IDs, invalid ports and missing builds before opening a writable store', async () => {
  const f = fixture();
  try {
    const before = hash(f.working); const prepared = await prepareLocalDemo(f.root);
    for (const id of ['', '../editorial.sqlite', prepared.directory, 'demo-not-a-uuid']) await assert.rejects(launchCompiledDemo(f.root, id, 4314), /arguments/);
    for (const port of [0, 1023, 65536, 4314.5]) await assert.rejects(launchCompiledDemo(f.root, prepared.demoId, port), /arguments/);
    await assert.rejects(launchCompiledDemo(f.root, prepared.demoId, 4314), /build/);
    assert.equal(hash(f.working), before);
  } finally { f.dispose(); }
});

test('local demo creates separate marked databases, random roles and no fabricated professional/publication records', async () => {
  const f = fixture();
  try {
    const before = hash(f.working);
    const a = await prepareLocalDemo(f.root); const b = await prepareLocalDemo(f.root);
    assert.notEqual(a.demoId, b.demoId); assert.notEqual(a.directory, b.directory);
    const users = credentials(a.credentialsFile); assert.deepEqual(users.map((u) => u.role), ['admin', 'editor', 'reviewer']);
    assert.equal(new Set([...users, ...credentials(b.credentialsFile)].map((u) => u.password)).size, 6);
    assert(users.every((u) => /^[A-Za-z0-9_-]{32}$/.test(u.password)));
    const db = new DatabaseSync(join(a.directory, 'editorial.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'localDemoId'").get()?.value, a.demoId);
      assert.equal(db.prepare('SELECT COUNT(*) count FROM users').get()?.count, 3);
      for (const table of ['professional_qualifications', 'professional_reviews', 'source_checks', 'publication_snapshots', 'publication_approvals', 'publication_events']) {
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count, 0);
      }
      const hashes = db.prepare('SELECT password_hash FROM users').all().map((row) => row.password_hash);
      assert(hashes.every((value) => typeof value === 'string' && /^[a-f0-9]{128}$/.test(value) && !users.some((u) => u.password === value)));
    } finally { db.close(); }
    assert.equal(hash(f.working), before);
  } finally { f.dispose(); }
});

test('local demo rejects paths, incomplete manifests, missing or substituted databases without recreating or changing them', async () => {
  const f = fixture();
  try {
    const a = await prepareLocalDemo(f.root); const b = await prepareLocalDemo(f.root); const port = await freePort();
    for (const id of ['', '../editorial.sqlite', a.directory, `${a.demoId}/../${b.demoId}`]) await assert.rejects(startLocalDemo(f.root, id, port));
    await assert.rejects(startLocalDemo(f.root, a.demoId, 0), /PORT/);
    const filename = join(a.directory, 'editorial.sqlite'); const parked = join(a.directory, 'parked.sqlite');
    renameSync(filename, parked);
    await assert.rejects(startLocalDemo(f.root, a.demoId, port));
    assert.throws(() => lstatSync(filename));
    writeFileSync(filename, readFileSync(join(b.directory, 'editorial.sqlite')));
    const swappedHash = hash(filename);
    await assert.rejects(startLocalDemo(f.root, a.demoId, port), /does not belong/);
    assert.equal(hash(filename), swappedHash);
    unlinkSync(filename); renameSync(parked, filename);
    const manifestFile = join(a.directory, 'demo.json'); const manifest = readFileSync(manifestFile, 'utf8');
    writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(manifest), databasePath: f.working }));
    const original = hash(filename);
    await assert.rejects(startLocalDemo(f.root, a.demoId, port), /manifest/); assert.equal(hash(filename), original);
    writeFileSync(manifestFile, manifest);
    const seedFile = join(a.directory, 'catalog.seed.json'); const seed = JSON.parse(readFileSync(seedFile, 'utf8')); seed.ingredients[0].name = 'tampered';
    writeFileSync(seedFile, JSON.stringify(seed));
    await assert.rejects(startLocalDemo(f.root, a.demoId, port), /digest/); assert.equal(hash(filename), original);
  } finally { f.dispose(); }
});

test('local demo refuses occupied ports, closes its store and can subsequently reopen the same database', async () => {
  const f = fixture(); const blocker = createServer(); let demo: Awaited<ReturnType<typeof startLocalDemo>> | undefined;
  try {
    const prepared = await prepareLocalDemo(f.root); blocker.listen(0, '127.0.0.1'); await once(blocker, 'listening');
    const port = (blocker.address() as { port: number }).port;
    await assert.rejects(startLocalDemo(f.root, prepared.demoId, port), { code: 'EADDRINUSE' });
    await new Promise<void>((done) => blocker.close(() => done()));
    demo = await startLocalDemo(f.root, prepared.demoId, port);
    assert.equal((await fetch(`${demo.url}/api/ready`)).status, 200);
    await Promise.all([demo.close(), demo.close()]);
  } finally { if (demo) await demo.close(); if (blocker.listening) await new Promise<void>((done) => blocker.close(() => done())); f.dispose(); }
});

test('local demo rejects both linked and dangling setup directories without traversing their targets', async () => {
  const f = fixture(); const target = join(f.root, 'empty-owned-link-target'); const link = join(f.root, '.local', 'local-demo');
  mkdirSync(target);
  try {
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareLocalDemo(f.root), /Linked paths/); assert.deepEqual(readdirSync(target), []);
    assert.equal(lstatSync(target).isSymbolicLink(), false); assert.deepEqual(readdirSync(target), []); rmdirSync(target);
    assert.equal(existsSync(link), false); assert.equal(lstatSync(link).isSymbolicLink(), true);
    await assert.rejects(prepareLocalDemo(f.root), /Linked paths/);
  } finally {
    // Remove only the inspected junction entry, never recurse into its target.
    if (lstatSync(link, { throwIfNoEntry: false })) { assert.equal(lstatSync(link).isSymbolicLink(), true); unlinkSync(link); }
    if (existsSync(target)) { assert.equal(lstatSync(target).isDirectory(), true); assert.deepEqual(readdirSync(target), []); rmdirSync(target); }
    f.dispose();
  }
});

test('local HTTP demo never bypasses production HTTPS guards and rejects before creating or opening a database', async () => {
  const f = fixture(); const previous = process.env.NODE_ENV;
  try {
    const prepared = await prepareLocalDemo(f.root); const dbFile = join(prepared.directory, 'editorial.sqlite');
    const before = hash(dbFile); const count = readdirSync(join(f.root, '.local', 'local-demo')).length;
    process.env.NODE_ENV = 'production';
    await assert.rejects(prepareLocalDemo(f.root), /production/);
    await assert.rejects(startLocalDemo(f.root, prepared.demoId), /production/);
    assert.equal(hash(dbFile), before); assert.equal(readdirSync(join(f.root, '.local', 'local-demo')).length, count);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; f.dispose(); }
});

test('actual local demo CLI ignores inherited secrets, preserves HTTP edits and role isolation across graceful process restart', async () => {
  const f = fixture(); const saved = { ...process.env }; let app: Awaited<ReturnType<typeof launchDemoCli>> | undefined;
  try {
    Object.assign(process.env, { DATABASE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://do-not-use.invalid/private', DATABASE_SCHEMA: 'do_not_use', DB_PATH: f.working,
      AUTH_MODE: 'local-key', EDITOR_TOKEN: 'must-not-print-or-accept', EDUCATION_PUBLICATION_ENABLED: 'true', BIND_HOST: '0.0.0.0', PORT: '1',
      ALLOWED_ORIGINS: 'https://do-not-trust.invalid', TLS_MODE: 'direct', TLS_CERT_FILE: 'missing-certificate', TLS_KEY_FILE: 'missing-key', NODE_ENV: 'test',
      AI_PROVIDER: 'openai', AI_EXTERNAL_ENABLED: 'true', OPENAI_API_KEY: 'must-never-call-or-print', AI_MODEL: 'not-a-model', AI_DAILY_CALL_LIMIT: 'invalid' });
    const before = hash(f.working); const prepared = await prepareLocalDemo(f.root); const users = credentials(prepared.credentialsFile); const port = await freePort();
    app = await launchDemoCli(f.root, prepared.demoId, port);
    const sessions: Record<string, { cookie: string; csrf: string }> = {};
    async function login(role: string) {
      const user = users.find((u) => u.role === role)!;
      const response = await fetch(`${app!.url}/api/v1/auth/login`, { method: 'POST', headers: { Origin: app!.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password: user.password }) });
      assert.equal(response.status, 200); const data = await response.json() as SessionInfo;
      sessions[role] = { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
    }
    const request = (path: string, role = 'editor', method = 'GET', body?: unknown) => fetch(`${app!.url}/api/v1${path}`, { method,
      headers: { Origin: app!.url, Cookie: sessions[role].cookie, 'X-CSRF-Token': sessions[role].csrf, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const role of ['admin', 'editor', 'reviewer']) await login(role);
    const publicBefore = await (await fetch(`${app.url}/api/v1/public/catalog`)).json() as ReturnType<typeof publicCatalog>;
    assert.equal(publicBefore.items.length, 3); assert.equal((await fetch(`${app.url}/`)).status, 200);
    assert.equal((await fetch(`${app.url}/api/v1/summary`)).status, 401);
    assert.equal((await request('/editorial/assistant/config')).status, 200);
    assert.equal(((await (await request('/editorial/assistant/config')).json()) as AssistantConfig).enabled, false);
    assert.equal((await fetch(`${app.url}/api/v1/public/education/huang-qi`)).status, 503);
    assert.equal((await request('/users')).status, 403);
    assert.equal((await request('/ingredients/huang-qi/note', 'reviewer', 'PUT', { text: 'forbidden', expectedRevision: 0 })).status, 403);
    assert.equal((await request('/ingredients/huang-qi/note', 'editor', 'PUT', { text: 'Private demo note', expectedRevision: 0 })).status, 200);
    assert.equal((await request('/ingredients/huang-qi/note', 'editor', 'PUT', { text: 'stale', expectedRevision: 0 })).status, 409);
    const sourceResponse = await request('/editorial/sources', 'editor', 'POST', { title: 'Demo only', publisher: 'Test source', url: 'https://example.org/local-demo' }); assert.equal(sourceResponse.status, 201);
    const source = await sourceResponse.json() as ManagedSource;
    const savedDraft = await request('/editorial/ingredients/huang-qi', 'editor', 'PUT', { expectedLockVersion: 0, content: {
      ediblePart: '待核对', latinName: '', educationText: 'Private demo draft', safetyText: '演示资料，不作医疗判断', sourceRefs: [{ id: source.id, revision: 1, locator: '测试定位' }] } });
    assert.equal(savedDraft.status, 200); const draft = await savedDraft.json() as ContentDraft;
    const submitted = await request('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: draft.lockVersion }); assert.equal(submitted.status, 200);
    const task = await submitted.json() as { task: ReviewTask; draft: ContentDraft };
    assert.equal((await request(`/editorial/tasks/${task.task.id}/decision`, 'editor', 'POST', { expectedLockVersion: task.draft.lockVersion, decision: 'accept', comment: 'not allowed' })).status, 403);
    const accepted = await request(`/editorial/tasks/${task.task.id}/decision`, 'reviewer', 'POST', { expectedLockVersion: task.draft.lockVersion, decision: 'accept', comment: '仅检查演示资料整理，不是专业签审' });
    assert.equal(accepted.status, 200); assert.equal((await accepted.json() as ContentDraft).visibility, 'private');
    const oldCookie = sessions.editor.cookie;
    await app.close(); assert(app.output().stdout.includes('Database and private credentials retained')); app = undefined;
    // The copied seed, not a newly replaced project seed, identifies this demo.
    writeFileSync(join(f.root, 'data', 'catalog.seed.json'), 'not a current catalog');
    app = await launchDemoCli(f.root, prepared.demoId, port);
    assert.equal((await fetch(`${app.url}/api/v1/auth/me`, { headers: { Cookie: oldCookie } })).status, 200);
    await login('editor');
    const detail = await (await request('/editorial/ingredients/huang-qi')).json() as DraftDetail;
    assert(detail.draft); assert.equal(detail.draft.state, 'editorial_accepted'); assert.equal(detail.revisions[0].content.educationText, 'Private demo draft');
    assert.equal(((await (await request('/ingredients/huang-qi')).json()) as IngredientDetail).note.text, 'Private demo note');
    assert.deepEqual(await (await fetch(`${app.url}/api/v1/public/catalog`)).json(), publicBefore);
    assert.equal((await fetch(`${app.url}/api/v1/public/education/huang-qi`)).status, 503);
    const output = JSON.stringify(app.output());
    for (const secret of [...users.map((u) => u.password), 'must-never-call-or-print', 'must-not-print-or-accept', 'do-not-use.invalid']) assert.equal(output.includes(secret), false);
    assert.equal(hash(f.working), before);
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved); f.dispose();
  }
});
