import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { observePostgresConnection, parsePostgresConnectionTrace, postgresConnectionDiagnostics, type PostgresConnectionTrace } from '../server/postgres-connection-diagnostics.js';
import { withOwnedPoolClient } from '../tools/https-postgres-fixture.js';

function fixture() {
  const connection = Object.assign(new EventEmitter(), { stream: new PassThrough() });
  const client = Object.assign(new EventEmitter(), { connection });
  let time = 100;
  const traces: PostgresConnectionTrace[] = [];
  observePostgresConnection(client, trace => traces.push(trace), () => time);
  const at = (value: number) => { time = 100 + value; };
  return { connection, client, at, traces };
}

test('database trace distinguishes TLS start, handshake completion, authentication and ready', () => {
  const f = fixture();
  f.at(1); f.connection.stream.emit('lookup');
  f.at(2); f.connection.emit('connect');
  f.at(3); f.connection.emit('sslconnect');
  f.at(4); f.connection.stream.emit('secureConnect');
  f.at(5); f.connection.emit('authenticationSASL', { password: 'never-retain-password' });
  f.at(6); f.client.emit('connect');
  assert.equal(f.traces.length, 1);
  assert.deepEqual(f.traces[0].phases, { created: 0, dns: 1, tcp: 2, tls_start: 3, tls_ready: 4, authentication: 5, ready: 6 });
  assert.equal(f.traces[0].outcome, 'ready'); assert.equal(f.traces[0].code, null);
  assert.doesNotMatch(JSON.stringify(f.traces), /password|localhost|SELECT/);
  assert.equal(f.connection.listenerCount('error'), 0);
  assert.equal(f.connection.listenerCount('end'), 0);
  f.at(50); f.connection.emit('end'); assert.equal(f.traces.length, 1);
  assert.deepEqual(parsePostgresConnectionTrace(f.traces[0]), f.traces[0]);
});

test('connection close during TLS retains the last completed phase and a fixed reason, not raw errors', () => {
  const f = fixture();
  f.at(1); f.connection.emit('connect');
  f.at(2); f.connection.emit('sslconnect');
  f.at(5000); f.connection.emit('end');
  assert.equal(f.traces.length, 1);
  assert.equal(f.traces[0].outcome, 'failed'); assert.equal(f.traces[0].code, 'connection_closed');
  assert.equal(f.traces[0].durationMs, 5000);
  assert.equal(f.traces[0].phases.tls_ready, undefined);
  assert.equal(f.traces[0].phases.authentication, undefined);
  assert.equal(f.connection.stream.listenerCount('secureConnect'), 0);
});

test('known error codes survive while private messages, connection strings and arbitrary codes do not', () => {
  for (const [code, expected] of [['ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_ALTNAME_INVALID'],
    ['28P01', '28P01'], ['postgres://user:secret@private-host/database', 'other']] as const) {
    const f = fixture(); f.at(7);
    f.connection.emit('error', { code, message: 'password=never-retain-password SELECT private', query: 'PRIVATE_SQL' });
    assert.equal(f.traces[0].code, expected);
    assert.doesNotMatch(JSON.stringify(f.traces), /secret|password|private|PRIVATE_SQL/);
  }
});

test('diagnostics publisher failures cannot change driver outcomes; non-TLS connections are not claimed as TLS', () => {
  const connection = Object.assign(new EventEmitter(), { stream: new PassThrough() });
  const client = Object.assign(new EventEmitter(), { connection });
  observePostgresConnection(client, () => { throw new Error('observer failure'); });
  assert.doesNotThrow(() => client.emit('connect'));
  const f = fixture(); f.connection.emit('connect'); f.client.emit('connect');
  assert.equal(f.traces[0].phases.tls_start, undefined);
  assert.equal(f.traces[0].phases.tls_ready, undefined);
});

test('retained trace parser rejects extra fields, raw payloads, invalid timings and incomplete outcomes', () => {
  const f = fixture(); f.at(2); f.client.emit('connect'); const valid = f.traces[0];
  for (const invalid of [null, [], { ...valid, password: 'do-not-retain' }, { ...valid, code: 'raw-private-error' },
    { ...valid, connection: 0 }, { ...valid, durationMs: NaN }, { ...valid, durationMs: -1 },
    { ...valid, startedAt: 'private-database-password' },
    { ...valid, phases: { created: 0, ready: 50 } }, { ...valid, phases: { created: 0, query: 1 } },
    { ...valid, phases: { created: 0 } }, { ...valid, outcome: 'failed', code: null }]) {
    assert.equal(parsePostgresConnectionTrace(invalid), null);
  }
});

test('retained traces are immutable and bounded; overflow is counted explicitly', () => {
  const before = postgresConnectionDiagnostics();
  for (let i = 0; i < 260; i++) { const f = fixture(); f.client.emit('connect'); }
  const after = postgresConnectionDiagnostics();
  assert.equal(after.traces.length, 256);
  assert.equal(after.dropped - before.dropped, before.traces.length + 4);
  assert.ok(Object.isFrozen(after)); assert.ok(Object.isFrozen(after.traces));
  assert.ok(Object.isFrozen(after.traces[0].phases));
});

test('failed fixture acquisition closes its owned pool without running or retrying writes', async () => {
  let connects = 0; let closes = 0; let writes = 0;
  const failure = new Error('fixture connection failed');
  const pool = { async connect(): Promise<{ release(): void }> { connects++; throw failure; }, async end() { closes++; } };
  await assert.rejects(withOwnedPoolClient(pool, async () => { writes++; }), error => error === failure);
  assert.equal(connects, 1); assert.equal(closes, 1); assert.equal(writes, 0);
});

test('fixture work releases and closes once on success or failure, preserving the original outcome', async () => {
  for (const fail of [false, true]) {
    let releases = 0; let closes = 0; let calls = 0;
    const pool = { async connect() { return { release() { releases++; } }; }, async end() { closes++; } };
    const failure = new Error('work failed');
    const result = withOwnedPoolClient(pool, async () => { calls++; if (fail) throw failure; return 'committed'; });
    if (fail) await assert.rejects(result, error => error === failure);
    else assert.equal(await result, 'committed');
    assert.equal(releases, 1); assert.equal(closes, 1); assert.equal(calls, 1);
  }
});
