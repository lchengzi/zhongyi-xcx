import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, lstatSync, copyFileSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertNoLinks } from '../server/demo-secrets.js';
import { openConfiguredStore } from '../server/store-config.js';
import { ciEnvironment } from './ci-core.js';
import { httpsTestBuildPlan, httpsTestProof, httpsTestProvider, ownedHttpsPostgres } from './https-test-plan.js';
import { prepareHttpsPostgresRuntime } from './https-postgres-fixture.js';
import { readSqliteSnapshot } from '../server/migration-snapshot.js';
import { validateSeed } from '../server/seed.js';

let markFailure: (() => void) | undefined;
async function main() {
  const provider = httpsTestProvider(process.argv.slice(2));
  const postgres = provider === 'postgres' ? ownedHttpsPostgres(process.env, process.connected === true) : undefined;
  const root = process.cwd();
  const base = resolve('.local/https-tests'); assertNoLinks(base); mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(base, 'run-')); const nonce = randomUUID();
  const report = { startedAt: new Date().toISOString(), finishedAt: null as string | null, testedAt: '', kind: 'local-https-engineering', scope: `compiled-https-${provider}`, databaseProvider: provider,
    storageEngineVerified: false, postgresSchemasVerified: 0, status: 'running', passed: 0, failed: 0, skipped: 0, fixturesStopped: false,
    certificateChainVerified: false, secureCookieVerified: false, browserFlowVerified: false, applicationRestartVerified: false,
    compiledBackendVerified: false, publicationFlowVerified: false, publicationDefaultOffVerified: false,
    publicationRestartVerified: false, publicationBrowserFlowVerified: false, controllerFailed: false,
    publicEducationClientVerified: false, publicEducationClientRequests: 0,
    publicEducationRecoveryVerified: false, publicEducationRecoveryRequests: 0,
    requestDiagnosticsVerified: false, diagnosticFaultsVerified: false, diagnosticApplications: 0, diagnosticMatchedRequests: 0,
    databaseTlsVerified: false, databaseCertificateChainVerified: false, databaseHostnameMismatchRejected: false,
    databaseUntrustedCaRejected: false, databasePlaintextRejected: false, databaseTlsApplicationsVerified: 0,
    databaseRuntimePermissionsVerified: false, databaseRestrictedApplicationsVerified: 0,
    publicTrustVerified: false, deploymentVerified: false, operatingSystemTrustModified: false, realModelCalls: 0,
    runtime: { node: process.version, tlsOpenSsl: process.versions.openssl, certificateGenerator: 'not_run' }, directory };
  const reportFile = resolve(provider === 'postgres' ? '.local/https-postgres-test-results.latest.json' : '.local/https-test-results.latest.json');
  const persist = () => {
    for (const filename of [join(directory, 'result.json'), reportFile]) {
      assertNoLinks(filename);
      if (existsSync(filename) && !lstatSync(filename).isFile()) throw new Error('Invalid HTTPS report target');
      writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    }
  };
  markFailure = () => { report.testedAt = new Date().toISOString(); report.finishedAt = report.testedAt; report.status = 'failed'; report.controllerFailed = true; persist(); };
  // Replace stale green evidence BEFORE certificate-tool preflight can fail.
  persist();
  if (postgres && process.send) await new Promise<void>((done, reject) => process.send!({ type: 'postgres-https-report', nonce: postgres.controllerNonce,
    filename: join(directory, 'result.json') }, (error) => error ? reject(error) : done()));
  const executable = process.env.HTTPS_TEST_OPENSSL || 'openssl'; const execute = promisify(execFile);
  const configuration = join(directory, 'openssl.cnf');
  writeFileSync(configuration, '[req]\ndistinguished_name=dn\n[dn]\n', { flag: 'wx', mode: 0o600 });
  const openssl = async (args: string[]) => execute(executable, args, { windowsHide: true, maxBuffer: 64 * 1024, env: { ...process.env, OPENSSL_CONF: configuration } });
  const version = (await openssl(['version'])).stdout.trim();
  if (!/^OpenSSL [3-9]\./.test(version)) throw new Error('The isolated certificate generator requires OpenSSL 3 or newer');
  report.runtime.certificateGenerator = version; persist();
  const path = (name: string) => join(directory, name);
  console.log('HTTPS fixture: generating a temporary local CA (no system trust changes).');
  await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=Food education ephemeral test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', path('ca.key'), '-out', path('ca.pem')]);
  console.log('HTTPS fixture: generating a temporary server key and CSR.');
  await openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=localhost', '-keyout', path('server.key'), '-out', path('server.csr')]);
  writeFileSync(path('leaf.ext'), '[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { flag: 'wx', mode: 0o600 });
  console.log('HTTPS fixture: signing the localhost-only server certificate.');
  await openssl(['x509', '-req', '-in', path('server.csr'), '-CA', path('ca.pem'), '-CAkey', path('ca.key'), '-CAcreateserial', '-days', '2', '-sha256',
    '-extfile', path('leaf.ext'), '-extensions', 'leaf', '-out', path('server.pem')]);
  for (const name of ['ca.key', 'server.key']) chmodSync(path(name), 0o600);
  // Compile into this fresh fixture, never overwrite a backend another live
  // test may still be using. The real entrypoint keeps its normal cwd contract.
  const build = httpsTestBuildPlan(root, directory);
  for (const target of [build.backend, build.frontend]) { assertNoLinks(target); if (lstatSync(target, { throwIfNoEntry: false })) throw new Error('Isolated build output must not already exist'); }
  for (const args of build.commands) {
    console.log(`HTTPS fixture: isolated ${args[0].includes('typescript') ? 'backend' : 'frontend'} production build.`);
    await execute(process.execPath, args, { cwd: root, windowsHide: true, maxBuffer: 512 * 1024, env: ciEnvironment(process.env, path('unused.sqlite')) });
  }
  mkdirSync(path('data'), { mode: 0o700 });
  copyFileSync(resolve(root, 'data/catalog.seed.json'), path('data/catalog.seed.json'), constants.COPYFILE_EXCL);
  const seed = validateSeed(JSON.parse(readFileSync('data/catalog.seed.json', 'utf8'))); const password = `test-only-${randomUUID()}`;
  const stores = await openConfiguredStore(seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: path('editorial.sqlite') });
  try { await stores.auth.createUser('https-test-admin', password, 'admin', 'https-test-fixture', true); } finally { await stores.close(); }
  const schema = postgres ? `https_workbench_${randomUUID().replaceAll('-', '')}` : '';
  let runtimeConnection = '';
  if (postgres) {
    const roles = await prepareHttpsPostgresRuntime(process.env, schema, readSqliteSnapshot(path('editorial.sqlite'), seed), seed);
    runtimeConnection = roles.runtimeConnection;
  }
  persist();
  const child = spawn(process.execPath, ['--import', 'tsx', resolve(root, 'tests/https.test.ts')], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...ciEnvironment(process.env, path('unused.sqlite')),
      HTTPS_TEST_DIRECTORY: directory, HTTPS_TEST_NONCE: nonce, HTTPS_TEST_PASSWORD: password, HTTPS_TEST_DATABASE_PROVIDER: provider,
      HTTPS_TEST_POSTGRES_SCHEMA: schema, HTTPS_TEST_RUNTIME_DATABASE_URL: runtimeConnection,
      ...(postgres ? { PG_TEST_DATABASE_URL: postgres.connection, PG_TEST_NONCE: postgres.controllerNonce } : {}) }
  });
  let output = ''; let proof: any;
  child.stdout!.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk); }); child.stderr!.on('data', (chunk) => process.stderr.write(chunk));
  child.on('message', (message: any) => { if (message?.type === 'https-proof' && message.nonce === nonce) proof = message; });
  const [code] = await once(child, 'close');
  report.testedAt = new Date().toISOString(); report.finishedAt = report.testedAt; report.status = 'failed';
  report.passed = Number(/^# pass (\d+)\r?$/m.exec(output)?.[1] || 0);
  report.failed = Number(/^# fail (\d+)\r?$/m.exec(output)?.[1] || 0);
  report.skipped = Number(/^# skipped (\d+)\r?$/m.exec(output)?.[1] || 0);
  report.fixturesStopped = proof?.fixturesStopped === true;
  try {
    httpsTestProof(output, code, proof, nonce, provider);
    report.status = 'passed'; report.fixturesStopped = true; report.certificateChainVerified = true; report.secureCookieVerified = true;
    report.browserFlowVerified = true; report.applicationRestartVerified = true;
    report.compiledBackendVerified = true; report.publicationFlowVerified = true; report.publicationDefaultOffVerified = true;
    report.publicationRestartVerified = true; report.publicationBrowserFlowVerified = true;
    report.publicEducationClientVerified = true; report.publicEducationClientRequests = proof.publicEducationClientRequests;
    report.publicEducationRecoveryVerified = proof.publicEducationRecoveryVerified; report.publicEducationRecoveryRequests = proof.publicEducationRecoveryRequests;
    report.storageEngineVerified = true; report.postgresSchemasVerified = proof.postgresSchemasVerified;
    report.requestDiagnosticsVerified = true; report.diagnosticFaultsVerified = true;
    report.diagnosticApplications = proof.diagnosticApplications; report.diagnosticMatchedRequests = proof.diagnosticMatchedRequests;
    report.databaseTlsVerified = proof.databaseTlsVerified; report.databaseCertificateChainVerified = proof.databaseCertificateChainVerified;
    report.databaseHostnameMismatchRejected = proof.databaseHostnameMismatchRejected; report.databaseUntrustedCaRejected = proof.databaseUntrustedCaRejected;
    report.databasePlaintextRejected = proof.databasePlaintextRejected; report.databaseTlsApplicationsVerified = proof.databaseTlsApplicationsVerified;
    report.databaseRuntimePermissionsVerified = proof.databaseRuntimePermissionsVerified;
    report.databaseRestrictedApplicationsVerified = proof.databaseRestrictedApplicationsVerified;
  } catch { report.controllerFailed = true; persist(); throw new Error('HTTPS tests or confirmed teardown did not pass'); }
  persist(); console.log('Local HTTPS fixtures stopped. No system trust, public deployment or real model calls performed.');
  if (postgres && process.send) await new Promise<void>((done, reject) => process.send!({ type: 'postgres-tls-proof', nonce: postgres.controllerNonce,
    certificateChainVerified: true, hostnameMismatchRejected: true, untrustedCaRejected: true, plaintextRejected: true,
    applicationConnectionsVerified: report.databaseTlsApplicationsVerified,
    restrictedApplicationConnectionsVerified: report.databaseRestrictedApplicationsVerified }, (error) => error ? reject(error) : done()));
  if (process.connected) process.disconnect();
}
main().catch(() => {
  try { markFailure?.(); } catch {}
  console.error('HTTPS verification failed. Check the local report, certificate tool and test output; keys and credentials are not printed.'); process.exitCode = 1;
  if (process.connected) process.disconnect();
});
