import type { SessionInfo } from '../shared/contracts';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos';
import { parsePhotoProfessionalInput, parsePhotoProfessionalReview, type PhotoProfessionalDetail, type PhotoProfessionalInput, type PhotoProfessionalReview } from '../shared/photo-professional';
import { parsePhotoProfessionalCredential, parsePhotoProfessionalDetail, parseReloadedPhotoProfessional, parseSavedPhotoProfessional, photoProfessionalBasisMatches, type PhotoProfessionalCredential } from '../shared/photo-professional-response';
import { readPhotoRights, type PhotoRightsWorkspace } from './photo-rights-api';
import { photoValueDigest } from './photo-integrity';
import { ApiError, requestDecoded } from './api';

export interface PhotoProfessionalWorkspace { detail: PhotoProfessionalDetail; rights: PhotoRightsWorkspace }
async function validReview(value: PhotoProfessionalReview, signal: AbortSignal): Promise<boolean> {
  // Shared parser fixes canonical key order, matching server-side new records.
  const { digest, ...payload } = parsePhotoProfessionalReview(value); return await photoValueDigest(payload, signal) === digest;
}
export async function readPhotoProfessional(value: PrivatePhoto, session: SessionInfo, signal: AbortSignal, previous?: PhotoProfessionalWorkspace): Promise<PhotoProfessionalWorkspace> {
  const candidate = parsePrivatePhoto(value), owner = { ...session, user: { ...session.user } }, bindingDigest = await photoValueDigest(candidate, signal);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const controller = new AbortController(), cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
  try {
    const [detail, rights] = await Promise.all([
      requestDecoded(`/private-photo-professional/${candidate.id}`, owner, raw => {
        const parsed = parsePhotoProfessionalDetail(raw, { candidateId: candidate.id, ingredientId: candidate.ingredientId, bindingDigest });
        return previous ? parseReloadedPhotoProfessional(parsed, previous.detail) : parsed;
      }, { signal: controller.signal, redirect: 'error' }),
      readPhotoRights(candidate, owner, controller.signal, previous?.rights)
    ]);
    if (!photoProfessionalBasisMatches(detail, rights.detail)) throw new ApiError('专业审校与权利、送审或核对版本不一致，请重新读取；当前输入已保留。', 502);
    for (const item of [...detail.history, ...detail.latestReviews]) if (!await validReview(item, controller.signal)) throw new ApiError('图片专业审校摘要不匹配，请联系管理员；当前输入已保留。', 502);
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    return { detail, rights };
  } finally { controller.abort(); signal.removeEventListener('abort', cancel); }
}
export async function reviewPhotoProfessional(value: PrivatePhoto, raw: PhotoProfessionalInput, rawCredential: PhotoProfessionalCredential, session: SessionInfo, signal: AbortSignal): Promise<PhotoProfessionalReview> {
  const candidate = parsePrivatePhoto(value), input = parsePhotoProfessionalInput(raw), credential = parsePhotoProfessionalCredential(rawCredential), owner = { ...session, user: { ...session.user } };
  if (credential.profession !== input.profession || credential.revision !== input.expectedQualificationRevision || credential.digest !== input.qualificationDigest || (input.decision !== 'revoke' && credential.userId !== owner.user.id)) throw new ApiError('资格依据与当前专业意见不一致，请重新读取核对。', 409);
  if (input.bindingDigest !== await photoValueDigest(candidate, signal)) throw new ApiError('候选资料已变化，请重新读取核对。', 409);
  const item = await requestDecoded(`/private-photo-professional/${candidate.id}`, owner, result => parseSavedPhotoProfessional(result, candidate, input, owner.user, credential),
    { method: 'POST', body: JSON.stringify(input), signal, redirect: 'error' });
  if (!await validReview(item, signal)) throw new ApiError('无法确认专业审校结果，请重新读取核对，不要重复提交。', 502);
  return item;
}
