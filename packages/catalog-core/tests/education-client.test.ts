import assert from 'node:assert/strict';
import test from 'node:test';
import { createEducationClient } from '../src/index.js';
import { educationNow, educationBinding, educationFixture } from './education-fixture.js';
import { harness } from './education-client-harness.js';

test('known offline cancels before aborting, deduplicates notifications and blocks new requests', async () => {
  const h = harness(); const request = h.client.refresh();
  h.client.subscribe(() => { if (h.client.getSnapshot().error === 'network') void h.client.refresh(); });
  h.client.setConnectivity('offline');
  assert.equal((await request).status, 'unavailable'); assert.equal(h.call().aborted, true);
  assert.equal(h.calls.length, 1); assert.equal(h.timerCount(), 0);
  const offline = h.client.getSnapshot(); h.client.setConnectivity('offline');
  assert.equal(h.client.getSnapshot(), offline);
  await h.client.refresh(); assert.equal(h.calls.length, 1);
  h.call().resolve({ status: 200, body: educationFixture() }); await Promise.resolve();
  assert.equal(h.client.getSnapshot(), offline);
});

test('disconnect preserves only the existing unexpired cache lifetime, including while rechecking', async () => {
  const h = harness(); const first = h.client.refresh(); h.call().resolve({ status: 200, body: educationFixture() }); await first;
  const deadline = h.client.getSnapshot().expiresAt;
  h.tick(1000); const recheck = h.client.refresh(); h.client.setConnectivity('offline');
  const stale = await recheck; assert.equal(stale.status, 'stale'); assert.equal(stale.expiresAt, deadline);
  assert.equal(h.call().aborted, true); assert.ok(stale.document);
  h.tick(58_999); assert.ok(h.client.getSnapshot().document);
  await h.client.refresh(); assert.equal(h.client.getSnapshot().expiresAt, deadline);
  h.tick(1); assert.equal(h.client.getSnapshot().document, null); assert.equal(h.timerCount(), 0);
});

test('unknown and connected do not assert freshness or auto-read; disabled stays disabled', async () => {
  const h = harness(); h.client.setConnectivity('offline'); h.client.setConnectivity('unknown');
  assert.equal(h.calls.length, 0); assert.equal(h.client.getSnapshot().status, 'unavailable');
  const first = h.client.refresh(); h.client.setConnectivity('connected'); assert.equal(h.calls.length, 1);
  h.call().resolve({ status: 404, body: {} }); await first;
  h.client.setConnectivity('offline'); assert.equal(h.client.getSnapshot().document, null);
  const disabled = harness(null); const before = disabled.client.getSnapshot();
  disabled.client.setConnectivity('offline'); await disabled.client.refresh(); assert.equal(disabled.client.getSnapshot(), before);
  assert.equal(disabled.calls.length, 0);
});

test('anonymous request has only pinned public path, GET, Accept and timeout; in-flight refresh deduplicates', async () => {
  const h = harness(); const first = h.client.refresh();
  assert.equal(h.client.refresh(), first);
  assert.deepEqual(h.call().input, { url: 'https://content.example.test/api/v1/public/education/huang-qi', method: 'GET', header: { Accept: 'application/json' }, timeoutMs: 6000 });
  assert.ok(Object.isFrozen(h.call().input));
  h.call().resolve({ status: 200, body: educationFixture() });
  const state = await first; assert.equal(state.status, 'ready'); assert.ok(Object.isFrozen(state));
  assert.equal(state.document?.name, '黄芪');
  assert.equal(h.client.getSnapshot(), state);
  assert.equal(h.calls.length, 1);
});

test('disabled endpoint never requests; invalid origin and cache duration reject', async () => {
  const h = harness(null); assert.equal((await h.client.refresh()).status, 'disabled'); assert.equal(h.calls.length, 0);
  assert.throws(() => harness('http://untrusted.example.test'));
  assert.throws(() => createEducationClient({ origin: null, binding: educationBinding, now: () => educationNow, scheduler: { after: () => () => {} }, transport: { request: () => { throw new Error('unexpected'); } }, cacheTtlMs: Infinity }));
});

test('network failure may show only unexpired last document, and timer removes it without user action', async () => {
  const h = harness(); let updates = 0; h.client.subscribe(() => { updates++; });
  const first = h.client.refresh(); h.call().resolve({ status: 200, body: educationFixture() }); await first;
  h.tick(1000); const second = h.client.refresh(); h.call().reject();
  const stale = await second; assert.equal(stale.status, 'stale'); assert.equal(stale.error, 'network'); assert.ok(stale.document);
  h.tick(59_000); assert.equal(h.client.getSnapshot().document, null); assert.equal(h.client.getSnapshot().error, 'cache_expired');
  assert.ok(updates >= 5); assert.equal(h.timerCount(), 0);
});

test('source validity shortens the memory lifetime and an expired source cannot enter the cache', async () => {
  const h = harness(); const body = educationFixture(); const source = body.sources[0]; assert.ok(source);
  source.validUntil = new Date(educationNow + 2000).toISOString();
  const first = h.client.refresh(); h.call().resolve({ status: 200, body });
  assert.equal((await first).expiresAt, educationNow + 2000); h.tick(2000); assert.equal(h.client.getSnapshot().document, null);
  const second = h.client.refresh(); h.call().resolve({ status: 200, body });
  assert.equal((await second).error, 'source_expired'); assert.equal(h.client.getSnapshot().document, null);
});

test('withdrawal, frozen service and malformed response clear prior content rather than falling back to it', async () => {
  for (const response of [{ status: 404, body: {} }, { status: 503, body: {} }, { status: 401, body: {} }, { status: 200, body: { ...educationFixture(), reviews: ['private'] } }, { status: 200, body: { ...educationFixture(), baseReleaseId: 'wrong' } }]) {
    const h = harness(); const first = h.client.refresh(); h.call().resolve({ status: 200, body: educationFixture() }); await first;
    const second = h.client.refresh(); h.call().resolve(response); const state = await second;
    assert.equal(state.document, null); assert.equal(state.status, response.status === 404 ? 'withdrawn' : response.status === 200 ? 'incompatible' : 'unavailable');
    assert.equal(h.timerCount(), 0);
  }
});

test('timeout settles and aborts; a late success cannot restore the expired operation', async () => {
  const h = harness(); const first = h.client.refresh(); h.tick(6000);
  assert.equal((await first).error, 'timeout'); assert.equal(h.call().aborted, true);
  const cleared = h.client.getSnapshot(); h.call().resolve({ status: 200, body: educationFixture() }); await Promise.resolve();
  assert.equal(h.client.getSnapshot(), cleared);
});

test('privacy clear invalidates before abort, rejects stale confirmation, and ignores a late previous request', async () => {
  const h = harness(); const first = h.client.refresh(); const revision = h.client.getSnapshot().revision;
  assert.equal(h.client.clear(revision - 1), false); assert.equal(h.call().aborted, false);
  assert.equal(h.client.clear(revision), true); assert.equal((await first).status, 'idle'); assert.equal(h.call().aborted, true);
  const second = h.client.refresh(); h.call(0).resolve({ status: 200, body: educationFixture() }); await Promise.resolve();
  assert.equal(h.client.getSnapshot().status, 'loading'); assert.equal(h.client.getSnapshot().document, null);
  h.call(1).resolve({ status: 404, body: {} }); assert.equal((await second).status, 'withdrawn');
});

test('subscriber reentrancy may clear loading without starting the request; bad observers cannot prevent deletion', async () => {
  const h = harness(); h.client.subscribe(() => { throw new Error('observer'); });
  h.client.subscribe(() => { const current = h.client.getSnapshot(); if (current.status === 'loading') h.client.clear(current.revision); });
  assert.equal((await h.client.refresh()).status, 'idle'); assert.equal(h.calls.length, 0); assert.equal(h.timerCount(), 0);
});

test('clock rollback fails closed; approved rollback to an older snapshot is not rejected by snapshot ordering', async () => {
  const h = harness(); const first = h.client.refresh(); const next = { ...educationFixture(), snapshotVersion: 2 };
  h.call().resolve({ status: 200, body: next }); await first;
  const rollback = h.client.refresh(); h.call().resolve({ status: 200, body: educationFixture() });
  assert.equal((await rollback).document?.snapshotVersion, 1);
  const badClock = h.client.refresh(); h.setTime(educationNow - 1); h.call().resolve({ status: 200, body: next });
  assert.equal((await badClock).error, 'invalid_clock'); assert.equal(h.client.getSnapshot().document, null);
});
