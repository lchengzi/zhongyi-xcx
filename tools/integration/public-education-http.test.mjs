import assert from 'node:assert/strict';
import test from 'node:test';
import { createEducationClient } from '../../packages/catalog-core/src/education-client.ts';
import { createConnectivityStore } from '../../packages/catalog-core/src/connectivity.ts';
import { watchEducationConnectivity } from '../../packages/catalog-core/src/education-connectivity.ts';
import { sqlitePublicationHttpBackend, servePublicationHttpFixture } from '../../zhongyi-platform/tests/publication-http-fixture.ts';

// Local engineering fixture only. It runs the real HTTP routes and SQLite
// transactions, but simulated identities are NOT real professional approval.
// This routing adapter is never imported by the mini-program or production.
const origin = 'https://content.example.test';
const binding = Object.freeze({ ingredientId: 'huang-qi', name: '黄芪', baseReleaseId: 'release-test.1' });
function clientFor(server, expected = binding) {
  const requests = [];
  const client = createEducationClient({ origin, binding: expected, now: Date.now,
    scheduler: { after(ms, callback) { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } },
    transport: { request(input) {
      assert.deepEqual(input, { url: origin + '/api/v1/public/education/huang-qi', method: 'GET', header: { Accept: 'application/json' }, timeoutMs: 6000 });
      requests.push(input);
      const controller = new AbortController();
      const promise = fetch(server.root + '/public/education/huang-qi', { method: input.method, headers: input.header, signal: controller.signal, redirect: 'error', credentials: 'omit' })
        .then(async response => ({ status: response.status, body: await response.json() }));
      return { promise, abort: () => controller.abort() };
    } } });
  return { client, requests, clear: () => client.clear(client.getSnapshot().revision) };
}

test('TS client + real SQLite/HTTP: unpublished → publish → second revision → rollback → withdrawal → new approval/recovery', { timeout: 120_000 }, async () => {
  const server = await servePublicationHttpFixture(await sqlitePublicationHttpBackend(), 'sqlite', true);
  const connection = clientFor(server); const { client } = connection;
  try {
    const historicalCatalog = await (await server.anonymous('/public/catalog')).text();
    assert.equal((await client.refresh()).status, 'withdrawn'); // v1 404 also means not yet published.
    await server.control('resume'); const first = await server.snapshot(); await server.approve(first);
    assert.equal((await client.refresh()).document, null, 'Approval alone does not publish');
    await server.action(first);
    let state = await client.refresh(); assert.equal(state.status, 'ready'); assert.equal(state.document?.snapshotId, first.id);
    assert.equal(state.document?.baseReleaseId, binding.baseReleaseId);
    assert.equal('professionalReviews' in state.document, false);
    assert.equal('basis' in state.document, false);
    assert.equal('evidenceReference' in state.document.sources[0], false);
    await server.advance('ENGINEERING_SIMULATION_NOT_REAL：第二份测试正文。');
    assert.equal((await client.refresh()).document?.snapshotId, first.id, 'Editing and review cannot silently replace the published snapshot');
    const second = await server.snapshot(); await server.approve(second); await server.action(second);
    assert.equal((await client.refresh()).document?.snapshotId, second.id);
    await server.action(first, 'rollback');
    state = await client.refresh(); assert.equal(state.status, 'ready'); assert.equal(state.document?.snapshotVersion, 1);
    await server.action(first, 'withdraw'); state = await client.refresh(); assert.equal(state.status, 'withdrawn'); assert.equal(state.document, null);
    await server.approve(first); assert.equal((await client.refresh()).document, null, 'Reapproval alone cannot restore a withdrawn pointer');
    await server.action(first, 'rollback'); assert.equal((await client.refresh()).document?.snapshotId, first.id);
    await server.control('freeze'); assert.equal((await client.refresh()).document, null);
    await server.control('resume'); assert.equal((await client.refresh()).document, null, 'Unfreezing does not revive old approval');
    await server.approve(first); await server.action(first);
    assert.equal((await client.refresh()).document?.snapshotId, first.id);
    assert.equal(await (await server.anonymous('/public/catalog')).text(), historicalCatalog, 'Published education cannot rewrite the historical catalog or its safety domain');
    assert.deepEqual((await server.workspace()).events.map(event => event.action), ['publish', 'rollback', 'withdraw', 'rollback', 'publish', 'publish']);
    assert.ok(connection.requests.length >= 12);
  } finally { connection.clear(); await server.close(); }
});

test('TS client + real HTTP: wrong local release cannot accept published content; private catalog drift clears previous content', { timeout: 120_000 }, async () => {
  const server = await servePublicationHttpFixture(await sqlitePublicationHttpBackend(), 'sqlite', true);
  const connection = clientFor(server); const mismatched = clientFor(server, { ...binding, baseReleaseId: 'wrong-local-release' });
  try {
    await server.control('resume'); const fixed = await server.snapshot(); await server.approve(fixed); await server.action(fixed);
    assert.equal((await connection.client.refresh()).status, 'ready');
    const rejected = await mismatched.client.refresh(); assert.equal(rejected.status, 'incompatible'); assert.equal(rejected.error, 'identity_mismatch'); assert.equal(rejected.document, null);
    await server.corrupt('catalog', fixed.id);
    const unavailable = await connection.client.refresh(); assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.document, null);
    assert.equal(JSON.stringify(unavailable).includes('PRIVATE_UNTRUSTED_EDIT'), false);
  } finally { connection.clear(); mismatched.clear(); await server.close(); }
});

test('TS client + real HTTP: explicit publication default-off remains unavailable', { timeout: 120_000 }, async () => {
  const server = await servePublicationHttpFixture(await sqlitePublicationHttpBackend(), 'sqlite', false);
  const connection = clientFor(server);
  try {
    const state = await connection.client.refresh(); assert.equal(state.status, 'unavailable'); assert.equal(state.document, null);
  } finally { connection.clear(); await server.close(); }
});

test('TS reconnect + real SQLite/HTTP: known offline skips reads; reconnect observes withdrawal without extending old data', { timeout: 120_000 }, async () => {
  const server = await servePublicationHttpFixture(await sqlitePublicationHttpBackend(), 'sqlite', true);
  const connection = clientFor(server); const { client } = connection;
  let event = (_connected) => {};
  const network = createConnectivityStore({ async read() { return null; }, watch(listener) { event = listener; return () => {}; } });
  const stopNetwork = network.start(); event(false);
  const stop = watchEducationConnectivity(client, network, () => true);
  try {
    assert.equal((await client.refresh()).status, 'unavailable'); assert.equal(connection.requests.length, 0);
    event(true);
    assert.equal((await client.refresh()).status, 'withdrawn'); assert.equal(connection.requests.length, 1);
    await server.control('resume'); const fixed = await server.snapshot(); await server.approve(fixed); await server.action(fixed);
    const ready = await client.refresh(); assert.equal(ready.status, 'ready'); assert.equal(connection.requests.length, 2);
    event(false); const stale = client.getSnapshot();
    assert.equal(stale.status, 'stale'); assert.equal(stale.document?.snapshotId, fixed.id);
    assert.equal(stale.verifiedAt, ready.verifiedAt); assert.equal(stale.expiresAt, ready.expiresAt);
    await server.action(fixed, 'withdraw');
    await client.refresh(); assert.equal(connection.requests.length, 2, 'Offline reading must not contact the HTTP server');
    event(true); const withdrawn = await client.refresh();
    assert.equal(withdrawn.status, 'withdrawn'); assert.equal(withdrawn.document, null); assert.equal(connection.requests.length, 3);
    event(true); assert.equal(connection.requests.length, 3, 'Repeated connected events do not poll');
  } finally { stop(); stopNetwork(); connection.clear(); await server.close(); }
});
