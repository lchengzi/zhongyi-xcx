import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoHttpFixture, type PhotoHttpBackend } from './photo-note-http-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { rightsInput } from './photo-rights-fixture.js';
import { readPhotoRights, reviewPhotoRights } from '../web/photo-rights-api.js';
import { matchesPhotoRightsAttempt, parsePhotoRightsDetail, parseSavedPhotoRights } from '../shared/photo-rights-response.js';
import { photoBindingDigest } from '../server/photo-note-values.js';

type Fixture = Awaited<ReturnType<typeof photoHttpFixture>>;
async function prepared(f: Fixture) {
  const editor = await f.login(f.editor), authority = { account: editor.session.user, token: editor.headers.Cookie.slice('food_session='.length) };
  const note = await f.stores.photoNotes.save(f.photo, noteInput(0, f.photo), authority), submission = await f.stores.photoSubmissions.submit(f.photo, submissionInput(note), authority);
  const reviewer = await f.login(f.reviewer);
  return { editor, authority, note, submission, reviewer, input: rightsInput(submission) };
}
export function registerPhotoRightsHttpTests(engine: string, backend: () => Promise<PhotoHttpBackend>): void {
  const fixture = (configured = true, localKey?: string) => photoHttpFixture(backend, 'private-photo-rights', configured, localKey);
  test(`${engine} rights HTTP enforces account roles, origin/CSRF, exact requests and GET-only originals`, async () => {
    const f = await fixture();
    try {
      assert.equal((await fetch(f.base + f.path)).status, 401);
      const p = await prepared(f), read = await fetch(f.base + f.path, { headers: p.reviewer.headers });
      assert.equal(read.status, 200); assert.equal(read.headers.get('Cache-Control'), 'no-store'); assert.equal(read.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
      assert.equal(parsePhotoRightsDetail(await read.json(), { candidateId: f.photo.id, ingredientId: f.photo.ingredientId, bindingDigest: photoBindingDigest(f.photo) }).version, 0);
      for (const method of ['HEAD', 'PUT', 'DELETE']) assert.equal((await fetch(f.base + f.path, { method, headers: p.reviewer.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path + '?token=fixture', { headers: p.reviewer.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path, { headers: { ...p.reviewer.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
      for (const body of [{ ...p.input, approved: true }, { ...p.input, candidate: f.photo }, { ...p.input, actorId: f.admin.id }, { ...p.input, verificationConfirmed: false }, { ...p.input, attributionPlan: ' ' }]) assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: JSON.stringify(body) })).status, 400);
      for (const headers of [{ ...p.reviewer.headers, 'X-CSRF-Token': 'bad' }, { ...p.reviewer.headers, Origin: 'https://foreign.example.test' }]) assert.equal((await fetch(f.base + f.path, { method: 'POST', headers, body: JSON.stringify(p.input) })).status, 403);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...p.reviewer.headers, 'Content-Type': 'text/plain' }, body: 'not-json' })).status, 400);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: JSON.stringify({ ...p.input, comment: 'x'.repeat(20000) }) })).status, 413);
      assert.equal((await fetch(f.base + f.path, { headers: p.editor.headers })).status, 200);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.editor.headers, body: JSON.stringify(p.input) })).status, 403);
      assert.equal((await fetch(f.base + '/api/v1/private-photo-rights/absent-photo', { headers: p.reviewer.headers })).status, 404);
      for (const path of ['/api/v1/private-photos', `/api/v1/private-photos/${f.photo.id}/original`]) assert.equal((await fetch(f.base + path, { method: 'POST', headers: p.reviewer.headers, body: '{}' })).status, 400);
      assert.equal((await f.stores.photoRights.detail(f.photo)).version, 0);
      const maximum = JSON.stringify({ ...p.input, evidenceReference: '据'.repeat(400), attributionPlan: '署'.repeat(500), alterationPlan: '改'.repeat(500), comment: '注'.repeat(1200) });
      assert(Buffer.byteLength(maximum) > 8192); assert(Buffer.byteLength(maximum) <= 16384);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: maximum })).status, 201);
    } finally { await f.close(); }
  });
  test(`${engine} typed rights client → authenticated HTTP → persisted approval/revoke history stays private`, async () => {
    const f = await fixture(), native = globalThis.fetch;
    try {
      const p = await prepared(f), before = await f.stores.catalog.publicSnapshot();
      globalThis.fetch = (url, options) => native(typeof url === 'string' && url.startsWith('/') ? f.base + url : url, { ...options, headers: { ...options?.headers, Cookie: p.reviewer.headers.Cookie, Origin: p.reviewer.headers.Origin } });
      const previous = await readPhotoRights(f.photo, p.reviewer.session, new AbortController().signal);
      const saved = await reviewPhotoRights(f.photo, p.input, p.reviewer.session, new AbortController().signal);
      assert.equal(saved.actorId, f.reviewer.id); assert.equal(saved.submissionDigest, p.submission.digest);
      const current = await readPhotoRights(f.photo, p.reviewer.session, new AbortController().signal, previous);
      assert.equal(current.detail.state, 'recorded'); assert.equal(current.detail.publicationEligible, false); assert.deepEqual(current.detail.history, [saved]);
      const revoked = await reviewPhotoRights(f.photo, { ...p.input, expectedVersion: 1, decision: 'revoke' }, p.reviewer.session, new AbortController().signal);
      const final = await readPhotoRights(f.photo, p.reviewer.session, new AbortController().signal, current);
      assert.equal(final.detail.state, 'revoked'); assert.deepEqual((await f.stores.photoRights.detail(f.photo)).history, [revoked, saved]);
      assert.deepEqual(await f.stores.catalog.publicSnapshot(), before); assert(!JSON.stringify(final).includes('localPath'));
      await f.stores.auth.logout(p.reviewer.headers.Cookie.slice('food_session='.length), f.reviewer.username);
      await assert.rejects(reviewPhotoRights(f.photo, { ...p.input, expectedVersion: 2 }, p.reviewer.session, new AbortController().signal));
      assert.equal((await f.stores.photoRights.detail(f.photo)).version, 2);
    } finally { globalThis.fetch = native; await f.close(); }
  });
  test(`${engine} rights HTTP rejects contributors and stale note/submission heads; concurrent decisions have one winner`, async () => {
    const f = await fixture();
    try {
      const p = await prepared(f);
      const stale = await fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: JSON.stringify({ ...p.input, bindingDigest: `sha256:${'0'.repeat(64)}` }) }); assert.equal(stale.status, 409);
      const nextNote = await f.stores.photoNotes.save(f.photo, noteInput(1, f.photo), p.authority);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: JSON.stringify(p.input) })).status, 409);
      const submission = await f.stores.photoSubmissions.submit(f.photo, submissionInput(nextNote, 1), p.authority), input = rightsInput(submission);
      const admin = await f.login(f.admin), adminAuthority = { account: admin.session.user, token: admin.headers.Cookie.slice('food_session='.length) };
      const adminNote = await f.stores.photoNotes.save(f.photo, noteInput(2, f.photo), adminAuthority);
      const currentSubmission = await f.stores.photoSubmissions.submit(f.photo, submissionInput(adminNote, 2), p.authority), currentInput = rightsInput(currentSubmission);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: admin.headers, body: JSON.stringify(currentInput) })).status, 403);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: JSON.stringify(input) })).status, 409);
      const results = await Promise.all([1, 2].map(() => fetch(f.base + f.path, { method: 'POST', headers: p.reviewer.headers, body: JSON.stringify(currentInput) })));
      assert.deepEqual(results.map(item => item.status).sort(), [201, 409]); const winner = results.find(item => item.status === 201); assert(winner);
      assert.equal(parseSavedPhotoRights(await winner.json(), f.photo, currentInput, p.reviewer.session.user).version, 1);
      assert.equal((await f.stores.photoRights.detail(f.photo)).history.length, 1);
    } finally { await f.close(); }
  });
  test(`${engine} lost rights response is not retried; explicit typed reread finds the exact committed intent`, async () => {
    const f = await fixture(), native = globalThis.fetch; let posts = 0;
    try {
      const p = await prepared(f);
      globalThis.fetch = async (url, options) => {
        const result = await native(typeof url === 'string' && url.startsWith('/') ? f.base + url : url, { ...options, headers: { ...options?.headers, Cookie: p.reviewer.headers.Cookie, Origin: p.reviewer.headers.Origin } });
        if (options?.method === 'POST') { posts++; assert.equal(result.status, 201); await result.json(); return Response.json({ cannotConfirm: true }, { status: 201 }); }
        return result;
      };
      await assert.rejects(reviewPhotoRights(f.photo, p.input, p.reviewer.session, new AbortController().signal), /无法确认提交结果/); assert.equal(posts, 1);
      const observed = await readPhotoRights(f.photo, p.reviewer.session, new AbortController().signal);
      assert(observed.detail.history.some(item => matchesPhotoRightsAttempt(item, f.photo, p.input, p.reviewer.session.user)));
      assert.equal(posts, 1); assert.equal((await f.stores.photoRights.detail(f.photo)).version, 1); assert.equal(observed.detail.publicationEligible, false);
    } finally { globalThis.fetch = native; await f.close(); }
  });
  test(`${engine} disabled library and local-key mode cannot expose or write private rights decisions`, async () => {
    for (const localKey of [undefined, 'fixture-local-key-only-32-characters-long']) {
      const f = await fixture(false, localKey);
      try {
        const headers = localKey ? { Authorization: `Bearer ${localKey}` } : (await f.login(f.admin)).headers;
        assert.equal((await fetch(f.base + f.path, { headers })).status, localKey ? 403 : 404);
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, localKey ? 403 : 404);
      } finally { await f.close(); }
    }
  });
}
