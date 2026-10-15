import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, SessionInfo } from '../shared/contracts.js';
import { PHOTO_NOTE_SCHEMA, parsePhotoNoteDetail, parseReloadedPhotoNotes, parseSavedPhotoNote, type PhotoNote, type PhotoNoteInput, type PhotoNoteDetail } from '../shared/photo-notes.js';
import { photoNoteDigest } from '../server/photo-note-values.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { readPhotoNotes, savePhotoNote } from '../web/photo-note-api.js';

const actor: Account = { id: 'fixture-editor', username: 'fixture-editor', role: 'editor', active: true, revision: 1, createdAt: '2026-10-12T00:00:00.000Z' };
const session: SessionInfo = { user: actor, csrfToken: 'fixture-csrf', expiresAt: '2026-10-13T00:00:00.000Z' };
const input = (): PhotoNoteInput => ({ ...noteInput(), category: 'identity' });
function note(version = 1): PhotoNote {
  const payload = { candidate: notePhoto(), bindingDigest: input().bindingDigest, version, category: input().category, text: input().text, evidenceReference: input().evidenceReference,
    actorId: actor.id, actorName: actor.username, accountRevision: actor.revision, createdAt: '2026-10-12T00:00:00.000Z' };
  return { ...payload, digest: photoNoteDigest(payload) };
}
const detail = (version = 1): PhotoNoteDetail => ({ schemaVersion: PHOTO_NOTE_SCHEMA, candidateId: notePhoto().id, bindingDigest: input().bindingDigest, version,
  history: Array.from({ length: Math.min(50, version) }, (_, index) => note(version - index)) });
test('photo saved acknowledgement binds exact candidate, intent, actor epoch and next version, not arbitrary success JSON', () => {
  assert.deepEqual(parseSavedPhotoNote(note(), notePhoto(), input(), actor), note());
  for (const bad of [{ ...note(), version: 2 }, { ...note(), actorId: 'someone-else' }, { ...note(), accountRevision: 2 }, { ...note(), text: 'foreign' },
    { ...note(), candidate: { ...notePhoto(), sourceRevision: '2' } }, { ...note(), approved: true }]) assert.throws(() => parseSavedPhotoNote(bad, notePhoto(), input(), actor));
});
test('photo reread rejects regression and immutable substitutions but accepts a sliding 50-row history window', () => {
  assert.deepEqual(parseReloadedPhotoNotes(detail(3), detail(2)), detail(3)); assert.deepEqual(parseReloadedPhotoNotes(detail(53), detail(2)), detail(53));
  assert.throws(() => parseReloadedPhotoNotes(detail(1), detail(2)));
  const bad = detail(2); bad.history[1].text = 'rewritten'; assert.throws(() => parseReloadedPhotoNotes(bad, detail(1)));
  assert.throws(() => parsePhotoNoteDetail({ ...detail(), history: [{ ...note(), candidate: { ...notePhoto(), ingredientId: 'jiang' } }] }, { ...detail(), ingredientId: 'huang-qi' }));
});
test('actual photo JSON client verifies hashes independently, rejects malformed receipts and keeps credentials off URLs', async () => {
  const native = globalThis.fetch; const calls: { url: string; options: RequestInit | undefined }[] = [];
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json(options?.method === 'POST' ? note() : detail()); };
    const signal = new AbortController().signal;
    assert.deepEqual(await readPhotoNotes(notePhoto(), session, signal), detail()); assert.deepEqual(await savePhotoNote(notePhoto(), input(), session, signal), note());
    assert(calls.every(call => call.url === `/api/v1/private-photo-notes/${notePhoto().id}` && call.options?.redirect === 'error' && call.options.credentials === 'same-origin'));
    assert.equal(new Headers(calls[1].options?.headers).get('Authorization'), null);
    globalThis.fetch = async () => Response.json({ ...note(), digest: `sha256:${'0'.repeat(64)}` });
    await assert.rejects(savePhotoNote(notePhoto(), input(), session, signal), /无法确认提交结果/);
    globalThis.fetch = async () => Response.json({ ...detail(), history: [{ ...note(), digest: `sha256:${'0'.repeat(64)}` }] });
    await assert.rejects(readPhotoNotes(notePhoto(), session, signal), /摘要不匹配/);
  } finally { globalThis.fetch = native; }
});
test('photo client never delivers a valid but cancelled late JSON response', async () => {
  const native = globalThis.fetch, controller = new AbortController();
  try {
    globalThis.fetch = async () => { controller.abort(); return Response.json(detail()); };
    await assert.rejects(readPhotoNotes(notePhoto(), session, controller.signal), error => error instanceof Error && error.name === 'AbortError');
  } finally { globalThis.fetch = native; }
});
