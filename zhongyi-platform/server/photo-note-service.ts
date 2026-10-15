import { PHOTO_NOTE_SCHEMA, parsePhotoNoteDetail, parsePhotoNoteInput, type PhotoNote, type PhotoNoteDetail, type PhotoNoteInput } from '../shared/photo-notes.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import type { Account } from '../shared/contracts.js';
import type { WriteAuthority } from './stores.js';
import { AccountError } from './auth.js';
import { photoBindingDigest, photoNoteDigest } from './photo-note-values.js';

export interface PhotoNoteStore {
  detail(candidate: PrivatePhoto): Promise<PhotoNoteDetail>;
  save(candidate: PrivatePhoto, input: unknown, authority: WriteAuthority): Promise<PhotoNote>;
}
export function requirePhotoEditor(current: Account | undefined, authority: WriteAuthority): void {
  const actor = authority.account;
  if (!current || current.id !== actor.id) throw new AccountError(401, 'unauthorized', '会话已失效，请重新登录。');
  if (current.username !== actor.username || current.createdAt !== actor.createdAt || current.active !== actor.active || current.revision !== actor.revision || current.role !== actor.role || !['admin', 'editor'].includes(current.role)) throw new AccountError(403, 'forbidden', '当前账号不能修改图片核对记录。');
}
// Shared pure rules; each adapter owns its native transaction. Never use async
// callbacks inside a synchronous SQLite transaction on a shared connection.
export function ownPhotoNoteWrite(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
  const candidate = parsePrivatePhoto(value);
  let input: PhotoNoteInput;
  try { input = parsePhotoNoteInput(raw); } catch { throw new AccountError(400, 'invalid_photo_note', '请填写有效的核对事项和依据，并携带当前图片摘要及修订号。'); }
  return { candidate, input, authority: { account: { ...authority.account }, token: authority.token } };
}
export function photoNoteDetail(candidate: PrivatePhoto, history: PhotoNote[], ingredientExists: boolean): PhotoNoteDetail {
  if (!ingredientExists) throw new AccountError(404, 'ingredient_not_found', '未找到候选对应的食材。');
  if (history.some(note => note.candidate.ingredientId !== candidate.ingredientId)) throw new AccountError(409, 'photo_identity_changed', '候选编号已绑定另一食材，请登记新的候选编号。');
  const bindingDigest = photoBindingDigest(candidate);
  return parsePhotoNoteDetail({ schemaVersion: PHOTO_NOTE_SCHEMA, candidateId: candidate.id, bindingDigest, version: history[0]?.version ?? 0, history }, { candidateId: candidate.id, bindingDigest });
}
export function nextPhotoNote(candidate: PrivatePhoto, current: PhotoNoteDetail, input: PhotoNoteInput, actor: Account, now: number): PhotoNote {
  if (input.bindingDigest !== current.bindingDigest || input.expectedVersion !== current.version) throw new AccountError(409, 'photo_note_conflict', '图片资料或核对记录已变化，请重新读取后核对；当前输入未保存。');
  if (current.version >= 10000) throw new AccountError(409, 'photo_note_limit', '该候选历史达到上限，请联系管理员归档。');
  const payload = { candidate, bindingDigest: current.bindingDigest, version: current.version + 1, category: input.category, text: input.text, evidenceReference: input.evidenceReference,
    actorId: actor.id, actorName: actor.username, accountRevision: actor.revision, createdAt: new Date(now).toISOString() };
  return { ...payload, digest: photoNoteDigest(payload) };
}
