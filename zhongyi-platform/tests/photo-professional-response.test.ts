import assert from 'node:assert/strict';
import { test } from 'node:test';
import { professionalResponseFixture, professionalReviewInput } from './photo-professional-response-fixture.js';
import { parsePhotoProfessionalCredential, parsePhotoProfessionalDetail, parseSavedPhotoProfessional, parseReloadedPhotoProfessional, photoProfessionalBasisMatches } from '../shared/photo-professional-response.js';
import type { PhotoProfessionalReview } from '../shared/photo-professional.js';
import { readPhotoProfessional, reviewPhotoProfessional, type PhotoProfessionalWorkspace } from '../web/photo-professional-api.js';
import { photoProfessionalDigest } from '../server/photo-professional-policy.js';

const signal = () => new AbortController().signal;
function response(url: string, w: PhotoProfessionalWorkspace) {
  return Response.json(url.includes('/private-photo-professional/') ? w.detail : url.includes('/private-photo-rights/') ? w.rights.detail
    : url.includes('/private-photo-submissions/') ? w.rights.submissions.detail : w.rights.submissions.notes);
}
function rehash(item: PhotoProfessionalReview): PhotoProfessionalReview {
  const { digest: _old, ...payload } = item; return { ...item, digest: photoProfessionalDigest(payload) };
}
test('professional receipt fixes every head, independent conclusion, credential evidence kind and named account epoch', async () => {
  const f = await professionalResponseFixture(); try {
    const q = await f.credential('tcm_physician');
    assert.deepEqual(parseSavedPhotoProfessional(f.saved, f.photo, f.input, f.session.user, q), f.saved);
    for (const bad of [{ ...f.saved, version: 2 }, { ...f.saved, noteVersion: 2 }, { ...f.saved, rightsVersion: 2 }, { ...f.saved, submissionVersion: 2 },
      { ...f.saved, qualificationUserId: 'other' }, { ...f.saved, qualificationRevision: 2 }, { ...f.saved, evidenceKind: 'manual-verification' },
      { ...f.saved, profession: 'pharmacist' }, { ...f.saved, identity: 'uncertain' }, { ...f.saved, part: 'uncertain' }, { ...f.saved, processing: 'mismatch' },
      { ...f.saved, comment: 'changed' }, { ...f.saved, evidenceReference: 'changed' }, { ...f.saved, decision: 'return' }, { ...f.saved, actorId: 'other' },
      { ...f.saved, actorName: 'other' }, { ...f.saved, actorRole: 'admin' }, { ...f.saved, accountRevision: 2 }, { ...f.saved, verificationConfirmed: false }, { ...f.saved, publicationEligible: true }])
      assert.throws(() => parseSavedPhotoProfessional(bad, f.photo, f.input, f.session.user, q));
    assert.throws(() => parsePhotoProfessionalCredential({ ...q, status: 'verified' }));
  } finally { await f.close(); }
});
test('professional detail rejects invented states, discontinuity, duplicate professions, mismatched versions and publication claims', async () => {
  const f = await professionalResponseFixture(); try {
    const w = await f.workspace(), expected = { candidateId: f.photo.id, ingredientId: f.photo.ingredientId, bindingDigest: f.input.bindingDigest };
    assert.deepEqual(parsePhotoProfessionalDetail(w.detail, expected), w.detail); assert(photoProfessionalBasisMatches(w.detail, w.rights.detail));
    for (const bad of [{ ...w.detail, publicationEligible: true }, { ...w.detail, approved: true }, { ...w.detail, state: 'pending' }, { ...w.detail, state: 'revoked' },
      { ...w.detail, state: 'changes_requested' }, { ...w.detail, state: 'eligible_for_derivative_review', reasons: [] }, { ...w.detail, version: 2 }, { ...w.detail, history: [] },
      { ...w.detail, noteDigest: null }, { ...w.detail, rightsDigest: `sha256:${'0'.repeat(64)}` }, { ...w.detail, latestReviews: [f.saved, f.saved] },
      { ...w.detail, history: [rehash({ ...f.saved, ingredientId: 'jiang' })] }, { ...w.detail, reasons: ['test_evidence', 'test_evidence'] }]) assert.throws(() => parsePhotoProfessionalDetail(bad, expected));
    assert(!photoProfessionalBasisMatches({ ...w.detail, rightsVersion: 2 }, w.rights.detail));
    assert(!photoProfessionalBasisMatches(w.detail, { ...w.rights.detail, state: 'stale' }));
    assert(!photoProfessionalBasisMatches({ ...w.detail, state: 'eligible_for_derivative_review' }, w.rights.detail), 'engineering rights cannot upgrade to real eligibility');
  } finally { await f.close(); }
});
test('professional reread retains a latest signer outside the fifty-record window and rejects rewritten old records', async () => {
  const f = await professionalResponseFixture(), native = globalThis.fetch; try {
    const old = (await f.workspace()).detail, revoke = professionalReviewInput(old, await f.credential('tcm_physician'), 'revoke');
    await f.stores.photoProfessional.review(f.photo, revoke, f.prepared.authority('tcm_physician'));
    const newer = (await f.workspace()).detail;
    assert.deepEqual(parseReloadedPhotoProfessional(newer, old), newer); assert.throws(() => parseReloadedPhotoProfessional(old, newer));
    const rewritten = structuredClone(newer); rewritten.history[1] = rehash({ ...rewritten.history[1], comment: 'rewritten' });
    assert.throws(() => parseReloadedPhotoProfessional(rewritten, old));
    // Keep pharmacist version3 fixed while physician opinions fill the window.
    await f.stores.photoProfessional.review(f.photo, professionalReviewInput(newer, await f.credential('pharmacist')), f.prepared.authority('pharmacist'));
    const anchored = (await f.workspace()).detail;
    for (let i = 0; i < 26; i++) {
      let detail = (await f.workspace()).detail;
      await f.stores.photoProfessional.review(f.photo, professionalReviewInput(detail, await f.credential('tcm_physician')), f.prepared.authority('tcm_physician'));
      detail = (await f.workspace()).detail;
      await f.stores.photoProfessional.review(f.photo, professionalReviewInput(detail, await f.credential('tcm_physician'), 'revoke'), f.prepared.authority('tcm_physician'));
    }
    const window = (await f.workspace()).detail; assert.equal(window.version, 55); assert.equal(window.history.length, 50);
    assert(window.latestReviews.some(item => item.version === 3)); assert.equal(parseReloadedPhotoProfessional(window, anchored).version, 55);
    const omitted = { ...window, latestReviews: window.latestReviews.filter(item => item.profession !== 'pharmacist') };
    assert.throws(() => parseReloadedPhotoProfessional(omitted, anchored));
    const changed = structuredClone(window); changed.latestReviews = changed.latestReviews.map(item => item.version === 3 ? rehash({ ...item, comment: 'rehashed old signer' }) : item);
    assert.throws(() => parseReloadedPhotoProfessional(changed, anchored));
    const w = await f.workspace();
    globalThis.fetch = async url => response(String(url), w);
    assert.equal((await readPhotoProfessional(f.photo, f.session, signal())).detail.version, 55);
    const corrupt = structuredClone(w); corrupt.detail.latestReviews = corrupt.detail.latestReviews.map(item => item.version === 3 ? { ...item, comment: 'outside-window digest tampering' } : item);
    globalThis.fetch = async url => response(String(url), corrupt);
    await assert.rejects(readPhotoProfessional(f.photo, f.session, signal()), /摘要不匹配/);
  } finally { globalThis.fetch = native; await f.close(); }
});
test('typed professional reads verify all four paired documents, canonical digests and same-origin ownership', async () => {
  const f = await professionalResponseFixture(), native = globalThis.fetch, calls: { url: string; options?: RequestInit }[] = [];
  try {
    const w = await f.workspace();
    globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return response(String(url), w); };
    assert.deepEqual(await readPhotoProfessional(f.photo, f.session, signal()), w); assert.equal(calls.length, 4);
    assert(calls.every(call => call.url.startsWith('/api/v1/private-photo-') && call.options?.redirect === 'error' && call.options.credentials === 'same-origin'));
    // JSON field order is transport-dependent; parsed canonical order is not.
    globalThis.fetch = async url => String(url).includes('/private-photo-professional/')
      ? Response.json({ ...w.detail, history: w.detail.history.map(item => Object.fromEntries(Object.entries(item).reverse())),
        latestReviews: w.detail.latestReviews.map(item => Object.fromEntries(Object.entries(item).reverse())) }) : response(String(url), w);
    assert.deepEqual(await readPhotoProfessional(f.photo, f.session, signal()), w);
    globalThis.fetch = async url => response(String(url), { ...w, detail: { ...w.detail, history: [{ ...f.saved, comment: 'digest tampering' }], latestReviews: [{ ...f.saved, comment: 'digest tampering' }] } });
    await assert.rejects(readPhotoProfessional(f.photo, f.session, signal()), /摘要不匹配/);
    globalThis.fetch = async url => response(String(url), { ...w, detail: { ...w.detail, state: 'stale', reasons: ['review_basis_changed'], rightsVersion: 2, rightsDigest: `sha256:${'1'.repeat(64)}` } });
    await assert.rejects(readPhotoProfessional(f.photo, f.session, signal()), /版本不一致/);
  } finally { globalThis.fetch = native; await f.close(); }
});
test('typed professional writes detach caller data and credential, verify digests and never retry unknown outcomes', async () => {
  const f = await professionalResponseFixture(), native = globalThis.fetch; let posts = 0;
  try {
    const q = await f.credential('tcm_physician'), input = { ...f.input }, credential = { ...q }, photo = structuredClone(f.photo), owner = structuredClone(f.session);
    globalThis.fetch = async (_url, options) => { posts++; assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), f.session.csrfToken); return Response.json(f.saved); };
    const pending = reviewPhotoProfessional(photo, input, credential, owner, signal());
    input.comment = 'late mutation'; credential.evidenceKind = 'manual-verification'; owner.csrfToken = 'late-token'; photo.concerns.push('late mutation');
    assert.deepEqual(await pending, f.saved); assert.equal(posts, 1);
    globalThis.fetch = async () => { posts++; return Response.json({ ...f.saved, digest: `sha256:${'0'.repeat(64)}` }); };
    await assert.rejects(reviewPhotoProfessional(f.photo, f.input, q, f.session, signal()), /无法确认专业审校结果/); assert.equal(posts, 2);
    globalThis.fetch = async () => { posts++; return Response.json(rehash({ ...f.saved, evidenceKind: 'manual-verification' })); };
    await assert.rejects(reviewPhotoProfessional(f.photo, f.input, q, f.session, signal()), /无法确认提交结果/); assert.equal(posts, 3);
    await assert.rejects(reviewPhotoProfessional(f.photo, f.input, { ...q, revision: 2 }, f.session, signal()), /资格依据/); assert.equal(posts, 3);
  } finally { globalThis.fetch = native; await f.close(); }
});
test('professional requests discard late cancelled results, abort failed siblings and pre-aborted writes never dispatch', async () => {
  const f = await professionalResponseFixture(), native = globalThis.fetch;
  try {
    const w = await f.workspace(), controller = new AbortController();
    globalThis.fetch = async url => { controller.abort(); return response(String(url), w); };
    await assert.rejects(readPhotoProfessional(f.photo, f.session, controller.signal), error => error instanceof Error && error.name === 'AbortError');
    let sibling: AbortSignal | null | undefined, entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/private-photo-notes/')) { sibling = options?.signal; entered(); return new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }); }); }
      if (String(url).includes('/private-photo-professional/')) { await ready; return Response.json({ invalid: true }); }
      return response(String(url), w);
    };
    await assert.rejects(readPhotoProfessional(f.photo, f.session, signal())); assert(sibling?.aborted);
    const cancelled = new AbortController(); cancelled.abort(); let called = false;
    globalThis.fetch = async () => { called = true; return Response.json(f.saved); };
    await assert.rejects(reviewPhotoProfessional(f.photo, f.input, await f.credential('tcm_physician'), f.session, cancelled.signal), error => error instanceof Error && error.name === 'AbortError'); assert.equal(called, false);
  } finally { globalThis.fetch = native; await f.close(); }
});
