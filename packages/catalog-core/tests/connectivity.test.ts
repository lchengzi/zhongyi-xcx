import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectivityStore } from '../src/index.js';

function fixture() {
  let listener = (_connected: boolean) => {}; let watchers = 0, removals = 0;
  const reads: ((value: boolean | null) => void)[] = [];
  const store = createConnectivityStore({ read: () => new Promise(resolve => reads.push(resolve)), watch(callback) { listener = callback; watchers++; return () => { removals++; }; } });
  return { store, event: (value: boolean) => listener(value), read(index: number, value: boolean | null) { const done = reads[index]; assert.ok(done); done(value); }, counts: () => ({ watchers, removals }) };
}

test('connection detection begins unknown; connected is distinct from service availability', async () => {
  const h = fixture(); assert.equal(h.store.getSnapshot().status, 'unknown'); const stop = h.store.start();
  h.read(0, true); await Promise.resolve(); assert.equal(h.store.getSnapshot().status, 'connected'); assert.ok(Object.isFrozen(h.store.getSnapshot()));
  h.event(false); assert.equal(h.store.getSnapshot().status, 'offline'); stop(); assert.equal(h.store.getSnapshot().status, 'unknown');
});
test('new network event wins over an older async initial read', async () => {
  const h = fixture(); const stop = h.store.start(); h.event(false); h.read(0, true); await Promise.resolve();
  assert.equal(h.store.getSnapshot().status, 'offline'); stop();
});
test('stop/restart invalidates old responses and duplicate start does not own the active monitor', async () => {
  const h = fixture(); const firstStop = h.store.start(); const duplicateStop = h.store.start(); duplicateStop();
  assert.deepEqual(h.counts(), { watchers: 1, removals: 0 }); firstStop(); const nextStop = h.store.start();
  h.read(0, false); await Promise.resolve(); assert.equal(h.store.getSnapshot().status, 'unknown');
  h.read(1, true); await Promise.resolve(); firstStop(); assert.equal(h.store.getSnapshot().status, 'connected');
  nextStop(); h.event(false); assert.equal(h.store.getSnapshot().status, 'unknown'); assert.deepEqual(h.counts(), { watchers: 2, removals: 2 });
});
test('failed detection is not treated as offline, and broken observers cannot prevent later updates', async () => {
  const failed = createConnectivityStore({ async read() { throw new Error('unavailable'); }, watch() { throw new Error('unavailable'); } });
  const stop = failed.start(); await Promise.resolve(); assert.equal(failed.getSnapshot().status, 'unknown'); stop();
  const h = fixture(); h.store.subscribe(() => { throw new Error('observer'); }); const end = h.store.start();
  h.event(false); assert.equal(h.store.getSnapshot().status, 'offline'); end();
});
