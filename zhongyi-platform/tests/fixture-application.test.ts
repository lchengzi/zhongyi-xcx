import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { fixtureApplicationCompletion, fixtureApplicationWrapper } from '../tools/fixture-application.js';

test('owned application completion observes exit without aggregate close but waits for both captured logs', async () => {
  // A protocol fixture, not a claim that a real OS process reproduced a stall.
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  let stdout = ''; let stderr = ''; let settled = false;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completion = fixtureApplicationCompletion(child as unknown as ChildProcess).then((result) => { settled = true; return result; });
  child.emit('exit', 0, null);
  await setImmediate(); assert.equal(settled, false);
  child.stdout.end('last stdout');
  await setImmediate(); assert.equal(settled, false);
  child.stderr.end('last stderr');
  assert.deepEqual(await completion, [0, null]);
  assert.equal(stdout, 'last stdout'); assert.equal(stderr, 'last stderr');
});

test('owned application completion preserves abnormal exit and rejects launch/log errors', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: null, stderr: null });
  const completion = fixtureApplicationCompletion(child as unknown as ChildProcess);
  child.emit('exit', 3, null); assert.deepEqual(await completion, [3, null]);
  const failed = Object.assign(new EventEmitter(), { stdout: null, stderr: null });
  const launch = fixtureApplicationCompletion(failed as unknown as ChildProcess);
  failed.emit('error', new Error('fixture launch failed')); await assert.rejects(launch, /fixture launch failed/);
  const broken = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: null });
  broken.stdout.resume();
  const logs = fixtureApplicationCompletion(broken as unknown as ChildProcess);
  broken.emit('exit', 0, null); broken.stdout.destroy(new Error('fixture log failed'));
  await assert.rejects(logs, /fixture log failed/);
});

test('real owned IPC child queues early cleanup, drains after readiness and exits gracefully after controller disconnect', async () => {
  for (const order of ['early', 'ready', 'disconnect'] as const) {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', fixtureApplicationWrapper('delayed-unit')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const phases: string[] = []; let stderr = '';
    child.stdout!.resume();
    child.stderr!.on('data', (value) => { stderr += value; });
    child.on('message', (value: any) => { if (typeof value?.phase === 'string') phases.push(value.phase); });
    const ended = fixtureApplicationCompletion(child);
    const phase = (name: string) => new Promise<void>((ready, reject) => {
      if (phases.includes(name)) { ready(); return; }
      const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('close', closed); };
      const message = () => { if (phases.includes(name)) { cleanup(); ready(); } };
      const closed = (code: number | null) => { cleanup(); reject(new Error(`Owned unit child exited before ${name}: ${code}; ${stderr}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Owned unit child did not report ${name}; ${stderr}`)); }, 15000);
      child.on('message', message); child.once('close', closed);
      if (child.exitCode !== null || child.signalCode !== null) closed(child.exitCode);
    });
    try {
      await phase('before-ready');
      if (order === 'disconnect') child.disconnect();
      else {
        if (order === 'early') child.send('test-stop');
        child.send('finish-loading');
        if (order === 'ready') { await phase('ready'); child.send('test-stop'); }
      }
      const [code, signal] = await ended; assert.equal(code, 0, stderr); assert.equal(signal, null);
      if (order !== 'disconnect') assert.deepEqual(phases, ['before-ready', 'ready', 'graceful-stop']);
      assert.equal(stderr, '');
    } finally {
      if (child.connected) { child.send('finish-loading'); child.send('test-stop'); }
      await ended;
    }
  }
});

test('fixture application launcher accepts only fixed test entrypoints and never exposes an HTTP shutdown or force-kill command', () => {
  for (const mode of ['server', 'container', 'delayed-unit'] as const) {
    const wrapper = fixtureApplicationWrapper(mode);
    assert(wrapper.includes('finally{loaded=true;drain();}'));
    assert.equal(/kill|shutdown\/|process\.exit\(/.test(wrapper), false);
  }
  for (const mode of ['', '../secrets', 'server; echo secret', '__proto__']) assert.throws(() => fixtureApplicationWrapper(mode as any));
});
