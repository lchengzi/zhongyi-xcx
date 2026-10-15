import type { SessionInfo } from '../shared/contracts';
export type Credential = string | SessionInfo | null;

function validatedRequestId(value: string | null | undefined): string | undefined {
  // Our server generates UUID v4. Never render arbitrary proxy/header text.
  return value && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : undefined;
}

export class ApiError extends Error {
  readonly requestId: string | undefined;
  constructor(message: string, readonly status: number, requestId?: string | null) {
    const safeId = validatedRequestId(requestId);
    super(safeId ? `${message}（请求编号：${safeId}）` : message);
    this.requestId = safeId;
  }
}

const REQUEST_TIMEOUT_MS = 15000;
const UNKNOWN_WRITE = '无法确认提交结果；服务可能已经处理。请先重新读取核对，不要连续重复提交。';
export const requiresWriteVerification = (reason: unknown): boolean => reason instanceof ApiError && (reason.status === 0 || reason.status === 502);

// Legacy callers are migrated by business flow; this signature alone does not
// validate a response. New/migrated callers must use requestDecoded.
export function request<T>(path: string, credential: Credential, options: RequestInit = {}): Promise<T> {
  return requestDecoded(path, credential, (value) => value as T, options);
}

export async function requestDecoded<T>(path: string, credential: Credential, decode: (value: unknown) => T, options: RequestInit = {}): Promise<T> {
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
  const controller = new AbortController();
  const lifetime: { cause: 'caller' | 'timeout' | null } = { cause: null };
  const cancel = (cause: 'caller' | 'timeout') => {
    if (controller.signal.aborted) return;
    lifetime.cause = cause;
    controller.abort();
  };
  const callerCancelled = () => cancel('caller');
  callerSignal?.addEventListener('abort', callerCancelled, { once: true });
  const deadline = setTimeout(() => cancel('timeout'), REQUEST_TIMEOUT_MS);
  const readOnly = ['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()) && !options.body;
  let requestId: string | undefined;
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { ...(typeof credential === 'string' ? { Authorization: `Bearer ${credential}` } : credential ? { 'X-CSRF-Token': credential.csrfToken } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      cache: 'no-store'
    });
    requestId = validatedRequestId(response.headers.get('X-Request-ID'));
    const body: unknown = await response.json().catch((error) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (response.ok) throw new ApiError(readOnly ? '服务返回的数据格式无效，请重试。' : UNKNOWN_WRITE, 502, requestId);
      return null;
    });
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim() && body.message.length <= 2000
        ? body.message : '请求失败，请稍后重试。';
      throw new ApiError(message, response.status, requestId);
    }
    // Some transports/test doubles can resolve after abort; never decode or
    // deliver an expired response, even when valid JSON has already arrived.
    if (controller.signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
    try { return decode(body); }
    catch { throw new ApiError(readOnly ? '服务返回的数据格式无效，请重新读取。' : UNKNOWN_WRITE, 502, requestId); }
  } catch (error) {
    // Aborting a client wait cannot roll back an already committed server write.
    // Preserve the first cancellation cause and never retry a request here.
    if (lifetime.cause === 'caller') throw new DOMException('请求已取消。', 'AbortError');
    if (lifetime.cause === 'timeout') throw new ApiError(readOnly ? '读取超时，请重试；当前无法确认服务是否可用。' : UNKNOWN_WRITE, 0, requestId);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(readOnly ? '无法连接服务，请确认后端正在运行，然后重试。' : UNKNOWN_WRITE, 0, requestId);
  } finally {
    clearTimeout(deadline);
    callerSignal?.removeEventListener('abort', callerCancelled);
  }
}
