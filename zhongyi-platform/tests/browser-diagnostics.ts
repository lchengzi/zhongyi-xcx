// Explicit local fixture evidence only; never imported by the production entry.
import { closeSync, openSync, realpathSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from '../server/demo-secrets.js';
import type { FailureSink } from '../server/failure-diagnostics.js';
import type { RequestLogSink } from '../server/request-log.js';

export function browserDiagnostics(port: number) {
  if (process.env.API_FAILURE_DIAGNOSTICS !== 'true') return { options: {}, close() {} };
  if (![4311, 4312, 4313, 4314, 4315].includes(port)) throw new Error('Unknown owned browser service');
  const report = process.env.CI_BROWSER_REPORT;
  if (!report || !isAbsolute(report) || basename(report) !== 'browser-results.json') throw new Error('Explicit fresh local browser report required for diagnostics');
  const root = realpathSync(resolve('.local')); const directory = dirname(report);
  assertNoLinks(directory); const actual = realpathSync(directory); const path = relative(root, actual);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('Browser diagnostics must stay in an owned local evidence directory');
  const filename = join(actual, `api-diagnostics-${port}-${randomUUID()}.jsonl`);
  const fd = openSync(filename, 'wx', 0o600); let closed = false;
  const requestLog: RequestLogSink = record => { writeSync(fd, JSON.stringify(record) + '\n'); };
  const failureLog: FailureSink = record => { writeSync(fd, JSON.stringify(record) + '\n'); };
  return { options: { requestLog, failureLog }, close() { if (!closed) { closed = true; closeSync(fd); } } };
}
