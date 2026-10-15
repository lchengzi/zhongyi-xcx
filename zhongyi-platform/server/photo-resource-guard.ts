import { closeSync, fstatSync, fsyncSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PublicationControl } from '../shared/contracts.js';
import { date, digest, id, list, literal, object, unique } from '../shared/workflow-response.js';
import { photoFile, photoPath } from './photo-files.js';
import { AccountError } from './auth.js';

export const PHOTO_LOCK = '_maintenance.lock', PHOTO_RECOVERY = '_recovery.json';
export interface PhotoResourceRecovery {
  schemaVersion: 'photo-resource-recovery.1'; archiveDigest: string; databaseArchiveSha256: string; restoredAt: string; forbiddenEpochs: string[];
}
export function parsePhotoRecovery(input: unknown): PhotoResourceRecovery {
  const value = object(input, 'schemaVersion archiveDigest databaseArchiveSha256 restoredAt forbiddenEpochs');
  const epochs = list(value.forbiddenEpochs, id, 20000); unique(epochs);
  return { schemaVersion: literal(value.schemaVersion, 'photo-resource-recovery.1'), archiveDigest: digest(value.archiveDigest),
    databaseArchiveSha256: digest(value.databaseArchiveSha256), restoredAt: date(value.restoredAt), forbiddenEpochs: epochs };
}
export function readPhotoRecovery(root: string): PhotoResourceRecovery | null {
  photoPath(root, true); const path = resolve(root, PHOTO_RECOVERY);
  const stat = (() => { try { return lstatSync(path); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error;
  } })();
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ordinary recovery marker required');
  return parsePhotoRecovery(JSON.parse(photoFile(path, 2 * 1024 * 1024).toString('utf8')));
}
export function photoRecoveryAllows(root: string, control: PublicationControl | undefined): boolean {
  const recovery = readPhotoRecovery(root);
  return !recovery || !!control && control.action === 'resume' && control.recordedAt > recovery.restoredAt && !recovery.forbiddenEpochs.includes(control.epoch);
}
/** Cooperative, fail-fast lock. Stale/foreign locks are never removed. Only the
 * exact ordinary lock file created by this call is eligible for cleanup. */
export function withPhotoResourceLock<T>(root: string, work: () => T): T {
  photoPath(root, true); const path = resolve(root, PHOTO_LOCK), token = JSON.stringify({ owner: process.pid, nonce: randomUUID() });
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new AccountError(409, 'photo_resources_busy', '图片资源正在维护，请稍后重新读取。');
    throw error;
  }
  const stat = fstatSync(fd); let initialized = false;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try { writeFileSync(fd, token, 'utf8'); fsyncSync(fd); initialized = true; outcome = { ok: true, value: work() }; }
  catch (error) { outcome = { ok: false, error }; }
  try {
    closeSync(fd); photoPath(path, false);
    // Compare handle-derived identities on both sides. On Windows lstat may
    // report dev=0 while fstat reports the volume ID for the very same file.
    const confirmation = openSync(path, 'r');
    const current = (() => { try { return fstatSync(confirmation); } finally { closeSync(confirmation); } })();
    if (!initialized || current.dev !== stat.dev || current.ino !== stat.ino || photoFile(path, 1024).toString('utf8') !== token) throw new Error('Photo maintenance lock ownership changed');
    unlinkSync(path);
  } catch (error) { if (!outcome.ok) throw new AggregateError([outcome.error, error], 'Photo maintenance and lock cleanup failed'); throw error; }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
