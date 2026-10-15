import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';

export type LoginStage = 'limit_cleanup' | 'limit_read' | 'limit_write' | 'account_lookup' | 'account_recheck' |
  'session_cleanup' | 'session_write' | 'security_event' | 'begin' | 'commit' | 'rollback' | 'other';
export interface LoginSqlTiming {
  stage: LoginStage; operation: 'prepare' | 'exec' | 'run' | 'get' | 'all';
  startedMs: number; endedMs: number; durationMs: number; explicitTransaction: boolean; failed: boolean;
}
function stage(sql: string): LoginStage {
  const text = sql.replace(/\s+/g, ' ').trim().toUpperCase();
  if (text === 'BEGIN IMMEDIATE') return 'begin';
  if (text === 'COMMIT') return 'commit';
  if (text === 'ROLLBACK') return 'rollback';
  if (text.startsWith('DELETE FROM LOGIN_ATTEMPTS WHERE RESET_AT <= ?')) return 'limit_cleanup';
  if (text.startsWith('SELECT ATTEMPTS FROM LOGIN_ATTEMPTS WHERE KEY = ?')) return 'limit_read';
  if (text.startsWith('INSERT INTO LOGIN_ATTEMPTS ')) return 'limit_write';
  if (text.startsWith('SELECT ') && text.includes(' FROM USERS WHERE USERNAME = ?')) return 'account_lookup';
  if (text.startsWith('SELECT ') && text.includes(' FROM USERS WHERE ID = ?')) return 'account_recheck';
  if (text.startsWith('DELETE FROM SESSIONS WHERE EXPIRES_AT <= ?')) return 'session_cleanup';
  if (text.startsWith('INSERT INTO SESSIONS ')) return 'session_write';
  if (text.startsWith('INSERT INTO SECURITY_EVENTS ')) return 'security_event';
  return 'other';
}
const round = (value: number) => Math.round(value * 100) / 100;

// Owned diagnostic fixtures only. No prototype patches, SQL/argument capture,
// PRAGMA changes, transaction injection or production environment switches.
export function instrumentLoginDatabase(db: DatabaseSync, now = () => performance.now()) {
  const started = now(); const records: LoginSqlTiming[] = []; let transaction = false; let dropped = 0;
  const observe = <T>(bucket: LoginStage, operation: LoginSqlTiming['operation'], work: () => T): T => {
    const begin = now(); const explicitTransaction = transaction; let failed = true;
    try { const result = work(); failed = false; return result; }
    finally {
      const end = now();
      if (records.length < 128) records.push({ stage: bucket, operation, startedMs: round(begin - started), endedMs: round(end - started),
        durationMs: round(end - begin), explicitTransaction, failed }); else dropped++;
      if (!failed && operation === 'exec') {
        if (bucket === 'begin') transaction = true;
        if (bucket === 'commit' || bucket === 'rollback') transaction = false;
      }
    }
  };
  const database = new Proxy(db, { get(target, key) {
    if (key === 'exec') return (sql: string) => observe(stage(sql), 'exec', () => target.exec(sql));
    if (key === 'prepare') return (sql: string) => {
      const bucket = stage(sql); const statement = observe(bucket, 'prepare', () => target.prepare(sql));
      return new Proxy(statement, { get(value, method) {
        if (method === 'run' || method === 'get' || method === 'all') {
          return (...args: unknown[]) => observe(bucket, method, () => Reflect.apply(value[method], value, args));
        }
        const member = Reflect.get(value, method, value); return typeof member === 'function' ? member.bind(value) : member;
      } });
    };
    const member = Reflect.get(target, key, target); return typeof member === 'function' ? member.bind(target) : member;
  } });
  return { database, finish() {
    const durationMs = round(now() - started);
    const lookup = records.find((r) => r.stage === 'account_lookup' && r.operation === 'get');
    const recheck = records.find((r) => r.stage === 'account_recheck' && r.operation === 'get');
    const sqlMs = round(records.reduce((sum, r) => sum + r.durationMs, 0));
    return { durationMs, sqlMs, nonSqlMs: round(Math.max(0, durationMs - sqlMs)),
      // Includes password derivation, comparison and scheduling, not pure CPU time.
      passwordCheckGapMs: lookup && recheck ? round(recheck.startedMs - lookup.endedMs) : null,
      dropped, records: records.map((r) => ({ ...r })) };
  } };
}
