import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import { withFailureDiagnostics, type FailureSink } from './failure-diagnostics.js';

export type RequestCategory = 'health' | 'readiness' | 'public' | 'authentication' | 'accounts' | 'editorial' | 'catalog' | 'other';
export interface RequestLogRecord {
  readonly event: 'api_request';
  readonly timestamp: string;
  readonly requestId: string;
  readonly category: RequestCategory;
  readonly method: string;
  readonly status: number | null;
  readonly durationMs: number;
  readonly outcome: 'completed' | 'aborted';
}
export type RequestLogSink = (record: RequestLogRecord) => void | Promise<void>;

// Mounted at /api. These are diagnostic buckets, never authorization decisions.
export function requestCategory(path: string): RequestCategory {
  const value = path.toLowerCase();
  const under = (prefix: string) => value === prefix || value.startsWith(`${prefix}/`);
  if (value === '/health') return 'health';
  if (value === '/ready') return 'readiness';
  if (under('/v1/public')) return 'public';
  if (under('/v1/auth')) return 'authentication';
  if (under('/v1/users') || under('/v1/security-events')) return 'accounts';
  if (under('/v1/editorial')) return 'editorial';
  if (under('/v1/ingredients') || value === '/v1/summary' || value === '/v1/events') return 'catalog';
  return 'other';
}

export function requestDiagnostics(sink?: RequestLogSink, failures?: FailureSink): RequestHandler {
  return (req, res, next) => {
    // Never echo a supplied correlation header: it can contain private text.
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    const bucket = requestCategory(req.path);
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
    if (sink) {
      const started = performance.now();
      let emitted = false;
      const emit = (outcome: RequestLogRecord['outcome']) => {
        if (emitted) return;
        emitted = true;
        res.off('finish', complete); res.off('close', closed);
        const record: RequestLogRecord = Object.freeze({ event: 'api_request', timestamp: new Date().toISOString(), requestId,
          category: bucket, method, status: outcome === 'completed' ? res.statusCode : null,
          durationMs: Math.max(0, Math.round((performance.now() - started) * 100) / 100), outcome });
        // Diagnostics must not turn a successful write into a failed response.
        try { void Promise.resolve(sink(record)).catch(() => {}); } catch { /* No raw logger errors. */ }
      };
      const complete = () => emit('completed');
      const closed = () => emit(res.writableFinished ? 'completed' : 'aborted');
      res.once('finish', complete); res.once('close', closed);
    }
    withFailureDiagnostics({ requestId, category: bucket, method }, failures, next);
  };
}

export const writeRequestLog: RequestLogSink = (record) => { console.log(JSON.stringify(record)); };
