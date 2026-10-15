import type { SessionInfo } from '../shared/contracts';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos';
import { parsePhotoNoteDetail, parsePhotoNoteInput, parseReloadedPhotoNotes, parseSavedPhotoNote, type PhotoNote, type PhotoNoteDetail, type PhotoNoteInput } from '../shared/photo-notes';
import { ApiError, requestDecoded } from './api';
import { photoValueDigest as hash } from './photo-integrity';
async function validNote(note: PhotoNote, signal: AbortSignal): Promise<boolean> {
  const { digest, ...payload } = note;
  return await hash(note.candidate, signal) === note.bindingDigest && await hash(payload, signal) === digest;
}
export async function readPhotoNotes(value: PrivatePhoto, session: SessionInfo, signal: AbortSignal, previous?: PhotoNoteDetail): Promise<PhotoNoteDetail> {
  const candidate = parsePrivatePhoto(value), bindingDigest = await hash(candidate, signal);
  const detail = await requestDecoded(`/private-photo-notes/${candidate.id}`, session, raw => {
    const parsed = parsePhotoNoteDetail(raw, { candidateId: candidate.id, ingredientId: candidate.ingredientId, bindingDigest });
    return previous ? parseReloadedPhotoNotes(parsed, previous) : parsed;
  }, { signal, redirect: 'error' });
  for (const note of detail.history) if (!await validNote(note, signal)) throw new ApiError('核对历史摘要不匹配，请联系管理员；当前输入已保留。', 502);
  return detail;
}
export async function savePhotoNote(value: PrivatePhoto, raw: PhotoNoteInput, session: SessionInfo, signal: AbortSignal): Promise<PhotoNote> {
  const candidate = parsePrivatePhoto(value), input = parsePhotoNoteInput(raw), owner = { ...session, user: { ...session.user } };
  if (input.bindingDigest !== await hash(candidate, signal)) throw new ApiError('候选资料已变化，请重新读取核对。', 409);
  const note = await requestDecoded(`/private-photo-notes/${candidate.id}`, owner, result => parseSavedPhotoNote(result, candidate, input, owner.user),
    { method: 'POST', body: JSON.stringify(input), signal, redirect: 'error' });
  if (!await validNote(note, signal)) throw new ApiError('无法确认提交结果，请重新读取核对，不要重复提交。', 502);
  return note;
}
