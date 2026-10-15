import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { projectIngredient, seedDigest, validateSeed } from '../server/seed.js';
import { fixtureSeed } from './fixture.js';

const token = 'test-local-editor-token-with-32-characters';
async function serve(repo: CatalogRepository) {
  const server = createApp(repo, token).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, api: (path: string, init: RequestInit = {}) => fetch(`${url}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }),
    close: async () => { const closed = once(server, 'close'); server.close(); await closed; } };
}

test('real HTTP authentication, literal SQL search, pagination and detail', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  try {
    assert.equal((await service.api('/api/health', { headers: { Authorization: '' } })).status, 200);
    assert.equal((await service.api('/api/v1/summary', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await service.api('/api/v1/summary', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const summary = await (await service.api('/api/v1/summary')).json();
    assert.equal(summary.ingredientCount, 3); assert.equal(summary.publicationEnabled, false);
    for (const query of ['黄芪', 'huang qi', '枸杞', '生姜']) {
      const data = await (await service.api(`/api/v1/ingredients?q=${encodeURIComponent(query)}`)).json(); assert.equal(data.total, 1);
    }
    for (const query of ["' OR 1=1 --", '%', '_', '不存在']) {
      const data = await (await service.api(`/api/v1/ingredients?q=${encodeURIComponent(query)}`)).json(); assert.equal(data.total, 0);
    }
    const first = await (await service.api('/api/v1/ingredients?page=1&pageSize=1')).json();
    const second = await (await service.api('/api/v1/ingredients?page=2&pageSize=1')).json();
    assert.equal(first.items.length, 1); assert.notEqual(first.items[0].id, second.items[0].id); assert.equal(first.total, 3);
    for (const query of ['page=0', 'page=1.5', 'pageSize=51', 'q=a&q=b', 'other=x', `q=${'x'.repeat(81)}`]) assert.equal((await service.api(`/api/v1/ingredients?${query}`)).status, 400);
    const detail = await (await service.api('/api/v1/ingredients/huang-qi')).json(); assert.equal(detail.note.revision, 0);
    assert.equal(detail.ingredient.professionalReviewState, 'pending'); assert.equal(detail.ingredient.sources[0].title, '测试来源（非正式资料）');
    assert.equal((await service.api('/api/v1/ingredients/no-such-id')).status, 404);
    assert.equal((await service.api('/api/v1/publish', { method: 'POST' })).status, 404);
  } finally { await service.close(); repo.close(); }
});

test('save, stale concurrent writer, clear, audit transaction and strict body', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  const put = (body: unknown, id = 'huang-qi', auth = `Bearer ${token}`) => service.api(`/api/v1/ingredients/${id}/note`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
  try {
    assert.equal((await put({ text: 'unauthorized', expectedRevision: 0 }, 'huang-qi', '')).status, 401);
    const note = await (await put({ text: '  核对原始公告  ', expectedRevision: 0 })).json(); assert.equal(note.text, '核对原始公告'); assert.equal(note.revision, 1);
    const concurrent = await Promise.all([put({ text: '窗口 A', expectedRevision: 1 }), put({ text: '窗口 B', expectedRevision: 1 })]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    assert.equal(repo.note('huang-qi').revision, 2); assert.equal(repo.events().length, 2);
    assert.equal((await put({ text: '', expectedRevision: 2 })).status, 200); assert.equal(repo.note('huang-qi').text, ''); assert.equal(repo.note('huang-qi').revision, 3);
    assert.equal(repo.events()[0].action, 'note_cleared'); assert.equal(repo.summary().noteCount, 0);
    for (const body of [{ text: 'x'.repeat(1201), expectedRevision: 3 }, { text: {}, expectedRevision: 3 }, { text: 'x', expectedRevision: -1 }, { text: 'x', expectedRevision: 1.5 }, { text: 'x', expectedRevision: 3, professionalReviewState: 'reviewed' }, { text: 'x' }, [], null]) assert.equal((await put(body)).status, 400);
    assert.equal((await put({ text: 'x', expectedRevision: 0 }, 'unknown')).status, 404);
    assert.equal((await service.api('/api/v1/ingredients/huang-qi/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await put({ text: 'x'.repeat(9000), expectedRevision: 3 })).status, 413);
    assert.equal(repo.events().length, 3); assert.equal(repo.ingredient('huang-qi')?.professionalReviewState, 'pending');
    assert.equal((await service.api('/api/v1/ingredients/huang-qi')).headers.get('cache-control'), 'no-store');
  } finally { await service.close(); repo.close(); }
});

test('SQLite file survives a complete HTTP/server/database restart; changed seed preserves notes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-platform-test-'));
  const filename = join(directory, 'test.sqlite');
  try {
    const seed = fixtureSeed();
    const first = new CatalogRepository(filename, seed); const service = await serve(first);
    try { assert.equal((await service.api('/api/v1/ingredients/huang-qi/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '重启后保留的备注', expectedRevision: 0 }) })).status, 200); }
    finally { await service.close(); first.close(); }
    const changed = fixtureSeed(); changed.ingredients[0].name = ' changed'; const { digest, ...payload } = changed; changed.digest = seedDigest(payload);
    assert.throws(() => new CatalogRepository(filename, changed), /explicit migration/);
    const reopened = new CatalogRepository(filename, seed); const next = await serve(reopened);
    try { const data = await (await next.api('/api/v1/ingredients/huang-qi')).json(); assert.equal(data.note.text, '重启后保留的备注'); assert.equal(data.note.revision, 1); assert.equal(reopened.events().length, 1); }
    finally { await next.close(); reopened.close(); }
  } finally { unlinkSync(filename); rmdirSync(directory); }
});

test('catalog import strips unknown/private fields; malformed or altered seeds are rejected', () => {
  const projected = projectIngredient({ id: 'example', name: '测试', privateEvidence: 'secret', audit: { professionalReviewState: 'pending', reviews: [{ secret: 'secret' }] }, identity: { latinName: '', ediblePart: '', privateDraft: 'secret' }, sources: [{ id: 's', title: 'source', url: 'https://example.org', privateDraft: 'secret' }] });
  assert.equal(JSON.stringify(projected).includes('secret'), false);
  for (const mutate of [(seed: any) => { seed.extra = 'secret'; }, (seed: any) => { seed.ingredients[0].name = 'tampered'; }, (seed: any) => { seed.ingredients[0].sources[0].url = 'javascript:alert(1)'; }, (seed: any) => { seed.ingredients.push(seed.ingredients[0]); }]) {
    const seed = fixtureSeed(); mutate(seed); assert.throws(() => validateSeed(seed));
  }
});
