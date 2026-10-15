import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ciEnvironment } from '../tools/ci-core.js';
import { fixtureApplicationCompletion, fixtureApplicationWrapper } from '../tools/fixture-application.js';
import { assertNoLinks } from '../server/demo-secrets.js';

test('compiled account-mode service correlates real HTTP responses with minimal JSON stdout and stops gracefully', { timeout: 30000 }, async () => {
  assertNoLinks(resolve('.'));
  const local = resolve('.local'); if (!existsSync(local)) mkdirSync(local); assertNoLinks(local);
  const root = join(local, 'request-log-runs'); mkdirSync(root, { recursive: true }); assertNoLinks(root);
  const directory = mkdtempSync(join(root, 'run-')); assertNoLinks(directory);
  const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = (reservation.address() as AddressInfo).port; await new Promise<void>((done) => reservation.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...ciEnvironment(process.env, join(directory, 'fixture.sqlite')), PORT: String(port), ALLOWED_ORIGINS: base };
  const report = { startedAt: new Date().toISOString(), testedAt: '', kind: 'compiled-request-log', status: 'running',
    passed: 0, failed: 0, matchedApplicationRequests: 0, minimumReadinessRequests: 0, fixturesStopped: false,
    accountMode: true, sourceWorkingDatabaseModified: false, deploymentVerified: false, realModelCalls: 0,
    lifecycle: { listenerLoggedAt: null as string | null, readyAt: null as string | null,
      readinessExpiredAt: null as string | null, stopRequestedAt: null as string | null,
      exitedAt: null as string | null, exitCode: null as number | null, exitSignal: null as NodeJS.Signals | null,
      readinessProbes: 0, lastProbeStatus: null as number | null, lastProbeError: null as string | null,
      stderrPresent: false } };
  const persist = () => {
    const filename = join(directory, 'report.json'); assertNoLinks(filename);
    writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  };
  persist();
  const child = spawn(process.execPath, ['--input-type=module', '--eval', fixtureApplicationWrapper('server')], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let stdout = ''; let stderr = '';
  child.stdout!.on('data', (chunk) => {
    stdout += chunk;
    if (!report.lifecycle.listenerLoggedAt && stdout.includes('Workbench listener:')) report.lifecycle.listenerLoggedAt = new Date().toISOString();
  });
  child.stderr!.on('data', (chunk) => { stderr += chunk; report.lifecycle.stderrPresent = true; });
  const ended = fixtureApplicationCompletion(child).then((result) => {
    report.lifecycle.exitedAt = new Date().toISOString(); report.lifecycle.exitCode = result[0]; report.lifecycle.exitSignal = result[1];
    return result;
  });
  const ids: string[] = []; const statuses: number[] = [];
  const secret = 'private-runtime-secret-never-log';
  let stopped = false;
  try {
    try {
      let ready = false;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, 'Owned compiled service exited before readiness');
        report.lifecycle.readinessProbes++;
        try {
          const response = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(1000) });
          report.lifecycle.lastProbeStatus = response.status;
          await response.text(); if (response.status === 200) {
            ready = true; report.lifecycle.readyAt = new Date().toISOString(); report.minimumReadinessRequests = 1; break;
          }
        } catch (error) {
          const failure = error as { name?: string; cause?: { code?: string } };
          const category = failure.cause?.code || failure.name || '';
          report.lifecycle.lastProbeError = ['ECONNREFUSED', 'ECONNRESET', 'TimeoutError', 'AbortError'].includes(category) ? category : 'other';
          // Same live owned child, no restart; no raw error/URL enters evidence.
        }
        await delay(100);
      }
      if (!ready) report.lifecycle.readinessExpiredAt = new Date().toISOString();
      assert(ready, 'Owned compiled service did not become ready');
      for (const [path, init, expected] of [
        [`/api/health?private-query=${secret}`, { headers: { 'X-Request-ID': secret, Cookie: `session=${secret}` } }, 200],
        ['/api/v1/summary', { headers: { Authorization: `Bearer ${secret}` } }, 401],
        ['/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: `{${secret}` }, 400],
        ['/api/v1/auth/config', {}, 200]
      ] as Array<[string, RequestInit, number]>) {
        const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(3000) }); await response.text();
        assert.equal(response.status, expected); statuses.push(expected);
        const id = response.headers.get('x-request-id'); assert.match(id!, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/); ids.push(id!);
      }
    } finally {
      report.lifecycle.stopRequestedAt = new Date().toISOString();
      if (child.connected && child.exitCode === null && child.signalCode === null) child.send('test-stop');
      const [code, signal] = await ended;
      stopped = code === 0 && signal === null;
      report.fixturesStopped = stopped;
      assert(stopped, 'Owned compiled service did not stop gracefully');
    }
    const records = stdout.split(/\r?\n/).filter((line) => line.startsWith('{"event":"api_request"')).map((line) => JSON.parse(line));
    assert(records.length >= ids.length + 1, 'Readiness and application request logs are required');
    for (const [index, id] of ids.entries()) {
      const matches = records.filter((record) => record.requestId === id); assert.equal(matches.length, 1); assert.equal(matches[0].status, statuses[index]);
    }
    for (const record of records) {
      assert.deepEqual(Object.keys(record).sort(), ['category', 'durationMs', 'event', 'method', 'outcome', 'requestId', 'status', 'timestamp']);
      assert.equal(record.outcome, 'completed'); assert(Number.isFinite(record.durationMs) && record.durationMs >= 0);
    }
    assert.equal(`${stdout}${stderr}`.includes(secret), false);
    assert.equal(stdout.includes('Local editor key'), false);
    report.status = 'passed'; report.passed = 1; report.matchedApplicationRequests = ids.length;
  } finally {
    report.testedAt = new Date().toISOString();
    if (report.status !== 'passed') { report.status = 'failed'; report.failed = 1; }
    persist();
  }
  console.log(JSON.stringify({ kind: 'compiled-request-log', status: 'passed', report: join(directory, 'report.json'), fixturesStopped: stopped, deploymentVerified: false }));
});
