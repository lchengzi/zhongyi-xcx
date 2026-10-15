import { createHash } from 'node:crypto';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { parsePhotoNote, type PhotoNote } from '../shared/photo-notes.js';
import { AccountError } from './auth.js';

const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
export const photoBindingDigest = (value: PrivatePhoto): string => hash(parsePrivatePhoto(value));
export const photoNoteDigest = (value: Omit<PhotoNote, 'digest'>): string => hash(value);
export const PHOTO_NOTE_COLUMNS = ['candidate_id', 'ingredient_id', 'version', 'candidate_payload', 'binding_digest', 'category', 'text', 'evidence_reference', 'actor_id', 'actor_name', 'account_revision', 'created_at', 'digest'] as const;
export const PHOTO_NOTE_INSERT = `INSERT INTO photo_notes (${PHOTO_NOTE_COLUMNS.join(', ')}) VALUES (${PHOTO_NOTE_COLUMNS.map(() => '?').join(', ')})`;
export function photoNoteValues(item: PhotoNote): (string | number)[] {
  return [item.candidate.id, item.candidate.ingredientId, item.version, JSON.stringify(item.candidate), item.bindingDigest, item.category, item.text, item.evidenceReference, item.actorId, item.actorName, item.accountRevision, item.createdAt, item.digest];
}
export function photoNoteFrom(value: Record<string, unknown>): PhotoNote {
  try {
    if (Object.keys(value).length !== PHOTO_NOTE_COLUMNS.length || PHOTO_NOTE_COLUMNS.some(key => !Object.hasOwn(value, key)) || typeof value.candidate_payload !== 'string') throw new Error('Invalid photo row');
    const candidate = parsePrivatePhoto(JSON.parse(value.candidate_payload));
    const item = parsePhotoNote({ candidate, bindingDigest: value.binding_digest, version: value.version, category: value.category, text: value.text, evidenceReference: value.evidence_reference,
      actorId: value.actor_id, actorName: value.actor_name, accountRevision: value.account_revision, createdAt: value.created_at, digest: value.digest });
    const { digest, ...payload } = item;
    if (candidate.id !== value.candidate_id || candidate.ingredientId !== value.ingredient_id || value.candidate_payload !== JSON.stringify(candidate) || value.text !== item.text || value.evidence_reference !== item.evidenceReference || photoBindingDigest(candidate) !== item.bindingDigest || photoNoteDigest(payload) !== digest) throw new Error('Photo note mismatch');
    return item;
  } catch { throw new AccountError(409, 'photo_note_integrity', '图片核对记录完整性检查失败，请联系管理员。'); }
}
