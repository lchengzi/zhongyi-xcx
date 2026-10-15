import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProfessionalKind } from '../shared/contracts.js';
import type { PhotoProfessionalCredential } from '../shared/photo-professional-response.js';
import { parsePhotoProfessionalDetail, matchesPhotoProfessionalAttempt } from '../shared/photo-professional-response.js';
import { readPhotoProfessional, reviewPhotoProfessional } from '../web/photo-professional-api.js';
import { photoBindingDigest } from '../server/photo-note-values.js';
import { photoHttpFixture, type PhotoHttpBackend } from './photo-note-http-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { rightsInput } from './photo-rights-fixture.js';
import { credentialInput } from './professional-fixture.js';
import { fixturePassword } from './migration-fixture.js';
import { professionalReviewInput } from './photo-professional-response-fixture.js';

type Fixture = Awaited<ReturnType<typeof photoHttpFixture>>;
async function prepared(f: Fixture) {
  const editor = await f.login(f.editor), admin = await f.login(f.admin), reviewer = await f.login(f.reviewer);
  const editAuthority = { account: editor.session.user, token: editor.headers.Cookie.slice('food_session='.length) };
  const adminAuthority = { account: admin.session.user, token: admin.headers.Cookie.slice('food_session='.length) };
  const note = await f.stores.photoNotes.save(f.photo, noteInput(0, f.photo), editAuthority);
  const submission = await f.stores.photoSubmissions.submit(f.photo, submissionInput(note), editAuthority);
  await f.stores.photoRights.review(f.photo, rightsInput(submission), { account: reviewer.session.user, token: reviewer.headers.Cookie.slice('food_session='.length) });
  async function person(profession: ProfessionalKind, name: string) {
    const account = await f.stores.auth.createUser(name, fixturePassword, 'reviewer', 'ENGINEERING_SIMULATION_NOT_REAL');
    await f.stores.workflow.saveQualification(account.id, credentialInput(profession), 0, admin.session.user, adminAuthority.token);
    const login = await f.login(account), qualification = (await f.stores.workflow.qualificationHistory(account.id))[0];
    const credential: PhotoProfessionalCredential = { userId: qualification.userId, revision: qualification.revision, digest: qualification.digest,
      profession: qualification.profession, evidenceKind: qualification.evidenceKind };
    return { ...login, credential, authority: { account: login.session.user, token: login.headers.Cookie.slice('food_session='.length) } };
  }
  const physician = await person('tcm_physician', 'http-photo-physician'), pharmacist = await person('pharmacist', 'http-photo-pharmacist');
  const input = async (credential: PhotoProfessionalCredential, decision: 'approve' | 'return' | 'revoke' = 'approve') => professionalReviewInput(await f.stores.photoProfessional.detail(f.photo), credential, decision);
  return { editor, admin, reviewer, editAuthority, adminAuthority, physician, pharmacist, input };
}
export function registerPhotoProfessionalHttpTests(engine: string, backend: () => Promise<PhotoHttpBackend>) {
  const fixture = (configured = true, localKey?: string) => photoHttpFixture(backend, 'private-photo-professional', configured, localKey);
  test(`${engine} professional image HTTP rejects anonymous, wrong roles, methods, CSRF, unknown fields and oversized bodies`, async () => {
    const f = await fixture(); try {
      assert.equal((await fetch(f.base + f.path)).status, 401);
      const p = await prepared(f), input = await p.input(p.physician.credential), read = await fetch(f.base + f.path, { headers: p.editor.headers });
      assert.equal(read.status, 200); assert.equal(read.headers.get('Cache-Control'), 'no-store'); assert.equal(read.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
      assert.equal(parsePhotoProfessionalDetail(await read.json(), { candidateId: f.photo.id, ingredientId: f.photo.ingredientId, bindingDigest: photoBindingDigest(f.photo) }).version, 0);
      for (const method of ['HEAD', 'PUT', 'DELETE']) assert.equal((await fetch(f.base + f.path, { method, headers: p.physician.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path + '?token=fixture', { headers: p.physician.headers })).status, 400);
      assert.equal((await fetch(f.base + f.path, { headers: { ...p.physician.headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
      for (const body of [{ ...input, approved: true }, { ...input, candidate: f.photo }, { ...input, actorId: f.admin.id }, { ...input, evidenceKind: 'manual-verification' },
        { ...input, verificationConfirmed: false }, { ...input, identity: 'unknown' }, { ...input, comment: ' ' }])
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.physician.headers, body: JSON.stringify(body) })).status, 400);
      for (const headers of [{ ...p.physician.headers, 'X-CSRF-Token': 'bad' }, { ...p.physician.headers, Origin: 'https://foreign.example.test' }])
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...p.physician.headers, 'Content-Type': 'text/plain' }, body: 'not-json' })).status, 400);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.physician.headers, body: JSON.stringify({ ...input, comment: 'x'.repeat(20000) }) })).status, 413);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.editor.headers, body: JSON.stringify(input) })).status, 403);
      assert.equal((await fetch(f.base + '/api/v1/private-photo-professional/absent-photo', { headers: p.physician.headers })).status, 404);
      for (const path of ['/api/v1/private-photos', `/api/v1/private-photos/${f.photo.id}/original`])
        assert.equal((await fetch(f.base + path, { method: 'POST', headers: p.physician.headers, body: '{}' })).status, 400);
      assert.equal((await f.stores.photoProfessional.detail(f.photo)).version, 0);
      const maximum = JSON.stringify({ ...input, evidenceReference: '据'.repeat(500), comment: '注'.repeat(1200) });
      assert(Buffer.byteLength(maximum) <= 8192, 'all legal Chinese input fits the configured route limit');
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.physician.headers, body: maximum })).status, 201);
    } finally { await f.close(); }
  });
  test(`${engine} typed professional client authenticates two independent opinions and revocation through HTTP and persists without publishing`, async () => {
    const f = await fixture(), native = globalThis.fetch; try {
      const p = await prepared(f), before = await f.stores.catalog.publicSnapshot(); let actor = p.physician;
      globalThis.fetch = (url, options) => native(typeof url === 'string' && url.startsWith('/') ? f.base + url : url,
        { ...options, headers: { ...options?.headers, Cookie: actor.headers.Cookie, Origin: actor.headers.Origin } });
      const previous = await readPhotoProfessional(f.photo, actor.session, new AbortController().signal);
      const saved = await reviewPhotoProfessional(f.photo, await p.input(actor.credential), actor.credential, actor.session, new AbortController().signal);
      actor = p.pharmacist;
      const second = await reviewPhotoProfessional(f.photo, await p.input(actor.credential), actor.credential, actor.session, new AbortController().signal);
      const current = await readPhotoProfessional(f.photo, actor.session, new AbortController().signal, previous);
      assert.equal(current.detail.state, 'recorded'); assert.equal(current.detail.latestReviews.length, 2); assert.deepEqual(current.detail.history, [second, saved]);
      assert.equal(current.detail.publicationEligible, false); assert(current.detail.reasons.includes('test_evidence'));
      const revoked = await reviewPhotoProfessional(f.photo, await p.input(actor.credential, 'revoke'), actor.credential, actor.session, new AbortController().signal);
      const final = await readPhotoProfessional(f.photo, actor.session, new AbortController().signal, current);
      assert.equal(final.detail.state, 'revoked'); assert.deepEqual((await f.stores.photoProfessional.detail(f.photo)).history, [revoked, second, saved]);
      assert.deepEqual(await f.stores.catalog.publicSnapshot(), before); assert(!JSON.stringify(final).includes('localPath'));
      await f.stores.auth.logout(actor.authority.token, actor.session.user.username);
      await assert.rejects(reviewPhotoProfessional(f.photo, await p.input(actor.credential), actor.credential, actor.session, new AbortController().signal));
      assert.equal((await f.stores.photoProfessional.detail(f.photo)).version, 3);
    } finally { globalThis.fetch = native; await f.close(); }
  });
  test(`${engine} professional image HTTP serializes competing heads and rechecks stale credentials and contributors on the server`, async () => {
    const f = await fixture(); try {
      const p = await prepared(f), input = await p.input(p.physician.credential);
      for (const body of [{ ...input, expectedNoteVersion: 2 }, { ...input, expectedSubmissionVersion: 2 }, { ...input, expectedRightsVersion: 2 },
        { ...input, qualificationDigest: `sha256:${'0'.repeat(64)}` }, { ...input, bindingDigest: `sha256:${'0'.repeat(64)}` }])
        assert([403, 409].includes((await fetch(f.base + f.path, { method: 'POST', headers: p.physician.headers, body: JSON.stringify(body) })).status));
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.physician.headers, body: JSON.stringify({ ...input, part: 'uncertain' }) })).status, 400);
      const results = await Promise.all([1, 2].map(() => fetch(f.base + f.path, { method: 'POST', headers: p.physician.headers, body: JSON.stringify(input) })));
      assert.deepEqual(results.map(item => item.status).sort(), [201, 409]);
      await f.stores.workflow.saveQualification(p.pharmacist.session.user.id, { ...credentialInput('pharmacist'), status: 'revoked' }, 1, p.admin.session.user, p.adminAuthority.token);
      assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: p.pharmacist.headers, body: JSON.stringify(await p.input(p.pharmacist.credential)) })).status, 403);
      const contributor = await f.stores.auth.createUser('http-photo-contributor', fixturePassword, 'admin', 'ENGINEERING_SIMULATION_NOT_REAL');
      const contributorLogin = await f.login(contributor), contributorAuthority = { account: contributorLogin.session.user, token: contributorLogin.headers.Cookie.slice('food_session='.length) };
      await f.stores.workflow.saveQualification(contributor.id, credentialInput('tcm_physician'), 0, p.admin.session.user, p.adminAuthority.token);
      const q = (await f.stores.workflow.qualificationHistory(contributor.id))[0];
      const contributorCredential = { userId: q.userId, revision: q.revision, digest: q.digest, profession: q.profession, evidenceKind: q.evidenceKind };
      const note = await f.stores.photoNotes.save(f.photo, noteInput(1, f.photo), contributorAuthority);
      const nextNote = await f.stores.photoNotes.save(f.photo, noteInput(2, f.photo), p.editAuthority);
      const submission = await f.stores.photoSubmissions.submit(f.photo, submissionInput(nextNote, 1), p.editAuthority);
      await f.stores.photoRights.review(f.photo, rightsInput(submission, 1), { account: p.reviewer.session.user, token: p.reviewer.headers.Cookie.slice('food_session='.length) });
      assert.equal(note.actorId, contributor.id);
      const rejected = await fetch(f.base + f.path, { method: 'POST', headers: contributorLogin.headers, body: JSON.stringify(await p.input(contributorCredential)) });
      assert.equal(rejected.status, 403); assert.match(JSON.stringify(await rejected.json()), /photo_professional_independence/);
      assert.equal((await f.stores.photoProfessional.detail(f.photo)).version, 1);
    } finally { await f.close(); }
  });
  test(`${engine} lost professional response sends one POST; explicit reread can match the committed fixed intent`, async () => {
    const f = await fixture(), native = globalThis.fetch; let posts = 0;
    try {
      const p = await prepared(f), actor = p.physician, input = await p.input(actor.credential);
      globalThis.fetch = async (url, options) => {
        const result = await native(typeof url === 'string' && url.startsWith('/') ? f.base + url : url,
          { ...options, headers: { ...options?.headers, Cookie: actor.headers.Cookie, Origin: actor.headers.Origin } });
        if (options?.method === 'POST') { posts++; assert.equal(result.status, 201); await result.json(); return Response.json({ cannotConfirm: true }, { status: 201 }); }
        return result;
      };
      await assert.rejects(reviewPhotoProfessional(f.photo, input, actor.credential, actor.session, new AbortController().signal), /无法确认提交结果/); assert.equal(posts, 1);
      const observed = await readPhotoProfessional(f.photo, actor.session, new AbortController().signal);
      assert(observed.detail.history.some(item => matchesPhotoProfessionalAttempt(item, f.photo, input, actor.session.user, actor.credential)));
      assert.equal(posts, 1); assert.equal((await f.stores.photoProfessional.detail(f.photo)).version, 1); assert.equal(observed.detail.publicationEligible, false);
    } finally { globalThis.fetch = native; await f.close(); }
  });
  test(`${engine} disabled registry and local-key mode cannot expose or write professional image opinions`, async () => {
    for (const localKey of [undefined, 'fixture-local-key-only-32-characters-long']) {
      const f = await fixture(false, localKey); try {
        const headers = localKey ? { Authorization: `Bearer ${localKey}` } : (await f.login(f.admin)).headers;
        assert.equal((await fetch(f.base + f.path, { headers })).status, localKey ? 403 : 404);
        assert.equal((await fetch(f.base + f.path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, localKey ? 403 : 404);
      } finally { await f.close(); }
    }
  });
}
