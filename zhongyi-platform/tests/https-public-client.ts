import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { createEducationClient, type EducationTransport } from '../../packages/catalog-core/src/education-client.js';

/** Test-only routing to the controller's loopback TLS listener. No HTTP downgrade,
 * OS trust change, cookie jar, credentials or production transport override. */
export function httpsPublicClient(port: number, ca: Buffer) {
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  const origin = 'https://localhost';
  let mode: 'trusted' | 'untrusted' | 'wrong-hostname' = 'trusted';
  const evidence = { requests: 0, authorizedResponses: 0, hostnameRejections: 0, untrustedRejections: 0 };
  const transport: EducationTransport = {
    request(input) {
      assert.deepEqual(input, { url: `${origin}/api/v1/public/education/huang-qi`, method: 'GET',
        header: { Accept: 'application/json' }, timeoutMs: 6000 });
      evidence.requests++;
      const attemptedMode = mode;
      let abort = () => {};
      const promise = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const request = httpsRequest({ hostname: '127.0.0.1', port,
          servername: attemptedMode === 'wrong-hostname' ? 'wrong-hostname.invalid' : 'localhost',
          ca: attemptedMode === 'untrusted' ? undefined : ca,
          rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
          path: new URL(input.url).pathname, method: input.method, headers: input.header }, response => {
          try {
            const socket = response.socket as TLSSocket;
            assert.equal(socket.authorized, true);
            assert.ok(['TLSv1.2', 'TLSv1.3'].includes(socket.getProtocol() || ''));
            assert.equal(attemptedMode, 'trusted', 'Negative TLS attempts must never yield an HTTP response');
            evidence.authorizedResponses++;
            let bytes = 0; const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 128 * 1024) { response.destroy(new Error('Fixture response limit exceeded')); return; }
              chunks.push(chunk);
            });
            response.once('error', reject);
            response.once('end', () => {
              try { resolve({ status: response.statusCode || 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }); }
              catch (error) { reject(error); }
            });
          } catch (error) { response.resume(); reject(error); }
        });
        request.once('error', (error: NodeJS.ErrnoException) => {
          if (attemptedMode === 'wrong-hostname' && error.code === 'ERR_TLS_CERT_ALTNAME_INVALID') evidence.hostnameRejections++;
          if (attemptedMode === 'untrusted' && ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
            'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error.code || '')) evidence.untrustedRejections++;
          reject(error);
        });
        abort = () => request.destroy(new Error('Public reading cancelled'));
        request.end();
      });
      return { promise, abort: () => abort() };
    }
  };
  const client = createEducationClient({ origin,
    binding: { ingredientId: 'huang-qi', name: '黄芪', baseReleaseId: 'release-test.1' },
    transport, now: Date.now,
    scheduler: { after(ms, callback) { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } } });
  const clear = () => assert.equal(client.clear(client.getSnapshot().revision), true);
  return { client, evidence, clear, setMode(value: typeof mode) { mode = value; } };
}
