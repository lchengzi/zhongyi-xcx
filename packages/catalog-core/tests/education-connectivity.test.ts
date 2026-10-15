import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectivityStore, watchEducationConnectivity, type ConnectivityState } from '../src/index.js';
import { harness } from './education-client-harness.js';
import { educationFixture } from './education-fixture.js';

function connectionFixture() {
  let event = (_connected: boolean) => {};
  const store = createConnectivityStore({ async read() { return null; }, watch(listener) { event = listener; return () => {}; } });
  store.start();
  return { store, event: (value: boolean) => event(value) };
}

test('offline-first reading starts no request; one reconnect revalidates, duplicate events and manual reads deduplicate', async () => {
  const h = harness(), network = connectionFixture(); network.event(false);
  const stop = watchEducationConnectivity(h.client, network.store, () => true);
  await h.client.refresh(); assert.equal(h.calls.length, 0);
  network.event(true); assert.equal(h.calls.length, 1); network.event(true); assert.equal(h.calls.length, 1);
  const result = h.client.refresh(); h.call().resolve({ status: 200, body: educationFixture() }); await result;
  network.event(true); assert.equal(h.calls.length, 1);
  network.event(false); assert.equal(h.client.getSnapshot().status, 'stale'); network.event(true);
  assert.equal(h.calls.length, 2); h.call().resolve({ status: 404, body: {} }); await h.client.refresh();
  assert.equal(h.client.getSnapshot().document, null); assert.equal(h.client.getSnapshot().status, 'withdrawn'); stop();
});

test('hidden pages and revoked privacy/health ownership do not re-read on reconnect; a new explicit visit may read', async () => {
  const h = harness(), network = connectionFixture(); let visible = true, epoch = 0, visitEpoch = 0, urgent = false;
  const stop = watchEducationConnectivity(h.client, network.store, () => visible && epoch === visitEpoch && !urgent);
  const first = h.client.refresh(); visible = false; h.client.clear(h.client.getSnapshot().revision);
  network.event(false); network.event(true); assert.equal(h.calls.length, 1);
  h.call().resolve({ status: 200, body: educationFixture() }); await first; assert.equal(h.client.getSnapshot().document, null);
  visible = true; epoch++; network.event(false); network.event(true); assert.equal(h.calls.length, 1);
  visitEpoch = epoch; urgent = true; network.event(false); network.event(true); assert.equal(h.calls.length, 1);
  urgent = false; const explicit = h.client.refresh(); assert.equal(h.calls.length, 2);
  h.call().resolve({ status: 200, body: educationFixture() }); await explicit; stop();
});

test('offline through unknown still rechecks once when connected; unsubscribe invalidates queued callbacks', async () => {
  const h = harness(); let state: ConnectivityState = { revision: 0, status: 'offline' }; let callback = () => {};
  const port = { getSnapshot: () => state, subscribe(listener: () => void) { callback = listener; return () => {}; } };
  const emit = (status: ConnectivityState['status']) => { state = { revision: state.revision + 1, status }; callback(); };
  const stop = watchEducationConnectivity(h.client, port, () => true);
  emit('unknown'); assert.equal(h.calls.length, 0); emit('connected'); assert.equal(h.calls.length, 1);
  h.call().resolve({ status: 200, body: educationFixture() }); await h.client.refresh();
  stop(); emit('offline'); emit('connected'); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().status, 'ready');
});

test('guard failure, synchronous deletion or a newer disconnect prevents a reconnect request', () => {
  for (const fault of ['throw', 'clear', 'disconnect']) {
    const h = harness(), network = connectionFixture(); network.event(false);
    const stop = watchEducationConnectivity(h.client, network.store, () => {
      if (fault === 'throw') throw new Error('unavailable owner');
      if (fault === 'clear') h.client.clear(h.client.getSnapshot().revision);
      else network.event(false);
      return true;
    });
    network.event(true); assert.equal(h.calls.length, 0);
    if (fault === 'disconnect') assert.equal(h.client.getSnapshot().status, 'unavailable');
    stop();
  }
});
