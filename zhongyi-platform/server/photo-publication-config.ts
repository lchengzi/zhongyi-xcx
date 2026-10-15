import type { PrivatePhotoRegistry } from './private-photos.js';
import { PhotoDerivativeRegistry } from './photo-derivative-registry.js';
import { PhotoPublicationJournal } from './photo-publication-journal.js';

export function photoPublicationFiles(env: NodeJS.ProcessEnv, originals?: PrivatePhotoRegistry) {
  const derivativeRoot = env.PHOTO_DERIVATIVE_ROOT, journalRoot = env.PHOTO_PUBLICATION_ROOT, enabled = env.ENABLE_PHOTO_PUBLICATION;
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') throw new Error('Explicit photo publication boolean required');
  if (!derivativeRoot && !journalRoot && enabled !== 'true') return;
  if (!derivativeRoot || !journalRoot || !originals) throw new Error('Photo publication needs private originals and both explicit artifact directories');
  const derivatives = new PhotoDerivativeRegistry(derivativeRoot, originals), journal = new PhotoPublicationJournal(journalRoot);
  derivatives.assertIsolation(journal.root);
  return { derivatives, journal, enabled: enabled === 'true' };
}
