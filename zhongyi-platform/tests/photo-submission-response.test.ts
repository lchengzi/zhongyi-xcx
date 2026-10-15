import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, SessionInfo } from '../shared/contracts.js';
import { PHOTO_NOTE_SCHEMA, type PhotoNote, type PhotoNoteDetail } from '../shared/photo-notes.js';
import { PHOTO_SUBMISSION_SCHEMA, parsePhotoSubmissionDetail, parseReloadedPhotoSubmissions, parseSavedPhotoSubmission, photoSubmissionBasisMatches, type PhotoSubmission, type PhotoSubmissionDetail } from '../shared/photo-submissions.js';
import { photoNoteDigest } from '../server/photo-note-values.js';
import { photoSubmissionDigest } from '../server/photo-submission-values.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { readPhotoSubmissions, submitPhoto } from '../web/photo-submission-api.js';

const actor: Account = { id: 'fixture-editor', username: 'fixture-editor', role: 'editor', active: true, revision: 1, createdAt: '2026-10-12T00:00:00.000Z' };
const session: SessionInfo = { user: actor, csrfToken: 'fixture-csrf', expiresAt: '2026-10-13T00:00:00.000Z' };
function note(version = 1): PhotoNote {
  const input = noteInput(), payload = { candidate: notePhoto(), bindingDigest: input.bindingDigest, version, category: input.category, text: input.text, evidenceReference: input.evidenceReference,
    actorId: actor.id, actorName: actor.username, accountRevision: actor.revision, createdAt: actor.createdAt };
  return { ...payload, digest: photoNoteDigest(payload) };
}
function submission(version = 1): PhotoSubmission {
  const input = submissionInput(note(), version - 1), payload = { candidate: notePhoto(), bindingDigest: input.bindingDigest, version, noteVersion: 1, noteDigest: input.noteDigest,
    caption: input.caption, partDescription: input.partDescription, processingDescription: input.processingDescription, evidenceReference: input.evidenceReference, submissionConfirmed: true as const,
    actorId: actor.id, actorName: actor.username, accountRevision: actor.revision, createdAt: actor.createdAt };
  return { ...payload, digest: photoSubmissionDigest(payload) };
}
const notes = (version = 1): PhotoNoteDetail => ({ schemaVersion: PHOTO_NOTE_SCHEMA, candidateId: notePhoto().id, bindingDigest: noteInput().bindingDigest, version,
  history: Array.from({ length: Math.min(50, version) }, (_, index) => note(version - index)) });
const detail = (version = 1): PhotoSubmissionDetail => ({ schemaVersion: PHOTO_SUBMISSION_SCHEMA, candidateId: notePhoto().id, bindingDigest: noteInput().bindingDigest,
  noteVersion: 1, noteDigest: note().digest, noteBindingDigest: noteInput().bindingDigest, version, history: Array.from({ length: Math.min(50, version) }, (_, index) => submission(version - index)) });
const signal = () => new AbortController().signal;

test('submission acknowledgement binds exact intent, candidate, note head and account revision; approvals are never accepted', () => {
  const input = submissionInput(note());
  assert.deepEqual(parseSavedPhotoSubmission(submission(), notePhoto(), input, actor), submission());
  for (const bad of [{ ...submission(), version: 2 }, { ...submission(), noteVersion: 2 }, { ...submission(), caption: 'foreign' }, { ...submission(), accountRevision: 2 },
    { ...submission(), actorId: 'foreign' }, { ...submission(), approved: true }, { ...submission(), candidate: { ...notePhoto(), sourceRevision: '2' } }]) {
    assert.throws(() => parseSavedPhotoSubmission(bad, notePhoto(), input, actor));
  }
});
test('submission reread rejects regression, immutable rewrites and incompatible current note heads, accepting a sliding 50-row window', () => {
  assert.deepEqual(parseReloadedPhotoSubmissions(detail(3), detail(2)), detail(3));
  assert.deepEqual(parseReloadedPhotoSubmissions(detail(53), detail(2)), detail(53));
  assert.throws(() => parseReloadedPhotoSubmissions(detail(1), detail(2)));
  const bad = detail(2); bad.history[1].caption = 'rewritten'; assert.throws(() => parseReloadedPhotoSubmissions(bad, detail(1)));
  assert.throws(() => parsePhotoSubmissionDetail({ ...detail(), noteDigest: `sha256:${'0'.repeat(64)}` }, detail()));
  assert(photoSubmissionBasisMatches(detail(), notes())); assert(!photoSubmissionBasisMatches(detail(), notes(2)));
});
test('actual submission JSON client checks paired note versions, independent digests and same-origin requests without credentials in URLs', async () => {
  const native = globalThis.fetch, calls: { url: string; options?: RequestInit }[] = [];
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json(options?.method === 'POST' ? submission() : String(url).includes('/private-photo-notes/') ? notes() : detail()); };
    assert.deepEqual(await readPhotoSubmissions(notePhoto(), session, signal()), { detail: detail(), notes: notes() });
    assert.deepEqual(await submitPhoto(notePhoto(), submissionInput(note()), session, signal()), submission());
    assert.equal(calls.length, 3);
    assert(calls.every(call => /^\/api\/v1\/private-photo-(notes|submissions)\/[^?]+$/.test(call.url) && call.options?.redirect === 'error' && call.options.credentials === 'same-origin'));
    assert.equal(new Headers(calls[2].options?.headers).get('Authorization'), null);
    assert.equal(new Headers(calls[2].options?.headers).get('X-CSRF-Token'), session.csrfToken);
    globalThis.fetch = async url => Response.json(String(url).includes('/private-photo-notes/') ? notes(2) : detail());
    await assert.rejects(readPhotoSubmissions(notePhoto(), session, signal()), /版本不一致/);
  } finally { globalThis.fetch = native; }
});
test('submission client rejects corrupt receipts/history without retrying, and owns input before asynchronous hashing', async () => {
  const native = globalThis.fetch; let posts = 0;
  try {
    globalThis.fetch = async () => { posts++; return Response.json(submission()); };
    const input = submissionInput(note()), pending = submitPhoto(notePhoto(), input, session, signal()); input.caption = 'caller changed after invocation';
    assert.equal((await pending).caption, submission().caption); assert.equal(posts, 1);
    globalThis.fetch = async () => { posts++; return Response.json({ ...submission(), digest: `sha256:${'0'.repeat(64)}` }); };
    await assert.rejects(submitPhoto(notePhoto(), submissionInput(note()), session, signal()), /无法确认送审结果/); assert.equal(posts, 2);
    globalThis.fetch = async url => Response.json(String(url).includes('/private-photo-notes/') ? notes() : { ...detail(), history: [{ ...submission(), digest: `sha256:${'0'.repeat(64)}` }] });
    await assert.rejects(readPhotoSubmissions(notePhoto(), session, signal()), /摘要不匹配/);
  } finally { globalThis.fetch = native; }
});
test('submission client cancels valid late responses and cancels a sibling read when the other read fails', async () => {
  const native = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async url => { controller.abort(); return Response.json(String(url).includes('/private-photo-notes/') ? notes() : detail()); };
    await assert.rejects(readPhotoSubmissions(notePhoto(), session, controller.signal), error => error instanceof Error && error.name === 'AbortError');
    let sibling: AbortSignal | null | undefined, started!: () => void;
    const entered = new Promise<void>(done => { started = done; });
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/private-photo-notes/')) { sibling = options?.signal; started(); return new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }); }); }
      await entered; return Response.json({ wrong: true });
    };
    await assert.rejects(readPhotoSubmissions(notePhoto(), session, signal())); assert(sibling?.aborted);
    const cancelled = new AbortController(); cancelled.abort(); let called = false;
    globalThis.fetch = async () => { called = true; return Response.json(detail()); };
    await assert.rejects(submitPhoto(notePhoto(), submissionInput(note()), session, cancelled.signal), error => error instanceof Error && error.name === 'AbortError'); assert.equal(called, false);
  } finally { globalThis.fetch = native; }
});
