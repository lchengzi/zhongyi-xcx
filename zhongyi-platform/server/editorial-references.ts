import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Express } from 'express';
import { object } from '../shared/workflow-response.js';
import { EDITORIAL_REFERENCE_SCHEMA, MAX_REFERENCE_BYTES, parseEditorialReference, parseEditorialReferenceList, type EditorialReferenceList } from '../shared/editorial-references.js';
import { photoId } from '../shared/private-photos.js';
import { photoFile, photoPath } from './photo-files.js';
import { jpegDimensions } from './private-photos.js';
import { currentAccount } from './auth-http.js';

function inside(root: string, path: string): boolean { const rel = relative(root, path); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }
/** Isolated read-only snapshot; deliberately has no candidate/publication API. */
export class EditorialReferenceRegistry {
  #root: string;
  #list: EditorialReferenceList;
  #images = new Map<string, Buffer>();
  constructor(manifestPath: string) {
    const manifest = photoPath(manifestPath, false); this.#root = photoPath(dirname(manifest), true);
    const raw = object(JSON.parse(photoFile(manifest, 256 * 1024).toString('utf8')) as unknown, 'schemaVersion items');
    if (raw.schemaVersion !== EDITORIAL_REFERENCE_SCHEMA || !Array.isArray(raw.items) || raw.items.length > 30) throw new Error('Invalid research manifest');
    let total = 0;
    const items = raw.items.map((entry: unknown) => {
      const { localPath, ...fields } = object(entry, 'id ingredientId name sourceUrl publisher locator author declaredLicense licenseUrl representation observation concerns sha256 bytes width height publicationEligible localPath');
      if (typeof localPath !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.jpg$/.test(localPath)) throw new Error('Invalid research image path');
      const item = parseEditorialReference(fields), file = photoPath(resolve(this.#root, localPath), false);
      if (!inside(this.#root, file) || (total += item.bytes) > 16 * MAX_REFERENCE_BYTES) throw new Error('Research image boundary');
      const bytes = photoFile(file, MAX_REFERENCE_BYTES), dimensions = jpegDimensions(bytes);
      if (bytes.length !== item.bytes || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== item.sha256 || item.width !== dimensions.width || item.height !== dimensions.height) throw new Error('Research image binding mismatch');
      this.#images.set(item.id, bytes); return item;
    });
    this.#list = parseEditorialReferenceList({ schemaVersion: EDITORIAL_REFERENCE_SCHEMA, enabled: true, items });
  }
  assertIsolation(target: string): void {
    const path = resolve(target);
    if (path === this.#root || inside(path, this.#root) || inside(this.#root, path)) throw new Error('Research references overlap public assets');
    // Check existing ancestors even when a future build directory is absent.
    let ancestor = path;
    for (;;) {
      try { photoPath(ancestor, true); return; }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; ancestor = dirname(ancestor); }
    }
  }
  list(): EditorialReferenceList { return parseEditorialReferenceList(this.#list); }
  image(id: string): Buffer | undefined { const bytes = this.#images.get(id); return bytes && Buffer.from(bytes); }
}
export function configureEditorialReferences(app: Express, registry?: EditorialReferenceRegistry): void {
  app.use('/api/v1/editorial-references', (req, res, next) => {
    currentAccount(res.locals); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.method !== 'GET' || Object.keys(req.query).length || Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] || req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(400).json({ error: 'invalid_reference_request', message: '研究参考只支持同源只读请求。' }); return;
    }
    next();
  });
  app.get('/api/v1/editorial-references', (_req, res) => res.json(registry?.list() ?? { schemaVersion: EDITORIAL_REFERENCE_SCHEMA, enabled: false, items: [] }));
  app.get('/api/v1/editorial-references/:id/image', (req, res) => {
    const bytes = photoId(req.params.id) ? registry?.image(req.params.id) : undefined;
    if (!bytes) { res.status(404).json({ error: 'reference_unavailable', message: '研究参考图不可用。' }); return; }
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${req.params.id}.jpg"`);
    res.type('image/jpeg').send(bytes);
  });
}
