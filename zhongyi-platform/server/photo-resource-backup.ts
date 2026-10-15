import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { date, digest, list, literal, number, object, text, unique } from '../shared/workflow-response.js';
import { PrivatePhotoRegistry } from './private-photos.js';
import { PhotoDerivativeRegistry } from './photo-derivative-registry.js';
import { PhotoPublicationJournal } from './photo-publication-journal.js';
import { photoFile, photoPath } from './photo-files.js';
import { PHOTO_LOCK, PHOTO_RECOVERY, parsePhotoRecovery, readPhotoRecovery, withPhotoResourceLock, type PhotoResourceRecovery } from './photo-resource-guard.js';

const FORMAT = 'food-education-photo-resources', MAX_PLAIN = 160 * 1024 * 1024;
export const MAX_PHOTO_BACKUP_BYTES = Math.ceil(MAX_PLAIN * 1.5);
const sha = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
interface ResourceFile { path: string; bytes: number; sha256: string; base64: string }
export interface PhotoResourceBackup {
  format: typeof FORMAT; version: 1; capturedAt: string; databaseArchiveSha256: string;
  previousRecovery: PhotoResourceRecovery | null; files: ResourceFile[]; digest: string;
}
function pathLimit(path: string): number {
  if (path === 'originals/manifest.json') return 256 * 1024;
  if (path === 'derivatives/bundle.json') return 512 * 1024;
  if (/^originals\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.jpg$/.test(path)) return 8 * 1024 * 1024;
  if (/^derivatives\/[a-f0-9]{64}\.jpg$/.test(path)) return 512 * 1024;
  if (/^journal\/[a-z][a-z0-9-]{0,79}\.[1-9][0-9]{0,4}\.json$/.test(path)) return 65536;
  throw new Error('Invalid photo resource path');
}
function base64(value: unknown, maximum: number): Buffer {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid photo resource encoding');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== value) throw new Error('Noncanonical photo resource bytes');
  return bytes;
}
function archiveDigest(backup: PhotoResourceBackup): string {
  const { digest: _digest, ...payload } = backup; return sha(Buffer.from(JSON.stringify(payload)));
}
export function parsePhotoResourceBackup(input: unknown): PhotoResourceBackup {
  const r = object(input, 'format version capturedAt databaseArchiveSha256 previousRecovery files digest');
  const files = list(r.files, input => {
    const entry = object(input, 'path bytes sha256 base64'), path = text(entry.path, 300), bytes = base64(entry.base64, pathLimit(path));
    if (bytes.length !== number(entry.bytes) || sha(bytes) !== digest(entry.sha256)) throw new Error('Photo resource checksum mismatch');
    return { path, bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') };
  }, 20000).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  unique(files.map(file => file.path.toLowerCase()));
  if (!files.some(file => file.path === 'originals/manifest.json') || !files.some(file => file.path === 'derivatives/bundle.json') ||
    files.reduce((sum, file) => sum + file.base64.length + 512, 0) > MAX_PLAIN) throw new Error('Incomplete or oversized photo backup');
  if (r.version !== 1) throw new Error('Unsupported photo backup');
  const backup: PhotoResourceBackup = { format: literal(r.format, FORMAT), version: 1, capturedAt: date(r.capturedAt), databaseArchiveSha256: digest(r.databaseArchiveSha256),
    previousRecovery: r.previousRecovery === null ? null : parsePhotoRecovery(r.previousRecovery), files, digest: digest(r.digest) };
  if (archiveDigest(backup) !== backup.digest) throw new Error('Photo backup digest mismatch');
  return backup;
}
export function capturePhotoResources(options: { originalsRoot: string; manifest: string; derivativesRoot: string; journalRoot: string; databaseArchiveSha256: string }): PhotoResourceBackup {
  digest(options.databaseArchiveSha256);
  const journal = new PhotoPublicationJournal(options.journalRoot);
  return withPhotoResourceLock(journal.root, () => {
    const originalManifest = photoFile(options.manifest, 256 * 1024), originalBundle = photoFile(resolve(options.derivativesRoot, 'bundle.json'), 512 * 1024);
    const originals = new PrivatePhotoRegistry(options.originalsRoot, options.manifest), derivatives = new PhotoDerivativeRegistry(options.derivativesRoot, originals);
    derivatives.assertIsolation(journal.root);
    const bundle: unknown = JSON.parse(originalBundle.toString('utf8'));
    if (!bundle || typeof bundle !== 'object' || !('originalManifestDigest' in bundle) || bundle.originalManifestDigest !== sha(originalManifest).slice(7)) throw new Error('Derivative manifest provenance mismatch');
    const files = new Map<string, ResourceFile>();
    const add = (path: string, bytes: Buffer) => {
      if (bytes.length > pathLimit(path)) throw new Error('Photo resource size limit');
      const previous = files.get(path);
      if (previous && previous.sha256 !== sha(bytes)) throw new Error('Resource collision');
      files.set(path, { path, bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') });
    };
    add('originals/manifest.json', originalManifest); add('derivatives/bundle.json', originalBundle);
    const manifest: unknown = JSON.parse(originalManifest.toString('utf8'));
    if (!manifest || typeof manifest !== 'object' || !('items' in manifest) || !Array.isArray(manifest.items)) throw new Error('Invalid original manifest');
    for (const raw of manifest.items) {
      if (!raw || typeof raw !== 'object' || !('id' in raw) || typeof raw.id !== 'string' || !('localPath' in raw) || typeof raw.localPath !== 'string') throw new Error('Invalid original mapping');
      const bytes = originals.asset(raw.id); if (!bytes) throw new Error('Missing original'); add(`originals/${raw.localPath}`, bytes);
    }
    for (const candidate of originals.list().items) {
      const item = derivatives.metadata(candidate.id), bytes = derivatives.asset(candidate.id);
      if (!item || !bytes) throw new Error('Missing derivative'); add(`derivatives/${item.assetFilename}`, bytes);
    }
    const names = readdirSync(journal.root).sort(), recordNames = names.filter(name => name !== PHOTO_LOCK && name !== PHOTO_RECOVERY);
    const ids = new Set<string>();
    for (const name of recordNames) {
      pathLimit(`journal/${name}`); ids.add(name.split('.')[0]!); add(`journal/${name}`, photoFile(resolve(journal.root, name), 65536));
    }
    for (const id of ids) journal.history(id);
    for (const name of recordNames) if (sha(photoFile(resolve(journal.root, name), 65536)) !== files.get(`journal/${name}`)?.sha256) throw new Error('Journal changed during capture');
    const previousRecovery = readPhotoRecovery(journal.root);
    const reread = new PrivatePhotoRegistry(options.originalsRoot, options.manifest);
    new PhotoDerivativeRegistry(options.derivativesRoot, reread);
    if (sha(photoFile(options.manifest, 256 * 1024)) !== sha(originalManifest) || sha(photoFile(resolve(options.derivativesRoot, 'bundle.json'), 512 * 1024)) !== sha(originalBundle) ||
      JSON.stringify(readdirSync(journal.root).sort()) !== JSON.stringify(names) || JSON.stringify(reread.list()) !== JSON.stringify(originals.list())) throw new Error('Photo sources changed during capture');
    const backup: PhotoResourceBackup = { format: FORMAT, version: 1, capturedAt: new Date().toISOString(), databaseArchiveSha256: options.databaseArchiveSha256,
      previousRecovery, files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), digest: `sha256:${'0'.repeat(64)}` };
    backup.digest = archiveDigest(backup); return parsePhotoResourceBackup(backup);
  });
}
export function encryptPhotoResources(value: PhotoResourceBackup, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('Invalid resource backup key');
  const backup = parsePhotoResourceBackup(value), plain = Buffer.from(JSON.stringify(backup));
  if (plain.length > MAX_PLAIN) throw new Error('Photo backup limit');
  try {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(`${FORMAT}:1`));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.from(JSON.stringify({ format: FORMAT, version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') }));
  } finally { plain.fill(0); }
}
export function decryptPhotoResources(bytes: Buffer, key: Buffer): PhotoResourceBackup {
  try {
    if (bytes.length > MAX_PHOTO_BACKUP_BYTES || key.length !== 32) throw new Error();
    const r = object(JSON.parse(bytes.toString('utf8')), 'format version algorithm iv tag ciphertext');
    if (r.format !== FORMAT || r.version !== 1 || r.algorithm !== 'aes-256-gcm') throw new Error();
    const iv = base64(r.iv, 12), tag = base64(r.tag, 16); if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(Buffer.from(`${FORMAT}:1`)); decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(base64(r.ciphertext, MAX_PLAIN)), decipher.final()]);
    try { if (plain.length > MAX_PLAIN) throw new Error(); return parsePhotoResourceBackup(JSON.parse(plain.toString('utf8'))); }
    finally { plain.fill(0); }
  } catch { throw new Error('图片备份无法认证或验证，拒绝恢复。'); }
}
export function writeNewPhotoFile(path: string, bytes: Buffer): void {
  photoPath(dirname(path), true); const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
export function restorePhotoResources(raw: PhotoResourceBackup, parent: string, databaseArchiveSha256: string) {
  const backup = parsePhotoResourceBackup(raw);
  if (digest(databaseArchiveSha256) !== backup.databaseArchiveSha256) throw new Error('Database archive association mismatch');
  photoPath(parent, true);
  const directory = resolve(parent, `photo-recovery-${randomUUID()}`); mkdirSync(directory); photoPath(directory, true);
  for (const name of ['originals', 'derivatives', 'journal']) mkdirSync(resolve(directory, name));
  const epochs = new Set(backup.previousRecovery?.forbiddenEpochs ?? []);
  for (const file of backup.files) if (file.path.startsWith('journal/')) {
    const record: unknown = JSON.parse(base64(file.base64, 65536).toString('utf8'));
    if (!record || typeof record !== 'object' || !('controlEpoch' in record) || typeof record.controlEpoch !== 'string') throw new Error('Invalid publication epoch');
    epochs.add(record.controlEpoch);
  }
  const marker = parsePhotoRecovery({ schemaVersion: 'photo-resource-recovery.1', archiveDigest: backup.digest,
    databaseArchiveSha256: backup.databaseArchiveSha256, restoredAt: new Date().toISOString(), forbiddenEpochs: [...epochs].sort() });
  // Quarantine is created before any content file can be observed at this root.
  writeNewPhotoFile(resolve(directory, 'journal', PHOTO_RECOVERY), Buffer.from(JSON.stringify(marker)));
  for (const file of backup.files) {
    const path = resolve(directory, file.path); let cursor = directory;
    for (const segment of file.path.split('/').slice(0, -1)) {
      cursor = resolve(cursor, segment);
      try { photoPath(cursor, true); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; photoPath(dirname(cursor), true); mkdirSync(cursor); }
    }
    writeNewPhotoFile(path, base64(file.base64, pathLimit(file.path)));
  }
  const originals = new PrivatePhotoRegistry(resolve(directory, 'originals'), resolve(directory, 'originals/manifest.json'));
  const derivatives = new PhotoDerivativeRegistry(resolve(directory, 'derivatives'), originals), journal = new PhotoPublicationJournal(resolve(directory, 'journal'));
  const bundle: unknown = JSON.parse(photoFile(resolve(directory, 'derivatives/bundle.json'), 512 * 1024).toString('utf8'));
  if (!bundle || typeof bundle !== 'object' || !('originalManifestDigest' in bundle) || bundle.originalManifestDigest !== sha(photoFile(resolve(directory, 'originals/manifest.json'), 256 * 1024)).slice(7)) throw new Error('Restored manifest provenance mismatch');
  for (const id of new Set(backup.files.filter(file => file.path.startsWith('journal/')).map(file => file.path.slice(8).split('.')[0]!))) journal.history(id);
  return { directory, originals, derivatives, journal, recovery: marker, publicationEnabled: false as const };
}
