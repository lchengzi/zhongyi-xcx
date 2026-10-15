import { MAX_PHOTO_BYTES, parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos';
import { ApiError } from './api';
import { requestDecoded } from './api';
import type { SessionInfo } from '../shared/contracts';
import { parsePhotoDerivative } from '../shared/photo-derivatives';
import { photoValueDigest } from './photo-integrity';

// Private prepared pixels are readable independently of professional approval
// and publication. This helper never reads originals or grants either state.
export async function readPrivateDerivative(candidate: PrivatePhoto, session: SessionInfo, signal: AbortSignal) {
  const photo = parsePrivatePhoto(candidate);
  const derivative = await requestDecoded(`/private-photo-derivatives/${photo.id}`, session, parsePhotoDerivative, { signal, redirect: 'error' });
  const { digest, ...payload } = derivative;
  const [binding, record] = await Promise.all([photoValueDigest(photo, signal), photoValueDigest(payload, signal)]);
  if (JSON.stringify(derivative.candidate) !== JSON.stringify(photo) || derivative.bindingDigest !== binding || derivative.digest !== record) throw new ApiError('展示图与当前候选不匹配，请重新读取。', 502);
  return derivative;
}

// Cookie-authenticated, bounded binary GET. No token/query URL or external fetch.
export async function readPrivatePhoto(candidate: PrivatePhoto, signal: AbortSignal): Promise<Blob> {
  const photo = parsePrivatePhoto(candidate);
  return readPrivateJpeg(`/api/v1/private-photos/${photo.id}/original`, photo, signal);
}

export async function readPrivateJpeg(path: string, descriptor: { bytes: number; sha256: string }, signal: AbortSignal, label: '原图' | '展示图' | '研究参考图' = '原图'): Promise<Blob> {
  const photo = { bytes: descriptor.bytes, sha256: descriptor.sha256 };
  if (!/^\/api\/v1\/(?:private-photos\/[a-z][a-z0-9-]{0,99}\/original|(?:private-photo-derivatives|editorial-references)\/[a-z][a-z0-9-]{0,99}\/image)$/.test(path) ||
    !Number.isSafeInteger(photo.bytes) || photo.bytes < 1 || photo.bytes > MAX_PHOTO_BYTES || !/^sha256:[a-f0-9]{64}$/.test(photo.sha256)) throw new ApiError('图片读取依据无效。', 400);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const controller = new AbortController();
  let cause: 'caller' | 'timeout' | null = null;
  const cancel = (value: 'caller' | 'timeout') => { if (!controller.signal.aborted) { cause = value; controller.abort(); } };
  const callerAbort = () => cancel('caller');
  signal.addEventListener('abort', callerAbort, { once: true });
  const timer = setTimeout(() => cancel('timeout'), 15000);
  const live = () => { if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError'); };
  try {
    const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    live();
    if (!response.ok) throw new ApiError(response.status === 401 ? `会话已失效，请重新登录后查看${label}。` : `${label}暂不可用，请重新读取候选资料。`, response.status, response.headers.get('X-Request-ID'));
    if (response.redirected || response.headers.get('Content-Type') !== 'image/jpeg' || response.headers.get('Content-Length') !== String(photo.bytes) || !response.body) throw new ApiError(`${label}响应不匹配，未显示图片。`, 502);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read(); live();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > photo.bytes || length > MAX_PHOTO_BYTES) throw new ApiError(`${label}超过登记大小，未显示图片。`, 502);
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (length !== photo.bytes) throw new ApiError(`${label}不完整，未显示图片。`, 502);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const digest = await crypto.subtle.digest('SHA-256', bytes); live();
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (`sha256:${hash}` !== photo.sha256) throw new ApiError(`${label}摘要与候选记录不符，未显示图片。`, 502);
    return new Blob([bytes], { type: 'image/jpeg' });
  } catch (error) {
    if (cause === 'caller') throw new DOMException('已取消', 'AbortError');
    if (cause === 'timeout') throw new ApiError(`${label}读取超时，请重试。`, 0);
    if (error instanceof ApiError || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new ApiError(`${label}读取失败，请重试。`, 0);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', callerAbort); }
}
