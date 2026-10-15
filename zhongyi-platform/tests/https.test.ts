import assert from 'node:assert/strict';
import { fixtureApplicationCompletion, fixtureApplicationWrapper } from '../tools/fixture-application.js';
import { test, before, after } from 'node:test';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { request as httpsRequest, createServer as secureServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { type TLSSocket } from 'node:tls';
import { X509Certificate, createHash, randomUUID, randomBytes } from 'node:crypto';
import { chromium, expect, type Page } from '@playwright/test';
import { runtimeConfig } from '../server/runtime-config.js';
import { tlsOptions } from '../server/tls-config.js';
import { ciEnvironment } from '../tools/ci-core.js';
import { publicationFixture } from './publication-fixture.js';
import { httpsPublicClient } from './https-public-client.js';
import { parsePostgresConnectionTrace, postgresConnectionDiagnostics } from '../server/postgres-connection-diagnostics.js';
import { fileDigest, fixturePassword } from './migration-fixture.js';
import { ownedHttpsPostgres } from '../tools/https-test-plan.js';
import { createPostgresPool } from '../server/postgres-migration.js';
import { ownedHttpsRuntimeConnection, prepareHttpsPostgresRuntime, prepareHttpsPostgresRecovery } from '../tools/https-postgres-fixture.js';
import { capturePostgresBackup, encryptBackup, decryptBackup, writeBackupFile, readBackupFile, type PostgresBackup } from '../server/postgres-backup.js';
import { assertRecoveryData } from './backup-fixture.js';
import { identifier } from '../server/migration-snapshot.js';
import { assertNoLinks } from '../server/demo-secrets.js';
import express from 'express';
import { requestDiagnostics } from '../server/request-log.js';
import { RequestLogCollector, RequestTimeline, correlateRequest, type ClientRequestTrace } from '../tools/https-diagnostics.js';
import type { Account, ContentDraft, ContentRevision, DraftDetail, ProfessionalDetail, PublicationSnapshotView, PublicationWorkspaceView, PublishedEducation, SessionInfo } from '../shared/contracts.js';

const directory = process.env.HTTPS_TEST_DIRECTORY; const nonce = process.env.HTTPS_TEST_NONCE; const password = process.env.HTTPS_TEST_PASSWORD;
const provider = process.env.HTTPS_TEST_DATABASE_PROVIDER;
if (provider !== 'sqlite' && provider !== 'postgres') throw new Error('Explicit owned HTTPS database provider required');
const postgres = provider === 'postgres' ? ownedHttpsPostgres(process.env, process.connected === true) : undefined;
const mainSchema = process.env.HTTPS_TEST_POSTGRES_SCHEMA || '';
if (postgres && !/^https_workbench_[a-f0-9]{32}$/.test(mainSchema)) throw new Error('Owned HTTPS PostgreSQL namespace required');
const runtimeConnection = postgres ? ownedHttpsRuntimeConnection(process.env, mainSchema) : '';
if (!directory || !nonce || !password || resolve(directory) !== process.cwd() || !/^run-[A-Za-z0-9_-]{6}$/.test(basename(directory)) ||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce)) throw new Error('Use the owned HTTPS controller, not standalone tests');
assertNoLinks(directory);
const path = (name: string) => join(directory, name); const ca = readFileSync(path('ca.pem')); const certificate = new X509Certificate(readFileSync(path('server.pem')));
const unusedSqlite = path('postgres-must-not-open.sqlite');
const baseEnv = { ...ciEnvironment(process.env, postgres ? unusedSqlite : path('editorial.sqlite')),
  ...(postgres ? { DATABASE_PROVIDER: 'postgres', DATABASE_URL: runtimeConnection, DATABASE_SCHEMA: mainSchema } : {}),
  NODE_ENV: 'production', PG_CONNECTION_DIAGNOSTICS: postgres ? 'true' : 'false',
  TLS_MODE: 'direct', TLS_CERT_FILE: path('server.pem'), TLS_KEY_FILE: path('server.key'), TLS_HEALTH_CA_FILE: path('ca.pem') };
const execute = promisify(execFile); let service: Awaited<ReturnType<typeof serve>>; let port: number;
let applicationSequence = 0;
let requestSequence = 0;
const applicationPorts = new Map<number, number>();
const clientRequests: ClientRequestTrace[] = [];
let droppedClientRequests = 0;
const diagnosticReports: Array<{ matched: number; dropped: number }> = [];
const proof = { type: 'https-proof', nonce, fixturesStopped: false, certificateChainVerified: false, secureCookieVerified: false, browserFlowVerified: false, applicationRestartVerified: false,
  publicationFlowVerified: false, publicationDefaultOffVerified: false, publicationRestartVerified: false, publicationBrowserFlowVerified: false,
  publicEducationClientVerified: false, publicEducationClientRequests: 0,
  publicEducationRecoveryVerified: false, publicEducationRecoveryRequests: 0,
  requestDiagnosticsVerified: false, diagnosticFaultsVerified: false, diagnosticApplications: 0, diagnosticMatchedRequests: 0,
  databaseTlsVerified: false, databaseCertificateChainVerified: false, databaseHostnameMismatchRejected: false,
  databaseUntrustedCaRejected: false, databasePlaintextRejected: false, databaseTlsApplicationsVerified: 0,
  databaseRuntimePermissionsVerified: false, databaseRestrictedApplicationsVerified: 0,
  databaseProvider: provider, storageEngineVerified: false, postgresSchemasVerified: 0 };
const verifiedSchemas = new Set<string>();
const verifiedTlsApplications = new Set<number>();
const verifiedRestrictedApplications = new Set<number>();
let unsafeStartupRejected = false;
interface DatabaseTransport { pid: number; ssl: boolean; version: string | null; bits: number | null;
  role: string; superuser: boolean; highPrivilege: boolean; inherits: boolean; schemaOwner: boolean; memberships: number }
async function databaseTransports(connection: string, schema: string): Promise<DatabaseTransport[]> {
  if (!postgres) return [];
  const pool = createPostgresPool(postgres.connection);
  try {
    const result = await pool.query(`SELECT a.pid, s.ssl, s.version, s.bits, a.usename AS role,
      r.rolsuper AS superuser, (r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS "highPrivilege",
      r.rolinherit AS inherits, (n.nspowner = r.oid) AS "schemaOwner",
      (SELECT COUNT(*) FROM pg_auth_members m WHERE m.member = r.oid OR m.roleid = r.oid) AS memberships
      FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid = a.pid JOIN pg_roles r ON r.rolname = a.usename
      CROSS JOIN pg_namespace n
      WHERE a.pid <> pg_backend_pid() AND a.backend_type = 'client backend'
        AND a.datname = current_database() AND a.usename = $1 AND n.nspname = $2 ORDER BY a.pid`, [new URL(connection).username, schema]);
    return result.rows.map((row) => ({ ...row, memberships: Number(row.memberships) }));
  } finally { await pool.end(); }
}
async function verifyNote(text: string, revision: number) {
  if (!postgres) return;
  const pool = createPostgresPool(postgres.connection);
  try {
    assert.deepEqual((await pool.query(`SELECT text, revision FROM ${identifier(mainSchema)}.editorial_notes WHERE ingredient_id = $1`, ['huang-qi'])).rows, [{ text, revision }]);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM ${identifier(mainSchema)}.ingredients`)).rows[0].n), 106);
    verifiedSchemas.add(mainSchema); proof.postgresSchemasVerified = verifiedSchemas.size;
    assert.equal(existsSync(unusedSqlite), false);
  } finally { await pool.end(); }
}

async function freePort() {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const value = (reservation.address() as AddressInfo).port; await new Promise<void>((done) => reservation.close(() => done())); return value;
}
const origin = () => `https://127.0.0.1:${port}`;
const environment = () => ({ ...baseEnv, PORT: String(port), ALLOWED_ORIGINS: origin() });
function request(pathname: string, options: { method?: string; headers?: Record<string, string>; body?: unknown; trusted?: boolean; servername?: string; port?: number } = {}) {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string; authorized: boolean; protocol: string | null }>((done, reject) => {
    const started = Date.now();
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const requestPort = options.port ?? port;
    const timeline = new RequestTimeline(++requestSequence, applicationPorts.get(requestPort) ?? null, pathname, options.method || 'GET');
    let settled = false; let timedOut: (Error & { code: string }) | undefined; let detachSocket = () => {};
    const record = (outcome: ClientRequestTrace['outcome'], code?: unknown) => {
      if (settled) return false;
      settled = true; detachSocket();
      if (clientRequests.length < 4096) clientRequests.push(timeline.finish(outcome, code)); else droppedClientRequests++;
      return true;
    };
    const failed = (error: Error & { code?: string }) => {
      const reason = timedOut || error;
      if (record(timedOut ? 'timed_out' : 'failed', reason.code)) reject(reason);
    };
    const req = httpsRequest({ hostname: '127.0.0.1', port: requestPort, path: pathname, method: options.method || 'GET', ca: options.trusted === false ? undefined : ca,
      rejectUnauthorized: true, servername: options.servername, minVersion: 'TLSv1.2', timeout: 3000,
      headers: { Origin: `https://127.0.0.1:${requestPort}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } : {}), ...options.headers }
    }, (res) => {
      const socket = res.socket as TLSSocket; const authorized = socket.authorized; const protocol = socket.getProtocol(); let text = '';
      timeline.headers(res.statusCode, res.headers['x-request-id']);
      res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('error', failed);
      res.once('aborted', () => failed(Object.assign(new Error('Owned HTTPS response aborted'), { code: 'OWNED_RESPONSE_ABORTED' })));
      res.on('end', () => { timeline.mark('end'); if (record('completed')) done({ status: res.statusCode!, headers: res.headers, text, authorized, protocol }); });
    });
    req.once('socket', (value) => {
      if (settled) return;
      const socket = value as TLSSocket;
      timeline.socket(!socket.connecting, socket.authorized === true, req.reusedSocket);
      const connected = () => timeline.mark('tcp'); const secure = () => timeline.secure(socket.authorized === true);
      if (socket.connecting) socket.once('connect', connected);
      if (!socket.authorized) socket.once('secureConnect', secure);
      detachSocket = () => { socket.off('connect', connected); socket.off('secureConnect', secure); };
    });
    req.once('finish', () => timeline.mark('flushed'));
    req.on('error', failed);
    req.once('close', () => { if (!settled) failed(Object.assign(new Error('Owned HTTPS request closed'), { code: 'OWNED_REQUEST_CLOSED' })); });
    req.on('timeout', () => {
      timedOut = Object.assign(new Error(`Owned HTTPS request timed out: ${options.method || 'GET'} ${pathname} (${Date.now() - started}ms)`), { code: 'OWNED_REQUEST_TIMEOUT' });
      req.destroy(timedOut);
    }); req.end(body);
  });
}
async function serve(options?: { root: string; filename: string; port: number; enabled: boolean; schema?: string; connection?: string }) {
  const sequence = ++applicationSequence;
  // No other fixture opens a pool between this snapshot and readiness. The
  // observing pool is excluded by backend PID and closed before spawn.
  const activeConnection = options?.connection || runtimeConnection, activeSchema = options?.schema || mainSchema;
  const previousBackends = new Set((await databaseTransports(activeConnection, activeSchema)).map((value) => value.pid));
  let databaseConnections: DatabaseTransport[] = [];
  applicationPorts.set(options?.port ?? port, sequence);
  const logs = new RequestLogCollector();
  const lifecycle = { kind: options ? 'publication' : '106-row-workbench', entrypoint: postgres ? 'container' : 'server', credentialMode: postgres ? 'runtime-file' : 'sqlite', startedAt: new Date().toISOString(),
    listenerLoggedAt: null as string | null, readyAt: null as string | null, readinessExpiredAt: null as string | null,
    stopRequestedAt: null as string | null, exitedAt: null as string | null, exitCode: null as number | null,
    readinessProbes: 0, lastProbeStatus: null as number | null, lastProbeError: null as string | null };
  const wrapper = `${options ? `process.chdir(${JSON.stringify(options.root)});` : ''}${fixtureApplicationWrapper(postgres ? 'container' : 'server')}`;
  const env: NodeJS.ProcessEnv = options ? { ...baseEnv, DB_PATH: options.filename, ...(postgres ? { DATABASE_SCHEMA: options.schema, DATABASE_URL: activeConnection } : {}), PORT: String(options.port), ALLOWED_ORIGINS: `https://127.0.0.1:${options.port}`, EDUCATION_PUBLICATION_ENABLED: String(options.enabled) } : environment();
  if (postgres) {
    const secretFile = path(`runtime-connection-${sequence}.txt`);
    writeFileSync(secretFile, activeConnection, { flag: 'wx', mode: 0o600 });
    env.DATABASE_URL = ''; env.DATABASE_URL_FILE = ''; env.DATABASE_OWNER_URL_FILE = ''; env.DATABASE_RUNTIME_URL_FILE = secretFile;
  }
  const child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stdout!.on('data', (value) => { output += value; logs.push(value.toString()); if (!lifecycle.listenerLoggedAt && output.includes('Workbench listener:')) lifecycle.listenerLoggedAt = new Date().toISOString(); }); child.stderr!.on('data', (value) => { output += value; });
  const ended = fixtureApplicationCompletion(child); let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    lifecycle.stopRequestedAt = new Date().toISOString();
    if (child.connected && child.exitCode === null && child.signalCode === null) child.send(postgres ? 'stop' : 'test-stop');
    const [code, signal] = await ended; lifecycle.exitedAt = new Date().toISOString(); lifecycle.exitCode = code;
    logs.end(); const requests = clientRequests.filter((record) => record.application === sequence);
    const correlations = requests.map((record) => ({ sequence: record.sequence, ...correlateRequest(record, logs.records) }));
    const matched = correlations.filter((record) => record.kind === 'request_id').length;
    const connectionTraces = output.split(/\r?\n/).flatMap(line => {
      if (!line.startsWith('{"event":"postgres_connection"') || line.length > 4096) return [];
      try { const trace = parsePostgresConnectionTrace(JSON.parse(line)); return trace ? [trace] : []; } catch { return []; }
    });
    writeFileSync(path(`application-${sequence}.json`), JSON.stringify({ ...lifecycle, databaseConnections,
      postgresConnections: connectionTraces.slice(0, 512), droppedPostgresConnections: Math.max(0, connectionTraces.length - 512), diagnostics: {
      schemaVersion: 1, timeoutKind: 'socket_inactivity', timeoutMs: 3000, clientRequests: requests,
      serverRequests: logs.records, correlations, droppedServerRecords: logs.dropped, droppedClientRecords: droppedClientRequests
    } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    assert(requests.length <= 512); assert.equal(logs.dropped, 0); assert.equal(droppedClientRequests, 0);
    for (const request of requests.filter((record) => record.outcome === 'completed')) {
      assert(request.requestId, 'A completed compiled API response must have a server-generated ID');
      const matches = logs.records.filter((record) => record.requestId === request.requestId);
      assert.equal(matches.length, 1); assert.equal(matches[0].status, request.status); assert.equal(matches[0].outcome, 'completed');
    }
    diagnosticReports.push({ matched, dropped: logs.dropped });
    assert.equal(code, 0); assert.equal(signal, null);
    assert.equal(output.includes(password!), false); assert.equal(output.includes('BEGIN PRIVATE KEY'), false);
    assert.equal(output.includes(fixturePassword), false);
    assert.match(output, new RegExp(`Database provider: ${provider}`));
    if (postgres) {
      for (const secret of [postgres.connection, activeConnection, new URL(activeConnection).password]) assert.equal(output.includes(secret), false);
      assert.equal(existsSync(options?.filename || unusedSqlite), false);
    }
  })();
  try {
    const deadline = Date.now() + 20000;
    while (true) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('HTTPS startup exited before readiness');
      lifecycle.readinessProbes++;
      try {
        lifecycle.lastProbeStatus = (await request('/api/ready', { port: options?.port })).status;
        if (lifecycle.lastProbeStatus === 200) { lifecycle.readyAt = new Date().toISOString(); break; }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        lifecycle.lastProbeError = ['ECONNREFUSED', 'ECONNRESET', 'OWNED_REQUEST_TIMEOUT'].includes(code || '') ? code! : 'other';
      }
      if (Date.now() >= deadline) { lifecycle.readinessExpiredAt = new Date().toISOString(); throw new Error('HTTPS startup observation expired'); }
      await new Promise((done) => setTimeout(done, 100));
    }
    if (postgres) {
      databaseConnections = (await databaseTransports(activeConnection, activeSchema)).filter((value) => !previousBackends.has(value.pid));
      assert(databaseConnections.length >= 1 && databaseConnections.length <= 4, 'The newly started compiled application must have an actual SQL connection');
      for (const connection of databaseConnections) {
        assert(Number.isSafeInteger(connection.pid) && connection.pid > 0); assert.equal(connection.ssl, true);
        assert(['TLSv1.2', 'TLSv1.3'].includes(connection.version!)); assert(connection.bits !== null && connection.bits >= 128);
        assert.equal(connection.role, new URL(activeConnection).username);
        for (const key of ['superuser', 'highPrivilege', 'inherits', 'schemaOwner'] as const) assert.equal(connection[key], false);
        assert.equal(connection.memberships, 0);
      }
      verifiedTlsApplications.add(sequence);
      verifiedRestrictedApplications.add(sequence);
    }
    return { stop };
  } catch (error) { await stop(); throw error; }
}

before(async () => { port = await freePort(); service = await serve(); });
after(async () => {
  await service?.stop(); proof.fixturesStopped = true;
  writeFileSync(path('postgres-client-setup.json'), JSON.stringify(postgresConnectionDiagnostics(), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  proof.diagnosticApplications = diagnosticReports.length;
  proof.diagnosticMatchedRequests = diagnosticReports.reduce((sum, report) => sum + report.matched, 0);
  const expectedApplications = postgres ? 9 : 7;
  proof.requestDiagnosticsVerified = diagnosticReports.length === expectedApplications && diagnosticReports.every((report) => report.matched > 0 && report.dropped === 0);
  proof.databaseTlsApplicationsVerified = verifiedTlsApplications.size;
  proof.databaseCertificateChainVerified = !!postgres && verifiedTlsApplications.size === expectedApplications;
  proof.databaseTlsVerified = proof.databaseCertificateChainVerified && proof.databaseHostnameMismatchRejected &&
    proof.databaseUntrustedCaRejected && proof.databasePlaintextRejected;
  proof.databaseRestrictedApplicationsVerified = verifiedRestrictedApplications.size;
  proof.databaseRuntimePermissionsVerified = !!postgres && unsafeStartupRejected && verifiedRestrictedApplications.size === expectedApplications;
  if (process.connected && process.send) await new Promise<void>((done, reject) => process.send!(proof, (error) => error ? reject(error) : done()));
  if (process.connected) process.disconnect();
});

test('direct TLS validates matching leaf/SAN/time and rejects invalid configuration without opening a fallback SQLite file', async () => {
  const config = runtimeConfig(environment()); assert.equal(tlsOptions(config)?.minVersion, 'TLSv1.2');
  for (const patch of [{ TLS_KEY_FILE: path('ca.key') }, { TLS_CERT_FILE: path('ca.pem'), TLS_KEY_FILE: path('ca.key') },
    { TLS_CERT_FILE: path('missing.pem') }, { ALLOWED_ORIGINS: 'https://not-covered.example.test' }]) assert.throws(() => tlsOptions(runtimeConfig({ ...environment(), ...patch })));
  assert.throws(() => tlsOptions(config, Date.parse(certificate.validTo) + 1)); assert.throws(() => tlsOptions(config, Date.parse(certificate.validFrom) - 1));
  const unused = path('must-not-open.sqlite');
  const untrustedDatabase = postgres ? new URL(postgres.connection) : undefined; untrustedDatabase?.searchParams.delete('sslrootcert');
  const wrongDatabaseHost = postgres ? new URL(postgres.connection) : undefined; if (wrongDatabaseHost) wrongDatabaseHost.hostname = '127.0.0.1';
  const plaintextDatabase = postgres ? new URL(postgres.connection) : undefined; if (plaintextDatabase) plaintextDatabase.search = '';
  for (const patch of [{ TLS_KEY_FILE: path('ca.key') }, { TLS_MODE: 'off', TLS_CERT_FILE: '', TLS_KEY_FILE: '' },
    ...(postgres ? [{ DATABASE_URL: '' }, { DATABASE_SCHEMA: `https_missing_${randomUUID().replaceAll('-', '')}` }, { DATABASE_URL: postgres.connection },
      { DATABASE_URL: untrustedDatabase!.toString() }, { DATABASE_URL: wrongDatabaseHost!.toString() }, { DATABASE_URL: plaintextDatabase!.toString() }] : [])]) {
    await assert.rejects(execute(process.execPath, ['build/server/index.js'], { env: { ...environment(), DB_PATH: unused, ...patch }, windowsHide: true }), (error: any) => {
      assert.equal(error.code, 1);
      const expected = postgres && 'DATABASE_URL' in patch && !patch.DATABASE_URL ? /missing_configuration:/
        : postgres && 'DATABASE_URL' in patch && patch.DATABASE_URL === plaintextDatabase!.toString() ? /tls_required:/
        : postgres && (('DATABASE_SCHEMA' in patch) || ('DATABASE_URL' in patch && patch.DATABASE_URL === postgres.connection)) ? /unsafe_database_permissions:/ : /Application startup failed/;
      assert.match(error.stderr, expected);
      assert.equal(`${error.stdout}${error.stderr}`.includes(password!), false);
      if (postgres) {
        assert.equal(`${error.stdout}${error.stderr}`.includes(postgres.connection), false);
        assert.equal(`${error.stdout}${error.stderr}`.includes(new URL(postgres.connection).password), false);
      }
      return true;
    });
    assert.equal(existsSync(unused), false);
  }
  if (postgres) {
    const permissionPool = createPostgresPool(postgres.connection);
    const role = identifier(new URL(runtimeConnection).username);
    try {
      for (const [change, undo] of [
        [`GRANT UPDATE ON ${identifier(mainSchema)}.ingredients TO ${role}`, `REVOKE UPDATE ON ${identifier(mainSchema)}.ingredients FROM ${role}`],
        [`REVOKE UPDATE ON ${identifier(mainSchema)}.editorial_notes FROM ${role}`, `GRANT UPDATE ON ${identifier(mainSchema)}.editorial_notes TO ${role}`]
      ]) {
        await permissionPool.query(change);
        try {
          await assert.rejects(execute(process.execPath, ['build/server/index.js'], { env: environment(), windowsHide: true }), (error: any) => {
            assert.equal(error.code, 1); assert.match(error.stderr, /unsafe_database_permissions:/);
            for (const secret of [postgres.connection, runtimeConnection, new URL(runtimeConnection).password]) assert.equal(`${error.stdout}${error.stderr}`.includes(secret), false);
            return true;
          });
        } finally { await permissionPool.query(undo); }
      }
      unsafeStartupRejected = true;
    } finally { await permissionPool.end(); }
    // The same production policy must protect operator CLIs, not only HTTPS.
    const forbiddenOutput = path('production-plaintext-must-not-backup.zfbackup');
    const operatorSchema = `https_operator_${randomUUID().replaceAll('-', '')}`;
    const operatorBackupKey = randomBytes(32).toString('base64');
    const secretFile = path('production-plaintext-database-url.txt');
    writeFileSync(secretFile, plaintextDatabase!.toString(), { flag: 'wx', mode: 0o600 });
    for (const [entry, args, secretMount] of [
      ['init-postgres', ['--schema', operatorSchema], false],
      ['migrate-postgres', ['--verify', '--schema', mainSchema], false],
      ['backup-postgres', ['--schema', mainSchema, '--output', forbiddenOutput], false],
      ['bootstrap-account', ['production-policy-test-admin'], false],
      ['container-entrypoint', ['init', '--schema', operatorSchema], true]
    ] as const) {
      await assert.rejects(execute(process.execPath, [`build/tools/${entry}.js`, ...args], {
        env: { ...environment(), DATABASE_URL: secretMount ? '' : plaintextDatabase!.toString(),
          DATABASE_OWNER_URL_FILE: secretMount ? secretFile : '', BACKUP_ENCRYPTION_KEY: entry === 'backup-postgres' ? operatorBackupKey : '' }, windowsHide: true
      }), (error: any) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /tls_required/);
        assert.equal(`${error.stdout}${error.stderr}`.includes(new URL(postgres.connection).password), false);
        assert.equal(`${error.stdout}${error.stderr}`.includes(postgres.connection), false);
        assert.equal(`${error.stdout}${error.stderr}`.includes(operatorBackupKey), false);
        return true;
      });
      assert.equal(existsSync(forbiddenOutput), false); assert.equal(existsSync(unusedSqlite), false);
    }
    const verifyPool = createPostgresPool(postgres.connection);
    try { assert.equal((await verifyPool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [operatorSchema])).rowCount, 0); }
    finally { await verifyPool.end(); }
    // Also assert precise transport errors through the same application pool
    // factory, not only the compiled entrypoint's sanitized startup rejection.
    for (const [url, expected] of [[untrustedDatabase!, 'untrusted'], [wrongDatabaseHost!, 'hostname'], [plaintextDatabase!, 'plaintext']] as const) {
      const pool = createPostgresPool(url.toString());
      try {
        await assert.rejects(pool.query('SELECT 1'), (error: NodeJS.ErrnoException) => expected === 'hostname' ? error.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
          : expected === 'plaintext' ? error.code === '28000' : ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code || ''));
      } finally { await pool.end(); }
    }
    proof.databaseHostnameMismatchRejected = true; proof.databaseUntrustedCaRejected = true; proof.databasePlaintextRejected = true;
  }
});

test('real HTTPS verifies private CA and hostname, rejects untrusted/plaintext requests, and runs certificate-validating SQL readiness probe', async () => {
  const result = await request('/api/ready'); assert.equal(result.status, 200); assert.equal(result.authorized, true); assert(['TLSv1.2', 'TLSv1.3'].includes(result.protocol!));
  assert.equal(result.headers['strict-transport-security'], 'max-age=86400');
  assert.deepEqual(JSON.parse(result.text), { ok: true });
  await assert.rejects(request('/api/ready', { trusted: false })); await assert.rejects(request('/api/ready', { servername: 'not-covered.example.test' }));
  await assert.rejects(new Promise<void>((done, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/api/ready', timeout: 3000 }, () => done()); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Plaintext test timed out'))); req.end();
  }));
  await execute(process.execPath, ['build/tools/healthcheck.js'], { env: environment(), windowsHide: true });
  await assert.rejects(execute(process.execPath, ['build/tools/healthcheck.js'], { env: { ...environment(), TLS_HEALTH_CA_FILE: '' }, windowsHide: true }));
  await diagnosticFaults();
  proof.certificateChainVerified = true;
});

async function diagnosticFaults() {
  const records: Array<{ injected: string; client: ClientRequestTrace; server: RequestLogCollector['records']; correlation: ReturnType<typeof correlateRequest> }> = [];
  const reportFile = path('diagnostic-faults.json');
  const persist = (verified = false) => {
    const serialized = JSON.stringify({ schemaVersion: 1, engineeringFaultInjection: true, fixturesStopped: true, verified, records }, null, 2);
    assert.equal(serialized.includes('private-fault-body-never-log'), false);
    writeFileSync(reportFile, serialized + '\n', { flag: existsSync(reportFile) ? 'w' : 'wx', mode: 0o600 });
  };
  for (const phase of ['tls_handshake', 'response_headers', 'response_body'] as const) {
    const logs = new RequestLogCollector(); const sockets = new Set<Socket>(); let reached = false;
    let logged!: () => void; const observed = new Promise<void>((done) => { logged = done; });
    const app = express(); app.use('/api', requestDiagnostics((record) => { logs.push(JSON.stringify(record) + '\n'); logged(); }));
    app.get('/api/ready', (_req, res) => { reached = true; if (phase === 'response_body') { res.writeHead(200); res.write('private-fault-body-never-log'); } });
    const owned = phase === 'tls_handshake' ? createServer(() => { reached = true; })
      : secureServer({ key: readFileSync(path('server.key')), cert: readFileSync(path('server.pem')), minVersion: 'TLSv1.2' }, app);
    owned.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    owned.listen(0, '127.0.0.1'); await once(owned, 'listening');
    const value = (owned.address() as AddressInfo).port; const sequence = requestSequence + 1;
    try {
      await assert.rejects(request('/api/ready', { port: value }), (error: NodeJS.ErrnoException) => error.code === 'OWNED_REQUEST_TIMEOUT');
      assert(reached, 'The owned fault server must actually reach the injected stall');
    } finally {
      const stopped = once(owned, 'close'); owned.close(); for (const socket of sockets) socket.destroy(); await stopped;
      if (phase !== 'tls_handshake' && reached) await observed;
      logs.end(); const client = clientRequests.find((record) => record.sequence === sequence);
      if (client) records.push({ injected: phase, client, server: logs.records, correlation: correlateRequest(client, logs.records) });
      persist();
    }
    const client = clientRequests.find((record) => record.sequence === sequence)!;
    assert(client); assert.equal(client.outcome, 'timed_out'); assert.equal(client.phase, phase); assert.equal(client.timeoutMs, 3000);
    if (phase !== 'tls_handshake') { assert.equal(client.tlsAuthorized, true); assert.equal(logs.records.length, 1); assert.equal(logs.records[0].outcome, 'aborted'); }
    assert.equal(correlateRequest(client, logs.records).kind, phase === 'tls_handshake' ? 'none' : phase === 'response_headers' ? 'time_window' : 'request_id');
  }
  persist(true);
  proof.diagnosticFaultsVerified = true;
}

test('real HTTPS login sets Secure/HttpOnly/Strict cookies and requires actual Origin plus CSRF for SQL writes', async () => {
  const login = await request('/api/v1/auth/login', { method: 'POST', body: { username: 'https-test-admin', password } }); assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie']![0]; assert.match(cookie, /; Secure/i); assert.match(cookie, /; HttpOnly/i); assert.match(cookie, /; SameSite=Strict/i);
  const session = JSON.parse(login.text); const headers = { Cookie: cookie.split(';')[0], 'X-CSRF-Token': session.csrfToken };
  assert.equal((await request('/api/v1/ingredients/huang-qi/note', { method: 'PUT', headers, body: { text: 'https-private-note', expectedRevision: 0 } })).status, 200);
  assert.equal((await request('/api/v1/ingredients/huang-qi/note', { method: 'PUT', headers: { ...headers, 'X-CSRF-Token': '' }, body: { text: 'forbidden', expectedRevision: 1 } })).status, 403);
  assert.equal((await request('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '127.0.0.1' }, body: { username: 'https-test-admin', password } })).status, 403);
  assert.equal((await request('/api/v1/ingredients/huang-qi')).status, 401);
  const publicData = await request('/api/v1/public/catalog'); assert.equal(JSON.parse(publicData.text).items.length, 106); assert.equal(publicData.text.includes('https-private-note'), false);
  await verifyNote('https-private-note', 1);
  proof.secureCookieVerified = true;
});

test('real Edge React HTTPS login/save/refresh/application-restart/logout keeps Secure session cookies and persists SQL notes', async () => {
  // Browser-scoped exception for this one ephemeral leaf SPKI only, not global
  // ignoreHTTPSErrors/system trust. Node client above independently verifies CA.
  const spki = createHash('sha256').update(certificate.publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: false }); const page = await context.newPage();
    await page.goto(origin()); await page.getByLabel('用户名', { exact: true }).fill('https-test-admin'); await page.getByLabel('密码', { exact: true }).fill(password!);
    await page.getByRole('button', { name: '登录工作台' }).click(); await page.getByRole('textbox', { name: '搜索食材' }).waitFor();
    const cookie = (await context.cookies()).find((value) => value.name === 'food_session')!; assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
    assert.equal(await page.evaluate<boolean>("document.cookie.includes('food_session')"), false); assert.equal(await page.evaluate<number>('localStorage.length + sessionStorage.length'), 0);
    await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪'); await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '编辑备注', exact: true }); await editor.fill('real-edge-https-note'); await page.getByRole('button', { name: '保存备注', exact: true }).click();
    await page.getByRole('status', { name: '备注保存结果' }).filter({ hasText: '已保存' }).waitFor();
    await service.stop(); service = await serve(); await page.reload(); await page.getByRole('textbox', { name: '搜索食材' }).waitFor();
    await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪'); await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
    assert.equal(await editor.inputValue(), 'real-edge-https-note');
    await verifyNote('real-edge-https-note', 2); proof.storageEngineVerified = true;
    await page.screenshot({ path: path('https-workbench-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'), true);
    await page.screenshot({ path: path('https-workbench-mobile.png'), fullPage: true });
    // At 390px the desktop sidebar is hidden; exercise the real mobile action.
    await page.getByRole('button', { name: '退出', exact: true }).click(); await page.getByLabel('密码', { exact: true }).waitFor();
    assert.equal((await context.cookies()).some((value) => value.name === 'food_session'), false);
    proof.browserFlowVerified = true; proof.applicationRestartVerified = true;
  } finally { await browser.close(); }
});

// Actual compiled production server, not createApp in the test process. Each
// simulation has its own seed/root and database; the real 106-row run stays separate.
async function publicationServer() {
  const state = await publicationFixture(); let app: Awaited<ReturnType<typeof serve>> | undefined;
  const sourceDigest = fileDigest(state.filename);
  let schema = postgres ? `https_publication_${randomUUID().replaceAll('-', '')}` : undefined;
  let publicationConnection = '';
  try {
    const root = mkdtempSync(path('publication-')); assertNoLinks(root);
    mkdirSync(join(root, 'data')); writeFileSync(join(root, 'data/catalog.seed.json'), JSON.stringify(state.seed), { flag: 'wx' });
    cpSync(path('dist'), join(root, 'dist'), { recursive: true, errorOnExist: true, force: false });
    if (postgres) {
      publicationConnection = (await prepareHttpsPostgresRuntime(process.env, schema!, state.read(), state.seed)).runtimeConnection;
    }
    const value = await freePort(); const url = `https://127.0.0.1:${value}`;
    const filename = postgres ? join(root, 'must-not-open.sqlite') : state.filename;
    const restart = async (enabled = true) => { await app?.stop(); app = await serve({ root, filename, port: value, enabled, schema, connection: publicationConnection }); };
    const verifyStorage = async (fixed: PublicationSnapshotView) => {
      if (!postgres) return;
      const pool = createPostgresPool(postgres.connection);
      try {
        assert.deepEqual((await pool.query(`SELECT id, digest FROM ${identifier(schema!)}.publication_snapshots WHERE id=$1`, [fixed.id])).rows, [{ id: fixed.id, digest: fixed.digest }]);
        assert.equal(existsSync(filename), false); verifiedSchemas.add(schema!); proof.postgresSchemasVerified = verifiedSchemas.size;
      } finally { await pool.end(); }
    };
    const raw = (pathname: string, options: Parameters<typeof request>[1] = {}) => request(pathname, { ...options, port: value });
    const sessions = new Map<string, { cookie: string; csrfToken: string }>();
    const login = async (actor: Account) => {
      const response = await raw('/api/v1/auth/login', { method: 'POST', body: { username: actor.username, password: fixturePassword } });
      assert.equal(response.status, 200); const info = JSON.parse(response.text) as SessionInfo;
      const cookie = response.headers['set-cookie']![0]; assert.match(cookie, /; Secure/i);
      sessions.set(actor.id, { cookie: cookie.split(';')[0], csrfToken: info.csrfToken });
    };
    async function api<T>(pathname: string, actor = state.admin, method = 'GET', body?: unknown, status = 200, extra: Record<string, string> = {}): Promise<T> {
      const session = sessions.get(actor.id)!;
      const response = await raw('/api/v1' + pathname, { method, body, headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, ...extra } });
      assert.equal(response.status, status, response.text); assert.equal(response.authorized, true);
      return JSON.parse(response.text) as T;
    }
    const workspace = () => api<PublicationWorkspaceView>('/editorial/publications/huang-qi');
    const captureBackup = async () => {
      assert.ok(postgres, 'Recovery evidence requires the actual owned PostgreSQL cluster');
      const pool = createPostgresPool(postgres.connection);
      try {
        const backup = await capturePostgresBackup(pool, schema!, state.seed);
        const key = randomBytes(32);
        try {
          const filename = join(root, 'publication-recovery.backup');
          writeBackupFile(filename, encryptBackup(backup, key));
          const decoded = decryptBackup(readBackupFile(filename), key, state.seed);
          assert.deepEqual(decoded, backup);
          return decoded;
        } finally { key.fill(0); }
      } finally { await pool.end(); }
    };
    const recover = async (backup: PostgresBackup) => {
      assert.ok(postgres);
      const oldSessions = [...sessions.values()];
      await app?.stop(); app = undefined;
      const recoveredSchema = `https_recovery_${randomUUID().replaceAll('-', '')}`;
      const prepared = await prepareHttpsPostgresRecovery(process.env, recoveredSchema, backup, state.seed);
      assert.equal(prepared.result.verified, true);
      assert.equal(prepared.result.publicationFrozen, true);
      assert.equal(prepared.result.sessionsRevoked, backup.data.tables.sessions.length);
      assert.ok(prepared.result.sessionsRevoked >= oldSessions.length);
      const pool = createPostgresPool(postgres.connection);
      try { assertRecoveryData(backup, await capturePostgresBackup(pool, recoveredSchema, state.seed)); }
      finally { await pool.end(); }
      schema = recoveredSchema; publicationConnection = prepared.runtimeConnection;
      await restart();
      for (const session of oldSessions) assert.equal((await raw('/api/v1/auth/me', { headers: { Cookie: session.cookie } })).status, 401);
      sessions.clear();
      for (const actor of [state.admin, state.editor, state.reviewer, state.approver, state.physician, state.pharmacist]) await login(actor);
      return prepared.result;
    };
    const comment = 'ENGINEERING_SIMULATION_NOT_REAL：仅本机编译 HTTPS 验收。';
    const control = async (action: 'resume' | 'freeze') => api('/editorial/publication-controls', state.admin, 'POST', {
      action, expectedVersion: (await workspace()).control?.version || 0, evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment, confirmed: true
    }, 201);
    const snapshot = async () => api<PublicationSnapshotView>('/editorial/publications/huang-qi/snapshots', state.editor, 'POST', {
      expectedBasisDigest: (await workspace()).basisDigest!, comment, confirmed: true
    }, 201);
    const approve = async (fixed: PublicationSnapshotView, actor = state.approver, status = 201) => api('/editorial/publications/huang-qi/approvals', actor, 'POST', {
      snapshotId: fixed.id, snapshotDigest: fixed.digest,
      expectedApprovalVersion: (await workspace()).approvals.find((item) => item.snapshotId === fixed.id)?.version || 0,
      expectedControlVersion: (await workspace()).control?.version || 0, decision: 'approve', comment, confirmed: true
    }, status);
    const action = async (fixed: PublicationSnapshotView, action: 'publish' | 'withdraw' | 'rollback' = 'publish', status = 201) => api('/editorial/publications/huang-qi/actions', state.approver, 'POST', {
      snapshotId: fixed.id, action, expectedVersion: (await workspace()).eventVersion, expectedControlVersion: (await workspace()).control?.version || 0, comment, confirmed: true
    }, status);
    const advance = async () => {
      const detail = await api<DraftDetail>('/editorial/ingredients/huang-qi', state.editor);
      const next = await api<ContentDraft>('/editorial/ingredients/huang-qi', state.editor, 'PUT', {
        content: { ...detail.draft!.content, educationText: comment + '第二固定版本。' }, expectedLockVersion: detail.draft!.lockVersion
      });
      const submitted = await api<{ draft: ContentDraft; task: { id: string } }>('/editorial/ingredients/huang-qi/submit', state.editor, 'POST', { expectedLockVersion: next.lockVersion });
      await api(`/editorial/tasks/${submitted.task.id}/decision`, state.reviewer, 'POST', { decision: 'accept', comment, expectedLockVersion: submitted.draft.lockVersion });
      for (const [actor, profession] of [[state.physician, 'tcm_physician'], [state.pharmacist, 'pharmacist']] as const) {
        const professional = await api<ProfessionalDetail>('/editorial/professional/huang-qi');
        const fixed = await api<ContentRevision>(`/editorial/ingredients/huang-qi/revisions/${professional.draft!.revision}`);
        await api('/editorial/professional/huang-qi', actor, 'POST', { profession, decision: 'approve', contentRevision: fixed.revision, contentDigest: fixed.digest,
          expectedLockVersion: professional.draft!.lockVersion, expectedReviewVersion: professional.reviewVersion, expectedQualificationRevision: 1, comment });
      }
    };
    await restart();
    for (const actor of [state.admin, state.editor, state.reviewer, state.approver, state.physician, state.pharmacist]) await login(actor);
    return { state, url, raw, api, workspace, control, snapshot, approve, action, advance, restart, verifyStorage, captureBackup, recover,
      close: async () => { try { await app?.stop(); if (postgres) assert.equal(fileDigest(state.filename), sourceDigest); } finally { state.close(); } } };
  } catch (error) { try { await app?.stop(); if (postgres) assert.equal(fileDigest(state.filename), sourceDigest); } finally { state.close(); } throw error; }
}

test('compiled HTTPS publication enforces roles/privacy, persists fixed versions and sessions across restart, closes on freeze and default-off, and allows emergency withdrawal', async () => {
  const s = await publicationServer();
  const reading = httpsPublicClient(Number(new URL(s.url).port), ca);
  const { client } = reading;
  try {
    const originalCatalog = (await s.raw('/api/v1/public/catalog')).text;
    assert.equal((await s.raw('/api/v1/editorial/publications/huang-qi')).status, 401);
    assert.equal((await client.refresh()).status, 'withdrawn');
    await s.control('resume'); const fixed = await s.snapshot();
    for (const qualification of fixed.basis.qualifications) assert.equal(Object.hasOwn(qualification, 'evidenceReference'), false);
    await s.approve(fixed, s.state.admin, 403);
    await s.api('/editorial/publications/huang-qi/approvals', s.state.approver, 'POST', {}, 403, { 'X-CSRF-Token': '' });
    await s.api('/editorial/publication-controls', s.state.admin, 'POST', {}, 403, { Origin: 'https://evil.example.test' });
    await s.approve(fixed);
    assert.equal((await client.refresh()).document, null, 'Approval cannot implicitly publish to the TS client');
    await s.action(fixed);
    const publicResult = await s.raw('/api/v1/public/education/huang-qi'); assert.equal(publicResult.status, 200); assert.equal(publicResult.authorized, true);
    assert.equal(publicResult.headers['cache-control'], 'no-store');
    const body = JSON.parse(publicResult.text) as PublishedEducation; assert.equal(body.snapshotId, fixed.id);
    assert.deepEqual(Object.keys(body).sort(), ['scope', 'ingredientId', 'name', 'snapshotId', 'snapshotVersion', 'contentRevision', 'baseReleaseId', 'publishedAt', 'ediblePart', 'latinName', 'educationText', 'safetyText', 'sources', 'boundary'].sort());
    let state = await client.refresh(); assert.equal(state.status, 'ready'); assert.equal(state.document?.snapshotId, fixed.id);
    const backup = postgres ? await s.captureBackup() : undefined;
    for (const mode of ['wrong-hostname', 'untrusted'] as const) {
      reading.setMode(mode);
      state = await client.refresh(); assert.equal(state.status, 'stale'); assert.equal(state.error, 'network');
      assert.equal(state.document?.snapshotId, fixed.id, 'Only the previously verified, unexpired document can remain stale');
      reading.clear(); state = await client.refresh();
      assert.equal(state.status, 'unavailable'); assert.equal(state.document, null);
      reading.setMode('trusted'); assert.equal((await client.refresh()).status, 'ready');
    }
    assert.equal(reading.evidence.hostnameRejections, 2); assert.equal(reading.evidence.untrustedRejections, 2);
    await s.advance(); assert.equal((await client.refresh()).document?.snapshotId, fixed.id, 'Private draft edits cannot alter public reading');
    const second = await s.snapshot(); await s.approve(second); await s.action(second);
    assert.equal((await client.refresh()).document?.snapshotId, second.id);
    await s.action(fixed, 'rollback'); assert.equal(JSON.parse((await s.raw('/api/v1/public/education/huang-qi')).text).snapshotId, fixed.id);
    assert.equal((await client.refresh()).document?.snapshotId, fixed.id);
    const before = await s.workspace(); await s.restart();
    assert.deepEqual(await s.workspace(), before, 'Secure sessions and fixed history survive actual compiled application restart');
    reading.clear(); assert.equal((await client.refresh()).document?.snapshotId, fixed.id, 'A fresh client read survives independent compiled service restart');
    assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 200); proof.publicationRestartVerified = true;
    await s.control('freeze'); assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 404);
    state = await client.refresh(); assert.equal(state.status, 'withdrawn'); assert.equal(state.document, null);
    await s.control('resume'); assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 404);
    assert.equal((await client.refresh()).document, null);
    await s.action(fixed, 'publish', 409); await s.approve(fixed); await s.action(fixed);
    assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 200);
    assert.equal((await client.refresh()).document?.snapshotId, fixed.id);
    await s.restart(false); assert.equal((await s.workspace()).enabled, false);
    assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 503);
    state = await client.refresh(); assert.equal(state.status, 'unavailable'); assert.equal(state.document, null);
    await s.action(fixed, 'publish', 409); await s.action(fixed, 'withdraw');
    assert.equal((await s.workspace()).events[0].action, 'withdraw'); proof.publicationDefaultOffVerified = true;
    await s.restart(true); assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 404);
    assert.equal((await client.refresh()).document, null);
    await s.approve(fixed); assert.equal((await client.refresh()).document, null);
    await s.action(fixed, 'rollback'); assert.equal((await client.refresh()).document?.snapshotId, fixed.id);
    await s.action(fixed, 'withdraw'); state = await client.refresh();
    assert.equal(state.status, 'withdrawn'); assert.equal(state.document, null);
    assert.equal((await s.raw('/api/v1/public/catalog')).text, originalCatalog); proof.publicationFlowVerified = true;
    await s.verifyStorage(fixed);
    if (backup) {
      const requestsBefore = reading.evidence.requests;
      // Put a later published body in the same client's memory, then cut the
      // actual compiled HTTPS service over to an encrypted earlier backup.
      await s.approve(second); await s.action(second);
      assert.equal((await client.refresh()).document?.snapshotId, second.id);
      const restored = await s.recover(backup);
      state = await client.refresh(); assert.equal(state.status, 'withdrawn'); assert.equal(state.document, null);
      const frozen = await s.workspace();
      assert.equal(frozen.control?.kind, 'recovery'); assert.equal(frozen.control?.action, 'freeze');
      assert.equal(frozen.control?.version, restored.publicationFreezeVersion);
      assert.equal(frozen.control?.evidenceReference, `backup:${backup.digest}`);
      assert.deepEqual(frozen.snapshots.map(item => item.id), [fixed.id], 'A later snapshot must not survive restoring an earlier backup');
      await verifyRecoveryPage(s.url, s.state.reviewer.username);
      await s.approve(fixed, s.state.approver, 409);
      await s.action(fixed, 'publish', 409);
      await s.control('resume'); assert.equal((await client.refresh()).document, null);
      await s.action(fixed, 'publish', 409);
      await s.approve(fixed); assert.equal((await client.refresh()).document, null, 'Approval alone cannot revive the restored publication pointer');
      await s.action(fixed, 'rollback'); assert.equal((await client.refresh()).document?.snapshotId, fixed.id);
      const restoredWorkspace = await s.workspace(); await s.restart();
      assert.deepEqual(await s.workspace(), restoredWorkspace);
      reading.clear(); assert.equal((await client.refresh()).document?.snapshotId, fixed.id);
      await s.action(fixed, 'withdraw'); state = await client.refresh();
      assert.equal(state.status, 'withdrawn'); assert.equal(state.document, null);
      await s.verifyStorage(fixed);
      assert.equal((await s.raw('/api/v1/public/catalog')).text, originalCatalog);
      proof.publicEducationRecoveryRequests = reading.evidence.requests - requestsBefore;
      assert.equal(proof.publicEducationRecoveryRequests, 7);
      proof.publicEducationRecoveryVerified = true;
    }
    assert.ok(reading.evidence.requests >= 21);
    assert.equal(reading.evidence.authorizedResponses, reading.evidence.requests - 4);
    proof.publicEducationClientVerified = true; proof.publicEducationClientRequests = reading.evidence.requests;
  } finally { reading.clear(); await s.close(); }
});

async function verifyRecoveryPage(url: string, username: string) {
  const spki = createHash('sha256').update(certificate.publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(url); await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
    await page.getByRole('button', { name: '登录工作台', exact: false }).click();
    await page.getByRole('button', { name: '内容协作', exact: true }).click();
    await page.getByRole('button', { name: '固定版本发布', exact: true }).click();
    await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click();
    await expect(page.getByLabel('教育发布状态', { exact: true })).toContainText('全部教育发布冻结');
    await expect(page.getByLabel('发布操作说明', { exact: true })).toBeDisabled();
    assert.equal(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'), true);
    await page.screenshot({ path: path('https-recovery-frozen.png'), fullPage: true });
  } finally { await browser.close(); }
}

test('real Edge React fixed publication over compiled HTTPS approves/publishes, preserves failed input, and shows frozen read-only 390px state', async () => {
  const s = await publicationServer();
  const spki = createHash('sha256').update(certificate.publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await s.control('resume'); await s.snapshot();
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
    const context = await browser.newContext({ ignoreHTTPSErrors: false }); const page = await context.newPage();
    const login = async (page: Page, username: string) => {
      await page.goto(s.url); await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
      await page.getByRole('button', { name: '登录工作台', exact: false }).click();
      await page.getByRole('button', { name: '内容协作', exact: true }).click();
      await page.getByRole('button', { name: '固定版本发布', exact: true }).click();
      await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click();
      await expect(page.getByRole('heading', { name: '黄芪 · 固定版本发布', exact: true })).toBeVisible();
    };
    const fill = async () => { await page.getByLabel('发布操作说明', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL：真实 HTTPS 页面测试。'); await page.getByLabel('确认已核对发布依据', { exact: true }).check(); };
    const click = async (name: string) => { page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name, exact: true }).click(); };
    await login(page, s.state.approver.username); await fill(); await click('批准此快照');
    await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('');
    await fill(); await click('发布此快照');
    await expect(page.getByLabel('教育发布状态', { exact: true })).toContainText('允许核对发布操作');
    await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('');
    assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 200);
    const cookie = (await context.cookies()).find((value) => value.name === 'food_session')!; assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
    await page.screenshot({ path: path('https-publication-desktop.png'), fullPage: true });
    await fill(); await page.route('**/api/v1/editorial/publications/huang-qi/actions', (route) => route.abort());
    await click('撤回当前发布'); await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('输入已保留');
    await expect(page.getByLabel('发布操作说明', { exact: true })).not.toHaveValue('');
    await expect(page.getByRole('button', { name: '撤回当前发布', exact: true })).toBeDisabled();
    assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 200, 'Aborted request did not withdraw or retry');
    await s.control('freeze'); assert.equal((await s.raw('/api/v1/public/education/huang-qi')).status, 404);
    const readonly = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 390, height: 844 } });
    const narrow = await readonly.newPage(); await login(narrow, s.state.reviewer.username);
    await expect(narrow.getByLabel('发布操作说明', { exact: true })).toBeDisabled();
    await expect(narrow.getByLabel('教育发布状态', { exact: true })).toContainText('全部教育发布冻结');
    assert.equal(await narrow.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'), true);
    await narrow.screenshot({ path: path('https-publication-mobile.png'), fullPage: true });
    await s.verifyStorage((await s.workspace()).snapshots[0]);
    proof.publicationBrowserFlowVerified = true;
  } finally { try { await browser?.close(); } finally { await s.close(); } }
});
