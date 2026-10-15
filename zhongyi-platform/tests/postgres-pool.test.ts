import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter, errorMonitor, once } from 'node:events';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { poolClientShutdownBarrier, OwnedPostgresPool } from '../server/postgres-pool.js';
import { createPostgresPool } from '../server/postgres-migration.js';

test('pool shutdown waits for actual client end after upstream bookkeeping has finished', async () => {
  const barrier = poolClientShutdownBarrier(); const one = new EventEmitter(); const two = new EventEmitter();
  barrier.connected(one); barrier.connected(two); barrier.connected(one);
  let poolClosed = false; let settled = false;
  const closing = barrier.drain(async () => { poolClosed = true; }).then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(poolClosed, true); assert.equal(settled, false);
  one.emit('end'); await Promise.resolve(); assert.equal(settled, false);
  two.emit('end'); await closing; assert.equal(settled, true);
  assert.equal(one.listenerCount('end'), 0); assert.equal(two.listenerCount('end'), 0);
});

test('shutdown includes a connection acquired during upstream draining; already ended clients do not hang', async () => {
  const barrier = poolClientShutdownBarrier(); const old = new EventEmitter(); const late = new EventEmitter();
  barrier.connected(old); old.emit('end'); let settled = false;
  const closing = barrier.drain(async () => { barrier.connected(late); }).then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  late.emit('end'); await closing; assert.equal(settled, true);
  await barrier.drain(async () => {});
});

test('closing retains only owned sockets, including a late connection, without changing normal idle behavior', async () => {
  const barrier = poolClientShutdownBarrier(); let retained = 0;
  const one = Object.assign(new EventEmitter(), { ref() { retained++; } });
  const late = Object.assign(new EventEmitter(), { ref() { retained++; } });
  barrier.connected(one); assert.equal(retained, 0);
  const closing = barrier.drain(async () => { barrier.connected(late); });
  assert.equal(retained, 2); one.emit('end'); late.emit('end'); await closing;
});

test('shutdown does not consume connection errors or replace upstream failure', async () => {
  const barrier = poolClientShutdownBarrier(); const client = new EventEmitter(); barrier.connected(client);
  const failure = new Error('engineering-only shutdown failure');
  assert.equal(client.listenerCount('error'), 0); assert.equal(client.listenerCount(errorMonitor), 0);
  assert.throws(() => client.emit('error', failure), error => error === failure);
  await assert.rejects(barrier.drain(async () => { throw failure; }), error => error === failure);
  client.emit('end'); await barrier.drain(async () => {});
});

test('actual factory and callback close use the owned lifecycle without opening a connection', async () => {
  const pool = createPostgresPool('postgresql://fixture:unused@localhost/not-opened');
  assert(pool instanceof OwnedPostgresPool); assert.equal(pool.totalCount, 0);
  await pool.end(); await assert.rejects(pool.end(), /more than once/);
  const callbackPool = new OwnedPostgresPool({});
  await new Promise<void>(resolve => callbackPool.end(resolve)); assert.equal(callbackPool.ended, true);
});

// A deliberately minimal local protocol fixture, NOT a real PostgreSQL engine.
// It allows the installed pg driver/pool to finish its bookkeeping while the
// TCP peer delays acknowledging Terminate; no SQL, TLS or recovery is claimed.
async function delayedWirePeer() {
  let socket: Socket | undefined; let complete: () => void = () => {};
  const terminated = new Promise<void>(resolve => { complete = resolve; });
  const server = createServer({ allowHalfOpen: true }, peer => {
    socket = peer; let ready = false; let buffered = Buffer.alloc(0);
    peer.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!ready && buffered.length >= 4 && buffered.length >= buffered.readUInt32BE(0)) {
        const size = buffered.readUInt32BE(0); buffered = buffered.subarray(size); ready = true;
        peer.write(Buffer.from('5200000008000000004b0000000c0000007b000001c85a0000000549', 'hex'));
      }
      if (ready && buffered.length >= 5 && buffered[0] === 0x58) complete();
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: (server.address() as AddressInfo).port, terminated,
    finish: () => socket?.end(),
    async close() {
      socket?.end(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

test('installed pg-pool resolves upstream end before TCP driver end; owned pool closes that reproducible interval', async () => {
  for (const owned of [false, true]) {
    const peer = await delayedWirePeer();
    const options = { host: '127.0.0.1', port: peer.port, user: 'protocol_fixture', database: 'not_a_real_database', ssl: false };
    const pool = owned ? new OwnedPostgresPool(options) : new Pool(options);
    let driverEnded = false; let closeReturned = false; let closing: Promise<void> | undefined;
    try {
      const client = await pool.connect(); client.once('end', () => { driverEnded = true; }); client.release();
      closing = pool.end().then(() => { closeReturned = true; });
      await peer.terminated; await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(driverEnded, false);
      assert.equal(closeReturned, !owned, 'The unmodified dependency must reproduce its early return, while our pool stays pending.');
      peer.finish(); await closing;
      if (owned) assert.equal(driverEnded, true);
    } finally {
      peer.finish(); if (closing) await closing; else await pool.end(); await peer.close();
    }
  }
});

test('allowExitOnIdle child stays alive until its final owned connection actually ends', async () => {
  const peer = await delayedWirePeer();
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { OwnedPostgresPool } from './server/postgres-pool.ts';
    const pool = new OwnedPostgresPool({host:'127.0.0.1',port:${peer.port},user:'protocol_fixture',database:'not_a_real_database',ssl:false,allowExitOnIdle:true});
    const client = await pool.connect(); client.release();
    const closing = pool.end(); console.log('draining');
    await closing; console.log('driver-ended');
  `], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(child, 'close');
  try {
    await peer.terminated;
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    assert.equal(child.exitCode, null, 'Awaited socket shutdown must keep the child alive without an artificial keepalive timer.');
    peer.finish(); const [code, signal] = await exited;
    assert.equal(code, 0, errors); assert.equal(signal, null); assert.match(output, /draining\s+driver-ended/);
  } finally { peer.finish(); await exited; await peer.close(); }
});
