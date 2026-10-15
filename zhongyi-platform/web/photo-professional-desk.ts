import type { ProfessionalQualification, SessionInfo } from '../shared/contracts';
import { parseQualificationHistory } from '../shared/professional-response';
import type { PrivatePhoto } from '../shared/private-photos';
import type { PhotoProfessionalCredential } from '../shared/photo-professional-response';
import { readPhotoProfessional, type PhotoProfessionalWorkspace } from './photo-professional-api';
import { photoValueDigest } from './photo-integrity';
import { ApiError, requestDecoded } from './api';

export interface PhotoProfessionalDesk { image: PhotoProfessionalWorkspace; qualifications: ProfessionalQualification[] }
export function photoCredentialOf(q: ProfessionalQualification): PhotoProfessionalCredential {
  return { userId: q.userId, revision: q.revision, digest: q.digest, profession: q.profession, evidenceKind: q.evidenceKind };
}
export async function readPhotoProfessionalDesk(photo: PrivatePhoto, session: SessionInfo, signal: AbortSignal, previous?: PhotoProfessionalDesk): Promise<PhotoProfessionalDesk> {
  const owner = { ...session, user: { ...session.user } }, controller = new AbortController(), cancel = () => controller.abort();
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const [image, history] = await Promise.all([
      readPhotoProfessional(photo, owner, controller.signal, previous?.image),
      owner.user.role === 'editor' ? Promise.resolve({ userId: owner.user.id, items: [] }) : requestDecoded(`/editorial/qualifications/${owner.user.id}`, owner,
        raw => parseQualificationHistory(raw, owner.user.id), { signal: controller.signal, redirect: 'error' })
    ]);
    const qualifications = history.items;
    for (const item of qualifications) {
      const { digest, ...payload } = item;
      if (await photoValueDigest(payload, controller.signal) !== digest) throw new ApiError('资格历史摘要不匹配，请联系管理员；当前输入已保留。', 502);
    }
    if ((qualifications[0]?.revision ?? 0) < (previous?.qualifications[0]?.revision ?? 0)) throw new ApiError('资格历史版本回退，请重新核对。', 502);
    for (const old of previous?.qualifications ?? []) {
      const item = qualifications.find(value => value.revision === old.revision);
      if (item ? JSON.stringify(item) !== JSON.stringify(old) : old.revision >= (qualifications[0]?.revision ?? 0) - 19) throw new ApiError('资格历史被改写或遗漏，请联系管理员。', 502);
    }
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    return { image, qualifications };
  } finally { controller.abort(); signal.removeEventListener('abort', cancel); }
}
