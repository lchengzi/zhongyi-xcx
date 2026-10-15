import assert from 'node:assert/strict';
import { fixtureApplicationWrapper } from '../tools/fixture-application.js';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, lstatSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { initializePostgres } from '../server/initialize-postgres.js';
import { createPostgresPool, verifyImportedPostgres } from '../server/postgres-migration.js';
import { identifier } from '../server/migration-snapshot.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { validateSeed } from '../server/seed.js';
import { fixtureSeed } from './fixture.js';
import { fixturePassword } from './migration-fixture.js';
import { ciEnvironment } from '../tools/ci-core.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection) throw new Error('A real isolated PostgreSQL fixture is required.');
const schemaName = () => `container_${randomUUID().replaceAll('-', '')}`;

function secretFixture(schema: string) {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-container-pg-test-'));
  const filename = join(directory, 'database-url.txt');
  writeFileSync(filename, connection!, { flag: 'wx', mode: 0o600 });
  const unusedSqlite = join(directory, 'must-not-exist.sqlite');
  const env = { ...ciEnvironment(process.env, unusedSqlite), DATABASE_PROVIDER: 'postgres', DATABASE_SCHEMA: schema,
    DATABASE_URL_FILE: filename, BOOTSTRAP_PASSWORD: fixturePassword };
  return { env, directory, unusedSqlite, dispose: () => {
    assert.deepEqual(readdirSync(directory), ['database-url.txt']); assert.equal(lstatSync(directory).isSymbolicLink(), false);
    assert.equal(lstatSync(filename).isSymbolicLink(), false); assert(lstatSync(filename).isFile());
    assert.equal(realpathSync(filename), resolve(realpathSync(directory), 'database-url.txt'));
    unlinkSync(filename); rmdirSync(directory);
  } };
}

const execute = promisify(execFile);
const command = (env: NodeJS.ProcessEnv, args: string[]) => execute(process.execPath, ['build/tools/container-entrypoint.js', ...args], { env, windowsHide: true });

test('fresh PostgreSQL initialization uses real migrations and seed with empty private business tables; existing namespaces are never replaced', async () => {
  const pool = createPostgresPool(connection!); const schema = schemaName(); const target = identifier(schema); const seed = fixtureSeed();
  try {
    const report = await initializePostgres(pool, schema, seed); assert.equal(report.verified, true); assert.equal(report.publicationEnabled, false);
    assert.equal(report.rowCounts.ingredients, 3); assert.equal(Object.keys(report.rowCounts).length, 32);
    for (const table of ['users', 'sessions', 'editorial_notes', 'source_versions', 'content_revisions', 'assistant_events', 'assistant_reservations',
      'publication_snapshots', 'publication_approvals', 'publication_events', 'publication_controls', 'photo_notes', 'photo_submissions']) assert.equal(report.rowCounts[table], 0);
    assert.deepEqual((await pool.query(`SELECT version FROM ${target}.migrations ORDER BY version`)).rows.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual((await pool.query(`SELECT version FROM ${target}.postgres_migrations ORDER BY version`)).rows.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(await verifyImportedPostgres(pool, schema, seed), report);
    const stores = await openPostgresStore(connection!, schema, seed);
    try { await stores.auth.createUser('existing-admin', fixturePassword, 'admin', 'test-fixture', true); await stores.catalog.saveNote('huang-qi', 'existing private content', 0, 'existing-admin'); }
    finally { await stores.close(); }
    await assert.rejects(initializePostgres(pool, schema, seed), (error: any) => error.code === 'target_exists');
    assert.equal((await pool.query(`SELECT text FROM ${target}.editorial_notes`)).rows[0].text, 'existing private content');
    assert.equal((await pool.query(`SELECT COUNT(*) AS count FROM ${target}.users`)).rows[0].count, 1);
  } finally { await pool.end(); }
});

test('compiled container init/bootstrap/verify commands persist the real 106-row seed and refuse duplicate initialization without leaking credentials', async () => {
  const schema = schemaName(); const fixture = secretFixture(schema); const pool = createPostgresPool(connection!);
  try {
    const initialized = await command(fixture.env, ['init', '--schema', schema]); const report = JSON.parse(initialized.stdout);
    assert.equal(report.verified, true); assert.equal(report.rowCounts.ingredients, 106); assert.equal(report.rowCounts.users, 0);
    assert.equal(initialized.stderr.includes('postgres_initialization'), false, 'Initialization diagnostics are default-off');
    const verified = await command(fixture.env, ['migrate', '--verify', '--schema', schema]); assert.equal(JSON.parse(verified.stdout).verified, true);
    const bootstrap = await command(fixture.env, ['bootstrap', 'container-demo-admin']); assert.match(bootstrap.stdout, /Administrator created/);
    // Import verification means exact equality with the initial snapshot, not
    // operational readiness after legitimate business writes such as bootstrap.
    await assert.rejects(command(fixture.env, ['migrate', '--verify', '--schema', schema]), (error: any) => { assert.match(error.stderr, /roundtrip_mismatch/); return true; });
    await assert.rejects(command({ ...fixture.env, PG_INITIALIZATION_DIAGNOSTICS: 'true' }, ['init', '--schema', schema]), (error: unknown) => {
      assert(error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string');
      assert.match(error.stderr, /target_exists/);
      const diagnostic = error.stderr.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(record => record.event === 'postgres_initialization');
      assert(diagnostic); assert.equal(diagnostic.outcome, 'failed'); assert.equal(diagnostic.phase, 'postgres-target-check');
      assert.equal(diagnostic.rollback.outcome, 'completed'); assert.equal(diagnostic.cleanup.sqlite.outcome, 'completed');
      assert.equal(diagnostic.cleanup.postgres.outcome, 'completed');
      for (const secret of [connection!, fixturePassword, fixture.directory, schema]) assert.equal(error.stderr.includes(secret), false);
      return true;
    });
    await assert.rejects(command(fixture.env, ['bootstrap', 'second-admin']));
    await assert.rejects(command(fixture.env, ['init', '--schema', `${schema}_other`, '--ignored']), (error: any) => { assert.match(error.stderr, /initialization_failed/); return true; });
    assert.equal((await pool.query('SELECT COUNT(*) AS count FROM pg_namespace WHERE nspname = $1', [`${schema}_other`])).rows[0].count, 0);
    assert.equal((await pool.query(`SELECT COUNT(*) AS count FROM ${identifier(schema)}.users`)).rows[0].count, 1);
    for (const result of [initialized, bootstrap, verified]) for (const secret of [connection!, fixturePassword]) assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
    assert.equal(existsSync(fixture.unusedSqlite), false);
  } finally { await pool.end(); fixture.dispose(); }
});

async function unusedPort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port; await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); return port;
}

async function serve(env: NodeJS.ProcessEnv) {
  const port = await unusedPort(); const origin = `http://127.0.0.1:${port}`;
  // Invoke the real compiled wrapper/server. Windows cannot deliver POSIX
  // SIGTERM; IPC emits that event in the child to test the registered drain
  // handler. This is NOT evidence of Docker/Linux signal delivery.
  const program = fixtureApplicationWrapper('container');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
    env: { ...env, PORT: String(port), BIND_HOST: '127.0.0.1', ALLOWED_ORIGINS: origin }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = ''; child.stdout!.on('data', (chunk) => { output += chunk; }); child.stderr!.on('data', (chunk) => { output += chunk; });
  const exited = once(child, 'exit'); let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    if (child.exitCode === null && child.signalCode === null && child.connected) child.send('stop');
    const [code, signal] = await exited; assert.equal(code, 0); assert.equal(signal, null);
    for (const secret of [connection!, fixturePassword]) assert.equal(output.includes(secret), false);
  })();
  try {
    const deadline = Date.now() + 30000;
    while (true) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Compiled server exited before readiness');
      try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
      if (Date.now() >= deadline) throw new Error('Compiled server readiness observation expired');
      await new Promise((done) => setTimeout(done, 100));
    }
    return { origin, stop, api: (path: string, init: RequestInit = {}, session?: { cookie: string; csrf: string }) => fetch(`${origin}/api/v1${path}`, {
      ...init, headers: { Origin: origin, ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...init.headers }
    }) };
  } catch (error) { await stop(); throw error; }
}

test('compiled container server supports real HTTP login/write and survives application restart on PostgreSQL without SQLite fallback or private publication', async () => {
  const schema = schemaName(); const fixture = secretFixture(schema);
  const seed = validateSeed(JSON.parse(readFileSync('data/catalog.seed.json', 'utf8'))); const id = seed.ingredients[0].id;
  try {
    await command(fixture.env, ['init', '--schema', schema]); await command(fixture.env, ['bootstrap', 'container-demo-admin']);
    const first = await serve(fixture.env); let session: { cookie: string; csrf: string };
    try {
      const login = await first.api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'container-demo-admin', password: fixturePassword }) });
      assert.equal(login.status, 200); const info: any = await login.json(); session = { cookie: login.headers.get('set-cookie')!.split(';')[0], csrf: info.csrfToken };
      assert.equal((await first.api(`/ingredients/${id}/note`, { method: 'PUT', body: JSON.stringify({ text: 'container-private-note-fixture', expectedRevision: 0 }) }, session)).status, 200);
      assert.equal((await first.api(`/ingredients/${id}`)).status, 401);
      const publicData = await (await first.api('/public/catalog')).text(); assert.equal(publicData.includes('container-private-note-fixture'), false); assert.equal(JSON.parse(publicData).items.length, 106);
    } finally { await first.stop(); }
    const second = await serve(fixture.env);
    try {
      const result = await second.api(`/ingredients/${id}`, {}, session!); assert.equal(result.status, 200);
      const body: any = await result.json(); assert.equal(body.note.text, 'container-private-note-fixture'); assert.equal(body.note.revision, 1);
    } finally { await second.stop(); }
    assert.equal(existsSync(fixture.unusedSqlite), false);
  } finally { fixture.dispose(); }
});
