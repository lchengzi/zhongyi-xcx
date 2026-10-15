import type { SessionInfo } from '../shared/contracts';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos';
import type { PhotoDerivative } from '../shared/photo-derivatives';
import { parsePhotoPublicationHistory, parsePhotoPublicationInput, parsePhotoPublicationRecord, type PhotoPublicationHistory, type PhotoPublicationInput, type PhotoPublicationRecord } from '../shared/photo-publications';
import { ApiError, requestDecoded } from './api';
import { photoValueDigest } from './photo-integrity';
import { readPhotoProfessional, type PhotoProfessionalWorkspace } from './photo-professional-api';
import { readPrivateDerivative } from './private-photo-api';

export interface PhotoPublicationDesk { derivative: PhotoDerivative; professional: PhotoProfessionalWorkspace; history: PhotoPublicationHistory }
async function checkDigest(value: PhotoPublicationRecord | PhotoDerivative, signal: AbortSignal) {
  const { digest, ...payload } = value;
  if (await photoValueDigest(payload, signal) !== digest) throw new ApiError('图片记录摘要不匹配，请重新读取。', 502);
}
export async function readPhotoPublicationHistory(ingredientId: string, session: SessionInfo, signal: AbortSignal, previous?: PhotoPublicationHistory): Promise<PhotoPublicationHistory> {
  const history = await requestDecoded(`/editorial/photo-publications/${ingredientId}`, session, raw => parsePhotoPublicationHistory(raw, ingredientId), { signal, redirect: 'error' });
  const old = previous?.items[0], head = history.items[0];
  if (old && (!head || head.version < old.version || (head.version === old.version && head.digest !== old.digest) ||
    (history.items.some(item => item.version === old.version) && history.items.find(item => item.version === old.version)?.digest !== old.digest))) throw new ApiError('图片发布历史倒退或变化，请联系管理员核对。', 502);
  for (const item of history.items) await checkDigest(item, signal);
  return history;
}
export async function readPhotoPublication(photo: PrivatePhoto, history: PhotoPublicationHistory, session: SessionInfo, signal: AbortSignal, previous?: PhotoPublicationDesk): Promise<PhotoPublicationDesk> {
  const candidate = parsePrivatePhoto(photo), owner = { ...session, user: { ...session.user } };
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const controller = new AbortController(), cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
  try {
    const [derivative, professional] = await Promise.all([
      readPrivateDerivative(candidate, owner, controller.signal),
      readPhotoProfessional(candidate, owner, controller.signal, previous?.professional)
    ]);
    if (JSON.stringify(derivative.candidate) !== JSON.stringify(candidate) || professional.detail.bindingDigest !== derivative.bindingDigest) throw new ApiError('展示图与当前审核资料不匹配。', 502);
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    return { derivative, professional, history };
  } finally { controller.abort(); signal.removeEventListener('abort', cancel); }
}
export function photoPublicationMatches(record: PhotoPublicationRecord, input: PhotoPublicationInput, session: SessionInfo): boolean {
  return record.version === input.expectedVersion + 1 && record.action === input.action && record.actorId === session.user.id && record.actorName === session.user.username &&
    record.accountRevision === session.user.revision && record.reason === input.reason && JSON.stringify(record.entries.map(({ photo: _photo, ...selection }) => selection)) === JSON.stringify(input.selections);
}
export async function writePhotoPublication(history: PhotoPublicationHistory, raw: PhotoPublicationInput, session: SessionInfo, signal: AbortSignal): Promise<PhotoPublicationRecord> {
  const input = parsePhotoPublicationInput(raw);
  const result = await requestDecoded(`/editorial/photo-publications/${history.ingredientId}`, session, raw => {
    const record = parsePhotoPublicationRecord(raw);
    if (record.ingredientId !== history.ingredientId || record.name !== history.name || record.baseReleaseId !== history.baseReleaseId ||
      record.previousDigest !== (history.items[0]?.digest ?? null) || !photoPublicationMatches(record, input, session)) throw new Error('Invalid photo publication receipt');
    return record;
  }, { method: 'POST', body: JSON.stringify(input), signal, redirect: 'error' });
  await checkDigest(result, signal); return result;
}
