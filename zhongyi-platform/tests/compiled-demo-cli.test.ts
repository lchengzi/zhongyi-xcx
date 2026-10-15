import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssistantConfig, IngredientDetail, SessionInfo } from '../shared/contracts.js';
import { assertNoLinks } from '../server/demo-secrets.js';
import { fixtureApplicationCompletion } from '../tools/fixture-application.js';
import { fixtureSeed } from './fixture.js';
import { launchCompiledDemoCli } from './local-demo-process.js';

// Opt-in built-CLI proof, separate from core tests and the 106-row Edge flows.
// All adversarial data and invalidation below belong to this fresh fixture.
test('actual compiled prepare and manual start CLI isolate inherited configuration and retain edits across restart', async () => {
  const parent = resolve('.local/compiled-demo-cli'); assertNoLinks(parent); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'run-')); assertNoLinks(root);
  for (const directory of ['data', 'dist', '.local']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'data/catalog.seed.json'), JSON.stringify(fixtureSeed()), { flag: 'wx' });
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>Owned CLI gate fixture</title>', { flag: 'wx' });
  const working = join(root, '.local/editorial.sqlite'); writeFileSync(working, 'working-store sentinel, must never be opened', { flag: 'wx' });
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex'); const before = hash(working);
  const saved = { ...process.env };
  const poison = { ...saved, NODE_ENV: 'test', DATABASE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://must-not-connect.invalid/private',
    DATABASE_SCHEMA: 'must_not_open', DATABASE_URL_FILE: 'must-not-read-secret-file', DATABASE_RUNTIME_URL_FILE: 'must-not-read-runtime-file',
    DB_PATH: working, AUTH_MODE: 'local-key', EDITOR_TOKEN: 'must-not-print-editor-secret', EDUCATION_PUBLICATION_ENABLED: 'true',
    BIND_HOST: '0.0.0.0', PORT: '1', ALLOWED_ORIGINS: 'https://must-not-trust.invalid', TLS_MODE: 'direct', TLS_CERT_FILE: 'must-not-read-cert', TLS_KEY_FILE: 'must-not-read-key',
    AI_PROVIDER: 'openai', AI_EXTERNAL_ENABLED: 'true', OPENAI_API_KEY: 'must-not-call-model-secret', AI_MODEL: 'not-a-real-model', AI_DAILY_CALL_LIMIT: 'invalid' };
  const report = { kind: 'compiled-manual-demo-cli', startedAt: new Date().toISOString(), finishedAt: null as string | null,
    status: 'running', checks: { compiledPrepare: false, inheritedConfigurationIgnored: false, serverRoleEnforced: false,
      staleWriteRejected: false, restartPersistence: false, copiedCatalogPreserved: false, privateBoundary: false, workingStoreUnchanged: false, secretOutputAbsent: false },
    rejectedInvocations: 0, applicationStarts: 0, gracefulStops: 0, fixturesStopped: false,
    compiledBackendVerified: false, deploymentVerified: false, realModelCalls: 0, professionalReviewVerified: false };
  const persist = () => writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); persist();
  const entry = fileURLToPath(new URL('../build/tools/local-demo.js', import.meta.url)); assertNoLinks(entry); assert(existsSync(entry));
  let app: Awaited<ReturnType<typeof launchCompiledDemoCli>> | undefined; let failure: unknown;
  const outputs: string[] = [];
  async function command(args: string[], env: NodeJS.ProcessEnv, observeStart = false) {
    const launcher = observeStart ? fileURLToPath(new URL('./fixtures/compiled-demo-cli-application.mjs', import.meta.url)) : entry;
    const child = spawn(process.execPath, [launcher, ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = ''; let stderr = ''; child.stdout!.on('data', (v) => { stdout += v; }); child.stderr!.on('data', (v) => { stderr += v; });
    const ended = fixtureApplicationCompletion(child);
    // An unexpected successful start still closes normally; no force-kill and
    // no observation timeout is treated as process completion.
    if (observeStart) child.send('test-stop'); else child.disconnect();
    const [code, signal] = await ended; assert.equal(signal, null); outputs.push(stdout, stderr); return { code, stdout };
  }
  try {
    const prepared = await command(['prepare'], poison); assert.equal(prepared.code, 0);
    const demoId = /Prepared isolated local demo: (demo-[a-f0-9-]+)/.exec(prepared.stdout)?.[1]; assert(demoId);
    assert(prepared.stdout.includes(`demo:start:compiled -- ${demoId}`)); report.checks.compiledPrepare = true;
    const credentials = JSON.parse(readFileSync(join(root, '.local/local-demo', demoId, 'credentials.json'), 'utf8')).accounts as Array<{ username: string; password: string; role: string }>;
    for (const [args, env] of [
      [['../editorial.sqlite'], poison], [[demoId, '--port', '0'], poison], [[demoId, '--port', '4314'], { ...poison, NODE_ENV: 'production' }]
    ] as Array<[string[], NodeJS.ProcessEnv]>) {
      assert.equal((await command(args, env, true)).code, 1); report.rejectedInvocations++;
    }
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = (reservation.address() as { port: number }).port; await new Promise<void>((done) => reservation.close(() => done()));
    Object.assign(process.env, poison);
    app = await launchCompiledDemoCli(root, demoId, port); report.applicationStarts++;
    assert.equal((await command([demoId, '--port', String(port)], poison, true)).code, 1); report.rejectedInvocations++;
    const sessions: Record<string, { cookie: string; csrf: string }> = {};
    async function login(role: string) {
      const user = credentials.find((item) => item.role === role)!;
      const response = await fetch(`${app!.url}/api/v1/auth/login`, { method: 'POST', headers: { Origin: app!.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password: user.password }) });
      assert.equal(response.status, 200); const session = await response.json() as SessionInfo;
      sessions[role] = { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: session.csrfToken };
    }
    const request = (path: string, role = 'editor', method = 'GET', body?: unknown) => fetch(`${app!.url}/api/v1${path}`, { method,
      headers: { Origin: app!.url, Cookie: sessions[role].cookie, 'X-CSRF-Token': sessions[role].csrf, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    await login('editor'); await login('reviewer');
    assert.equal(((await (await request('/editorial/assistant/config')).json()) as AssistantConfig).enabled, false);
    assert.equal((await fetch(`${app.url}/api/v1/public/education/huang-qi`)).status, 503);
    assert.equal((await fetch(`${app.url}/api/v1/summary`, { headers: { Authorization: 'Bearer must-not-print-editor-secret' } })).status, 401);
    report.checks.inheritedConfigurationIgnored = true;
    const catalog = await (await fetch(`${app.url}/api/v1/public/catalog`)).json() as { items: unknown[] }; assert.equal(catalog.items.length, 3);
    assert.equal((await request('/ingredients/huang-qi/note', 'reviewer', 'PUT', { text: 'forbidden', expectedRevision: 0 })).status, 403);
    assert.equal((await request('/users')).status, 403); report.checks.serverRoleEnforced = true;
    assert.equal((await request('/ingredients/huang-qi/note', 'editor', 'PUT', { text: 'Compiled manual CLI private note', expectedRevision: 0 })).status, 200);
    assert.equal((await request('/ingredients/huang-qi/note', 'editor', 'PUT', { text: 'stale', expectedRevision: 0 })).status, 409); report.checks.staleWriteRejected = true;
    const cookie = sessions.editor.cookie;
    await app.close(); outputs.push(JSON.stringify(app.output())); report.gracefulStops++; app = undefined;
    // The compiled manual demo uses its prepared copy, not the working seed.
    writeFileSync(join(root, 'data/catalog.seed.json'), 'invalidated owned project seed');
    app = await launchCompiledDemoCli(root, demoId, port); report.applicationStarts++;
    assert.equal((await fetch(`${app.url}/api/v1/auth/me`, { headers: { Cookie: cookie } })).status, 200);
    await login('editor');
    const detail = await (await request('/ingredients/huang-qi')).json() as IngredientDetail;
    assert.equal(detail.note.text, 'Compiled manual CLI private note'); report.checks.restartPersistence = true;
    assert.deepEqual(await (await fetch(`${app.url}/api/v1/public/catalog`)).json(), catalog); report.checks.copiedCatalogPreserved = true;
    assert.equal((await fetch(`${app.url}/api/v1/public/education/huang-qi`)).status, 503); report.checks.privateBoundary = true;
    await app.close(); outputs.push(JSON.stringify(app.output())); report.gracefulStops++; app = undefined;
    report.checks.workingStoreUnchanged = hash(working) === before; assert(report.checks.workingStoreUnchanged);
    for (const secret of [...credentials.map((item) => item.password), poison.EDITOR_TOKEN, poison.OPENAI_API_KEY, 'must-not-connect.invalid']) assert.equal(outputs.join('\n').includes(secret), false);
    report.checks.secretOutputAbsent = true; assert(Object.values(report.checks).every(Boolean));
  } catch (error) { failure = error; }
  finally {
    try { if (app) { await app.close(); report.gracefulStops++; app = undefined; } } catch (error) { failure ??= error; }
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
    report.fixturesStopped = app === undefined && report.applicationStarts === report.gracefulStops;
    report.compiledBackendVerified = !failure && report.fixturesStopped;
    report.status = failure ? 'failed' : 'passed'; report.finishedAt = new Date().toISOString(); persist();
  }
  console.log(`Compiled manual demo CLI report: ${join(root, 'report.json')}`);
  if (failure) assert.fail('Compiled manual demo CLI failed; private arguments redacted. See the owned report and test source.');
  assert(report.fixturesStopped);
});
