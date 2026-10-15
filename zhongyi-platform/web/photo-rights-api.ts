import type { SessionInfo } from '../shared/contracts';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos';
import { parsePhotoRightsInput, type PhotoRightsDetail, type PhotoRightsInput, type PhotoRightsReview } from '../shared/photo-rights';
import { parsePhotoRightsDetail, parseReloadedPhotoRights, parseSavedPhotoRights, photoRightsBasisMatches } from '../shared/photo-rights-response';
import { readPhotoSubmissions, type PhotoSubmissionWorkspace } from './photo-submission-api';
import { photoValueDigest } from './photo-integrity';
import { ApiError, requestDecoded } from './api';

export interface PhotoRightsWorkspace { detail: PhotoRightsDetail; submissions: PhotoSubmissionWorkspace }
async function validReview(item: PhotoRightsReview, signal: AbortSignal): Promise<boolean> {
  const { digest, ...payload } = item;
  return await photoValueDigest(payload, signal) === digest;
}
export async function readPhotoRights(value: PrivatePhoto, session: SessionInfo, signal: AbortSignal, previous?: PhotoRightsWorkspace): Promise<PhotoRightsWorkspace> {
  const candidate = parsePrivatePhoto(value), owner = { ...session, user: { ...session.user } }, bindingDigest = await photoValueDigest(candidate, signal);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const controller = new AbortController(), cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
  try {
    const [detail, submissions] = await Promise.all([
      requestDecoded(`/private-photo-rights/${candidate.id}`, owner, raw => {
        const parsed = parsePhotoRightsDetail(raw, { candidateId: candidate.id, ingredientId: candidate.ingredientId, bindingDigest });
        return previous ? parseReloadedPhotoRights(parsed, previous.detail) : parsed;
      }, { signal: controller.signal, redirect: 'error' }),
      readPhotoSubmissions(candidate, owner, controller.signal, previous?.submissions)
    ]);
    if (!photoRightsBasisMatches(detail, submissions.detail)) throw new ApiError('权利审核与送审或核对版本不一致，请重新读取；当前输入已保留。', 502);
    for (const item of detail.history) if (!await validReview(item, controller.signal)) throw new ApiError('图片权利历史摘要不匹配，请联系管理员；当前输入已保留。', 502);
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    return { detail, submissions };
  } finally { controller.abort(); signal.removeEventListener('abort', cancel); }
}
export async function reviewPhotoRights(value: PrivatePhoto, raw: PhotoRightsInput, session: SessionInfo, signal: AbortSignal): Promise<PhotoRightsReview> {
  const candidate = parsePrivatePhoto(value), input = parsePhotoRightsInput(raw), owner = { ...session, user: { ...session.user } };
  if (input.bindingDigest !== await photoValueDigest(candidate, signal)) throw new ApiError('候选资料已变化，请重新读取核对。', 409);
  const item = await requestDecoded(`/private-photo-rights/${candidate.id}`, owner, result => parseSavedPhotoRights(result, candidate, input, owner.user),
    { method: 'POST', body: JSON.stringify(input), signal, redirect: 'error' });
  if (!await validReview(item, signal)) throw new ApiError('无法确认权利审核结果，请重新读取核对，不要重复提交。', 502);
  return item;
}
