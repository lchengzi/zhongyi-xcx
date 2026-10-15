import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { requestDiagnostics, type RequestLogRecord, type RequestLogSink } from '../server/request-log.js';
import { fixtureSeed } from './fixture.js';
import { safeRequestLog, RequestLogCollector, RequestTimeline, correlateRequest } from '../tools/https-diagnostics.js';
import { DatabaseSync } from 'node:sqlite';
import { instrumentLoginDatabase } from '../tools/login-timing.js';

const token = 'test-local-editor-token-with-32-characters';
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fields = ['category', 'durationMs', 'event', 'method', 'outcome', 'requestId', 'status', 'timestamp'];
async function serve(sink: RequestLogSink) {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  const server = createApp(repo, token, undefined, { requestLog: sink }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { repo, base, async close() { const ended = once(server, 'close'); server.close(); await ended; repo.close(); } };
}
function validate(record: RequestLogRecord) {
  assert.deepEqual(Object.keys(record).sort(), fields);
  assert.equal(record.event, 'api_request'); assert.match(record.requestId, idPattern);
  assert.equal(new Date(record.timestamp).toISOString(), record.timestamp);
  assert(Number.isFinite(record.durationMs) && record.durationMs >= 0);
}

test('real HTTP returns independent IDs and logs only fixed fields, not secrets, search text or bodies', async () => {
  const records: RequestLogRecord[] = []; const service = await serve((record) => { records.push(record); });
  const privateText = 'private-health-search-DO-NOT-LOG';
  try {
    const response = await fetch(`${service.base}/api/v1/ingredients?q=${privateText}`, { headers: {
      Authorization: `Bearer ${token}`, Cookie: 'session=private-cookie', 'X-CSRF-Token': 'private-csrf',
      'X-Request-ID': 'spoofed-private-request-id', 'User-Agent': 'private-agent', 'X-Forwarded-For': '192.0.2.123'
    } });
    assert.equal(response.status, 200); await response.text();
    assert.equal(records.length, 1); validate(records[0]); assert.equal(records[0].requestId, response.headers.get('x-request-id'));
    assert.equal(records[0].category, 'catalog'); assert.equal(records[0].outcome, 'completed');
    const write = await fetch(`${service.base}/api/v1/ingredients/huang-qi/note`, { method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: privateText, expectedRevision: 0 }) });
    assert.equal(write.status, 200); await write.text(); assert.equal(service.repo.note('huang-qi').text, privateText);
    assert.equal(records.length, 2); assert.notEqual(records[0].requestId, records[1].requestId); validate(records[1]);
    for (const secret of [privateText, token, 'private-cookie', 'private-csrf', 'spoofed-private-request-id', 'private-agent', '192.0.2.123', 'huang-qi', 'Authorization']) {
      assert.equal(JSON.stringify(records).includes(secret), false);
    }
  } finally { await service.close(); }
});

test('real 401, malformed 400, oversized 413, missing 404, internal 500 and readiness 503 are captured once', async () => {
  const records: RequestLogRecord[] = []; const service = await serve((record) => { records.push(record); });
  try {
    const cases: Array<[string, RequestInit, number]> = [
      ['/api/v1/summary', {}, 401],
      ['/api/v1/ingredients/x/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{secret-invalid-json' }, 400],
      ['/api/v1/ingredients/x/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'x'.repeat(9000) }) }, 413],
      ['/api/v1/not-found/private-path', { headers: { Authorization: `Bearer ${token}` } }, 404]
    ];
    for (const [path, init, status] of cases) {
      const response = await fetch(`${service.base}${path}`, init); assert.equal(response.status, status); await response.text();
      assert.equal(records.at(-1)?.status, status); assert.equal(records.at(-1)?.requestId, response.headers.get('x-request-id'));
    }
    service.repo.summary = () => { throw new Error('private-database-error'); };
    service.repo.publicSnapshot = () => { throw new Error('private-readiness-error'); };
    for (const [path, status] of [['/api/v1/summary', 500], ['/api/ready', 503]] as const) {
      const response = await fetch(`${service.base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, status); assert.equal((await response.text()).includes('private-'), false);
      assert.equal(records.at(-1)?.status, status);
    }
    assert.equal(records.length, 6); records.forEach(validate);
    assert.equal(JSON.stringify(records).includes('private-'), false); assert.equal(JSON.stringify(records).includes('secret-invalid-json'), false);
  } finally { await service.close(); }
});

test('diagnostic route buckets never contain identifiers and static requests are excluded', async () => {
  const records: RequestLogRecord[] = []; const service = await serve((record) => { records.push(record); });
  try {
    const paths = ['/api/health', '/api/ready', '/api/v1/public/catalog', '/api/v1/auth/config', '/api/v1/users/private-id',
      '/api/v1/editorial/assistant/private-id', '/api/v1/ingredients/private-id', '/api/v1/authentication-private-id'];
    for (const path of paths) { const response = await fetch(`${service.base}${path}`); await response.text(); }
    assert.deepEqual(records.map((record) => record.category), ['health', 'readiness', 'public', 'authentication', 'accounts', 'editorial', 'catalog', 'other']);
    const staticResponse = await fetch(`${service.base}/private-static-name?private-query=1`); await staticResponse.text();
    assert.equal(staticResponse.headers.has('x-request-id'), false); assert.equal(records.length, paths.length);
    assert.equal(JSON.stringify(records).includes('private-'), false);
  } finally { await service.close(); }
});

test('finish followed by close emits once and releases both observation listeners', () => {
  const records: RequestLogRecord[] = []; const response = Object.assign(new EventEmitter(), { statusCode: 409, writableFinished: true, setHeader() {} });
  let advanced = false;
  requestDiagnostics((record) => { records.push(record); })({ path: '/v1/ingredients/private', method: 'PUT' } as Request,
    response as unknown as Response, () => { advanced = true; });
  assert(advanced); response.emit('finish'); response.emit('close'); response.emit('finish');
  assert.equal(records.length, 1); assert.equal(records[0].status, 409); assert.equal(records[0].outcome, 'completed');
  assert.equal(response.listenerCount('finish'), 0); assert.equal(response.listenerCount('close'), 0);
});

test('real disconnected HTTP response is aborted, never reported as a successful 200', { timeout: 10000 }, async () => {
  const app = express(); const records: RequestLogRecord[] = [];
  let logged!: (record: RequestLogRecord) => void; let failed!: (error: Error) => void;
  const observed = new Promise<RequestLogRecord>((done, reject) => { logged = done; failed = reject; });
  app.use('/api', requestDiagnostics((record) => { records.push(record); logged(record); }));
  app.get('/api/pending', (_req, res) => { res.flushHeaders(); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/api/pending' }, (response) => { response.destroy(); });
    client.setTimeout(3000, () => client.destroy(new Error('Owned disconnect fixture timed out')));
    client.on('error', failed); client.end();
    const record = await observed; validate(record); assert.equal(record.outcome, 'aborted'); assert.equal(record.status, null); assert.equal(records.length, 1);
  } finally { const ended = once(server, 'close'); server.close(); await ended; }
});

test('unrecognized HTTP method is reduced to OTHER, not arbitrary caller text', () => {
  const records: RequestLogRecord[] = []; const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true, setHeader() {} });
  requestDiagnostics((record) => { records.push(record); })({ path: '/private', method: 'PRIVATE-METHOD' } as Request,
    response as unknown as Response, () => {}); response.emit('finish');
  assert.equal(records[0].method, 'OTHER'); assert.equal(JSON.stringify(records).includes('PRIVATE-METHOD'), false);
});

test('synchronous and asynchronous logging failures cannot break real requests', async () => {
  for (const sink of [() => { throw new Error('private-sink-error'); }, async () => { throw new Error('private-sink-error'); }]) {
    const service = await serve(sink);
    try { for (let n = 0; n < 2; n++) { const response = await fetch(`${service.base}/api/ready`); assert.equal(response.status, 200); await response.text(); } }
    finally { await service.close(); }
  }
});

test('embedded app without a sink still returns a server-generated request ID', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const server = createApp(repo, token).listen(0, '127.0.0.1'); await once(server, 'listening');
  try { const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`); assert.equal(response.status, 200); assert.match(response.headers.get('x-request-id')!, idPattern); await response.text(); }
  finally { const ended = once(server, 'close'); server.close(); await ended; repo.close(); }
});

const diagnosticId = '12345678-1234-4234-8234-123456789abc';
const diagnosticTime = '2026-10-09T06:00:00.000Z';
const diagnosticLog = (): RequestLogRecord => ({ event: 'api_request', timestamp: diagnosticTime, requestId: diagnosticId,
  category: 'authentication', method: 'POST', status: 200, durationMs: 100, outcome: 'completed' });
function diagnosticTimeline() {
  let time = 0;
  return { trace: new RequestTimeline(1, 1, '/api/v1/auth/login?private-query', 'POST', () => time, () => diagnosticTime),
    advance(value: number) { time = value; } };
}

test('HTTPS diagnostic projection rejects every extra field, malformed shape and unsafe scalar', () => {
  const log = diagnosticLog(); const accepted = safeRequestLog(JSON.stringify(log));
  assert.deepEqual(accepted, log); assert(Object.isFrozen(accepted));
  for (const change of [{ password: 'private' }, { cookie: 'private' }, { path: '/private' }, { error: 'private' },
    { requestId: 'private-id' }, { method: 'private-method' }, { category: 'private-category' },
    { timestamp: 'invalid' }, { timestamp: '2026-10-09' }, { durationMs: -1 }, { durationMs: 86400001 },
    { durationMs: '100' }, { status: null }, { status: 600 }, { status: 200.1 }, { event: 'private-event' },
    { outcome: 'unknown' }, { outcome: 'aborted', status: 200 }]) assert.equal(safeRequestLog(JSON.stringify({ ...log, ...change })), null);
  for (const text of ['null', '[]', '{', 'x'.repeat(4097), JSON.stringify({ ...log, timestamp: null })]) assert.equal(safeRequestLog(text), null);
  assert.equal(safeRequestLog(JSON.stringify({ ...log, status: null, outcome: 'aborted' }))?.outcome, 'aborted');
});

test('diagnostic stream tolerates chunk boundaries and CRLF but never archives raw output', () => {
  const collector = new RequestLogCollector(); const line = JSON.stringify(diagnosticLog());
  collector.push('private startup password\n'); collector.push(line.slice(0, 17)); collector.push(line.slice(17) + '\r\n');
  collector.push(JSON.stringify({ ...diagnosticLog(), secret: 'private' }) + '\n');
  collector.push(line); collector.end(); collector.end();
  assert.equal(collector.records.length, 2); assert.equal(collector.dropped, 0);
  assert.equal(JSON.stringify(collector.records).includes('private'), false);
});

test('diagnostic collector bounds both unfinished lines and accepted records and recovers after oversized input', () => {
  const collector = new RequestLogCollector(); const line = JSON.stringify(diagnosticLog());
  collector.push('x'.repeat(4097)); collector.push('private suffix\n' + line + '\n');
  assert.equal(collector.records.length, 1); assert.equal(collector.dropped, 1);
  collector.push((line + '\n').repeat(1024));
  assert.equal(collector.records.length, 1024); assert.equal(collector.dropped, 2);
});

test('HTTPS timeline distinguishes socket assignment, TCP, TLS, headers and body without extending the original timeout', () => {
  for (const phase of ['socket_assignment', 'tcp_connect', 'tls_handshake', 'response_headers', 'response_body', 'complete'] as const) {
    const { trace, advance } = diagnosticTimeline(); advance(10);
    if (phase !== 'socket_assignment') trace.socket(false, false, false);
    if (['tls_handshake', 'response_headers', 'response_body', 'complete'].includes(phase)) trace.mark('tcp');
    if (['response_headers', 'response_body', 'complete'].includes(phase)) trace.secure(true);
    if (['response_body', 'complete'].includes(phase)) trace.headers(200, diagnosticId);
    if (phase === 'complete') trace.mark('end');
    advance(3000);
    const result = trace.finish(phase === 'complete' ? 'completed' : 'timed_out', 'OWNED_REQUEST_TIMEOUT');
    assert.equal(result.phase, phase); assert.equal(result.timeoutKind, 'socket_inactivity'); assert.equal(result.timeoutMs, 3000);
    assert.equal(result.durationMs, 3000); assert.equal(result.errorCode, phase === 'complete' ? null : 'OWNED_REQUEST_TIMEOUT');
    assert.equal(JSON.stringify(result).includes('private-query'), false);
  }
});

test('verified reused sockets and flushed client writes do not imply fresh handshakes or server completion', () => {
  const { trace } = diagnosticTimeline(); trace.socket(true, true, true); trace.mark('flushed');
  const result = trace.finish('timed_out', 'OWNED_REQUEST_TIMEOUT');
  assert.equal(result.reusedSocket, true); assert.equal(result.tlsAuthorized, true);
  assert.equal(result.phase, 'response_headers'); assert.equal(result.requestId, null); assert.equal(result.status, null);
  const unverified = diagnosticTimeline().trace; unverified.socket(true, false, false); unverified.secure(false);
  assert.equal(unverified.finish('failed').phase, 'tls_handshake');
});

test('terminal diagnostic snapshots are frozen, idempotent and cannot store caller-controlled identifiers or error messages', () => {
  const { trace, advance } = diagnosticTimeline(); trace.socket(true, true, false); trace.headers(200, 'private-response-id');
  advance(10); const result = trace.finish('failed', 'private-error-password');
  advance(100); trace.headers(500, diagnosticId); trace.mark('end'); trace.secure(false);
  assert.strictEqual(trace.finish('completed'), result); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.milestones));
  assert.equal(result.durationMs, 10); assert.equal(result.requestId, null); assert.equal(result.errorCode, 'OTHER');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.throws(() => new RequestTimeline(0, 1, '/api/ready', 'GET'));
});

test('request ID correlation requires exactly one safe server record and never falls back silently', () => {
  const { trace } = diagnosticTimeline(); trace.headers(200, diagnosticId);
  const client = trace.finish('completed'); const log = diagnosticLog();
  assert.deepEqual(correlateRequest(client, [log]), { kind: 'request_id', candidates: [diagnosticId] });
  assert.equal(correlateRequest(client, [log, log]).kind, 'ambiguous');
  assert.equal(correlateRequest(client, [{ ...log, secret: 'private' } as RequestLogRecord]).kind, 'none');
  assert.equal(correlateRequest(client, []).kind, 'none');
});

test('headerless time-window candidates remain uncertain even when unique; differing method/category and nonoverlap are excluded', () => {
  const { trace, advance } = diagnosticTimeline(); advance(3000); const client = trace.finish('timed_out');
  const log = { ...diagnosticLog(), timestamp: '2026-10-09T06:00:03.100Z', durationMs: 3200 };
  assert.deepEqual(correlateRequest(client, [log]), { kind: 'time_window', candidates: [diagnosticId] });
  assert.equal(correlateRequest(client, [log, { ...log, requestId: '12345678-1234-4234-9234-123456789abc' }]).kind, 'ambiguous');
  for (const change of [{ method: 'GET' }, { category: 'health' }, { durationMs: 50 }, { timestamp: '2026-10-09T05:59:59.000Z' }]) {
    assert.equal(correlateRequest(client, [{ ...log, ...change } as RequestLogRecord]).kind, 'none');
  }
});

test('login SQL observation preserves results and explicit transactions without patching database prototypes', () => {
  const db = new DatabaseSync(':memory:'); const prepare = db.prepare;
  try {
    db.exec('CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL)');
    const observed = instrumentLoginDatabase(db); const facade = observed.database;
    facade.exec('BEGIN IMMEDIATE');
    const result = facade.prepare('INSERT INTO login_attempts (key, attempts, reset_at) VALUES (?, 1, ?)').run('private-ip-key', 100);
    assert.equal(result.changes, 1); facade.exec('COMMIT');
    assert.equal(facade.prepare('SELECT attempts FROM login_attempts WHERE key = ?').get('private-ip-key')?.attempts, 1);
    const report = observed.finish(); assert.equal(report.dropped, 0); assert.strictEqual(db.prepare, prepare);
    assert.equal(report.records.find((r) => r.stage === 'begin')?.explicitTransaction, false);
    assert.equal(report.records.find((r) => r.stage === 'limit_write' && r.operation === 'run')?.explicitTransaction, true);
    assert.equal(report.records.find((r) => r.stage === 'commit')?.explicitTransaction, true);
    assert.equal(report.records.find((r) => r.stage === 'limit_read' && r.operation === 'get')?.explicitTransaction, false);
    assert.equal(JSON.stringify(report).includes('private-ip-key'), false);
  } finally { db.close(); }
});

test('login SQL observation never serializes SQL, parameters, results or raw errors and preserves failures', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE private_fixture (private_column TEXT UNIQUE)');
    const observed = instrumentLoginDatabase(db);
    const statement = observed.database.prepare('INSERT INTO private_fixture (private_column) VALUES (?)');
    statement.run('private-password-cookie'); assert.throws(() => statement.run('private-password-cookie'));
    const report = observed.finish(); assert.equal(report.records.at(-1)?.failed, true); assert.equal(report.records.at(-1)?.stage, 'other');
    assert.equal(JSON.stringify(report).includes('private'), false);
    assert.deepEqual(Object.keys(report.records[0]).sort(), ['durationMs','endedMs','explicitTransaction','failed','operation','stage','startedMs']);
  } finally { db.close(); }
});

test('login SQL timing bounds storage and returns independent snapshots without changing database settings', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const before = db.prepare('PRAGMA synchronous').get(); const journal = db.prepare('PRAGMA journal_mode').get();
    let clock = 0; const observed = instrumentLoginDatabase(db, () => clock++);
    for (let n = 0; n < 70; n++) assert.equal(observed.database.prepare('SELECT 1 AS n').get()?.n, 1);
    const first = observed.finish(); assert.equal(first.records.length, 128); assert.equal(first.dropped, 12);
    assert(first.records.every((r) => r.durationMs === 1 && r.endedMs > r.startedMs));
    first.records[0].stage = 'commit'; assert.equal(observed.finish().records[0].stage, 'other');
    assert.deepEqual(db.prepare('PRAGMA synchronous').get(), before); assert.deepEqual(db.prepare('PRAGMA journal_mode').get(), journal);
  } finally { db.close(); }
});
