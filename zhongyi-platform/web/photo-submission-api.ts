import type { SessionInfo } from '../shared/contracts';
import type { PhotoNoteDetail } from '../shared/photo-notes';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos';
import { parsePhotoSubmissionDetail, parsePhotoSubmissionInput, parseReloadedPhotoSubmissions, parseSavedPhotoSubmission, photoSubmissionBasisMatches, type PhotoSubmission, type PhotoSubmissionDetail, type PhotoSubmissionInput } from '../shared/photo-submissions';
import { ApiError, requestDecoded } from './api';
import { photoValueDigest } from './photo-integrity';
import { readPhotoNotes } from './photo-note-api';

export interface PhotoSubmissionWorkspace { detail: PhotoSubmissionDetail; notes: PhotoNoteDetail }
async function validSubmission(item: PhotoSubmission, signal: AbortSignal): Promise<boolean> {
  const { digest, ...payload } = item;
  return await photoValueDigest(item.candidate, signal) === item.bindingDigest && await photoValueDigest(payload, signal) === digest;
}
export async function readPhotoSubmissions(value: PrivatePhoto, session: SessionInfo, signal: AbortSignal, previous?: PhotoSubmissionWorkspace): Promise<PhotoSubmissionWorkspace> {
  const candidate = parsePrivatePhoto(value), owner = { ...session, user: { ...session.user } }, bindingDigest = await photoValueDigest(candidate, signal);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const controller = new AbortController(), cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const [detail, notes] = await Promise.all([
      requestDecoded(`/private-photo-submissions/${candidate.id}`, owner, raw => {
        const parsed = parsePhotoSubmissionDetail(raw, { candidateId: candidate.id, ingredientId: candidate.ingredientId, bindingDigest });
        return previous ? parseReloadedPhotoSubmissions(parsed, previous.detail) : parsed;
      }, { signal: controller.signal, redirect: 'error' }),
      readPhotoNotes(candidate, owner, controller.signal, previous?.notes)
    ]);
    if (!photoSubmissionBasisMatches(detail, notes)) throw new ApiError('核对意见与送审资料的版本不一致，请重新读取；当前输入已保留。', 502);
    for (const item of detail.history) if (!await validSubmission(item, controller.signal)) throw new ApiError('送审历史摘要不匹配，请联系管理员；当前输入已保留。', 502);
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    return { detail, notes };
  } finally { controller.abort(); signal.removeEventListener('abort', cancel); }
}
export async function submitPhoto(value: PrivatePhoto, raw: PhotoSubmissionInput, session: SessionInfo, signal: AbortSignal): Promise<PhotoSubmission> {
  const candidate = parsePrivatePhoto(value), input = parsePhotoSubmissionInput(raw), owner = { ...session, user: { ...session.user } };
  if (input.bindingDigest !== await photoValueDigest(candidate, signal)) throw new ApiError('候选资料已变化，请重新读取核对。', 409);
  const item = await requestDecoded(`/private-photo-submissions/${candidate.id}`, owner, result => parseSavedPhotoSubmission(result, candidate, input, owner.user),
    { method: 'POST', body: JSON.stringify(input), signal, redirect: 'error' });
  if (!await validSubmission(item, signal)) throw new ApiError('无法确认送审结果，请重新读取核对，不要重复提交。', 502);
  return item;
}
