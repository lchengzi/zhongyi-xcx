import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoClient, parsePublicPhotoGallery, publicPhotoUrl, type EducationTransport } from '../src/index.js';
const now = Date.parse('2026-10-13T00:00:00.000Z');
const binding = { ingredientId: 'huang-qi', name: '黄芪', baseReleaseId: 'test-release' };
const fixture = () => ({ schemaVersion: 'public-photo-gallery.1', ...binding, version: 1,
  publishedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 120000).toISOString(), photos: [{
    sha256: `sha256:${'a'.repeat(64)}`, width: 96, height: 48, bytes: 300, caption: '工程图，不作食材鉴定', part: '测试部位', processing: '测试形态', author: '工程测试',
    sourceUrl: 'https://example.test/fixture', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', modification: '仅验证工程流程' }] });
function harness(origin: string | null = 'https://photos.example.test') {
  let clock = now;
  const timers = new Map<() => void, number>();
  const calls: { resolve: (value: { status: number; body: unknown }) => void; reject: () => void; aborted: boolean; url: string }[] = [];
  const transport: EducationTransport = { request(input) {
    let resolve = (_value: { status: number; body: unknown }) => {}, reject = () => {};
    const promise = new Promise<{ status: number; body: unknown }>((done, fail) => { resolve = done; reject = () => fail(new Error('network')); });
    const call = { resolve, reject, aborted: false, url: input.url }; calls.push(call);
    return { promise, abort() { call.aborted = true; } };
  } };
  const client = createPhotoClient({ origin, binding, now: () => clock, transport, scheduler: { after(ms, callback) { timers.set(callback, clock + ms); return () => { timers.delete(callback); }; } } });
  return { client, calls, timers, tick(ms: number) { clock += ms; for (const [callback, deadline] of [...timers]) if (deadline <= clock) { timers.delete(callback); callback(); } } };
}
test('strict photo protocol keeps historical identity and rejects private fields, wrong releases and forged URLs', () => {
  const gallery = parsePublicPhotoGallery(fixture(), binding, now);
  assert(Object.isFrozen(gallery.photos[0]));
  assert.equal(publicPhotoUrl('https://photos.example.test', gallery, gallery.photos[0]!), `https://photos.example.test/api/v1/public/photos/huang-qi/1/${'a'.repeat(64)}.jpg`);
  for (const input of [{ ...fixture(), privateNotes: [] }, { ...fixture(), baseReleaseId: 'other' }, { ...fixture(), schemaVersion: 'public-photo-gallery.2' },
    { ...fixture(), validUntil: new Date(now).toISOString() }, { ...fixture(), photos: [] }, { ...fixture(), photos: [fixture().photos[0], fixture().photos[0]] }]) assert.throws(() => parsePublicPhotoGallery(input, binding, now));
  for (const patch of [{ sourceUrl: 'https://example.test@evil.test/image' }, { licenseUrl: 'https://evil.test' }, { src: 'file:///private.jpg' }, { sha256: '../private' }, { width: 9000 }, { publicationEligible: true }]) {
    assert.throws(() => parsePublicPhotoGallery({ ...fixture(), photos: [{ ...fixture().photos[0], ...patch }] }, binding, now));
  }
  assert.throws(() => publicPhotoUrl('http://photos.example.test', gallery, gallery.photos[0]!));
});
test('gallery request deduplicates; expiry removes photos and no data is persisted', async () => {
  const h = harness(); const first = h.client.refresh(); assert.equal(h.client.refresh(), first);
  assert.equal(h.calls[0]!.url, 'https://photos.example.test/api/v1/public/photos/huang-qi');
  h.calls[0]!.resolve({ status: 200, body: fixture() }); await first;
  assert.equal(h.client.getSnapshot().status, 'ready'); assert.equal(h.timers.size, 1);
  h.tick(60000); assert.equal(h.client.getSnapshot().gallery, null); assert.equal(h.timers.size, 0);
  assert.equal(h.client.getSnapshot().status, 'expired');
  assert.equal(h.calls.length, 1, 'expiry signalling alone does not retry the transport');
});
test('hide/delete clear aborts; late success cannot resurrect photos', async () => {
  const h = harness(), pending = h.client.refresh(); h.client.clear(); await pending;
  assert(h.calls[0]!.aborted); assert.equal(h.timers.size, 0);
  h.calls[0]!.resolve({ status: 200, body: fixture() }); await Promise.resolve();
  assert.equal(h.client.getSnapshot().status, 'idle'); assert.equal(h.client.getSnapshot().gallery, null);
});
test('withdrawal, malformed metadata, network failure and timeout remove prior photos', async () => {
  for (const mode of ['404', '410', 'invalid', 'network', 'timeout']) {
    const h = harness(); const first = h.client.refresh(); h.calls[0]!.resolve({ status: 200, body: fixture() }); await first;
    const second = h.client.refresh(); assert.equal(h.client.getSnapshot().gallery, null);
    if (mode === 'timeout') h.tick(6000);
    else if (mode === 'network') h.calls[1]!.reject();
    else h.calls[1]!.resolve({ status: mode === 'invalid' ? 200 : Number(mode), body: {} });
    await second; assert.equal(h.client.getSnapshot().gallery, null); assert.equal(h.timers.size, 0);
    assert.equal(h.client.getSnapshot().status, ['404', '410'].includes(mode) ? 'withdrawn' : 'unavailable');
  }
});
test('synchronous clear during notification prevents requests; disabled never reads', async () => {
  const h = harness(); h.client.subscribe(() => { if (h.client.getSnapshot().status === 'loading') h.client.clear(); });
  await h.client.refresh(); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
  const disabled = harness(null); await disabled.client.refresh(); assert.equal(disabled.calls.length, 0);
});
