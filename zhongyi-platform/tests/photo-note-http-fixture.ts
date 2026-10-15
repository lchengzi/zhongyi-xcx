import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, lstatSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Account, SessionInfo } from '../shared/contracts.js';
import type { RepositoryBundle } from '../server/stores.js';
import { createApp } from '../server/app.js';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import { PRIVATE_PHOTO_SCHEMA } from '../shared/private-photos.js';
import { parsePhotoNoteDetail, parseSavedPhotoNote } from '../shared/photo-notes.js';
import { photoBindingDigest } from '../server/photo-note-values.js';
import { readPhotoNotes, savePhotoNote } from '../web/photo-note-api.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { fixturePassword } from './migration-fixture.js';

export interface PhotoHttpBackend { stores: RepositoryBundle; admin: Account; editor: Account; reviewer: Account; close(): Promise<void> }
const origin = 'https://photo-notes.example.test';
export function photoHttpRegistry() {
  const root = mkdtempSync(join(tmpdir(), 'photo-note-http-')), manifest = join(root, 'manifest.json'), image = join(root, 'fixture.jpg');
  // Synthetic JPEG framing only, not an edible-part image or decoder proof.
  const bytes = Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
  const photo = { ...notePhoto(), sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes: bytes.length };
  writeFileSync(image, bytes); writeFileSync(manifest, JSON.stringify({ schemaVersion: PRIVATE_PHOTO_SCHEMA, items: [{ ...photo, localPath: 'fixture.jpg' }] }));
  const registry = new PrivatePhotoRegistry(root, manifest);
  return { registry, photo: registry.list().items[0], close: () => {
    assert.deepEqual(readdirSync(root).sort(), ['fixture.jpg','manifest.json']); assert(!lstatSync(root).isSymbolicLink());
    for (const file of [image, manifest]) { assert(lstatSync(file).isFile()); assert(!lstatSync(file).isSymbolicLink()); unlinkSync(file); }
    rmdirSync(root);
  } };
}
export async function photoHttpFixture(backend: () => Promise<PhotoHttpBackend>, namespace: 'private-photo-notes' | 'private-photo-submissions' | 'private-photo-rights' | 'private-photo-professional', configured = true, localKey?: string) {
    const f = await backend(), images = photoHttpRegistry();
    const server = createApp(f.stores, localKey ?? { mode: 'accounts', allowedOrigins: [origin] }, undefined, configured ? { privatePhotos: images.registry } : {}).listen(0, '127.0.0.1');
    await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = async (actor: Account) => {
      const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: actor.username, password: fixturePassword }) });
      assert.equal(response.status, 200); const session: SessionInfo = await response.json();
      return { session, headers: { Cookie: response.headers.get('set-cookie')!.split(';')[0], Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' } };
    };
    return { ...f, ...images, base, login, path: `/api/v1/${namespace}/${images.photo.id}`,
      close: async () => { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); await f.close(); images.close(); } };
}
export function registerPhotoNoteHttpTests(engine: string, backend: () => Promise<PhotoHttpBackend>): void {
  const fixture = (configured = true, localKey?: string) => photoHttpFixture(backend, 'private-photo-notes', configured, localKey);
  test(`${engine} photo-note HTTP: exact method/query/body/role/CSRF boundaries preserve private original GET-only routes`, async () => {
    const f = await fixture();
    try {
      assert.equal((await fetch(f.base + f.path)).status, 401);
      const editor = await f.login(f.editor), input = noteInput(0, f.photo);
      const read = await fetch(f.base + f.path, { headers: editor.headers }); assert.equal(read.status, 200); assert.equal(read.headers.get('Cache-Control'), 'no-store');
      const detail = parsePhotoNoteDetail(await read.json(), { candidateId: f.photo.id, bindingDigest: photoBindingDigest(f.photo), ingredientId: f.photo.ingredientId }); assert.equal(detail.version, 0);
      for (const method of ['HEAD','PUT','DELETE']) assert.equal((await fetch(f.base + f.path, { method, headers: editor.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path + '?token=not-a-secret', { headers: editor.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path, { headers: { ...editor.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
      for (const body of [{ ...input, approved: true }, { ...input, candidate: f.photo }, { ...input, actorId: f.admin.id }, { ...input, text: ' ' }]) {
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: editor.headers, body: JSON.stringify(body) })).status, 400);
      }
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...editor.headers, 'X-CSRF-Token': 'bad' }, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...editor.headers, Origin: 'https://foreign.example.test' }, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...editor.headers, 'Content-Type': 'text/plain' }, body: 'not-json' })).status, 400);
      const reviewer = await f.login(f.reviewer); assert.equal((await fetch(f.base + f.path, { headers: reviewer.headers })).status, 200);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: reviewer.headers, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(`${f.base}/api/v1/private-photos`, { method: 'POST', headers: editor.headers, body: '{}' })).status, 400);
      assert.equal((await fetch(`${f.base}/api/v1/private-photos/${f.photo.id}/original`, { method: 'POST', headers: editor.headers, body: '{}' })).status, 400);
      assert.equal((await f.stores.photoNotes.detail(f.photo)).version, 0);
    } finally { await f.close(); }
  });
  test(`${engine} actual typed photo client → authenticated API → database; fixed receipt/reread and optimistic conflicts stay private`, async () => {
    const f = await fixture(), nativeFetch = globalThis.fetch;
    try {
      const actor = await f.login(f.editor), before = await f.stores.catalog.publicSnapshot();
      globalThis.fetch = (input, options) => nativeFetch(typeof input === 'string' && input.startsWith('/') ? f.base + input : input, { ...options, headers: { ...options?.headers, Cookie: actor.headers.Cookie, Origin: origin } });
      const signal = new AbortController().signal, detail = await readPhotoNotes(f.photo, actor.session, signal);
      const saved = await savePhotoNote(f.photo, noteInput(detail.version, f.photo), actor.session, signal);
      assert.equal(saved.actorId, f.editor.id); assert.equal(saved.version, 1); assert.equal(saved.candidate.publicationEligible, false);
      const current = await readPhotoNotes(f.photo, actor.session, signal, detail); assert.deepEqual(current.history, [saved]);
      await assert.rejects(savePhotoNote(f.photo, noteInput(0, f.photo), actor.session, signal));
      assert.deepEqual(await f.stores.catalog.publicSnapshot(), before); assert(!JSON.stringify(current).includes('localPath'));
      await f.stores.auth.logout(actor.headers.Cookie.slice('food_session='.length), f.editor.username);
      await assert.rejects(readPhotoNotes(f.photo, actor.session, signal)); assert.equal((await f.stores.photoNotes.detail(f.photo)).version, 1);
    } finally { globalThis.fetch = nativeFetch; await f.close(); }
  });
  test(`${engine} photo HTTP competing writes have one exact winner; server never trusts supplied source binding`, async () => {
    const f = await fixture();
    try {
      const actor = await f.login(f.admin), input = noteInput(0, f.photo);
      const bad = await fetch(f.base + f.path, { method: 'POST', headers: actor.headers, body: JSON.stringify({ ...input, bindingDigest: `sha256:${'0'.repeat(64)}` }) }); assert.equal(bad.status, 409);
      const results = await Promise.all([1,2].map(() => fetch(f.base + f.path, { method: 'POST', headers: actor.headers, body: JSON.stringify(input) })));
      assert.deepEqual(results.map(result => result.status).sort(), [201,409]); const winner = results.find(result => result.status === 201)!;
      const receipt = parseSavedPhotoNote(await winner.json(), f.photo, input, actor.session.user); assert.equal(receipt.version, 1);
      assert.equal((await f.stores.photoNotes.detail(f.photo)).history.length, 1);
    } finally { await f.close(); }
  });
  test(`${engine} disabled image library and local-key mode cannot expose or save photo notes`, async () => {
    for (const localKey of [undefined, 'fixture-local-key-only-32-characters-long']) {
      const f = await fixture(false, localKey);
      try {
        const headers = localKey ? { Authorization: `Bearer ${localKey}` } : (await f.login(f.admin)).headers;
        assert.equal((await fetch(f.base + f.path, { headers })).status, localKey ? 403 : 404);
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(noteInput(0, f.photo)) })).status, localKey ? 403 : 404);
      } finally { await f.close(); }
    }
  });
}
