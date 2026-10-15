import { parsePrivatePhoto, type PrivatePhoto } from './private-photos.js';
import { choice, date, digest, id, invalid, number, object, text } from './workflow-response.js';
import type { Account } from './contracts.js';

export const PHOTO_NOTE_SCHEMA = 'private-photo-notes.1';
export const PHOTO_NOTE_CATEGORIES = ['identity', 'processing', 'rights', 'general'] as const;
export type PhotoNoteCategory = typeof PHOTO_NOTE_CATEGORIES[number];
export interface PhotoNoteInput { bindingDigest: string; expectedVersion: number; category: PhotoNoteCategory; text: string; evidenceReference: string }
export interface PhotoNote {
  candidate: PrivatePhoto; bindingDigest: string; version: number; category: PhotoNoteCategory; text: string; evidenceReference: string;
  actorId: string; actorName: string; accountRevision: number; createdAt: string; digest: string;
}
export interface PhotoNoteDetail { schemaVersion: typeof PHOTO_NOTE_SCHEMA; candidateId: string; bindingDigest: string; version: number; history: PhotoNote[] }
function noteText(value: unknown, max: number): string {
  const result = text(value, max);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) invalid();
  return result.trim();
}
export function parsePhotoNoteInput(value: unknown): PhotoNoteInput {
  const r = object(value, 'bindingDigest expectedVersion category text evidenceReference');
  return { bindingDigest: digest(r.bindingDigest), expectedVersion: number(r.expectedVersion, 0), category: choice(r.category, PHOTO_NOTE_CATEGORIES), text: noteText(r.text, 1200), evidenceReference: noteText(r.evidenceReference, 400) };
}
export function parsePhotoNote(value: unknown): PhotoNote {
  const r = object(value, 'candidate bindingDigest version category text evidenceReference actorId actorName accountRevision createdAt digest');
  return { candidate: parsePrivatePhoto(r.candidate), bindingDigest: digest(r.bindingDigest), version: number(r.version), category: choice(r.category, PHOTO_NOTE_CATEGORIES),
    text: noteText(r.text, 1200), evidenceReference: noteText(r.evidenceReference, 400), actorId: id(r.actorId), actorName: id(r.actorName), accountRevision: number(r.accountRevision), createdAt: date(r.createdAt), digest: digest(r.digest) };
}
export function parsePhotoNoteDetail(value: unknown, expected: { candidateId: string; bindingDigest: string; ingredientId?: string }): PhotoNoteDetail {
  const r = object(value, 'schemaVersion candidateId bindingDigest version history');
  if (r.schemaVersion !== PHOTO_NOTE_SCHEMA || r.candidateId !== expected.candidateId || r.bindingDigest !== expected.bindingDigest || !Array.isArray(r.history) || r.history.length > 50) invalid();
  const version = number(r.version, 0), history = r.history.map((item: unknown) => parsePhotoNote(item));
  if (history.length !== Math.min(50, version) || history.some((item, index) => item.candidate.id !== expected.candidateId || item.version !== version - index ||
    (expected.ingredientId !== undefined && item.candidate.ingredientId !== expected.ingredientId))) invalid();
  return { schemaVersion: PHOTO_NOTE_SCHEMA, candidateId: expected.candidateId, bindingDigest: expected.bindingDigest, version, history };
}
export function matchesPhotoNoteAttempt(note: PhotoNote, candidate: PrivatePhoto, raw: PhotoNoteInput, actor: Account): boolean {
  const input = parsePhotoNoteInput(raw);
  return JSON.stringify(note.candidate) === JSON.stringify(parsePrivatePhoto(candidate)) && note.bindingDigest === input.bindingDigest && note.version === input.expectedVersion + 1 &&
    note.category === input.category && note.text === input.text && note.evidenceReference === input.evidenceReference && note.actorId === actor.id && note.actorName === actor.username && note.accountRevision === actor.revision;
}
export function parseSavedPhotoNote(value: unknown, candidate: PrivatePhoto, input: PhotoNoteInput, actor: Account): PhotoNote {
  const note = parsePhotoNote(value); if (!matchesPhotoNoteAttempt(note, candidate, input, actor)) invalid(); return note;
}
export function parseReloadedPhotoNotes(value: unknown, previous: PhotoNoteDetail): PhotoNoteDetail {
  const detail = parsePhotoNoteDetail(value, previous);
  if (detail.version < previous.version || previous.history.some(old => {
    const current = detail.history.find(note => note.version === old.version);
    return current ? JSON.stringify(current) !== JSON.stringify(old) : old.version >= detail.version - 49;
  })) invalid();
  return detail;
}
