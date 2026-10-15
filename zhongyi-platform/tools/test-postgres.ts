import { randomBytes } from 'node:crypto';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { appendFileSync, mkdirSync, mkdtempSync, lstatSync, realpathSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createPostgresPool } from '../server/postgres-migration.js';
import { waitForPostgresReadiness } from './postgres-readiness.js';
import { assertNoLinks } from '../server/demo-secrets.js';
import { ciEnvironment, httpsProof, tapProof } from './ci-core.js';
import { httpsOwnedReportPath } from './https-test-plan.js';
import { postgresBrowserProof, postgresBrowserReportPath, postgresTestPlan, publicationHttpProof, postgresPermissionsProof } from './postgres-test-plan.js';

// Real PostgreSQL, not an SQL emulator. No system service/user, Docker or WSL.
// Binaries are development-only optional packages supplied by embedded-postgres.
async function main() {
  const plan = postgresTestPlan(process.argv.slice(2)); const browser = plan.browser;
  const reportPath = resolve(plan.reportPath);
  const root = resolve(process.cwd(), '.local/postgres-tests'); assertNoLinks(root); mkdirSync(root, { recursive: true });
  if (lstatSync(root).isSymbolicLink() || realpathSync(root).toLowerCase() !== root.toLowerCase()) throw new Error('Unsafe test root');
  const directory = mkdtempSync(join(root, 'cluster-')); const dataDir = join(directory, 'data');
  const serverLog = join(directory, 'server.log');
  writeFileSync(serverLog, '', { flag: 'wx', mode: 0o600 });
  const nonce = randomBytes(16).toString('hex');
  const user = 'postgres_fixture'; const password = randomBytes(32).toString('hex');
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  let binaries: { initdb: string; postgres: string; pg_ctl: string } | undefined;
  let port = 0; let connection = '';
  let server: ChildProcess | undefined; let restarting = false; let serverVersion = ''; let restarts = 0;
  let stopping: Promise<void> | undefined;
  let latestReport: Record<string, unknown> | undefined;
  let httpsReportPath: string | undefined;
  let databaseTlsProof = false;
  let certificateGenerator = 'not_run';
  const databaseTls = plan.mode === 'full' || plan.mode === 'https' || plan.mode === 'permissions';
  const startedAt = new Date().toISOString(); const ownedReportPath = join(directory, 'result.json');
  const browserReportPath = browser ? postgresBrowserReportPath(process.cwd(), directory, process.env.CI_BROWSER_REPORT) : undefined;
  const persist = () => {
    if (!latestReport) return;
    for (const filename of [ownedReportPath, reportPath]) {
      assertNoLinks(filename);
      const stat = lstatSync(filename, { throwIfNoEntry: false });
      if (stat && !stat.isFile()) throw new Error('Invalid PostgreSQL report target');
      writeFileSync(filename, JSON.stringify(latestReport, null, 2) + '\n', { mode: 0o600 });
    }
  };
  {
    latestReport = { startedAt, testedAt: null, finishedAt: null, engine: 'real-postgresql', status: 'running', scope: plan.scope,
      passed: 0, failed: 0, skipped: 0, cancelled: 0, restarts: 0, fixtureStopped: false, directory,
      sourceWorkingDatabaseModified: false, applicationRuntime: browser ? 'typescript-browser-fixtures' : plan.mode === 'publication-http' ? 'typescript-http-fixture' : plan.mode === 'https' ? 'compiled-https-postgres' : 'postgres-opt-in',
      ...(browser ? { browserReportPath } : {}), compiledBackendVerified: false, deploymentVerified: false };
    persist(); console.log(`Owned PostgreSQL ${plan.scope} evidence: ${ownedReportPath}`);
  }

  async function command(binary: string, args: string[]) {
    const child = spawn(binary, args, { windowsHide: true, env: { ...process.env, LC_MESSAGES: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; child.stdout!.on('data', (chunk) => { stdout += chunk; }); child.stderr!.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    if (code !== 0) throw new Error(`PostgreSQL fixture command failed with code ${code}: ${(stdout + stderr).replaceAll(password, '[redacted]').replaceAll(connection, '[redacted]').slice(-1600)}`);
    return stdout;
  }
  async function start() {
    if (!binaries || !connection || !port) throw new Error('Owned PostgreSQL setup is incomplete');
    if (server && server.exitCode === null && server.signalCode === null) throw new Error('Previous owned PostgreSQL process is still live; refusing another start.');
    stopping = undefined;
    server = spawn(binaries.postgres, ['-D', dataDir, '-p', String(port), '-c', `listen_addresses=${databaseTls ? '127.0.0.1,::1' : '127.0.0.1'}`,
      ...(databaseTls ? ['-c', 'ssl=on', '-c', 'ssl_min_protocol_version=TLSv1.2',
        '-c', `ssl_cert_file=${join(directory, 'server.pem').replaceAll('\\', '/')}`,
        '-c', `ssl_key_file=${join(directory, 'server.key').replaceAll('\\', '/')}`] : [])], {
      windowsHide: true, env: { ...process.env, LC_MESSAGES: 'C' }, stdio: ['ignore', 'ignore', 'pipe']
    });
    let output = '';
    await new Promise<void>((ready, reject) => {
      const timer = setTimeout(() => reject(new Error('PostgreSQL fixture startup timed out')), 20000);
      server!.on('error', (error) => { clearTimeout(timer); reject(error); });
      server!.once('exit', () => { clearTimeout(timer); reject(new Error('PostgreSQL fixture exited before readiness')); });
      server!.stderr!.on('data', (chunk) => {
        output += chunk.toString();
        appendFileSync(serverLog, chunk.toString().replaceAll(password, '[redacted]').replaceAll(connection, '[redacted]'));
        if (output.includes('database system is ready to accept connections')) { clearTimeout(timer); ready(); }
      });
    });
    const ownedServer = server;
    serverVersion = await waitForPostgresReadiness(async () => {
      const pool = createPostgresPool(connection);
      try { return (await pool.query('SELECT version() AS version')).rows[0].version as string; }
      finally { await pool.end(); }
    }, () => ownedServer.exitCode === null && ownedServer.signalCode === null);
  }
  async function stop() {
    // Reuse the SAME shutdown even if restart verification and final cleanup
    // both await it. An observation expiry must never issue a second signal.
    if (stopping) return stopping;
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    stopping = stopOwnedServer();
    return stopping;
  }
  async function stopOwnedServer() {
    if (!server || !binaries) throw new Error('Missing owned PostgreSQL process');
    const absolute = realpathSync(dataDir);
    if (lstatSync(dataDir).isSymbolicLink() || !absolute.toLowerCase().startsWith((directory + sep).toLowerCase()) ||
      absolute.toLowerCase() !== dataDir.toLowerCase()) throw new Error('Unsafe PostgreSQL fixture directory');
    const actualPid = Number(readFileSync(join(dataDir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]);
    if (!server.pid || actualPid !== server.pid) throw new Error('PostgreSQL fixture ownership mismatch');
    const ownedServer = server; const exited = once(ownedServer, 'exit');
    try { await command(binaries.pg_ctl, ['-D', dataDir, '-m', 'fast', '-w', '-t', '60', 'stop']); }
    catch (error) {
      // An observation timeout is not a second shutdown request or a license to
      // restart. Keep observing the same owned process while its checkpoint syncs.
      const log = readFileSync(serverLog, 'utf8');
      if (!(error instanceof Error) || !error.message.includes('pg_ctl: server does not shut down') ||
        !log.includes(`[${actualPid}] LOG:  received fast shutdown request`)) throw error;
      console.log('pg_ctl observation expired; waiting for the SAME owned PostgreSQL process to finish normal shutdown. No force/second signal.');
    }
    const observer = setInterval(() => {
      console.log('Still observing the SAME owned PostgreSQL shutdown/checkpoint; no additional signal or restart.');
    }, 30000);
    try {
      // Keep observing actual process exit. The test-side verification has its
      // own deadline, but cleanup must not treat that deadline as an exit.
      const [code] = await exited;
      if (code !== 0) throw new Error('Owned PostgreSQL process exited abnormally; evidence retained.');
      server = undefined;
    } finally { clearInterval(observer); }
  }

  try {
    if (browserReportPath) {
      assertNoLinks(browserReportPath);
      if (lstatSync(browserReportPath, { throwIfNoEntry: false })) throw new Error('Browser report must be fresh, not an existing file');
    }
    binaries = await import(`@embedded-postgres/${platform}-${process.arch}`) as { initdb: string; postgres: string; pg_ctl: string };
    for (const binary of Object.values(binaries)) if (typeof binary !== 'string' || !lstatSync(binary).isFile()) throw new Error('PostgreSQL test binary is unavailable');
    const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    connection = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;
    const passwordFile = join(directory, 'init-password'); writeFileSync(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
    try {
      await command(binaries.initdb, ['-D', dataDir, '--username=' + user, '--pwfile=' + passwordFile,
        '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--lc-messages=C']);
    } finally {
      const actual = realpathSync(passwordFile);
      if (actual.toLowerCase() !== passwordFile.toLowerCase() || lstatSync(actual).isSymbolicLink() || !lstatSync(actual).isFile()) throw new Error('Unsafe temporary password target');
      unlinkSync(actual);
    }
    if (databaseTls) {
      // Fresh private CA; no OS trust import, download or shared certificate.
      const configuration = join(directory, 'openssl.cnf');
      writeFileSync(configuration, '[req]\ndistinguished_name=dn\n[dn]\n', { flag: 'wx', mode: 0o600 });
      const execute = promisify(execFile);
      const openssl = (args: string[]) => execute(process.env.HTTPS_TEST_OPENSSL || 'openssl', args, {
        windowsHide: true, maxBuffer: 65536, env: { ...process.env, OPENSSL_CONF: configuration }
      });
      certificateGenerator = (await openssl(['version'])).stdout.trim();
      if (!/^OpenSSL [3-9]\./.test(certificateGenerator)) throw new Error('Database TLS fixture requires an explicit OpenSSL 3+ certificate generator');
      await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=Ephemeral PostgreSQL test CA',
        '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-keyout', join(directory, 'ca.key'), '-out', join(directory, 'ca.pem')]);
      await openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=localhost',
        '-keyout', join(directory, 'server.key'), '-out', join(directory, 'server.csr')]);
      const extensions = join(directory, 'server.ext');
      writeFileSync(extensions, 'subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n', { flag: 'wx', mode: 0o600 });
      await openssl(['x509', '-req', '-in', join(directory, 'server.csr'), '-CA', join(directory, 'ca.pem'), '-CAkey', join(directory, 'ca.key'),
        '-CAcreateserial', '-days', '2', '-sha256', '-extfile', extensions, '-out', join(directory, 'server.pem')]);
      for (const name of ['ca.key', 'server.key']) {
        const filename = join(directory, name); assertNoLinks(filename);
        if (!lstatSync(filename).isFile()) throw new Error('Owned PostgreSQL private key file required');
        chmodSync(filename, 0o600);
      }
      const hba = join(dataDir, 'pg_hba.conf'); assertNoLinks(hba);
      if (!lstatSync(hba).isFile()) throw new Error('Owned PostgreSQL authentication file required');
      writeFileSync(hba, 'hostnossl all all 127.0.0.1/32 reject\nhostnossl all all ::1/128 reject\nhostssl all all 127.0.0.1/32 scram-sha-256\nhostssl all all ::1/128 scram-sha-256\n', { mode: 0o600 });
      const encrypted = new URL(connection); encrypted.hostname = 'localhost';
      encrypted.searchParams.set('sslmode', 'verify-full'); encrypted.searchParams.set('sslrootcert', join(directory, 'ca.pem'));
      connection = encrypted.toString();
    }
    await start(); console.log(JSON.stringify({ engine: 'real-postgresql', serverVersion, host: '127.0.0.1', temporary: true }));
    // Execute node:test directly so the live server controller's IPC channel
    // belongs to the test process rather than a separate Node discovery worker.
    const childStartedAt = Date.now();
    const child = spawn(process.execPath, [...plan.childArgs, ...(browser ? [`--output=${join(directory, 'browser-artifacts')}`] : [])], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...(plan.mode !== 'full' ? ciEnvironment(process.env, join(directory, 'unused-working-database.sqlite')) : process.env),
        ...(browser ? { CI_BROWSER_REPORT: browserReportPath } : {}), PG_TEST_DATABASE_URL: connection, PG_TEST_NONCE: nonce, FORCE_COLOR: '0' }
    });
    let output = ''; child.stdout!.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
    child.stderr!.on('data', (chunk) => process.stderr.write(chunk));
    child.on('message', (message: any) => {
      if (databaseTls && message?.type === 'postgres-tls-proof' && message.nonce === nonce &&
        message.certificateChainVerified === true && message.hostnameMismatchRejected === true &&
        message.untrustedCaRejected === true && message.plaintextRejected === true &&
        (plan.mode !== 'https' || (message.applicationConnectionsVerified === 9 && message.restrictedApplicationConnectionsVerified === 9))) {
        databaseTlsProof = true; return;
      }
      if (plan.mode === 'https' && message?.type === 'postgres-https-report' && message.nonce === nonce && typeof message.filename === 'string') {
        // Never read an arbitrary child-selected file or stale shared latest.
        try {
          const filename = httpsOwnedReportPath(process.cwd(), message.filename); assertNoLinks(filename);
          if (!httpsReportPath) { httpsReportPath = filename; if (latestReport) { latestReport.httpsReportPath = filename; persist(); } }
        }
        catch { /* Missing valid owned evidence fails the terminal gate below. */ }
        return;
      }
      if (message?.type !== 'restart-postgres' || message.nonce !== nonce || typeof message.id !== 'string' || restarting) return;
      restarting = true;
      void (async () => {
        try {
          await stop();
          if (!child.connected) return; // A failed/finished test cannot request a late restart.
          await start(); restarts += 1;
          if (child.connected) child.send({ id: message.id, nonce, ok: true });
        }
        catch (error) {
          console.error(error instanceof Error ? error.message : 'Fixture restart failed');
          if (child.connected) child.send({ id: message.id, nonce, ok: false });
        }
        finally { restarting = false; }
      })();
    });
    const [code] = await once(child, 'close');
    const childFinishedAt = Date.now();
    // Record the child's actual outcome before any evidence gate can throw.
    // A missing TLS proof must not erase failed/cancelled business test counts.
    if (!browser && latestReport) {
      Object.assign(latestReport, { testedAt: new Date().toISOString(),
        childExitCode: code, restarts, databaseTlsVerified: databaseTlsProof,
        passed: Number(/^# pass (\d+)\r?$/m.exec(output)?.[1] || 0), failed: Number(/^# fail (\d+)\r?$/m.exec(output)?.[1] || 0),
        skipped: Number(/^# skipped (\d+)\r?$/m.exec(output)?.[1] || 0), cancelled: Number(/^# cancelled (\d+)\r?$/m.exec(output)?.[1] || 0) });
      persist();
    }
    if (databaseTls && !databaseTlsProof) throw new Error('Missing actual PostgreSQL TLS and rejection evidence');
    if (!browser) tapProof(output);
    if (plan.mode === 'permissions') postgresPermissionsProof(output, code);
    let httpsEvidence: ReturnType<typeof httpsProof> | undefined;
    if (plan.mode === 'https') {
      if (!httpsReportPath) throw new Error('Missing owned PostgreSQL HTTPS report');
      assertNoLinks(httpsReportPath);
      httpsEvidence = httpsProof(JSON.parse(readFileSync(httpsReportPath, 'utf8')), childStartedAt, childFinishedAt, 'postgres');
      if (code !== 0 || httpsEvidence.passed !== tapProof(output).passed) throw new Error('Owned PostgreSQL HTTPS report and actual six-case TAP must agree');
    }
    const browserResult = browser ? JSON.parse(readFileSync(browserReportPath!, 'utf8')) : undefined;
    const passed = Number((browser ? /(?:^|\n)\s*(\d+) passed/ : /# pass (\d+)/).exec(output)?.[1] || 0);
    const failed = Number((browser ? /(?:^|\n)\s*(\d+) failed/ : /# fail (\d+)/).exec(output)?.[1] || 0);
    const report = { startedAt, testedAt: new Date().toISOString(), engine: 'real-postgresql', serverVersion, platform: process.platform,
      passed, failed, restarts, status: code === 0 && passed > 0 && failed === 0 ? 'passed' : 'failed',
      ...(!browser ? { skipped: Number(/^# skipped (\d+)\r?$/m.exec(output)?.[1] || 0),
        cancelled: Number(/^# cancelled (\d+)\r?$/m.exec(output)?.[1] || 0), childExitCode: code } : {}),
      directory, sourceWorkingDatabaseModified: false, applicationRuntime: browser ? 'typescript-browser-fixtures' : plan.mode === 'publication-http' ? 'typescript-http-fixture' : plan.mode === 'https' ? 'compiled-https-postgres' : 'postgres-opt-in',
      scope: plan.scope, fixtureStopped: false,
      ...(plan.mode === 'permissions' ? { applicationRuntime: 'compiled-api-restricted-postgres-role',
        compiledBackendVerified: true, deploymentVerified: false, runtimeRoleSeparationVerified: true,
        skipped: 0, cancelled: 0 } : {}),
      ...(databaseTls ? { databaseTlsVerified: databaseTlsProof, certificateGenerator, operatingSystemTrustModified: false,
        certificateChainVerified: true, hostnameMismatchRejected: true, untrustedCaRejected: true, plaintextRejected: true } : {}),
      ...(plan.mode === 'publication-http' ? {
        skipped: Number(/# skipped (\d+)/.exec(output)?.[1] || 0), cancelled: Number(/# cancelled (\d+)/.exec(output)?.[1] || 0),
        compiledBackendVerified: false, deploymentVerified: false
      } : {}),
      ...(plan.mode === 'https' ? { httpsReportPath, skipped: 0, cancelled: 0, compiledBackendVerified: true, deploymentVerified: false,
        databaseProvider: 'postgres', storageEngineVerified: true, postgresSchemasVerified: 4, httpsFixturesStopped: true,
        databaseRuntimePermissionsVerified: true, databaseRestrictedApplicationsVerified: httpsEvidence ? 9 : 0 } : {}),
      ...(browser ? { browserReportPath, browserArtifacts: join(directory, 'browser-artifacts'), skipped: browserResult?.stats?.skipped ?? null,
        flaky: browserResult?.stats?.flaky ?? null, compiledBackendVerified: false, deploymentVerified: false } : {}) };
    latestReport = report;
    persist();
    if (plan.mode === 'publication-http') publicationHttpProof(output, code);
    if (browser) postgresBrowserProof(browserResult, output, code, childStartedAt, childFinishedAt);
    if (code !== 0 || !passed || failed) throw new Error('PostgreSQL tests did not pass');
  } catch (error) {
    if (latestReport) { latestReport.status = 'failed'; latestReport.controllerFailed = true; persist(); }
    throw error;
  } finally {
    try { await stop(); }
    catch (error) {
      if (latestReport) { latestReport.status = 'failed'; latestReport.controllerFailed = true; persist(); }
      throw error;
    } finally {
      if (latestReport) {
        latestReport.fixtureStopped = !server || server.exitCode !== null || server.signalCode !== null;
        latestReport.finishedAt = new Date().toISOString(); persist();
      }
    }
    console.log('PostgreSQL fixture stopped; its isolated evidence directory is retained. No working database was migrated.');
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'PostgreSQL fixture failed'); process.exitCode = 1; });
