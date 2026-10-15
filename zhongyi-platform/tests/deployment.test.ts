import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, lstatSync, realpathSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import { runtimeConfig } from '../server/runtime-config.js';
import { containerEnvironment, type ContainerDatabaseCommand } from '../server/container-secrets.js';
import { prepareDemoSecrets } from '../server/demo-secrets.js';
import { ciEnvironment } from '../tools/ci-core.js';
import { waitForPostgresReadiness } from '../tools/postgres-readiness.js';

// Enumerate and validate all owned targets before removing any of them.
test('PostgreSQL fixture waits for authenticated SQL on the same live process after transient connection failures', async () => {
  let clock = 0; let probes = 0; let waits = 0;
  const version = await waitForPostgresReadiness(async () => {
    probes += 1; if (probes < 3) throw new Error('fixture-only secret must not escape'); return 'PostgreSQL fixture';
  }, () => true, { now: () => clock, wait: async () => { waits += 1; clock += 250; }, timeoutMs: 1000 });
  assert.equal(version, 'PostgreSQL fixture'); assert.equal(probes, 3); assert.equal(waits, 2);
});

test('PostgreSQL readiness stops on process exit or deadline and never returns raw connection errors', async () => {
  let probes = 0; let clock = 0;
  await assert.rejects(waitForPostgresReadiness(async () => { probes += 1; return 'unused'; }, () => false), /Owned PostgreSQL process exited/);
  assert.equal(probes, 0);
  await assert.rejects(waitForPostgresReadiness(async () => { probes += 1; throw new Error('do-not-print-credentials'); }, () => true,
    { now: () => clock, wait: async () => { clock += 250; }, timeoutMs: 500 }), /authenticated SQL readiness timed out/);
  assert.equal(probes, 2);
  let live = true;
  await assert.rejects(waitForPostgresReadiness(async () => { live = false; return 'not-ready'; }, () => live), /Owned PostgreSQL process exited/);
});

function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-deployment-test-'));
  const dispose = () => {
    const files: string[] = []; const directories: string[] = [];
    const inspect = (path: string) => {
      assert(path === directory || path.startsWith(`${directory}${sep}`));
      assert.equal(lstatSync(path).isSymbolicLink(), false); assert.equal(realpathSync(path), resolve(path));
      if (lstatSync(path).isDirectory()) { for (const name of readdirSync(path)) inspect(join(path, name)); directories.push(path); }
      else { assert(lstatSync(path).isFile()); files.push(path); }
    };
    inspect(directory); assert(files.length <= 10 && directories.length <= 4);
    for (const path of files) unlinkSync(path);
    for (const path of directories) rmdirSync(path);
  };
  return { directory, dispose };
}

test('runtime defaults preserve loopback accounts; network binding requires explicit origins and disallows local keys', () => {
  const defaults = runtimeConfig({}); assert.equal(defaults.bindHost, '127.0.0.1'); assert.equal(defaults.port, 4310);
  assert.equal(defaults.authentication.mode, 'accounts'); assert.equal(defaults.generatedLocalKey, false);
  const network = runtimeConfig({ BIND_HOST: '0.0.0.0', ALLOWED_ORIGINS: 'http://127.0.0.1:4310' }); assert.equal(network.bindHost, '0.0.0.0');
  for (const env of [{ BIND_HOST: '0.0.0.0' }, { BIND_HOST: '0.0.0.0', AUTH_MODE: 'local-key', ALLOWED_ORIGINS: 'https://demo.example.test' },
    { BIND_HOST: 'localhost' }, { BIND_HOST: '::' }, { AUTH_MODE: 'unknown' }]) assert.throws(() => runtimeConfig(env));
  const legacy = runtimeConfig({ AUTH_MODE: 'local-key' }); assert.equal(legacy.generatedLocalKey, true); assert.equal(legacy.authentication.token?.length, 64);
});

test('runtime validates strict ports, exact trusted origins and production HTTPS before database initialization', () => {
  for (const PORT of ['0', '1023', '65536', '4310x', '4.31e3', ' 4310', '-4310', '4310.0']) assert.throws(() => runtimeConfig({ PORT }));
  for (const ALLOWED_ORIGINS of ['*', 'null', 'http://localhost:4310/', 'https://user:secret@example.test', 'https://a.test,', 'ftp://a.test']) assert.throws(() => runtimeConfig({ ALLOWED_ORIGINS }));
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production' }));
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', AUTH_MODE: 'local-key', ALLOWED_ORIGINS: 'https://demo.example.test' }));
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://demo.example.test' }));
  const production = runtimeConfig({ NODE_ENV: 'production', BIND_HOST: '0.0.0.0', ALLOWED_ORIGINS: 'https://demo.example.test',
    TLS_MODE: 'direct', TLS_CERT_FILE: resolve('not-read-until-start.pem'), TLS_KEY_FILE: resolve('not-read-until-start.key') });
  assert.equal(production.authentication.secureCookies, true); assert.equal(production.authentication.mode, 'accounts');
});

test('container secret loader reads only a bounded regular absolute PostgreSQL secret and does not mutate its input', () => {
  const fixture = temporary();
  try {
    const filename = join(fixture.directory, 'connection.txt'); const value = 'postgresql://fixture:fake-password@127.0.0.1:5432/test';
    writeFileSync(filename, `${value}\n`, { flag: 'wx', mode: 0o600 });
    const input = { DATABASE_URL_FILE: filename, DATABASE_PROVIDER: 'postgres', KEEP: 'unchanged' };
    const output = containerEnvironment(input); assert.equal(output.DATABASE_URL, value); assert.equal(output.DATABASE_URL_FILE, undefined);
    assert.equal(output.KEEP, 'unchanged'); assert.equal(Object.hasOwn(input, 'DATABASE_URL'), false);
    for (const env of [{}, { DATABASE_URL_FILE: 'relative.txt' }, { DATABASE_URL_FILE: filename, DATABASE_URL: value },
      { DATABASE_URL_FILE: fixture.directory }, { DATABASE_URL_FILE: join(fixture.directory, 'missing') }]) assert.throws(() => containerEnvironment(env));
    for (const bad of ['', 'x'.repeat(8193), 'https://example.test/db', 'postgresql://host', `${value}\nsecond-line`, `${value}\0`]) {
      writeFileSync(filename, bad); assert.throws(() => containerEnvironment({ DATABASE_URL_FILE: filename }));
    }
  } finally { fixture.dispose(); }
});

test('container credentials are command-specific, production has no legacy fallback and opposite credentials are refused', () => {
  const fixture = temporary();
  try {
    const runtimeFile = join(fixture.directory, 'runtime.txt'), ownerFile = join(fixture.directory, 'owner.txt');
    const runtimeUrl = 'postgresql://runtime:runtime-test-secret@localhost:5432/workspace';
    const ownerUrl = 'postgresql://owner:owner-test-secret@localhost:5432/workspace';
    writeFileSync(runtimeFile, runtimeUrl, { flag: 'wx', mode: 0o600 }); writeFileSync(ownerFile, ownerUrl, { flag: 'wx', mode: 0o600 });
    const keyFile = join(fixture.directory, 'key.txt'); writeFileSync(keyFile, Buffer.alloc(32, 3).toString('base64'), { flag: 'wx', mode: 0o600 });
    for (const command of ['server', 'bootstrap', 'init', 'migrate', 'backup', 'runtime-role'] as ContainerDatabaseCommand[]) {
      const runtime = ['server', 'bootstrap'].includes(command);
      const selected = runtime ? 'DATABASE_RUNTIME_URL_FILE' : 'DATABASE_OWNER_URL_FILE';
      const opposite = runtime ? 'DATABASE_OWNER_URL_FILE' : 'DATABASE_RUNTIME_URL_FILE';
      const input = { NODE_ENV: 'production', [selected]: runtime ? runtimeFile : ownerFile, ...(command === 'backup' ? { BACKUP_ENCRYPTION_KEY_FILE: keyFile } : {}) };
      const output = containerEnvironment(input, command);
      assert.equal(output.DATABASE_URL, runtime ? runtimeUrl : ownerUrl);
      for (const key of ['DATABASE_URL_FILE', 'DATABASE_RUNTIME_URL_FILE', 'DATABASE_OWNER_URL_FILE']) assert.equal(output[key], undefined);
      assert.equal(Object.hasOwn(input, 'DATABASE_URL'), false);
      for (const patch of [{ [opposite]: ownerFile }, { DATABASE_URL_FILE: runtimeFile }, { DATABASE_URL: ownerUrl }]) {
        assert.throws(() => containerEnvironment({ ...input, ...patch }, command));
      }
      assert.throws(() => containerEnvironment({ NODE_ENV: 'production', DATABASE_URL_FILE: runtimeFile }, command));
      assert.throws(() => containerEnvironment({ [opposite]: runtimeFile }, command));
      assert.throws(() => containerEnvironment({ NODE_ENV: 'production' }, command));
    }
    assert.throws(() => containerEnvironment({ DATABASE_URL_FILE: runtimeFile }, 'unknown' as ContainerDatabaseCommand));
    assert.equal(containerEnvironment({ DATABASE_RUNTIME_URL_FILE: runtimeFile }).DATABASE_URL, runtimeUrl);
    assert.equal(containerEnvironment({ DATABASE_URL_FILE: runtimeFile }).DATABASE_URL, runtimeUrl, 'nonproduction legacy demo retained');
  } finally { fixture.dispose(); }
});

test('production container CLI rejects old, mixed and wrong-purpose mounts before importing any database operator', async () => {
  const fixture = temporary(); const execute = promisify(execFile);
  try {
    const filename = join(fixture.directory, 'private-url.txt');
    writeFileSync(filename, 'postgresql://private:do-not-print@localhost:1/must-not-connect', { flag: 'wx', mode: 0o600 });
    for (const [command, patch] of [
      ['server', { DATABASE_URL_FILE: filename }], ['bootstrap', { DATABASE_OWNER_URL_FILE: filename }],
      ['init', { DATABASE_RUNTIME_URL_FILE: filename }], ['migrate', { DATABASE_RUNTIME_URL_FILE: filename }],
      ['backup', { DATABASE_RUNTIME_URL_FILE: filename }], ['runtime-role', { DATABASE_RUNTIME_URL_FILE: filename }],
      ['server', { DATABASE_RUNTIME_URL_FILE: filename, DATABASE_OWNER_URL_FILE: filename }]
    ] as const) {
      await assert.rejects(execute(process.execPath, ['--import', 'tsx', 'tools/container-entrypoint.ts', command], {
        env: { ...ciEnvironment(process.env, join(fixture.directory, 'must-not-exist.sqlite')), NODE_ENV: 'production', ...patch }, windowsHide: true
      }), (error: any) => { assert.equal(error.code, 1); assert.match(error.stderr, /Container command failed/);
        assert.equal(`${error.stdout}${error.stderr}`.includes('do-not-print'), false); return true; });
    }
    assert.deepEqual(readdirSync(fixture.directory), ['private-url.txt']);
  } finally { fixture.dispose(); }
});

test('standalone restricted Compose keeps owner credentials off app and bootstrap and never auto-applies grants or publishes', () => {
  const document = parseDocument(readFileSync('compose.restricted.yaml', 'utf8'), { uniqueKeys: true, merge: true }); assert.deepEqual(document.errors, []);
  const compose = document.toJS(); const { app, operator, bootstrap } = compose.services;
  assert.deepEqual(Object.keys(compose.services).sort(), ['app', 'bootstrap', 'operator']);
  assert.deepEqual(app.ports, ['127.0.0.1:4310:4310']);
  assert.equal(app.environment.DATABASE_RUNTIME_URL_FILE, '/run/secrets/runtime_database_url');
  assert.equal(bootstrap.environment.DATABASE_RUNTIME_URL_FILE, '/run/secrets/runtime_database_url');
  assert.equal(operator.environment.DATABASE_OWNER_URL_FILE, '/run/secrets/owner_database_url');
  assert.deepEqual(app.secrets, ['runtime_database_url','database_ca','tls_certificate','tls_private_key','https_ca']);
  assert.deepEqual(operator.secrets, ['owner_database_url','database_ca']); assert.deepEqual(bootstrap.secrets, ['runtime_database_url','database_ca']);
  for (const service of [app, operator, bootstrap]) {
    assert.equal(service.environment.NODE_ENV, 'production'); assert.equal(service.environment.DATABASE_URL, undefined);
    assert.equal(service.environment.DATABASE_URL_FILE, undefined); assert.equal(service.environment.EDUCATION_PUBLICATION_ENABLED, 'false');
    assert.equal(service.environment.AI_EXTERNAL_ENABLED, 'false'); assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']); assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
  }
  assert.equal(app.environment.DATABASE_OWNER_URL_FILE, undefined); assert.equal(bootstrap.environment.DATABASE_OWNER_URL_FILE, undefined);
  assert.equal(operator.environment.DATABASE_RUNTIME_URL_FILE, undefined);
  assert.equal(operator.command[0], 'runtime-role'); assert.equal(operator.command[1], '--verify');
  assert.deepEqual(operator.profiles, ['operator']); assert.deepEqual(bootstrap.profiles, ['bootstrap']);
  assert.equal(operator.ports, undefined); assert.equal(bootstrap.ports, undefined); assert.deepEqual(bootstrap.command, ['bootstrap']);
  assert.equal(app.environment.TLS_MODE, 'direct'); assert.equal(app.environment.TLS_HEALTH_CA_FILE, '/run/secrets/https_ca');
  assert.notEqual(compose.secrets.runtime_database_url.file, compose.secrets.owner_database_url.file);
  assert.match(compose.secrets.database_ca.file, /\$\{CONTAINER_DATABASE_CA_FILE:\?/);
});

test('demo preparation creates fresh independent secrets without usernames/passwords from the host or overwriting a setup', () => {
  const fixture = temporary();
  try {
    const first = prepareDemoSecrets(fixture.directory); const second = prepareDemoSecrets(fixture.directory); assert.notEqual(first, second);
    const password = readFileSync(join(first, 'postgres-password.txt'), 'utf8'); assert.match(password, /^[A-Za-z0-9_-]{43}$/);
    const url = new URL(readFileSync(join(first, 'database-url.txt'), 'utf8'));
    assert.equal(url.username, 'food_demo'); assert.equal(decodeURIComponent(url.password), password); assert.equal(url.hostname, 'postgres'); assert.equal(url.pathname, '/food_demo');
    assert.notEqual(password, readFileSync(join(second, 'postgres-password.txt'), 'utf8'));
    assert.deepEqual(readdirSync(first).sort(), ['database-url.txt', 'postgres-password.txt']);
    assert.throws(() => prepareDemoSecrets(join(fixture.directory, 'missing')));
  } finally { fixture.dispose(); }
});

test('Compose YAML confines HTTP to loopback, isolates database and grants each secret only to its required services', () => {
  const document = parseDocument(readFileSync('compose.yaml', 'utf8'), { uniqueKeys: true, merge: true }); assert.deepEqual(document.errors, []);
  const compose = document.toJS(); assert.equal(compose.name, 'food-education-demo');
  const { app, postgres, operator } = compose.services;
  assert.deepEqual(app.ports, ['127.0.0.1:4310:4310']); assert.equal(postgres.ports, undefined); assert.equal(operator.ports, undefined);
  assert.equal(app.environment.BIND_HOST, '0.0.0.0'); assert.equal(app.environment.AUTH_MODE, 'accounts'); assert.equal(app.environment.NODE_ENV, 'development');
  assert.equal(app.environment.DATABASE_URL, undefined); assert.equal(app.environment.DATABASE_URL_FILE, '/run/secrets/database_url');
  assert.equal(app.environment.AI_PROVIDER, 'disabled'); assert.equal(app.environment.AI_EXTERNAL_ENABLED, 'false');
  assert.deepEqual(app.secrets, ['database_url']); assert.deepEqual(postgres.secrets, ['postgres_password']);
  assert.equal(postgres.environment.POSTGRES_PASSWORD, undefined); assert.equal(postgres.environment.POSTGRES_PASSWORD_FILE, '/run/secrets/postgres_password');
  assert.equal(app.read_only, true); assert.deepEqual(app.cap_drop, ['ALL']); assert.deepEqual(app.security_opt, ['no-new-privileges:true']);
  assert.equal(app.depends_on.postgres.condition, 'service_healthy'); assert.deepEqual(operator.profiles, ['operator']);
  assert.deepEqual(operator.command, ['init', '--schema', 'food_demo']); assert.equal(operator.healthcheck.disable, true);
  assert.match(compose.secrets.database_url.file, /\$\{CONTAINER_SECRET_DIR:\?/); assert.match(postgres.volumes[0], /:\/var\/lib\/postgresql$/);
  assert.equal(postgres.stop_grace_period, '10m');
});

test('Docker assets use separate build/runtime dependencies, a nonroot direct entrypoint and deny-by-default build context', () => {
  const docker = readFileSync('Dockerfile', 'utf8'); const ignore = readFileSync('Dockerfile.dockerignore', 'utf8');
  assert.equal((docker.match(/^FROM node:22\.23\.3-bookworm-slim AS /gm) || []).length, 3);
  assert.match(docker, /npm ci --omit=dev --ignore-scripts/); assert.match(docker, /^USER node$/m);
  assert.match(docker, /^ENTRYPOINT \["node", "build\/tools\/container-entrypoint.js"\]$/m);
  assert.match(docker, /^CMD \["server"\]$/m); assert.equal(/^COPY \. /m.test(docker), false);
  const patterns = ignore.split(/\r?\n/).filter((line) => line && !line.startsWith('#')); assert.equal(patterns[0], '**');
  assert(patterns.includes('!zhongyi-platform/data/catalog.seed.json')); assert.equal(patterns.includes('!zhongyi-platform/data/**'), false);
  for (const name of ['.local', 'docs', 'node_modules']) assert.equal(patterns.some((line) => line.startsWith(`!zhongyi-platform/${name}/`)), false);
  for (const name of ['**/.env', '**/*.sqlite', '**/*.zfbackup', '**/*.pem', '**/*.key', '**/.local/**']) assert(patterns.includes(name));
  for (const entry of ['init-postgres', 'bootstrap-account', 'migrate-postgres', 'backup-postgres', 'runtime-role-postgres']) assert(docker.includes(`/app/zhongyi-platform/build/tools/${entry}.js`));
});

test('Docker build retains every configured typecheck and supplies its source-only inputs without adding tests to runtime', () => {
  const docker = readFileSync('Dockerfile', 'utf8');
  const patterns = readFileSync('Dockerfile.dockerignore', 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  assert.match(scripts.build, /npm run typecheck/);
  const configs = [...scripts.typecheck.matchAll(/-p (tsconfig[\w.-]*\.json)/g)].map(match => match[1]);
  assert.deepEqual(configs, ['tsconfig.json', 'tsconfig.server.json', 'tsconfig.publication-tests.json',
    'tsconfig.local-demo-tests.json', 'tsconfig.https-tests.json', 'tsconfig.web-tests.json',
    'tsconfig.request-log-tests.json', 'tsconfig.publication-client-browser.json', 'tsconfig.assistant-tests.json', 'tsconfig.photo-processing.json']);
  const build = docker.split(/^FROM .* AS dependencies$/m)[0];
  const runtime = docker.split(/^FROM .* AS runtime$/m)[1];
  for (const config of configs) {
    assert(patterns.includes(`!zhongyi-platform/${config}`), `${config} absent from build context`);
    assert(build.split(/\r?\n/).some(line => line.startsWith('COPY ') && line.split(/\s+/).slice(1, -1).includes(`zhongyi-platform/${config}`)), `${config} not copied into build stage`);
  }
  assert(patterns.includes('!zhongyi-platform/playwright.config.ts'));
  assert(patterns.includes('!zhongyi-platform/photo-processing/*.ts'));
  assert.equal(patterns.includes('!zhongyi-platform/photo-processing/**'), false);
  assert.match(build, /^COPY zhongyi-platform\/photo-processing \.\/photo-processing$/m);
  assert.equal(/photo-processing/.test(runtime), false);
  assert.match(build, /^COPY zhongyi-platform\/playwright\.config\.ts /m);
  assert(patterns.includes('!zhongyi-platform/tests/'));
  assert(patterns.includes('!zhongyi-platform/tests/**/*.ts'));
  assert.equal(patterns.includes('!zhongyi-platform/tests/**'), false, 'do not admit test outputs, archives or local databases');
  assert.match(build, /^COPY zhongyi-platform\/tests \.\/tests$/m);
  assert.match(build, /^WORKDIR \/app\/zhongyi-platform$/m);
  assert.match(build, /^COPY packages\/catalog-core\/src \/app\/packages\/catalog-core\/src$/m);
  assert(patterns.includes('!packages/catalog-core/src/**/*.ts'));
  assert.equal(patterns.includes('!packages/**'), false);
  for (const filename of ['compose.yaml', 'compose.restricted.yaml']) {
    const parsed = parseDocument(readFileSync(filename, 'utf8'), { uniqueKeys: true }); assert.deepEqual(parsed.errors, []);
    const compose = parsed.toJS(); const template = compose['x-app'] || compose['x-service'];
    assert.equal(template.build.context, '..'); assert.equal(template.build.dockerfile, 'zhongyi-platform/Dockerfile');
  }
  assert.match(build, /^RUN npm run build$/m);
  assert.equal(/(?:tests|playwright|tsconfig)/.test(runtime), false, 'test inputs belong only to the build stage');
  assert.equal(/catalog-core/.test(runtime), false, 'shared client source belongs only to typechecking');
});

test('HTTPS Compose overlay explicitly enables production TLS and mounts separate certificate files without embedding private keys', () => {
  const source = readFileSync('compose.https.yaml', 'utf8'); const document = parseDocument(source, { uniqueKeys: true }); assert.deepEqual(document.errors, []);
  const overlay = document.toJS(); assert.deepEqual(Object.keys(overlay.services), ['app']);
  const app = overlay.services.app; assert.equal(app.environment.NODE_ENV, 'production'); assert.equal(app.environment.TLS_MODE, 'direct');
  assert.equal(app.environment.TLS_CERT_FILE, '/run/secrets/tls_certificate'); assert.equal(app.environment.TLS_KEY_FILE, '/run/secrets/tls_private_key');
  assert.match(app.environment.ALLOWED_ORIGINS, /\$\{HTTPS_ALLOWED_ORIGINS:\?/); assert.equal(app.ports, undefined);
  assert.deepEqual(app.secrets, ['tls_certificate', 'tls_private_key']);
  assert.match(overlay.secrets.tls_certificate.file, /\$\{HTTPS_CERT_FILE:\?/); assert.match(overlay.secrets.tls_private_key.file, /\$\{HTTPS_KEY_FILE:\?/);
  assert.equal(source.includes('BEGIN PRIVATE KEY'), false);
});

test('actual startup rejects invalid network/production configuration before creating a SQLite file and without logging secrets', async () => {
  const execute = promisify(execFile); const fixture = temporary();
  try {
    for (const extra of [{ BIND_HOST: '0.0.0.0' }, { NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:4310' }, { PORT: '4310x' }]) {
      const path = join(fixture.directory, 'must-not-exist.sqlite');
      const env = { ...ciEnvironment(process.env, path), ...extra, DATABASE_URL: 'postgresql://private:do-not-print@host/work' };
      await assert.rejects(execute(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, windowsHide: true }), (error: any) => {
        assert.equal(error.code, 1); assert.match(error.stderr, /Application startup failed/); assert.equal(`${error.stdout}${error.stderr}`.includes('do-not-print'), false); return true;
      });
      assert.deepEqual(readdirSync(fixture.directory), []);
    }
  } finally { fixture.dispose(); }
});

test('container CLI rejects unknown commands and secret conflicts before importing an operator or opening a database', async () => {
  const execute = promisify(execFile); const fixture = temporary();
  try {
    const env = { ...ciEnvironment(process.env, join(fixture.directory, 'must-not-exist.sqlite')), DATABASE_URL_FILE: '/missing-file', DATABASE_URL: 'postgresql://private:do-not-print@host/work' };
    for (const args of [[], ['unknown'], ['server', '--ignored'], ['init', '--schema', 'new_demo']]) {
      await assert.rejects(execute(process.execPath, ['--import', 'tsx', 'tools/container-entrypoint.ts', ...args], { env, windowsHide: true }), (error: any) => {
        assert.equal(error.code, 1); assert.match(error.stderr, /Container command failed/); assert.equal(`${error.stdout}${error.stderr}`.includes('do-not-print'), false); return true;
      });
    }
    assert.deepEqual(readdirSync(fixture.directory), []);
  } finally { fixture.dispose(); }
});

test('HTTPS certificate-tool preflight failure replaces old green report and does not open a database', async () => {
  const fixture = temporary(); const execute = promisify(execFile);
  try {
    const local = join(fixture.directory, '.local'); mkdirSync(local);
    const reportFile = join(local, 'https-test-results.latest.json'); writeFileSync(reportFile, JSON.stringify({ status: 'passed', testedAt: '2000-01-01T00:00:00.000Z' }));
    await assert.rejects(execute(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/test-https.ts')], {
      cwd: fixture.directory, windowsHide: true, env: { ...ciEnvironment(process.env, join(fixture.directory, 'must-not-exist.sqlite')), HTTPS_TEST_OPENSSL: process.execPath }
    }), (error: any) => { assert.equal(error.code, 1); assert.match(error.stderr, /HTTPS verification failed/); return true; });
    const report = JSON.parse(readFileSync(reportFile, 'utf8')); assert.equal(report.status, 'failed'); assert.equal(report.failed, 0);
    assert.equal(report.controllerFailed, true, 'preflight failure must not invent a failed test'); assert.equal(report.compiledBackendVerified, false);
    assert.equal(report.passed, 0); assert.equal(report.certificateChainVerified, false); assert.notEqual(report.testedAt, '2000-01-01T00:00:00.000Z');
    assert.deepEqual(readdirSync(fixture.directory), ['.local']);
  } finally { fixture.dispose(); }
});
