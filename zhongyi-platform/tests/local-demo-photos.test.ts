import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { localDemoStartArgs, prepareLocalDemo, startLocalDemo } from '../server/local-demo.js';
import { createSyntheticPublicationAssets } from './photo-publication-assets-fixture.js';
import { fixtureSeed } from './fixture.js';
import { launchDemoCli } from './local-demo-process.js';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
async function freePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string'); const port = address.port; await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); return port; }
function fixture() {
  const assets = createSyntheticPublicationAssets();
  const parent = resolve('.local/demo-photo-tests'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'run-')), root = join(directory, 'platform');
  const originals = join(directory, 'zhongyi/content-private/research'), display = join(root, '.local/photo-derivatives/frozen-fixture');
  for (const path of [join(root, 'data'), join(root, 'dist'), originals, display]) mkdirSync(path, { recursive: true });
  writeFileSync(join(root, 'data/catalog.seed.json'), JSON.stringify(fixtureSeed()), { flag: 'wx' });
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>Engineering static fixture only</title>', { flag: 'wx' });
  writeFileSync(join(root, '.local/editorial.sqlite'), 'working-store sentinel; never open', { flag: 'wx' });
  for (const [source, target] of [[join(assets.root, 'originals/manifest.json'), join(originals, 'manifest.json')], [join(assets.root, 'originals/original.jpg'), join(originals, 'original.jpg')],
    [join(assets.root, 'derivatives/bundle.json'), join(display, 'bundle.json')], [join(assets.root, 'derivatives', assets.metadata.assetFilename), join(display, assets.metadata.assetFilename)]]) writeFileSync(target, readFileSync(source), { flag: 'wx' });
  return { assets, directory, root, originals, display, photos: { manifest: join(originals, 'manifest.json'), derivatives: display } };
}

test('photo demo CLI accepts only paired explicit paths, unique known flags and bounded ports', () => {
  const id = 'demo-11111111-1111-4111-8111-111111111111', manifest = resolve('private-manifest.json'), display = resolve('private-displays');
  assert.deepEqual(localDemoStartArgs(['start', id]), { demoId: id, port: 4314 });
  assert.deepEqual(localDemoStartArgs(['start', id, '--photo-derivatives', display, '--port', '4321', '--photo-manifest', manifest]), { demoId: id, port: 4321, photos: { manifest, derivatives: display } });
  for (const args of [['start', '../working.sqlite'], ['start', id, '--photo-manifest', manifest], ['start', id, '--photo-manifest', '.', '--photo-derivatives', display],
    ['start', id, '--port', '4314', '--port', '4315'], ['start', id, '--publish', 'true'], ['start', id, '--port', '0'], ['start', id, '--port', '65536'], ['start', id, '--port', '4314.5']]) assert.throws(() => localDemoStartArgs(args));
});

test('account-only derivative previews need no journal, do not enable publication and retain HTTP protections', async () => {
  const f = fixture(), repo = new CatalogRepository(':memory:', fixtureSeed()), auth = new AuthRepository(repo.db), journalBefore = readdirSync(f.assets.journal.root);
  assert.throws(() => createApp(repo, 'test-key-longer-than-thirty-two-characters', undefined, { privatePhotos: f.assets.originals, privateDerivatives: f.assets.derivatives }), /account/);
  assert.throws(() => createApp(repo, { mode: 'accounts' }, undefined, { privateDerivatives: f.assets.derivatives }), /bound/);
  const origin = 'https://private-preview.example.test';
  const server = createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { privatePhotos: f.assets.originals, privateDerivatives: f.assets.derivatives }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`, path = `${url}/api/v1/private-photo-derivatives/${f.assets.photo.id}`;
  try {
    assert.equal((await fetch(path)).status, 401); assert.equal((await fetch(`${path}/image`)).status, 401);
    await auth.createUser('private-preview-admin', 'fixture-password-for-preview-2026', 'admin', 'test'); const login = await auth.login('private-preview-admin', 'fixture-password-for-preview-2026', 'test');
    const headers = { Cookie: `food_session=${login.token}` };
    const metadata = await fetch(path, { headers }); assert.equal(metadata.status, 200); assert.equal(metadata.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(await metadata.json(), f.assets.metadata);
    const image = await fetch(`${path}/image`, { headers }); assert.equal(image.status, 200); assert.equal(image.headers.get('Content-Type'), 'image/jpeg'); assert.equal(image.headers.get('Cross-Origin-Resource-Policy'), 'same-origin'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), f.assets.display);
    for (const request of [fetch(`${path}?token=bad`, { headers }), fetch(path, { method: 'HEAD', headers }), fetch(path, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })]) assert.equal((await request).status, 400);
    assert.equal((await fetch(path, { method: 'POST', headers })).status, 403);
    const writeHeaders = { ...headers, Origin: origin, 'X-CSRF-Token': login.info.csrfToken, 'Content-Type': 'application/json' };
    assert.equal((await fetch(path, { method: 'POST', headers: writeHeaders, body: '{}' })).status, 400);
    assert.equal((await fetch(`${url}/api/v1/editorial/photo-publications/huang-qi`, { headers })).status, 503);
    assert.equal((await fetch(`${url}/api/v1/editorial/photo-publications/huang-qi`, { method: 'POST', headers: writeHeaders, body: '{}' })).status, 503);
    assert.equal((await fetch(`${url}/api/v1/public/photos/huang-qi`)).status, 503);
    assert.deepEqual(readdirSync(f.assets.journal.root), journalBefore);
    for (const table of ['photo_notes', 'photo_submissions', 'photo_rights_reviews', 'photo_professional_reviews', 'publication_events']) assert.equal(repo.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0);
    await auth.logout(login.token, login.info.user.username); assert.equal((await fetch(path, { headers })).status, 401);
  } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close(); }
});

test('local demo rejects private asset escape/links before writable SQL, and actual source CLI serves only explicit previews without a build dependency', async () => {
  const f = fixture(), prepared = await prepareLocalDemo(f.root), database = join(prepared.directory, 'editorial.sqlite'), before = hash(database), working = hash(join(f.root, '.local/editorial.sqlite'));
  const link = join(f.originals, 'alias'); symlinkSync(f.originals, link, process.platform === 'win32' ? 'junction' : 'dir');
  const extra = { ...f.photos, publicationEnabled: true };
  for (const photos of [{ ...f.photos, manifest: join(f.root, 'data/catalog.seed.json') }, { ...f.photos, derivatives: f.assets.derivatives.root }, { ...f.photos, manifest: join(link, 'manifest.json') }, extra]) {
    await assert.rejects(startLocalDemo(f.root, prepared.demoId, 4314, photos)); assert.equal(hash(database), before);
  }
  let app: Awaited<ReturnType<typeof launchDemoCli>> | undefined;
  try {
    assert.equal(existsSync(join(f.root, 'build')), false);
    app = await launchDemoCli(f.root, prepared.demoId, await freePort(), 'source', f.photos);
    const user = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts.find((value: { role: string }) => value.role === 'editor');
    const login = await fetch(`${app.url}/api/v1/auth/login`, { method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password: user.password }) }); assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]; const headers = { Cookie: cookie };
    assert.equal((await fetch(`${app.url}/api/v1/private-photo-derivatives/${f.assets.photo.id}/image`, { headers })).status, 200);
    assert.equal((await fetch(`${app.url}/api/v1/editorial/photo-publications/huang-qi`, { headers })).status, 503);
    assert.equal((await fetch(`${app.url}/api/v1/public/photos/huang-qi`)).status, 503);
    const output = JSON.stringify(app.output()); assert(!output.includes(user.password)); assert(output.includes('No publication journal or approval was created'));
    await app.close(); app = undefined; assert.equal(hash(join(f.root, '.local/editorial.sqlite')), working); assert.equal(existsSync(join(prepared.directory, 'photo-publications')), false);
    const db = new DatabaseSync(database, { readOnly: true }); try { assert.equal(db.prepare('SELECT count(*) n FROM publication_events').get()!.n, 0); } finally { db.close(); }
  } finally { await app?.close(); }
});

