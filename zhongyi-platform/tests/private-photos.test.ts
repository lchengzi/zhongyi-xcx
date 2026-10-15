import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { PrivatePhotoRegistry, jpegDimensions, privatePhotosFromEnvironment } from '../server/private-photos.js';
import { PRIVATE_PHOTO_SCHEMA, parsePrivatePhoto, parsePrivatePhotoList } from '../shared/private-photos.js';
import { readPrivatePhoto } from '../web/private-photo-api.js';
import { createApp } from '../server/app.js';
import { AuthRepository } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import { fixtureSeed } from './fixture.js';
import './private-derivative-client.test.js';

// Deliberately synthetic JPEG framing for parser/transport tests, not a food
// photo or a browser decoder fixture. Real originals are tested separately.
const bytes = Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
const photo = { id: 'fixture-photo', ingredientId: 'huang-qi', name: '测试候选（非食材照片）', sourcePage: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg', sourceRevision: '1',
  author: 'Test fixture', declaredLicense: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', observation: '仅用于工程测试，不是实际照片。', concerns: ['测试材料，不可公开。'],
  sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes: bytes.length, width: 1, height: 1,
  identityReview: 'pending', processingReview: 'pending', rightsReview: 'pending', professionalReview: 'pending', originalMetadataRetained: true, publicationEligible: false };
const manifest = () => ({ schemaVersion: PRIVATE_PHOTO_SCHEMA, items: [{ ...photo, localPath: 'original.jpg' }] });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'food-private-photo-'));
  const file = join(root, 'manifest.json');
  writeFileSync(file, JSON.stringify(manifest())); writeFileSync(join(root, 'original.jpg'), bytes);
  return { root, file, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('private photo projection rejects unknown, approved, unsafe and inconsistent metadata; detaches all lists', () => {
  const parsed = parsePrivatePhoto(photo); assert.equal(parsed.publicationEligible, false);
  parsed.concerns.push('local'); assert.equal(photo.concerns.length, 1);
  for (const bad of [{ ...photo, localPath: '/private/path' }, { ...photo, gps: 'must-not-project' }, { ...photo, rightsReview: 'approved' },
    { ...photo, publicationEligible: true }, { ...photo, originalMetadataRetained: false }, { ...photo, id: '../original' },
    { ...photo, sourcePage: 'https://commons.wikimedia.org.evil.test/wiki/File:X' }, { ...photo, sourcePage: `${photo.sourcePage}?token=secret` },
    { ...photo, sourceRevision: 1 }, { ...photo, licenseUrl: 'https://example.org/' }, { ...photo, width: 12000, height: 12000 }, { ...photo, bytes: 9 * 1024 * 1024 }]) assert.throws(() => parsePrivatePhoto(bad));
  assert.throws(() => parsePrivatePhotoList({ schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: false, items: [photo] }));
  assert.throws(() => parsePrivatePhotoList({ schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: true, items: [photo, photo] }));
});
test('registry verifies bytes/hash/dimensions, safe paths and static isolation; served bytes are immutable copies', () => {
  const f = fixture();
  try {
    const registry = new PrivatePhotoRegistry(f.root, f.file);
    assert.deepEqual(jpegDimensions(bytes), { width: 1, height: 1 });
    assert.equal(registry.list().items.length, 1); const copy = registry.asset(photo.id)!; copy[0] = 0;
    assert.deepEqual(registry.asset(photo.id), bytes); assert.equal(registry.asset('../manifest.json'), undefined);
    assert.throws(() => registry.assertStaticIsolation(f.root)); assert.throws(() => registry.assertStaticIsolation(join(f.root, 'dist')));
    assert.throws(() => registry.assertStaticIsolation(join(f.root, '..')));
    for (const change of [{ localPath: '../original.jpg' }, { localPath: 'https://example.org/x.jpg' }, { sha256: `sha256:${'a'.repeat(64)}` }, { width: 2 }, { bytes: 1 }]) {
      writeFileSync(f.file, JSON.stringify({ schemaVersion: PRIVATE_PHOTO_SCHEMA, items: [{ ...manifest().items[0], ...change }] }));
      assert.throws(() => new PrivatePhotoRegistry(f.root, f.file));
    }
    writeFileSync(f.file, JSON.stringify(manifest())); writeFileSync(join(f.root, 'original.jpg'), Buffer.from('not jpeg'));
    assert.throws(() => new PrivatePhotoRegistry(f.root, f.file));
    // An already constructed registry remains the exact, hash-bound snapshot.
    assert.deepEqual(registry.asset(photo.id), bytes);
  } finally { f.close(); }
});
test('registry rejects junction traversal, explicit env errors and local-key exposure', () => {
  const f = fixture();
  try {
    assert.equal(privatePhotosFromEnvironment({}, 'accounts'), undefined);
    for (const env of [{ PRIVATE_PHOTO_ROOT: f.root }, { PRIVATE_PHOTO_ROOT: '', PRIVATE_PHOTO_MANIFEST: f.file }, { PRIVATE_PHOTO_ROOT: '.', PRIVATE_PHOTO_MANIFEST: f.file }]) assert.throws(() => privatePhotosFromEnvironment(env, 'accounts'));
    assert.throws(() => privatePhotosFromEnvironment({ PRIVATE_PHOTO_ROOT: f.root, PRIVATE_PHOTO_MANIFEST: f.file }, 'local-key'));
    mkdirSync(join(f.root, 'real')); symlinkSync(join(f.root, 'real'), join(f.root, 'link'), 'junction');
    writeFileSync(join(f.root, 'real', 'original.jpg'), bytes);
    writeFileSync(f.file, JSON.stringify({ schemaVersion: PRIVATE_PHOTO_SCHEMA, items: [{ ...photo, localPath: 'link/original.jpg' }] }));
    assert.throws(() => new PrivatePhotoRegistry(f.root, f.file), /links/);
    writeFileSync(f.file, JSON.stringify(manifest()));
    const repo = new CatalogRepository(':memory:', fixtureSeed());
    try { assert.throws(() => createApp(repo, 'fixture-key-that-is-longer-than-32-characters', undefined, { privatePhotos: new PrivatePhotoRegistry(f.root, f.file) }), /account/); } finally { repo.close(); }
  } finally { f.close(); }
});
test('real SQLite/account HTTP protects candidate JSON and JPEG, refuses mutation/HEAD/cross-site and revoked sessions', async () => {
  const f = fixture(), repo = new CatalogRepository(':memory:', fixtureSeed()), auth = new AuthRepository(repo.db);
  const server = createApp(repo, { mode: 'accounts', allowedOrigins: ['http://127.0.0.1'] }, undefined, { privatePhotos: new PrivatePhotoRegistry(f.root, f.file) }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  try {
    assert.equal((await fetch(`${base}/private-photos`)).status, 401);
    assert.equal((await fetch(`${base}/private-photos/${photo.id}/original`)).status, 401);
    for (const role of ['admin', 'editor', 'reviewer'] as const) {
      await auth.createUser(`photo-${role}`, 'fixture-only-photo-password-2026', role, 'fixture');
      const session = await auth.login(`photo-${role}`, 'fixture-only-photo-password-2026', `fixture-${role}`), headers = { Cookie: `food_session=${session.token}` };
      const list = await fetch(`${base}/private-photos`, { headers }); assert.equal(list.status, 200);
      assert.equal(list.headers.get('Cache-Control'), 'no-store'); const text = await list.text(); assert(!/localPath|gps|latitude|longitude|original.jpg/.test(text));
      assert.deepEqual(parsePrivatePhotoList(JSON.parse(text)).items[0], parsePrivatePhoto(photo));
      const original = await fetch(`${base}/private-photos/${photo.id}/original`, { headers }); assert.equal(original.status, 200);
      assert.equal(original.headers.get('Content-Type'), 'image/jpeg'); assert.equal(original.headers.get('Cache-Control'), 'no-store'); assert.equal(original.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
      for (const suffix of ['?path=original.jpg', '?token=secret']) assert.equal((await fetch(`${base}/private-photos${suffix}`, { headers })).status, 400);
      assert.equal((await fetch(`${base}/private-photos`, { headers, method: 'HEAD' })).status, 400);
      assert.equal((await fetch(`${base}/private-photos`, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
      assert.equal((await fetch(`${base}/private-photos`, { headers: { ...headers, Origin: 'http://127.0.0.1', 'X-CSRF-Token': session.info.csrfToken }, method: 'POST' })).status, 400);
      await auth.logout(session.token, session.info.user.username);
      assert.equal((await fetch(`${base}/private-photos/${photo.id}/original`, { headers })).status, 401);
    }
  } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close(); f.close(); }
});
test('disabled private library is distinct from an empty configured library; local-key cannot access either', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()), auth = new AuthRepository(repo.db);
  const server = createApp(repo, { mode: 'accounts' }).listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await auth.createUser('photo-admin', 'fixture-only-photo-password-2026', 'admin', 'fixture'); const session = await auth.login('photo-admin', 'fixture-only-photo-password-2026', 'fixture');
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/private-photos`, { headers: { Cookie: `food_session=${session.token}` } });
    assert.deepEqual(await response.json(), { schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: false, items: [] });
    assert(!response.headers.get('Content-Security-Policy')?.includes('blob:'));
    const f = fixture();
    try {
      writeFileSync(f.file, JSON.stringify({ schemaVersion: PRIVATE_PHOTO_SCHEMA, items: [] }));
      assert.deepEqual(new PrivatePhotoRegistry(f.root, f.file).list(), { schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: true, items: [] });
    } finally { f.close(); }
    const key = 'fixture-key-that-is-longer-than-32-characters', local = createApp(repo, key).listen(0, '127.0.0.1'); await once(local, 'listening');
    try {
      for (const suffix of ['', '/fixture-photo/original']) assert.equal((await fetch(`http://127.0.0.1:${(local.address() as AddressInfo).port}/api/v1/private-photos${suffix}`, { headers: { Authorization: `Bearer ${key}` } })).status, 403);
    } finally { await new Promise<void>(done => { local.close(() => done()); local.closeAllConnections(); }); }
  } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close(); }
});
test('actual binary client binds length/hash/MIME, blocks redirects and late cancelled bytes, never supplies bearer token', async () => {
  const originalFetch = globalThis.fetch, calls: RequestInit[] = [], candidate = parsePrivatePhoto(photo);
  try {
    const response = (body: Uint8Array = bytes, type = 'image/jpeg', length = String(bytes.length)) => new Response(new Uint8Array(body), { headers: { 'Content-Type': type, 'Content-Length': length } });
    globalThis.fetch = (async (url, options) => { assert.equal(url, '/api/v1/private-photos/fixture-photo/original'); calls.push(options!); return response(); }) as typeof fetch;
    const blob = await readPrivatePhoto(candidate, new AbortController().signal); assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    assert.equal(calls[0].credentials, 'same-origin'); assert.equal(calls[0].cache, 'no-store'); assert.equal(calls[0].redirect, 'error'); assert.equal(calls[0].headers, undefined);
    for (const body of [Buffer.alloc(bytes.length), Buffer.alloc(bytes.length - 1), Buffer.alloc(bytes.length + 1)]) {
      globalThis.fetch = (async () => response(body)) as typeof fetch; await assert.rejects(readPrivatePhoto(candidate, new AbortController().signal));
    }
    for (const bad of [response(bytes, 'text/html'), response(bytes, 'image/jpeg', '999'), new Response('denied', { status: 401 })]) {
      globalThis.fetch = (async () => bad) as typeof fetch; await assert.rejects(readPrivatePhoto(candidate, new AbortController().signal));
    }
    const controller = new AbortController(); globalThis.fetch = (async () => { controller.abort(); return response(); }) as typeof fetch;
    await assert.rejects(readPrivatePhoto(candidate, controller.signal), { name: 'AbortError' });
    globalThis.fetch = (async () => { throw new Error('should not dispatch'); }) as typeof fetch;
    await assert.rejects(readPrivatePhoto(candidate, controller.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = originalFetch; }
});
