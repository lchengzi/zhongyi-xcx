import { resolve, relative, isAbsolute, sep } from 'node:path';
import { object, text, date, digest } from '../shared/workflow-response.js';
import { parsePhotoDerivative, type PhotoDerivative } from '../shared/photo-derivatives.js';
import { validatePhotoDerivative } from './photo-derivative-preparation.js';
import { photoFile, photoPath } from './photo-files.js';
import type { PrivatePhotoRegistry } from './private-photos.js';

export class PhotoDerivativeRegistry {
  readonly root: string;
  #items = new Map<string, PhotoDerivative>();
  constructor(directory: string, readonly originals: PrivatePhotoRegistry) {
    this.root = photoPath(directory, true);
    const bundle = object(JSON.parse(photoFile(resolve(this.root, 'bundle.json'), 524288).toString('utf8')), 'schemaVersion preparedAt encoderVersion originalManifestDigest publicationEligible items');
    if (bundle.schemaVersion !== 'private-photo-derivative-bundle.1' || bundle.publicationEligible !== false || !Array.isArray(bundle.items) || !bundle.items.length || bundle.items.length > 100) throw new Error('Invalid derivative bundle');
    const encoder = text(bundle.encoderVersion, 100); date(bundle.preparedAt);
    digest(`sha256:${text(bundle.originalManifestDigest, 64)}`);
    for (const raw of bundle.items) {
      const item = parsePhotoDerivative(raw), original = originals.candidate(item.candidate.id);
      if (!original || item.encoderVersion !== encoder || this.#items.has(original.id)) throw new Error('Derivative candidate mismatch');
      validatePhotoDerivative(item, photoFile(resolve(this.root, item.assetFilename), 524288), original);
      this.#items.set(original.id, item);
    }
  }
  assertIsolation(other: string) {
    const target = resolve(other), rel = relative(target, this.root), reverse = relative(this.root, target);
    const contained = (value: string) => value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
    if (contained(rel) || contained(reverse)) throw new Error('Private photo artifact overlaps public or publication directory');
    this.originals.assertStaticIsolation(target);
  }
  metadata(id: string): PhotoDerivative | undefined { const value = this.#items.get(id); return value ? parsePhotoDerivative(value) : undefined; }
  asset(id: string): Buffer | undefined {
    const item = this.#items.get(id); if (!item) return;
    const bytes = photoFile(resolve(this.root, item.assetFilename), 524288);
    validatePhotoDerivative(item, bytes, this.originals.candidate(id)); return bytes;
  }
}
