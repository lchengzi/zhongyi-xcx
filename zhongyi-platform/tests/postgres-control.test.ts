import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForOwnedPostgresRestart, type RestartChannel } from '../tools/postgres-restart.js';
import { postgresTestPlan, publicationHttpProof, postgresPermissionsProof } from '../tools/postgres-test-plan.js';
import { postgresProof } from '../tools/ci-core.js';
import { join, resolve } from 'node:path';
import { postgresBrowserProof, postgresBrowserReportPath } from '../tools/postgres-test-plan.js';
import { postgresStartupFailure } from '../tools/postgres-readiness.js';
import { windowsPostgresStartArgs, postmasterIdentity, postgresPidLive } from '../tools/postgres-owned-process.js';

test('Windows pg_ctl uses restricted startup with quoted fixed arguments, rejecting shell syntax and relative paths', () => {
  const data = resolve('fixture path/data'), log = resolve('fixture path/server.log');
  const args = windowsPostgresStartArgs(data, log, ['-p', '5555', '-c', 'listen_addresses=127.0.0.1,::1']);
  assert.deepEqual(args.slice(0, 8), ['-D', data, '-l', log, '-w', '-t', '20', '-o']);
  assert.equal(args[8], '"-p" "5555" "-c" "listen_addresses=127.0.0.1,::1"'); assert.equal(args[9], 'start');
  for (const value of ['x&whoami', '%TEMP%', 'a|b', 'a"b', 'a\nb', 'a^b', 'a!b', 'a>b']) assert.throws(() => windowsPostgresStartArgs(data, log, [value]));
  assert.throws(() => windowsPostgresStartArgs('relative', log, []));
});

test('postmaster adoption binds a fresh positive PID, exact data directory, port and start time', () => {
  const data = resolve('owned-cluster/data'), startedAt = 1700000000999;
  const marker = `12345\n${data}\n1700000000\n5555\n`;
  assert.deepEqual(postmasterIdentity(marker, data, 5555, startedAt), { pid: 12345, dataDir: data, startedSeconds: 1700000000, port: 5555 });
  for (const bad of [marker.replace('12345', '0'), marker.replace('12345', '-12345'), marker.replace('12345', '12x'),
    marker.replace(data, resolve('other/data')), marker.replace('1700000000', '1699999999'), marker.replace('5555', '5556')]) {
    assert.throws(() => postmasterIdentity(bad, data, 5555, startedAt));
  }
});

test('owned process liveness treats only actual ESRCH as exit, never access denied or invalid identity', () => {
  assert.equal(postgresPidLive(12345, () => {}), true);
  assert.equal(postgresPidLive(12345, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); }), false);
  for (const code of ['EPERM', 'EACCES', 'UNKNOWN']) assert.throws(() => postgresPidLive(12345, () => { throw Object.assign(new Error(), { code }); }));
  for (const pid of [0, -1, 1, NaN, 1.2]) assert.throws(() => postgresPidLive(pid, () => {}));
});

test('startup diagnostics retain bounded fixture failure evidence but redact credentials, URLs and terminal controls', () => {
  const password = 'fixture-password-only'; const connection = `postgresql://fixture:${password}@localhost:9999/postgres`;
  const error = postgresStartupFailure('Fixture exited', `\u001b[31mFATAL: ${password} ${connection}\npostgres://other:secret@localhost/work\u0007\nend`, [password, connection, '']);
  assert.match(error.message, /FATAL:/); assert.match(error.message, /end$/);
  for (const forbidden of [password, connection, 'other:secret', '\u001b', '\u0007']) assert.equal(error.message.includes(forbidden), false);
  assert.equal(postgresStartupFailure('Fixture exited', '', []).message, 'Fixture exited (no server stderr)');
  assert.ok(postgresStartupFailure('Fixture exited', 'x'.repeat(10000), []).message.length < 1700);
});

test('PostgreSQL browser proof requires fresh JSON, matching console counts and no skip, flake or focused-only configuration', () => {
  const start = Date.now(); const end = start + 1000;
  const value = { config: { forbidOnly: true }, stats: { startTime: new Date(start).toISOString(), expected: 26, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] };
  assert.equal(postgresBrowserProof(value, '  26 passed (1m)\n', 0, start, end).passed, 26);
  for (const bad of [null, { ...value, config: { forbidOnly: false } }, { ...value, errors: [{}] },
    ...['skipped', 'flaky', 'unexpected'].map((key) => ({ ...value, stats: { ...value.stats, [key]: 1 } })),
    { ...value, stats: { ...value.stats, startTime: new Date(start - 1).toISOString() } }]) {
    assert.throws(() => postgresBrowserProof(bad, '26 passed', 0, start, end));
  }
  for (const output of ['', '25 passed', '27 passed']) assert.throws(() => postgresBrowserProof(value, output, 0, start, end));
  for (const code of [1, null]) assert.throws(() => postgresBrowserProof(value, '26 passed', code, start, end));
});

test('PostgreSQL browser evidence paths stay local, preserve CI-owned reports and default to this fresh cluster', () => {
  const root = resolve('controller-unit-only'); const directory = join(root, '.local', 'postgres-tests', 'cluster-ABC123');
  assert.equal(postgresBrowserReportPath(root, directory), join(directory, 'browser-results.json'));
  const ci = join(root, '.local', 'ci-runs', 'postgres-browser-unit', 'browser-results.json');
  assert.equal(postgresBrowserReportPath(root, directory, ci), ci);
  for (const path of [join(root, 'browser-results.json'), join(root, '.local', 'credentials.json'), '../browser-results.json']) {
    assert.throws(() => postgresBrowserReportPath(root, directory, path));
  }
  assert.throws(() => postgresBrowserReportPath(root, join(root, 'cluster-ABC123')));
  assert.throws(() => postgresBrowserReportPath(root, join(root, '.local', 'postgres-tests', 'not-a-cluster')));
  assert.deepEqual(postgresTestPlan(['--browser']).childArgs, ['node_modules/@playwright/test/cli.js', 'test']);
  const https = postgresTestPlan(['--https']);
  assert.equal(https.scope, 'compiled-https-postgres');
  assert.equal(https.reportPath, '.local/postgres-https-test-results.latest.json');
  assert.deepEqual(https.childArgs, ['--import', 'tsx', 'tools/test-https.ts', '--postgres']);
});

test('PostgreSQL controller selects only fixed scopes and keeps publication HTTP evidence separate from full CI', () => {
  const full = postgresTestPlan([]); const browser = postgresTestPlan(['--browser']); const publication = postgresTestPlan(['--publication-http']);
  assert.equal(full.scope, 'migration-api-and-recovery'); assert.equal(browser.scope, 'react-browser'); assert.equal(publication.scope, 'publication-http');
  assert.equal(new Set([full.reportPath, browser.reportPath, publication.reportPath]).size, 3);
  assert.deepEqual(publication.childArgs, ['--import', 'tsx', 'tests/postgres-publication-http.test.ts']);
  assert.equal(publication.childArgs.some((arg) => arg.includes('build/')), false);
  for (const args of [['--browser', '--publication-http'], ['--publication-http', '--publication-http'], ['--test', '../private.ts'], ['../private.ts'], ['--publication']]) {
    assert.throws(() => postgresTestPlan(args));
  }
  const now = Date.now();
  assert.throws(() => postgresProof({ testedAt: new Date(now).toISOString(), engine: 'real-postgresql', status: 'passed', fixtureStopped: true,
    sourceWorkingDatabaseModified: false, passed: 7, failed: 0, scope: publication.scope, restarts: 0 }, now - 1, now + 1));
});

test('publication HTTP proof requires the complete seven-case TAP result and rejects skips, cancellation or failed exits', () => {
  const tap = (total = 7, pass = 7, fail = 0, skipped = 0, cancelled = 0) =>
    `# tests ${total}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo 0\n`;
  assert.deepEqual(publicationHttpProof(tap(), 0), { passed: 7, failed: 0, skipped: 0, cancelled: 0 });
  for (const output of ['', '# pass 7\n# fail 0\n', tap(6, 6), tap(8, 8), tap(7, 6, 1), tap(7, 6, 0, 1), tap(7, 6, 0, 0, 1)]) {
    assert.throws(() => publicationHttpProof(output, 0));
  }
  for (const code of [1, null]) assert.throws(() => publicationHttpProof(tap(), code));
});

test('runtime permission verification has a fixed independent thirteen-case proof, never substitutes for full recovery CI', () => {
  const plan = postgresTestPlan(['--permissions']);
  assert.equal(plan.scope, 'runtime-role-separation');
  assert.equal(plan.reportPath, '.local/postgres-permissions-test-results.latest.json');
  assert.deepEqual(plan.childArgs, ['--import', 'tsx', 'tests/postgres-permissions.test.ts']);
  const tap = (total = 13, skipped = 0, cancelled = 0) => `# tests ${total}\n# pass ${total}\n# fail 0\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo 0\n`;
  assert.equal(postgresPermissionsProof(tap(), 0).passed, 13);
  for (const output of ['', tap(12), tap(14), tap(13, 1), tap(13, 0, 1)]) assert.throws(() => postgresPermissionsProof(output, 0));
  for (const code of [1, null]) assert.throws(() => postgresPermissionsProof(tap(), code));
  const now = Date.now();
  assert.throws(() => postgresProof({ testedAt: new Date(now).toISOString(), engine: 'real-postgresql', status: 'passed', fixtureStopped: true,
    sourceWorkingDatabaseModified: false, passed: 12, failed: 0, scope: plan.scope, restarts: 0 }, now - 1, now + 1));
});

// Protocol unit fixture, NOT evidence that a real database has restarted.
function fixture() {
  let live = true; let message: (value: unknown) => void = () => {}; let disconnect = () => {}; let tick = () => {};
  let error: Error | null = null; let subscribed = false; let observing = false; let observations = 0;
  const sent: Parameters<RestartChannel['send']>[0][] = [];
  const channel: RestartChannel = {
    connected: () => live,
    subscribe: (onMessage, onDisconnect) => { message = onMessage; disconnect = onDisconnect; subscribed = true; return () => { subscribed = false; }; },
    send: (request, failed) => { sent.push(request); failed(error); }
  };
  const nonce = 'a'.repeat(32);
  return { channel, nonce, sent,
    options: { observe: (callback: () => void) => { tick = callback; observing = true; return () => { observing = false; }; }, report: () => { observations += 1; } },
    tick: () => tick(), message: (value: unknown) => message(value), disconnect: () => { live = false; disconnect(); },
    setDisconnected: () => { live = false; }, setSendError: () => { error = new Error('private detail must not escape'); },
    state: () => ({ live, subscribed, observing, observations }) };
}

test('restart observation keeps one request pending across intervals and ignores unrelated or unauthenticated replies', async () => {
  const f = fixture(); let outcome = 'pending';
  const waiting = waitForOwnedPostgresRestart(f.channel, f.nonce, f.options).then(() => { outcome = 'resolved'; });
  assert.equal(f.sent.length, 1); const request = f.sent[0];
  for (let i = 0; i < 1000; i++) f.tick();
  for (const value of [null, { id: request.id, ok: true }, { id: request.id, nonce: 'wrong', ok: true },
    { id: 'another-request', nonce: f.nonce, ok: true }, { ...request, ok: 'true' }]) f.message(value);
  await Promise.resolve(); assert.equal(outcome, 'pending'); assert.equal(f.sent.length, 1);
  assert.deepEqual(f.state(), { live: true, subscribed: true, observing: true, observations: 1000 });
  f.message({ id: request.id, nonce: f.nonce, ok: true }); await waiting;
  assert.equal(outcome, 'resolved'); assert.equal(f.state().subscribed, false); assert.equal(f.state().observing, false);
});

test('restart protocol fails on an actual disconnect, delivery failure or authenticated failure without retrying', async () => {
  for (const kind of ['disconnect', 'delivery', 'negative'] as const) {
    const f = fixture(); if (kind === 'delivery') f.setSendError();
    const waiting = waitForOwnedPostgresRestart(f.channel, f.nonce, f.options);
    if (kind === 'disconnect') f.disconnect();
    if (kind === 'negative') f.message({ ...f.sent[0], ok: false, message: 'private detail must not escape' });
    await assert.rejects(waiting, (e: Error) => /Owned PostgreSQL/.test(e.message) && !e.message.includes('private detail'));
    assert.equal(f.sent.length, 1); assert.equal(f.state().subscribed, false); assert.equal(f.state().observing, false);
  }
});

test('restart protocol refuses a missing live IPC controller or invalid nonce before sending any request', async () => {
  const f = fixture(); f.setDisconnected();
  await assert.rejects(waitForOwnedPostgresRestart(f.channel, f.nonce, f.options), /not connected/);
  for (const nonce of ['', 'secret', 'g'.repeat(32), 'a'.repeat(31)]) await assert.rejects(waitForOwnedPostgresRestart(f.channel, nonce, f.options), /verified live/);
  assert.equal(f.sent.length, 0); assert.equal(f.state().subscribed, false); assert.equal(f.state().observing, false);
});
