import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { runtimeConfig } from '../server/runtime-config.js';
import { tlsOptions } from '../server/tls-config.js';
import { CatalogRepository } from '../server/database.js';
import { createApp } from '../server/app.js';
import { fixtureSeed } from './fixture.js';
import { createPostgresPool, postgresConnectionOptions } from '../server/postgres-migration.js';
import { openConfiguredStore } from '../server/store-config.js';
import { httpsTestBuildPlan, httpsTestProof, httpsTestProvider, ownedHttpsPostgres, httpsOwnedReportPath } from '../tools/https-test-plan.js';
import { ownedHttpsRuntimeConnection } from '../tools/https-postgres-fixture.js';

test('restricted HTTPS runtime URL is bound to its namespace and live TLS cluster, never an inherited working or owner credential', () => {
  const original = new URL(`postgresql://postgres_fixture:${'a'.repeat(64)}@localhost:54321/postgres`);
  original.searchParams.set('sslmode', 'verify-full'); original.searchParams.set('sslrootcert', resolve('.local/postgres-tests/cluster-ABC123/ca.pem'));
  const schema = `https_workbench_${'b'.repeat(32)}`;
  const runtime = new URL(original); runtime.username = `https_runtime_${'b'.repeat(32)}`; runtime.password = 'c'.repeat(64);
  const env = { PG_TEST_DATABASE_URL: original.toString(), PG_TEST_NONCE: 'd'.repeat(32), HTTPS_TEST_RUNTIME_DATABASE_URL: runtime.toString() };
  assert.equal(ownedHttpsRuntimeConnection(env, schema, true), runtime.toString());
  assert.throws(() => ownedHttpsRuntimeConnection(env, schema, false));
  assert.throws(() => ownedHttpsRuntimeConnection(env, 'working_schema', true));
  for (const mutate of [(url: URL) => { url.username = 'postgres_fixture'; }, (url: URL) => { url.username = `https_runtime_${'f'.repeat(32)}`; },
    (url: URL) => { url.password = 'not-a-fixture-secret'; }, (url: URL) => { url.hostname = 'working.example.test'; },
    (url: URL) => { url.port = '12345'; }, (url: URL) => { url.pathname = '/working'; }, (url: URL) => { url.search = ''; }]) {
    const changed = new URL(runtime); mutate(changed);
    assert.throws(() => ownedHttpsRuntimeConnection({ ...env, HTTPS_TEST_RUNTIME_DATABASE_URL: changed.toString() }, schema, true),
      (error: Error) => !error.message.includes(changed.toString()) && !error.message.includes('not-a-fixture-secret'));
  }
  for (const value of ['', 'malformed-private-input']) assert.throws(() => ownedHttpsRuntimeConnection({ ...env, HTTPS_TEST_RUNTIME_DATABASE_URL: value }, schema, true), (error: Error) => !error.message.includes('malformed-private-input'));
});

test('PostgreSQL connection refuses weak TLS, compatibility downgrades, duplicate parameters and host overrides', () => {
  const base = 'postgresql://test:private-test-password@localhost/test';
  for (const query of ['sslmode=no-verify', 'sslmode=prefer', 'sslmode=require', 'sslmode=verify-ca', 'ssl=true',
    'sslmode=verify-full&uselibpqcompat=true', 'sslmode=verify-full&sslmode=disable', 'host=remote.example.test', 'sslnegotiation=direct']) {
    assert.throws(() => createPostgresPool(`${base}?${query}`), (error: Error) => !error.message.includes('private-test-password'));
  }
});
test('PostgreSQL verify-full explicitly enables chain hostname and TLS version checks', async () => {
  const pool = createPostgresPool('postgresql://test:private-test-password@localhost/test?sslmode=verify-full');
  try {
    const ssl = pool.options.ssl;
    assert(ssl && typeof ssl === 'object'); assert.equal(ssl.rejectUnauthorized, true); assert.equal(ssl.minVersion, 'TLSv1.2');
    assert.equal(ssl.checkServerIdentity, undefined, 'Use Node built-in hostname verification');
    assert.equal(new URL(pool.options.connectionString!).search, '', 'Driver URL parsing must not replace the checked SSL object');
    assert.equal(pool.options.sslnegotiation, 'postgres');
  } finally { await pool.end(); }
});
test('PostgreSQL custom trust requires verify-full and an existing absolute CA file without exposing paths', () => {
  const base = 'postgresql://test:private-test-password@localhost/test';
  for (const query of ['sslrootcert=relative.pem', 'sslmode=disable&sslrootcert=relative.pem',
    'sslmode=verify-full&sslrootcert=relative.pem', `sslmode=verify-full&sslrootcert=${encodeURIComponent(resolve('.local/must-not-exist-tls-ca.pem'))}`]) {
    assert.throws(() => createPostgresPool(`${base}?${query}`), (error: Error) => !error.message.includes('private-test-password') && !error.message.includes('must-not-exist'));
  }
});
test('PostgreSQL existing local plaintext demos remain explicitly plaintext rather than inheriting PGSSLMODE', async () => {
  for (const suffix of ['', '?sslmode=disable']) {
    const pool = createPostgresPool(`postgresql://test@localhost/test${suffix}`);
    try { assert.equal(pool.options.ssl, false); assert.equal(new URL(pool.options.connectionString!).search, ''); }
    finally { await pool.end(); }
  }
});

test('production PostgreSQL rejects plaintext synchronously in the shared pool factory and cannot opt out of identity checks', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const connection = 'postgresql://fixture:private-production-password@localhost/test';
  try {
    for (const suffix of ['', '?sslmode=disable']) for (const required of [false, true]) {
      for (const build of [postgresConnectionOptions, createPostgresPool]) assert.throws(() => build(`${connection}${suffix}`, required),
        (error: any) => error.code === 'tls_required' && !error.message.includes('private-production-password'));
    }
    for (const mode of ['require', 'prefer', 'verify-ca', 'no-verify']) assert.throws(() => createPostgresPool(`${connection}?sslmode=${mode}`));
    const pool = createPostgresPool(`${connection}?sslmode=verify-full`);
    try {
      assert(pool.options.ssl && typeof pool.options.ssl === 'object'); assert.equal(pool.options.ssl.rejectUnauthorized, true);
      assert.equal(pool.options.ssl.minVersion, 'TLSv1.2'); assert.equal(pool.options.ssl.checkServerIdentity, undefined);
    } finally { await pool.end(); }
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('an explicitly supplied production store environment requires TLS without changing the host environment or selecting SQLite', async () => {
  const previous = process.env.NODE_ENV;
  const databaseUrl = 'postgresql://fixture:private-production-password@localhost:1/test';
  for (const suffix of ['', '?sslmode=disable']) {
    await assert.rejects(openConfiguredStore(fixtureSeed(), { NODE_ENV: 'production', DATABASE_PROVIDER: 'postgres',
      DATABASE_URL: `${databaseUrl}${suffix}`, DATABASE_SCHEMA: 'fixture' }),
    (error: any) => error.code === 'tls_required' && !error.message.includes('private-production-password'));
  }
  assert.equal(process.env.NODE_ENV, previous);
});
test('PostgreSQL invalid encoded credentials and ambiguous URLs fail with sanitized errors before opening storage', () => {
  for (const connection of ['postgresql://user:%ZZ@localhost/test', 'postgresql://user:private-test-password@localhost/test#fragment',
    'postgresql://localhost/', 'https://user:private-test-password@example.test/database']) {
    assert.throws(() => createPostgresPool(connection), (error: Error) => !error.message.includes('private-test-password') && !error.message.includes('%ZZ'));
  }
});

test('HTTPS provider selection is fixed and PostgreSQL requires the live isolated controller contract', () => {
  assert.equal(httpsTestProvider([]), 'sqlite'); assert.equal(httpsTestProvider(['--postgres']), 'postgres');
  for (const args of [['--sqlite'], ['--postgres', '--postgres'], ['../private.ts'], ['--postgres; echo secret']]) assert.throws(() => httpsTestProvider(args));
  const caFile = resolve('.local/postgres-tests/cluster-ABC123/ca.pem');
  const connection = new URL(`postgresql://postgres_fixture:${'a'.repeat(64)}@localhost:54321/postgres`);
  connection.searchParams.set('sslmode', 'verify-full'); connection.searchParams.set('sslrootcert', caFile);
  const env = { PG_TEST_DATABASE_URL: connection.toString(), PG_TEST_NONCE: 'b'.repeat(32) };
  assert.equal(ownedHttpsPostgres(env, true).connection, env.PG_TEST_DATABASE_URL);
  assert.equal(ownedHttpsPostgres(env, true).caFile, caFile);
  assert.throws(() => ownedHttpsPostgres(env, false));
  for (const change of [{ PG_TEST_NONCE: '' }, { PG_TEST_NONCE: 'not-owned' }, { PG_TEST_DATABASE_URL: '' },
    { PG_TEST_DATABASE_URL: env.PG_TEST_DATABASE_URL.replace('localhost', 'remote.example.test') },
    { PG_TEST_DATABASE_URL: env.PG_TEST_DATABASE_URL.replace('postgres_fixture', 'working_user') }]) {
    assert.throws(() => ownedHttpsPostgres({ ...env, ...change }, true), (error: Error) => !error.message.includes(env.PG_TEST_DATABASE_URL));
  }
});

test('joint HTTPS database contract rejects plaintext, ambiguous TLS and CA paths outside its owned cluster', () => {
  const connection = new URL(`postgresql://postgres_fixture:${'a'.repeat(64)}@localhost:54321/postgres`);
  const caFile = resolve('.local/postgres-tests/cluster-ABC123/ca.pem');
  connection.searchParams.set('sslmode', 'verify-full'); connection.searchParams.set('sslrootcert', caFile);
  const reject = (url: URL) => assert.throws(() => ownedHttpsPostgres({ PG_TEST_DATABASE_URL: url.toString(), PG_TEST_NONCE: 'b'.repeat(32) }, true),
    (error: Error) => !error.message.includes(url.toString()) && !error.message.includes(caFile));
  for (const query of ['', 'sslmode=disable', 'sslmode=verify-full',
    `${connection.search.slice(1)}&sslmode=disable`, `${connection.search.slice(1)}&sslrootcert=${encodeURIComponent(caFile)}`,
    `${connection.search.slice(1)}&application_name=unowned`]) {
    const url = new URL(connection); url.search = query; reject(url);
  }
  for (const filename of ['relative/ca.pem', resolve('ca.pem'), resolve('.local/postgres-tests/cluster-invalid/ca.pem'),
    resolve('.local/postgres-tests/cluster-ABC123/server.pem'), resolve('.local/postgres-tests/cluster-ABC123/nested/ca.pem')]) {
    const url = new URL(connection); url.searchParams.set('sslrootcert', filename); reject(url);
  }
  const wrongHost = new URL(connection); wrongHost.hostname = '127.0.0.1'; reject(wrongHost);
});

test('nested PostgreSQL HTTPS evidence is limited to a fresh owned HTTPS result file', () => {
  const root = resolve('.'); const filename = join(root, '.local/https-tests/run-ABC123/result.json');
  assert.equal(httpsOwnedReportPath(root, filename), filename);
  for (const path of [join(root, '.local/https-test-results.latest.json'), join(root, 'result.json'),
    join(root, '.local/https-tests/run-ABC123/ca.key'), '../result.json', join(root, '.local/https-tests/run-invalid/result.json')]) assert.throws(() => httpsOwnedReportPath(root, path));
});

test('HTTPS builds target only a newly owned run, never shared build/dist or a caller-selected application entrypoint', () => {
  const root = resolve('.'); const directory = join(root, '.local/https-tests/run-ABC123');
  const plan = httpsTestBuildPlan(root, directory);
  assert.equal(plan.backend, join(directory, 'build')); assert.equal(plan.frontend, join(directory, 'dist'));
  assert.equal(plan.commands[0].at(-1), plan.backend); assert.equal(plan.commands[1].at(-1), plan.frontend);
  for (const path of [root, join(root, 'build/run-ABC123'), join(root, '.local/https-tests'), join(root, '.local/https-tests/run-ABC123/../outside'), 'relative/run-ABC123']) assert.throws(() => httpsTestBuildPlan(root, path));
  assert.throws(() => httpsTestBuildPlan('.', directory));
});

test('HTTPS proof requires all six cases, authenticated teardown and current publication/default-off/restart/browser evidence', () => {
  const output = '# tests 6\n# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  const proof = { type: 'https-proof', nonce: 'owned', databaseProvider: 'sqlite', storageEngineVerified: true, postgresSchemasVerified: 0,
    fixturesStopped: true, certificateChainVerified: true, secureCookieVerified: true,
    browserFlowVerified: true, applicationRestartVerified: true, publicationFlowVerified: true, publicationDefaultOffVerified: true,
    publicationRestartVerified: true, publicationBrowserFlowVerified: true,
    publicEducationClientVerified: true, publicEducationClientRequests: 21,
    publicEducationRecoveryVerified: false, publicEducationRecoveryRequests: 0,
    requestDiagnosticsVerified: true, diagnosticFaultsVerified: true, diagnosticApplications: 7, diagnosticMatchedRequests: 20,
    databaseTlsVerified: false, databaseCertificateChainVerified: false, databaseHostnameMismatchRejected: false,
    databaseUntrustedCaRejected: false, databasePlaintextRejected: false, databaseTlsApplicationsVerified: 0,
    databaseRuntimePermissionsVerified: false, databaseRestrictedApplicationsVerified: 0 };
  assert.equal(httpsTestProof(output, 0, proof, 'owned').passed, 6);
  for (const key of ['fixturesStopped', 'storageEngineVerified', 'certificateChainVerified', 'secureCookieVerified', 'browserFlowVerified', 'applicationRestartVerified',
    'publicationFlowVerified', 'publicationDefaultOffVerified', 'publicationRestartVerified', 'publicationBrowserFlowVerified',
    'requestDiagnosticsVerified', 'diagnosticFaultsVerified', 'publicEducationClientVerified']) assert.throws(() => httpsTestProof(output, 0, { ...proof, [key]: false }, 'owned'));
  for (const publicEducationClientRequests of [undefined, 0, 20, 21.1]) {
    assert.throws(() => httpsTestProof(output, 0, { ...proof, publicEducationClientRequests }, 'owned'));
  }
  assert.throws(() => httpsTestProof(output, 0, { ...proof, publicEducationClientVerified: undefined }, 'owned'));
  for (const change of [{ diagnosticApplications: 6 }, { diagnosticApplications: 8 }, { diagnosticMatchedRequests: 6 },
    { diagnosticMatchedRequests: 7.1 }, { diagnosticMatchedRequests: undefined }]) assert.throws(() => httpsTestProof(output, 0, { ...proof, ...change }, 'owned'));
  for (const code of [1, null]) assert.throws(() => httpsTestProof(output, code, proof, 'owned'));
  assert.throws(() => httpsTestProof(output.replaceAll('6', '4'), 0, proof, 'owned'));
  assert.throws(() => httpsTestProof(output.replace('# skipped 0', '# skipped 1'), 0, proof, 'owned'));
  assert.throws(() => httpsTestProof(output, 0, proof, 'other')); assert.throws(() => httpsTestProof(output, 0, undefined, 'owned'));
  assert.throws(() => httpsTestProof(output, 0, proof, 'owned', 'postgres'));
  const postgres = { ...proof, databaseProvider: 'postgres', postgresSchemasVerified: 4, databaseTlsVerified: true,
    diagnosticApplications: 9, publicEducationClientRequests: 28, publicEducationRecoveryVerified: true, publicEducationRecoveryRequests: 7,
    databaseCertificateChainVerified: true, databaseHostnameMismatchRejected: true, databaseUntrustedCaRejected: true,
    databasePlaintextRejected: true, databaseTlsApplicationsVerified: 9,
    databaseRuntimePermissionsVerified: true, databaseRestrictedApplicationsVerified: 9 };
  assert.equal(httpsTestProof(output, 0, postgres, 'owned', 'postgres').passed, 6);
  for (const change of [{ publicEducationRecoveryVerified: false }, { publicEducationRecoveryVerified: undefined },
    { publicEducationRecoveryRequests: 6 }, { publicEducationRecoveryRequests: 7.1 }, { publicEducationRecoveryRequests: undefined },
    { publicEducationClientRequests: 21 }, { publicEducationClientRequests: 27 }, { diagnosticApplications: 7 }, { postgresSchemasVerified: 3 }]) {
    assert.throws(() => httpsTestProof(output, 0, { ...postgres, ...change }, 'owned', 'postgres'));
  }
  for (const change of [{ publicEducationRecoveryVerified: true }, { publicEducationRecoveryVerified: undefined },
    { publicEducationRecoveryRequests: 7 }, { publicEducationRecoveryRequests: undefined }]) {
    assert.throws(() => httpsTestProof(output, 0, { ...proof, ...change }, 'owned'));
  }
  assert.throws(() => httpsTestProof(output, 0, { ...postgres, postgresSchemasVerified: 2 }, 'owned', 'postgres'));
  for (const key of ['databaseTlsVerified', 'databaseCertificateChainVerified', 'databaseHostnameMismatchRejected',
    'databaseUntrustedCaRejected', 'databasePlaintextRejected', 'databaseRuntimePermissionsVerified']) {
    assert.throws(() => httpsTestProof(output, 0, { ...postgres, [key]: false }, 'owned', 'postgres'));
    assert.throws(() => httpsTestProof(output, 0, { ...postgres, [key]: undefined }, 'owned', 'postgres'));
    assert.throws(() => httpsTestProof(output, 0, { ...proof, [key]: true }, 'owned'));
  }
  for (const count of [0, 6, 7, 8, undefined]) assert.throws(() => httpsTestProof(output, 0, { ...postgres, databaseTlsApplicationsVerified: count }, 'owned', 'postgres'));
  for (const count of [0, 6, 7, 8, undefined]) assert.throws(() => httpsTestProof(output, 0, { ...postgres, databaseRestrictedApplicationsVerified: count }, 'owned', 'postgres'));
  assert.throws(() => httpsTestProof(output, 0, { ...proof, databaseRestrictedApplicationsVerified: 7 }, 'owned'));
  assert.throws(() => httpsTestProof(output, 0, { ...proof, databaseTlsApplicationsVerified: 7 }, 'owned'));
});

test('TLS configuration is explicit: production cannot run plaintext; direct mode requires accounts and separate absolute files', () => {
  assert.equal(runtimeConfig({}).tls.mode, 'off'); assert.equal(tlsOptions(runtimeConfig({})), undefined);
  const valid = { TLS_MODE: 'direct', AUTH_MODE: 'accounts', ALLOWED_ORIGINS: 'https://localhost:4310', TLS_CERT_FILE: resolve('fixture.pem'), TLS_KEY_FILE: resolve('fixture.key') };
  assert.equal(runtimeConfig(valid).authentication.secureCookies, true);
  for (const patch of [{ TLS_MODE: 'proxy' }, { TLS_MODE: 'off' }, { AUTH_MODE: 'local-key' }, { TLS_CERT_FILE: '' }, { TLS_KEY_FILE: '' },
    { TLS_KEY_FILE: 'relative.key' }, { TLS_CERT_FILE: valid.TLS_KEY_FILE }, { ALLOWED_ORIGINS: 'http://localhost:4310' }, { ALLOWED_ORIGINS: '' }]) assert.throws(() => runtimeConfig({ ...valid, ...patch }));
  assert.throws(() => tlsOptions(runtimeConfig(valid)), 'missing TLS files must fail before storage opens');
});

test('anonymous readiness validates SQL catalog integrity and returns no private data; liveness alone stays green on data drift', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const server = createApp(repo, 'a'.repeat(40)).listen(0, '127.0.0.1');
  await once(server, 'listening'); const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ready = await fetch(`${root}/api/ready`); assert.equal(ready.status, 200); assert.equal(ready.headers.get('cache-control'), 'no-store'); assert.deepEqual(await ready.json(), { ok: true });
    assert.equal((await fetch(`${root}/api/ready?private=query`)).status, 400);
    const payload = JSON.parse((repo.db.prepare("SELECT payload FROM ingredients WHERE id = 'huang-qi'").get() as { payload: string }).payload);
    payload.name = 'out-of-band-drift'; repo.db.prepare("UPDATE ingredients SET payload = ? WHERE id = 'huang-qi'").run(JSON.stringify(payload));
    assert.equal((await fetch(`${root}/api/health`)).status, 200);
    const failed = await fetch(`${root}/api/ready`); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false });
  } finally { await new Promise<void>((done) => server.close(() => done())); repo.close(); }
});

test('untrusted forwarded headers cannot make a plaintext socket secure or cause production HSTS', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  const app = createApp(repo, { mode: 'accounts', secureCookies: true, allowedOrigins: ['https://localhost:4310'] }); assert.equal(app.get('trust proxy'), false);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`, { headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.123' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('strict-transport-security'), null);
  } finally {
    await new Promise<void>((done) => server.close(() => done())); repo.close();
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
