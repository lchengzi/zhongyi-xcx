import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoBatchClient, parsePublicPhotoBatch, type EducationBinding, type EducationTransport } from '../src/index.js';
const start = Date.parse('2026-10-13T00:00:00.000Z');
const bindings = (count: number): EducationBinding[] => Array.from({ length: count }, (_, index) => ({ ingredientId: `item-${index}`, name: `工程条目 ${index}`, baseReleaseId: 'fixture-release' }));
const gallery = (binding: EducationBinding, expires = start + 120000) => ({ schemaVersion: 'public-photo-gallery.1', ...binding, version: 1,
  publishedAt: new Date(start - 1000).toISOString(), validUntil: new Date(expires).toISOString(), photos: [{ sha256: `sha256:${'a'.repeat(64)}`, width: 96, height: 48, bytes: 300,
    caption: '工程色块，非食材照片', part: '测试部位', processing: '测试形态', author: '工程测试', sourceUrl: 'https://example.test/photo', license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', modification: '工程验证' }] });
const batch = (items: readonly EducationBinding[], photos = items.map(item => gallery(item))) => ({ schemaVersion: 'public-photo-batch.1', baseReleaseId: 'fixture-release', requestedIds: items.map(item => item.ingredientId), galleries: photos });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(origin: string | null = 'https://photos.example.test') {
  let clock = start, maxActive = 0;
  const timers = new Map<() => void, number>();
  const calls: { url: string; aborted: boolean; settled: boolean; resolve(value: { status: number; body: unknown }): void; reject(): void }[] = [];
  const transport: EducationTransport = { request(input) {
    assert.deepEqual(Object.keys(input).sort(), ['header', 'method', 'timeoutMs', 'url']); assert.deepEqual(input.header, { Accept: 'application/json' }); assert.equal(input.method, 'GET');
    let done = (_value: { status: number; body: unknown }) => {}, fail = () => {};
    const promise = new Promise<{ status: number; body: unknown }>((resolve, reject) => { done = resolve; fail = () => reject(new Error('network')); });
    const call = { url: input.url, aborted: false, settled: false, resolve(value: { status: number; body: unknown }) { call.settled = true; done(value); }, reject() { call.settled = true; fail(); } };
    calls.push(call); maxActive = Math.max(maxActive, calls.filter(item => !item.aborted && !item.settled).length);
    return { promise, abort() { call.aborted = true; } };
  } };
  const client = createPhotoBatchClient({ origin, now: () => clock, transport, scheduler: { after(ms, callback) { timers.set(callback, clock + ms); return () => { timers.delete(callback); }; } } });
  return { client, calls, timers, maxActive: () => maxActive, setClock(value: number) { clock = value; },
    tick(ms: number) { clock += ms; for (const [callback, deadline] of [...timers]) if (deadline <= clock) { timers.delete(callback); callback(); } } };
}
test('batch schema pins exact requested identities/release and rejects unknown, duplicate, private and cross-batch galleries', () => {
  const items = bindings(2); assert.equal(parsePublicPhotoBatch(batch(items), items, start).length, 2);
  assert(Object.isFrozen(parsePublicPhotoBatch(batch(items), items, start))); assert.equal(parsePublicPhotoBatch(batch(items, []), items, start).length, 0);
  for (const value of [{ ...batch(items), privateNotes: [] }, { ...batch(items), requestedIds: ['item-1', 'item-0'] }, { ...batch(items), baseReleaseId: 'other' },
    { ...batch(items), galleries: [gallery(items[0]!), gallery(items[0]!)] }, { ...batch(items), galleries: [gallery(bindings(3)[2]!)] },
    { ...batch(items), galleries: [{ ...gallery(items[0]!), privateReview: true }] }]) assert.throws(() => parsePublicPhotoBatch(value, items, start));
  assert.throws(() => parsePublicPhotoBatch(batch(bindings(13)), bindings(13), start));
});
test('36 cards use three batches with two in flight; repeated refresh shares the pending promise', async () => {
  const f = harness(), items = bindings(36), pending = f.client.refresh(items);
  assert.equal(f.client.refresh(items), pending); assert.equal(f.calls.length, 2);
  f.calls[0]!.resolve({ status: 200, body: batch(items.slice(0, 12)) }); await flush(); assert.equal(f.calls.length, 3);
  f.calls[2]!.resolve({ status: 200, body: batch(items.slice(24)) }); f.calls[1]!.resolve({ status: 200, body: batch(items.slice(12, 24)) }); await pending;
  assert.equal(f.maxActive(), 2); assert.equal(Object.keys(f.client.getSnapshot().galleries).length, 36); assert(Object.isFrozen(f.client.getSnapshot().galleries));
  for (const call of f.calls) { assert(!call.url.includes('?')); assert.equal(call.url.split('/batch/')[1]!.split(',').length, 12); }
});
test('load more retains verified photos and reads only new identities without extending existing expiry', async () => {
  const f = harness(), items = bindings(24), first = f.client.refresh(items.slice(0, 12));
  f.calls[0]!.resolve({ status: 200, body: batch(items.slice(0, 12)) }); await first; f.tick(10000);
  const more = f.client.refresh(items); assert.equal(f.calls.length, 2); assert.equal(Object.keys(f.client.getSnapshot().galleries).length, 12);
  f.calls[1]!.resolve({ status: 200, body: batch(items.slice(12)) }); await more;
  f.tick(49999); assert.equal(Object.keys(f.client.getSnapshot().galleries).length, 24);
  f.tick(1); assert.equal(f.client.getSnapshot().status, 'expired'); assert.equal(Object.keys(f.client.getSnapshot().galleries).length, 12);
});
test('changed search cancels old batches before new reads; late callbacks cannot revive dropped cards', async () => {
  const f = harness(), items = bindings(25), old = f.client.refresh(items.slice(0, 24));
  const latest = f.client.refresh([items[24]!]); assert(f.calls[0]!.aborted && f.calls[1]!.aborted); await old;
  f.calls[0]!.resolve({ status: 200, body: batch(items.slice(0, 12)) }); f.calls[1]!.resolve({ status: 200, body: batch(items.slice(12, 24)) });
  f.calls[2]!.resolve({ status: 200, body: batch([items[24]!]) }); await latest;
  assert.deepEqual(Object.keys(f.client.getSnapshot().galleries), ['item-24']); assert.equal(f.maxActive(), 2);
  f.client.clear(); assert.deepEqual(f.client.getSnapshot().galleries, {}); assert.equal(f.timers.size, 0);
});
test('forced verification and omitted withdrawn items immediately drop old images; expiry obeys the shortest approval', async () => {
  const f = harness(), items = bindings(1), first = f.client.refresh(items);
  f.calls[0]!.resolve({ status: 200, body: batch(items, [gallery(items[0]!, start + 2000)]) }); await first; f.tick(2000);
  assert.equal(f.client.getSnapshot().galleries['item-0'], undefined);
  const next = f.client.refresh(items); f.calls[1]!.resolve({ status: 200, body: batch(items) }); await next;
  const forced = f.client.refresh(items, true); assert.equal(f.client.getSnapshot().galleries['item-0'], undefined);
  f.calls[2]!.resolve({ status: 200, body: batch(items, []) }); await forced;
  await f.client.refresh(items); assert.equal(f.calls.length, 3); assert.equal(f.client.getSnapshot().galleries['item-0'], undefined);
});
test('partial failures retain other verified batches, never retry automatically and do not cache failures', async () => {
  const f = harness(), items = bindings(24), pending = f.client.refresh(items);
  f.calls[0]!.resolve({ status: 200, body: { ...batch(items.slice(0, 12)), requestedIds: [] } });
  f.calls[1]!.resolve({ status: 200, body: batch(items.slice(12)) }); await pending;
  assert.equal(f.client.getSnapshot().status, 'unavailable'); assert.equal(Object.keys(f.client.getSnapshot().galleries).length, 12); f.tick(6000); assert.equal(f.calls.length, 2);
  const retry = f.client.refresh(items); assert.equal(f.calls.length, 3); f.calls[2]!.reject(); await retry; assert.equal(Object.keys(f.client.getSnapshot().galleries).length, 12);
});
test('timeout abort precedes queued work and clearing invalidates every late response', async () => {
  const f = harness(), items = bindings(36), pending = f.client.refresh(items);
  f.tick(6000); await flush(); assert(f.calls[0]!.aborted && f.calls[1]!.aborted); assert.equal(f.calls.length, 3); assert.equal(f.maxActive(), 2);
  f.client.clear(); await pending; assert(f.calls[2]!.aborted); assert.equal(f.timers.size, 0);
  for (const [index, call] of f.calls.entries()) call.resolve({ status: 200, body: batch(items.slice(index * 12, index * 12 + 12)) }); await flush();
  assert.deepEqual(f.client.getSnapshot().galleries, {});
});
test('subscriber reset, invalid clocks/identities and disabled origin cannot initiate or revive requests', async () => {
  const f = harness(); const stop = f.client.subscribe(() => { if (f.client.getSnapshot().status === 'loading') f.client.clear(); });
  await f.client.refresh(bindings(1)); assert.equal(f.calls.length, 0); stop();
  f.setClock(NaN); await f.client.refresh(bindings(1)); assert.equal(f.client.getSnapshot().status, 'unavailable'); assert.equal(f.calls.length, 0);
  assert.throws(() => f.client.refresh(bindings(121))); assert.throws(() => f.client.refresh([bindings(1)[0]!, bindings(1)[0]!]));
  const disabled = harness(null); await disabled.client.refresh(bindings(24)); assert.equal(disabled.calls.length, 0); assert.equal(disabled.client.getSnapshot().status, 'disabled');
});
