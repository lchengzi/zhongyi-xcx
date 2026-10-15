import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import type { Express } from 'express';
import { currentAccount } from './auth-http.js';
import { MAX_PHOTO_BYTES, PRIVATE_PHOTO_SCHEMA, parsePrivatePhoto, parsePrivatePhotoList, photoId, type PrivatePhotoList, type PrivatePhoto } from '../shared/private-photos.js';

function contained(root: string, path: string): boolean { const rel = relative(root, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }
function regularPath(path: string, directory: boolean): string {
  if (!isAbsolute(path) || resolve(path) === parse(path).root) throw new Error('Explicit non-root private photo path required');
  let cursor = path;
  while (cursor !== parse(cursor).root) {
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('Private photo links are not allowed');
    cursor = dirname(cursor);
  }
  const real = realpathSync(path), stat = lstatSync(real);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Invalid private photo file type');
  return real;
}
function boundedFile(path: string, max: number): Buffer {
  const real = regularPath(path, false), fd = openSync(real, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > max) throw new Error('Private photo file size limit');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0, count = 0;
    do { count = readSync(fd, buffer, length, buffer.length - length, null); length += count; } while (count && length < buffer.length);
    if (length !== stat.size) throw new Error('Private photo changed during read');
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('JPEG required');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG segment');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) throw new Error('Invalid JPEG frame');
      return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
    }
    offset += length;
  }
  throw new Error('Supported JPEG frame required');
}
export class PrivatePhotoRegistry {
  #root: string;
  #list: PrivatePhotoList;
  #assets = new Map<string, Buffer>();
  constructor(assetRoot: string, manifestPath: string) {
    this.#root = regularPath(assetRoot, true);
    const manifest = regularPath(manifestPath, false);
    if (!contained(this.#root, manifest)) throw new Error('Private manifest must be inside asset root');
    const value: unknown = JSON.parse(boundedFile(manifest, 256 * 1024).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'items,schemaVersion' || !('schemaVersion' in value) || value.schemaVersion !== PRIVATE_PHOTO_SCHEMA || !('items' in value) || !Array.isArray(value.items) || value.items.length > 100) throw new Error('Invalid private manifest');
    let totalBytes = 0;
    const items = value.items.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid private manifest item');
      const { localPath, ...metadata } = Object.fromEntries(Object.entries(raw));
      if (typeof localPath !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.jpg$/.test(localPath)) throw new Error('Invalid private asset path');
      const item = parsePrivatePhoto(metadata), path = regularPath(resolve(this.#root, localPath), false);
      totalBytes += item.bytes;
      if (totalBytes > 64 * 1024 * 1024) throw new Error('Private photo registry size limit');
      if (!contained(this.#root, path)) throw new Error('Private asset outside root');
      const bytes = boundedFile(path, MAX_PHOTO_BYTES), dimensions = jpegDimensions(bytes);
      if (bytes.length !== item.bytes || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== item.sha256 || dimensions.width !== item.width || dimensions.height !== item.height) throw new Error('Private asset binding mismatch');
      this.#assets.set(item.id, bytes);
      return item;
    });
    this.#list = parsePrivatePhotoList({ schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: true, items });
  }
  assertStaticIsolation(staticRoot?: string): void {
    if (!staticRoot) return;
    const root = resolve(staticRoot);
    // Check every existing ancestor, even before a future Vite dist exists.
    let ancestor = root;
    while (true) {
      try { regularPath(ancestor, true); break; }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; ancestor = dirname(ancestor); }
    }
    if (root === this.#root || contained(root, this.#root) || contained(this.#root, root)) throw new Error('Private photos cannot overlap web static root');
  }
  list(): PrivatePhotoList { return parsePrivatePhotoList(this.#list); }
  candidate(id: string): PrivatePhoto | undefined { const item = this.#list.items.find(photo => photo.id === id); return item ? parsePrivatePhoto(item) : undefined; }
  asset(id: string): Buffer | undefined { const bytes = this.#assets.get(id); return bytes ? Buffer.from(bytes) : undefined; }
}
export function privatePhotosFromEnvironment(env: NodeJS.ProcessEnv, mode: 'accounts' | 'local-key'): PrivatePhotoRegistry | undefined {
  const root = env.PRIVATE_PHOTO_ROOT, manifest = env.PRIVATE_PHOTO_MANIFEST;
  if (root === undefined && manifest === undefined) return;
  if (mode !== 'accounts' || !root || !manifest || !isAbsolute(root) || !isAbsolute(manifest)) throw new Error('Private photos require account mode and two explicit absolute paths');
  return new PrivatePhotoRegistry(root, manifest);
}
export function configurePrivatePhotos(app: Express, registry?: PrivatePhotoRegistry): void {
  app.use('/api/v1/private-photos', (req, res, next) => {
    currentAccount(res.locals);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.method !== 'GET' || Object.keys(req.query).length || Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] || req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(400).json({ error: 'invalid_photo_request', message: '图片审阅只支持同源只读请求。' }); return;
    }
    next();
  });
  app.get('/api/v1/private-photos', (_req, res) => { res.json(registry?.list() ?? { schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: false, items: [] }); });
  app.get('/api/v1/private-photos/:id/original', (req, res) => {
    const bytes = photoId(req.params.id) ? registry?.asset(req.params.id) : undefined;
    if (!bytes) { res.status(404).json({ error: 'photo_unavailable', message: '该候选原图不可用。' }); return; }
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${req.params.id}.jpg"`);
    res.type('image/jpeg').send(bytes);
  });
}
