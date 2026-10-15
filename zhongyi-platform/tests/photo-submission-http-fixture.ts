import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoHttpFixture, type PhotoHttpBackend } from './photo-note-http-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { photoBindingDigest } from '../server/photo-note-values.js';
import { parsePhotoSubmissionDetail, parseSavedPhotoSubmission } from '../shared/photo-submissions.js';
import { readPhotoSubmissions, submitPhoto } from '../web/photo-submission-api.js';

export function registerPhotoSubmissionHttpTests(engine: string, backend: () => Promise<PhotoHttpBackend>): void {
  const fixture = (configured = true, localKey?: string) => photoHttpFixture(backend, 'private-photo-submissions', configured, localKey);
  test(`${engine} submission HTTP enforces accounts/roles/CSRF/exact requests and keeps original routes GET-only`, async () => {
    const f = await fixture();
    try {
      assert.equal((await fetch(f.base + f.path)).status, 401);
      const editor = await f.login(f.editor), note = await f.stores.photoNotes.save(f.photo, noteInput(0, f.photo), { account: editor.session.user, token: editor.headers.Cookie.slice('food_session='.length) }), input = submissionInput(note);
      const response = await fetch(f.base + f.path, { headers: editor.headers }); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
      assert.equal(parsePhotoSubmissionDetail(await response.json(), { candidateId: f.photo.id, bindingDigest: photoBindingDigest(f.photo), ingredientId: f.photo.ingredientId }).version, 0);
      for (const method of ['HEAD', 'PUT', 'DELETE']) assert.equal((await fetch(f.base + f.path, { method, headers: editor.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path + '?token=fixture', { headers: editor.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path, { headers: { ...editor.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
      for (const body of [{ ...input, approved: true }, { ...input, candidate: f.photo }, { ...input, actorId: f.admin.id }, { ...input, submissionConfirmed: false }, { ...input, caption: ' ' }]) assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: editor.headers, body: JSON.stringify(body) })).status, 400);
      for (const headers of [{ ...editor.headers, 'X-CSRF-Token': 'bad' }, { ...editor.headers, Origin: 'https://foreign.example.test' }]) assert.equal((await fetch(f.base + f.path, { method: 'POST', headers, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...editor.headers, 'Content-Type': 'text/plain' }, body: 'not-json' })).status, 400);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: editor.headers, body: JSON.stringify({ ...input, caption: 'x'.repeat(9000) }) })).status, 413);
      const reviewer = await f.login(f.reviewer); assert.equal((await fetch(f.base + f.path, { headers: reviewer.headers })).status, 200); assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: reviewer.headers, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(f.base + '/api/v1/private-photo-submissions/absent-photo', { headers: editor.headers })).status, 404);
      for (const path of ['/api/v1/private-photos', `/api/v1/private-photos/${f.photo.id}/original`]) assert.equal((await fetch(f.base + path, { method: 'POST', headers: editor.headers, body: '{}' })).status, 400);
      assert.equal((await f.stores.photoSubmissions.detail(f.photo)).version, 0);
    } finally { await f.close(); }
  });
  test(`${engine} actual typed submission client → account API → persisted history, with matching opinion and no public changes`, async () => {
    const f = await fixture(), native = globalThis.fetch;
    try {
      const editor = await f.login(f.editor), authority = { account: editor.session.user, token: editor.headers.Cookie.slice('food_session='.length) };
      const before = await f.stores.catalog.publicSnapshot(), note = await f.stores.photoNotes.save(f.photo, noteInput(0, f.photo), authority);
      globalThis.fetch = (url, options) => native(typeof url === 'string' && url.startsWith('/') ? f.base + url : url, { ...options, headers: { ...options?.headers, Cookie: editor.headers.Cookie, Origin: editor.headers.Origin } });
      const signal = new AbortController().signal, previous = await readPhotoSubmissions(f.photo, editor.session, signal);
      assert.equal(previous.notes.history[0].digest, previous.detail.noteDigest);
      const saved = await submitPhoto(f.photo, submissionInput(note), editor.session, signal);
      assert.equal(saved.actorId, f.editor.id); assert.equal(saved.noteDigest, note.digest); assert.equal(saved.candidate.publicationEligible, false);
      const current = await readPhotoSubmissions(f.photo, editor.session, signal, previous); assert.deepEqual(current.detail.history, [saved]); assert.equal(current.notes.version, 1);
      assert.deepEqual((await f.stores.photoSubmissions.detail(f.photo)).history, [saved]); assert.deepEqual(await f.stores.catalog.publicSnapshot(), before); assert(!JSON.stringify(current).includes('localPath'));
      await f.stores.auth.logout(authority.token, f.editor.username); await assert.rejects(submitPhoto(f.photo, submissionInput(note, 1), editor.session, signal)); assert.equal((await f.stores.photoSubmissions.detail(f.photo)).version, 1);
    } finally { globalThis.fetch = native; await f.close(); }
  });
  test(`${engine} submission HTTP rejects stale opinion/file bindings; simultaneous next-version requests have one winner`, async () => {
    const f = await fixture();
    try {
      const editor = await f.login(f.editor), authority = { account: editor.session.user, token: editor.headers.Cookie.slice('food_session='.length) };
      const note = await f.stores.photoNotes.save(f.photo, noteInput(0, f.photo), authority), input = submissionInput(note);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: editor.headers, body: JSON.stringify({ ...input, bindingDigest: `sha256:${'0'.repeat(64)}` }) })).status, 409);
      const fresh = await f.stores.photoNotes.save(f.photo, noteInput(1, f.photo), authority);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: editor.headers, body: JSON.stringify(input) })).status, 409);
      const next = submissionInput(fresh), results = await Promise.all([1, 2].map(() => fetch(f.base + f.path, { method: 'POST', headers: editor.headers, body: JSON.stringify(next) })));
      assert.deepEqual(results.map(item => item.status).sort(), [201, 409]); const winner = results.find(item => item.status === 201); assert(winner);
      const saved = parseSavedPhotoSubmission(await winner.json(), f.photo, next, editor.session.user); assert.equal(saved.noteVersion, 2); assert.equal((await f.stores.photoSubmissions.detail(f.photo)).history.length, 1);
    } finally { await f.close(); }
  });
  test(`${engine} disabled private library and local-key access cannot read or submit image-review versions`, async () => {
    for (const localKey of [undefined, 'fixture-local-key-only-32-characters-long']) {
      const f = await fixture(false, localKey);
      try {
        const headers = localKey ? { Authorization: `Bearer ${localKey}` } : (await f.login(f.admin)).headers;
        const input = { bindingDigest: photoBindingDigest(f.photo), expectedVersion: 0, expectedNoteVersion: 1, noteDigest: photoBindingDigest(f.photo), caption: 'fixture', partDescription: 'fixture', processingDescription: 'fixture', evidenceReference: 'fixture', submissionConfirmed: true };
        assert.equal((await fetch(f.base + f.path, { headers })).status, localKey ? 403 : 404);
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, localKey ? 403 : 404);
      } finally { await f.close(); }
    }
  });
}
