import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rightsResponseFixture } from './photo-rights-response-fixture.js';
import { parsePhotoRightsDetail, parseReloadedPhotoRights, parseSavedPhotoRights, photoRightsBasisMatches } from '../shared/photo-rights-response.js';
import { readPhotoRights, reviewPhotoRights, type PhotoRightsWorkspace } from '../web/photo-rights-api.js';
import { photoBindingDigest } from '../server/photo-note-values.js';

const signal = () => new AbortController().signal;
function response(url: string, workspace: PhotoRightsWorkspace) {
  return Response.json(url.includes('/private-photo-notes/') ? workspace.submissions.notes : url.includes('/private-photo-submissions/') ? workspace.submissions.detail : workspace.detail);
}
test('rights acknowledgement binds exact decision, evidence, usage, expiry and named account epoch without granting publication', async () => {
  const f = await rightsResponseFixture();
  try {
    assert.deepEqual(parseSavedPhotoRights(f.saved, f.photo, f.input, f.session.user), f.saved);
    for (const bad of [{ ...f.saved, version: 2 }, { ...f.saved, submissionVersion: 2 }, { ...f.saved, evidenceKind: 'manual-verification' }, { ...f.saved, decision: 'return' },
      { ...f.saved, comment: 'different' }, { ...f.saved, attributionPlan: 'different' }, { ...f.saved, alterationPlan: 'different' }, { ...f.saved, actorRole: 'admin' },
      { ...f.saved, actorId: 'foreign' }, { ...f.saved, accountRevision: 2 }, { ...f.saved, publicationEligible: true }, { ...f.saved, verificationConfirmed: false }]) assert.throws(() => parseSavedPhotoRights(bad, f.photo, f.input, f.session.user));
  } finally { await f.close(); }
});
test('rights detail rejects forged state, unrelated heads and discontinuous history; changed originals remain readable as stale', async () => {
  const f = await rightsResponseFixture();
  try {
    const w = await f.workspace(), expected = { candidateId: f.photo.id, ingredientId: f.photo.ingredientId, bindingDigest: f.input.bindingDigest };
    assert.deepEqual(parsePhotoRightsDetail(w.detail, expected), w.detail); assert(photoRightsBasisMatches(w.detail, w.submissions.detail));
    for (const bad of [{ ...w.detail, publicationEligible: true }, { ...w.detail, state: 'rights_verified' }, { ...w.detail, state: 'pending' }, { ...w.detail, state: 'revoked' },
      { ...w.detail, version: 2 }, { ...w.detail, submissionDigest: `sha256:${'0'.repeat(64)}` }, { ...w.detail, history: [{ ...f.saved, ingredientId: 'jiang' }] },
      { ...w.detail, history: [{ ...f.saved, validUntil: f.saved.createdAt }] }, { ...w.detail, history: [] }, { ...w.detail, approved: true }]) assert.throws(() => parsePhotoRightsDetail(bad, expected));
    const changed = { ...f.photo, sourceRevision: '2' }, stale = await f.stores.photoRights.detail(changed);
    assert.equal(stale.state, 'stale'); assert.deepEqual(parsePhotoRightsDetail(stale, { ...expected, bindingDigest: photoBindingDigest(changed) }), stale);
    assert(!photoRightsBasisMatches({ ...w.detail, noteVersion: 2 }, w.submissions.detail));
  } finally { await f.close(); }
});
test('rights reread preserves immutable decisions and heads across a sliding fifty-record window', async () => {
  const f = await rightsResponseFixture();
  try {
    const old = (await f.workspace()).detail;
    await f.stores.photoRights.review(f.photo, { ...f.input, expectedVersion: 1 }, f.prepared.reviewAuthority);
    const current = (await f.workspace()).detail;
    assert.deepEqual(parseReloadedPhotoRights(current, old), current); assert.throws(() => parseReloadedPhotoRights(old, current));
    const rewritten = structuredClone(current); rewritten.history[1].comment = 'rewritten'; assert.throws(() => parseReloadedPhotoRights(rewritten, old));
    for (let version = 2; version < 52; version++) await f.stores.photoRights.review(f.photo, { ...f.input, expectedVersion: version }, f.prepared.reviewAuthority);
    const sliding = (await f.workspace()).detail; assert.equal(sliding.history.length, 50); assert.equal(parseReloadedPhotoRights(sliding, old).version, 52);
  } finally { await f.close(); }
});
test('typed rights client validates paired submission/note heads and all hashes with same-origin requests', async () => {
  const f = await rightsResponseFixture(), native = globalThis.fetch, calls: { url: string; options?: RequestInit }[] = [];
  try {
    const w = await f.workspace();
    globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return options?.method === 'POST' ? Response.json(f.saved) : response(String(url), w); };
    assert.deepEqual(await readPhotoRights(f.photo, f.session, signal()), w);
    assert.deepEqual(await reviewPhotoRights(f.photo, f.input, f.session, signal()), f.saved); assert.equal(calls.length, 4);
    assert(calls.every(call => /^\/api\/v1\/private-photo-(notes|submissions|rights)\/[^?]+$/.test(call.url) && call.options?.redirect === 'error' && call.options.credentials === 'same-origin'));
    const headers = new Headers(calls[3].options?.headers); assert.equal(headers.get('Authorization'), null); assert.equal(headers.get('X-CSRF-Token'), f.session.csrfToken);
    globalThis.fetch = async url => response(String(url), { ...w, detail: { ...w.detail, noteVersion: 2 } });
    await assert.rejects(readPhotoRights(f.photo, f.session, signal()), /版本不一致/);
    globalThis.fetch = async url => response(String(url), { ...w, detail: { ...w.detail, history: [{ ...f.saved, comment: 'digest changed' }] } });
    await assert.rejects(readPhotoRights(f.photo, f.session, signal()), /摘要不匹配/);
  } finally { globalThis.fetch = native; await f.close(); }
});
test('rights writes own caller input before hashing, reject corrupt or forged receipts and never retry', async () => {
  const f = await rightsResponseFixture(), native = globalThis.fetch; let posts = 0;
  try {
    globalThis.fetch = async () => { posts++; return Response.json(f.saved); };
    const input = { ...f.input }, pending = reviewPhotoRights(f.photo, input, f.session, signal()); input.comment = 'late caller mutation';
    assert.deepEqual(await pending, f.saved); assert.equal(posts, 1);
    globalThis.fetch = async () => { posts++; return Response.json({ ...f.saved, digest: `sha256:${'0'.repeat(64)}` }); };
    await assert.rejects(reviewPhotoRights(f.photo, f.input, f.session, signal()), /无法确认权利审核结果/); assert.equal(posts, 2);
    globalThis.fetch = async () => { posts++; return Response.json({ ...f.saved, actorName: 'foreign' }); };
    await assert.rejects(reviewPhotoRights(f.photo, f.input, f.session, signal()), /无法确认提交结果/); assert.equal(posts, 3);
  } finally { globalThis.fetch = native; await f.close(); }
});
test('rights reads cancel late data and failed sibling requests; pre-cancelled writes do not dispatch', async () => {
  const f = await rightsResponseFixture(), native = globalThis.fetch;
  try {
    const w = await f.workspace(), controller = new AbortController();
    globalThis.fetch = async url => { controller.abort(); return response(String(url), w); };
    await assert.rejects(readPhotoRights(f.photo, f.session, controller.signal), error => error instanceof Error && error.name === 'AbortError');
    let sibling: AbortSignal | null | undefined, enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/private-photo-notes/')) { sibling = options?.signal; enter(); return new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }); }); }
      if (String(url).includes('/private-photo-rights/')) { await entered; return Response.json({ invalid: true }); }
      return response(String(url), w);
    };
    await assert.rejects(readPhotoRights(f.photo, f.session, signal())); assert(sibling?.aborted);
    const cancelled = new AbortController(); cancelled.abort(); let called = false;
    globalThis.fetch = async () => { called = true; return Response.json(f.saved); };
    await assert.rejects(reviewPhotoRights(f.photo, f.input, f.session, cancelled.signal), error => error instanceof Error && error.name === 'AbortError'); assert.equal(called, false);
  } finally { globalThis.fetch = native; await f.close(); }
});
