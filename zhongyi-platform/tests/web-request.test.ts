import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { ApiError, request, requestDecoded, requiresWriteVerification } from '../web/api.js';

// Actual request helper, controlled transport and clock; never contacts a service.
const originals = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
let timers: { callback: () => void; delay: number; cleared: boolean }[];
let calls: { url: string; options: RequestInit }[];
let pendingReject: ((reason: unknown) => void) | undefined;
const aborted = () => new DOMException('fixture aborted', 'AbortError');
beforeEach(() => {
  timers = []; calls = []; pendingReject = undefined;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false }; timers.push(timer); return timer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: unknown) => { const timer = timers.find((item) => item === handle); if (timer) timer.cleared = true; }) as typeof clearTimeout;
  globalThis.fetch = (async (url, options = {}) => {
    calls.push({ url: String(url), options }); return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { pendingReject?.(aborted()); Object.assign(globalThis, originals); });
function hang() {
  globalThis.fetch = ((url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Promise<Response>((_resolve, reject) => {
      pendingReject = reject;
      options.signal?.addEventListener('abort', () => reject(aborted()), { once: true });
    });
  }) as typeof fetch;
}
function deadline() {
  assert.equal(timers.length, 1, 'a finite deadline is required');
  assert.equal(timers[0].delay, 15000, 'fixed client wait limit, not a performance claim');
  timers[0].callback();
}

test('web request keeps existing credentials, headers and no-store contract and clears its deadline on success', async () => {
  const options = { method: 'PUT', body: JSON.stringify({ text: 'fixture' }) };
  const value = await request('/fixture', 'fixture-key', options);
  assert.deepEqual(value, { ok: true }); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/fixture');
  assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.credentials, 'same-origin');
  assert.deepEqual(calls[0].options.headers, { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' });
  assert.equal(timers.length, 1); assert(timers[0].cleared); assert(!('signal' in options));
});
test('silent read times out, aborts its owned transport and never retries automatically', async () => {
  hang(); const operation = request('/summary', null); void operation.catch(() => {});
  deadline();
  await assert.rejects(operation, (error: unknown) => error instanceof ApiError && error.status === 0 && /读取超时/.test(error.message));
  assert(calls[0].options.signal?.aborted); assert.equal(calls.length, 1); assert(timers[0].cleared);
});
test('silent write reports an unknown outcome, never a guaranteed rollback or an automatic retry', async () => {
  hang(); const operation = request('/fixture', null, { method: 'POST', body: '{}' }); void operation.catch(() => {});
  deadline();
  await assert.rejects(operation, (error: unknown) => error instanceof ApiError && error.status === 0 && /无法确认提交结果/.test(error.message) && /先重新读取核对/.test(error.message));
  assert.equal(calls.length, 1); assert(timers[0].cleared);
});
test('pre-cancelled caller is not dispatched or turned into a user-facing network failure', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request('/summary', null, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0); assert.equal(timers.length, 0);
});
test('caller cancellation is forwarded but does not abort the caller controller or become a timeout message', async () => {
  hang(); const controller = new AbortController();
  const operation = request('/summary', null, { signal: controller.signal }); void operation.catch(() => {});
  assert.notEqual(calls[0].options.signal, controller.signal);
  controller.abort();
  await assert.rejects(operation, { name: 'AbortError' });
  assert(calls[0].options.signal?.aborted); assert(timers[0].cleared);
});
test('deadline covers a stalled response body, not only the time to receive headers', async () => {
  globalThis.fetch = (async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(new ReadableStream({ start(stream) {
      pendingReject = (reason) => stream.error(reason);
      options.signal?.addEventListener('abort', () => stream.error(aborted()), { once: true });
    } }));
  }) as typeof fetch;
  const operation = request('/summary', null); void operation.catch(() => {});
  await Promise.resolve(); await Promise.resolve(); deadline();
  await assert.rejects(operation, (error: unknown) => error instanceof ApiError && /读取超时/.test(error.message));
  pendingReject = undefined;
  assert.equal(calls.length, 1); assert(timers[0].cleared);
});
test('HTTP and malformed JSON failures preserve existing safe errors and clear the deadline', async () => {
  for (const [status, body, expected] of [[409, '{"message":"fixture conflict"}', 'fixture conflict'], [500, 'not-json', '请求失败'], [200, 'not-json', '数据格式无效']] as const) {
    globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
    await assert.rejects(request('/fixture', null), (error: unknown) => error instanceof ApiError && error.message.includes(expected));
    assert(timers.at(-1)?.cleared);
  }
  globalThis.fetch = (async () => new Response('not-json', { status: 200 })) as typeof fetch;
  await assert.rejects(request('/fixture', null, { method: 'PUT' }), (error: unknown) => error instanceof ApiError && error.status === 502 && /无法确认提交结果/.test(error.message));
  assert(timers.at(-1)?.cleared);
});
test('transport write failure also preserves uncertainty while read failure remains retryable', async () => {
  globalThis.fetch = (async () => { throw new TypeError('fixture transport secret'); }) as typeof fetch;
  await assert.rejects(request('/summary', null), (error: unknown) => error instanceof ApiError && /无法连接服务/.test(error.message) && !error.message.includes('secret'));
  for (const method of ['POST', 'PUT', 'DELETE']) {
    await assert.rejects(request('/fixture', null, { method }), (error: unknown) => error instanceof ApiError && /无法确认提交结果/.test(error.message) && !error.message.includes('secret'));
  }
  assert(timers.every((timer) => timer.cleared));
});
test('the first abort cause wins when cancellation and deadline race', async () => {
  hang(); const controller = new AbortController();
  const operation = request('/summary', null, { signal: controller.signal }); void operation.catch(() => {});
  controller.abort(); deadline();
  await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(calls.length, 1); assert(timers[0].cleared);
});

const requestId = '12345678-1234-4123-8123-123456789abc';
test('HTTP failures expose only a validated response request ID and preserve status and safe message', async () => {
  for (const status of [401, 409, 500]) {
    globalThis.fetch = (async () => new Response('{"message":"fixture safe error"}', { status, headers: { 'X-Request-ID': requestId } })) as typeof fetch;
    await assert.rejects(request('/fixture', null), (error: unknown) => {
      assert(error instanceof ApiError); assert.equal(error.status, status); assert.equal(error.requestId, requestId);
      assert.equal(error.message, `fixture safe error（请求编号：${requestId}）`); return true;
    });
  }
  assert(timers.every((timer) => timer.cleared));
});

test('missing, malformed, duplicated or secret-bearing correlation headers are never shown or recovered from the body', async () => {
  for (const value of [null, '', 'private-health-secret', '<script>private</script>', `${requestId}, ${requestId}`, 'a'.repeat(2000), requestId.replace('-4123-', '-0123-')]) {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'safe failure', requestId }), { status: 500,
      headers: value === null ? {} : { 'X-Request-ID': value } })) as typeof fetch;
    await assert.rejects(request('/fixture', null), (error: unknown) => {
      assert(error instanceof ApiError); assert.equal(error.requestId, undefined); assert.equal(error.message, 'safe failure'); return true;
    });
  }
  const error = new ApiError('safe constructor', 500, 'private-constructor-secret');
  assert.equal(error.requestId, undefined); assert.equal(error.message, 'safe constructor');
});

test('malformed response JSON keeps the validated header without claiming that an uncertain write failed', async () => {
  for (const [method, status, expected] of [['GET', 200, '数据格式无效'], ['GET', 500, '请求失败'], ['PUT', 200, '无法确认提交结果']] as const) {
    globalThis.fetch = (async () => new Response('not-json', { status, headers: { 'X-Request-ID': requestId.toUpperCase() } })) as typeof fetch;
    await assert.rejects(request('/fixture', null, { method }), (error: unknown) => {
      assert(error instanceof ApiError); assert.equal(error.requestId, requestId); assert(error.message.includes(expected));
      assert(error.message.includes(`请求编号：${requestId}`)); return true;
    });
  }
});

test('a stalled response body retains its received ID on timeout while write uncertainty and one-dispatch remain', async () => {
  for (const method of ['GET', 'PUT']) {
    timers = []; calls = [];
    globalThis.fetch = (async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return new Response(new ReadableStream({ start(stream) {
        pendingReject = (reason) => stream.error(reason);
        options.signal?.addEventListener('abort', () => stream.error(aborted()), { once: true });
      } }), { headers: { 'X-Request-ID': requestId } });
    }) as typeof fetch;
    const operation = request('/fixture', null, { method }); void operation.catch(() => {});
    await Promise.resolve(); await Promise.resolve(); deadline();
    await assert.rejects(operation, (error: unknown) => {
      assert(error instanceof ApiError); assert.equal(error.status, 0); assert.equal(error.requestId, requestId);
      assert(error.message.includes(method === 'GET' ? '读取超时' : '先重新读取核对')); return true;
    });
    pendingReject = undefined; assert.equal(calls.length, 1); assert(timers[0].cleared);
  }
});

test('caller cancellation after headers remains an AbortError, not a displayed diagnostic failure', async () => {
  globalThis.fetch = (async (_url, options = {}) => new Response(new ReadableStream({ start(stream) {
    pendingReject = (reason) => stream.error(reason);
    options.signal?.addEventListener('abort', () => stream.error(aborted()), { once: true });
  } }), { headers: { 'X-Request-ID': requestId } })) as typeof fetch;
  const controller = new AbortController(); const operation = request('/fixture', null, { signal: controller.signal }); void operation.catch(() => {});
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  await assert.rejects(operation, (error: unknown) => error instanceof DOMException && error.name === 'AbortError' && !error.message.includes(requestId));
  pendingReject = undefined; assert(timers[0].cleared);
});

test('no response means no invented ID, and concurrent errors cannot inherit another request ID', async () => {
  globalThis.fetch = (async () => { throw new TypeError('private transport error'); }) as typeof fetch;
  await assert.rejects(request('/fixture', null), (error: unknown) => error instanceof ApiError && error.requestId === undefined && !error.message.includes('请求编号'));
  const otherId = 'abcdef12-abcd-4abc-9abc-abcdef123456';
  globalThis.fetch = (async (url) => new Response('{"message":"safe"}', { status: 503,
    headers: { 'X-Request-ID': String(url).endsWith('/first') ? requestId : otherId } })) as typeof fetch;
  const results = await Promise.allSettled([request('/first', null), request('/second', null)]);
  assert.deepEqual(results.map((result) => result.status === 'rejected' ? result.reason.requestId : 'unexpected'), [requestId, otherId]);
});

test('successful responses do not inject diagnostic metadata into business values', async () => {
  globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200, headers: { 'X-Request-ID': requestId } })) as typeof fetch;
  assert.deepEqual(await request('/fixture', null), { ok: true }); assert(timers[0].cleared);
});

test('decoded requests validate successful JSON once and sanitize parser failures without automatic retries', async () => {
  let decodes = 0;
  const decode = (value: unknown) => { decodes++; assert.deepEqual(value, { ok: true }); return { checked: true }; };
  assert.deepEqual(await requestDecoded('/fixture', null, decode), { checked: true }); assert.equal(decodes, 1); assert.equal(calls.length, 1);
  globalThis.fetch = (async (url, options = {}) => {
    calls.push({ url: String(url), options }); return new Response('{"ok":true}', { headers: { 'X-Request-ID': requestId } });
  }) as typeof fetch;
  for (const method of ['GET', 'PUT', 'POST']) {
    const before: number = calls.length;
    await assert.rejects(requestDecoded('/fixture', null, () => { throw new Error('private-invalid-payload'); }, { method }), (error: unknown) => {
      assert(error instanceof ApiError); assert.equal(error.status, 502); assert.equal(error.requestId, requestId); assert(!error.message.includes('private-invalid-payload'));
      assert(error.message.includes(method === 'GET' ? '数据格式无效' : '先重新读取核对')); return true;
    });
    assert.equal(calls.length, before + 1);
  }
  assert(timers.every(timer => timer.cleared));
  assert(requiresWriteVerification(new ApiError('test', 0))); assert(requiresWriteVerification(new ApiError('test', 502)));
  for (const status of [400, 401, 403, 409, 500, 503]) assert.equal(requiresWriteVerification(new ApiError('test', status)), false);
  assert.equal(requiresWriteVerification(new Error('unclassified error')), false);
});

test('HTTP rejection never invokes a success decoder and malformed message objects are not shown', async () => {
  let decodes = 0;
  for (const message of [{ secret: 'private-error-object' }, ['private-array'], 9, null, 'x'.repeat(2001)]) {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message }), { status: 409 })) as typeof fetch;
    await assert.rejects(requestDecoded('/fixture', null, () => { decodes++; return true; }), (error: unknown) => error instanceof ApiError && error.status === 409 && error.message === '请求失败，请稍后重试。');
  }
  assert.equal(decodes, 0);
});

test('a transport resolving valid JSON after caller cancellation is not decoded or delivered', async () => {
  const controller = new AbortController(); let deliver: ((response: Response) => void) | undefined, decodes = 0;
  globalThis.fetch = (async () => new Promise<Response>(resolve => { deliver = resolve; })) as typeof fetch;
  const operation = requestDecoded('/fixture', null, () => { decodes++; return true; }, { signal: controller.signal });
  controller.abort(); deliver!(new Response('{"ok":true}'));
  await assert.rejects(operation, { name: 'AbortError' }); assert.equal(decodes, 0); assert(timers[0].cleared);
});
