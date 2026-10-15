import { isAbsolute, resolve } from 'node:path';

// pg_ctl on Windows uses PostgreSQL's CreateRestrictedProcess. Directly spawning
// postgres inherits the hosted runner's administrator token and is rejected.
// pg_ctl constructs a command line internally: reject shell syntax first.
export function windowsPostgresStartArgs(dataDir: string, serverLog: string, options: readonly string[]): string[] {
  const safe = (value: string) => {
    if (!value || !/^[\p{L}\p{N} _./:=,\\-]+$/u.test(value)) throw new Error('Unsafe owned PostgreSQL command argument');
    return value.replaceAll('\\', '/');
  };
  if (!isAbsolute(dataDir) || !isAbsolute(serverLog)) throw new Error('Absolute owned PostgreSQL paths required');
  safe(dataDir); safe(serverLog);
  return ['-D', dataDir, '-l', serverLog, '-w', '-t', '20', '-o', options.map(value => `"${safe(value)}"`).join(' '), 'start'];
}

export interface PostmasterIdentity { pid: number; dataDir: string; startedSeconds: number; port: number }
export function postmasterIdentity(text: string, dataDir: string, port: number, startedAfter: number): PostmasterIdentity {
  const fields = text.split(/\r?\n/); const pid = Number(fields[0]), startedSeconds = Number(fields[2]);
  if (!/^[1-9]\d*$/.test(fields[0] ?? '') || !Number.isSafeInteger(pid) || pid <= 1 ||
    !fields[1] || resolve(fields[1]).toLowerCase() !== resolve(dataDir).toLowerCase() ||
    !Number.isSafeInteger(startedSeconds) || startedSeconds < Math.floor(startedAfter / 1000) ||
    Number(fields[3]) !== port) throw new Error('Owned PostgreSQL process identity mismatch');
  return { pid, dataDir: resolve(dataDir), startedSeconds, port };
}

// Signal 0 only observes. Access denied is not evidence of a stopped process.
export function postgresPidLive(pid: number, probe: (pid: number) => void = value => { process.kill(value, 0); }): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned PostgreSQL PID');
  try { probe(pid); return true; }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return false;
    throw new Error('Cannot verify owned PostgreSQL process liveness');
  }
}
