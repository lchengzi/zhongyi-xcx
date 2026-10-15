// Private editorial protocol. Never import this module into the mini-program.
export const PRIVATE_PHOTO_SCHEMA = 'private-photo-preview.1';
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export interface PrivatePhoto {
  id: string; ingredientId: string; name: string; sourcePage: string; sourceRevision: string;
  author: string; declaredLicense: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0';
  licenseUrl: string; observation: string; concerns: string[];
  sha256: string; bytes: number; width: number; height: number;
  identityReview: 'pending'; processingReview: 'pending'; rightsReview: 'pending'; professionalReview: 'pending';
  originalMetadataRetained: true; publicationEligible: false;
}
export interface PrivatePhotoList { schemaVersion: typeof PRIVATE_PHOTO_SCHEMA; enabled: boolean; items: PrivatePhoto[] }
export function photoId(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100; }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private photo object');
  const result = Object.fromEntries(Object.entries(value));
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw new Error('Unexpected private photo fields');
  return result;
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid private photo text');
  return value;
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid private photo number');
  return value;
}
export function parsePrivatePhoto(value: unknown): PrivatePhoto {
  const r = record(value, ['id', 'ingredientId', 'name', 'sourcePage', 'sourceRevision', 'author', 'declaredLicense', 'licenseUrl', 'observation', 'concerns', 'sha256', 'bytes', 'width', 'height', 'identityReview', 'processingReview', 'rightsReview', 'professionalReview', 'originalMetadataRetained', 'publicationEligible']);
  if (!photoId(r.id) || !photoId(r.ingredientId) || typeof r.sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(r.sha256) ||
      typeof r.sourceRevision !== 'string' || !/^[1-9][0-9]{0,14}$/.test(r.sourceRevision)) throw new Error('Invalid private photo identity');
  const sourcePage = text(r.sourcePage, 500), source = new URL(sourcePage);
  if (source.origin !== 'https://commons.wikimedia.org' || !source.pathname.startsWith('/wiki/File:') || source.username || source.password || source.search || source.hash) throw new Error('Invalid private photo source');
  const license = r.declaredLicense;
  if (license !== 'CC0-1.0' && license !== 'CC-BY-4.0' && license !== 'CC-BY-SA-4.0') throw new Error('Invalid declared license');
  const licenseUrl = license === 'CC0-1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : license === 'CC-BY-4.0' ? 'https://creativecommons.org/licenses/by/4.0/' : 'https://creativecommons.org/licenses/by-sa/4.0/';
  if (r.licenseUrl !== licenseUrl || ['identityReview', 'processingReview', 'rightsReview', 'professionalReview'].some(key => r[key] !== 'pending') || r.originalMetadataRetained !== true || r.publicationEligible !== false) throw new Error('Preview cannot grant approval');
  if (!Array.isArray(r.concerns) || !r.concerns.length || r.concerns.length > 10) throw new Error('Invalid private photo concerns');
  const width = integer(r.width, 12000), height = integer(r.height, 12000);
  if (width * height > 32_000_000) throw new Error('Private photo pixel limit');
  // Explicit projection, detached from incoming objects; no paths or EXIF fields.
  return { id: r.id, ingredientId: r.ingredientId, name: text(r.name, 80), sourcePage, sourceRevision: r.sourceRevision,
    author: text(r.author, 200), declaredLicense: license, licenseUrl, observation: text(r.observation), concerns: r.concerns.map(item => text(item)),
    sha256: r.sha256, bytes: integer(r.bytes, MAX_PHOTO_BYTES), width, height,
    identityReview: 'pending', processingReview: 'pending', rightsReview: 'pending', professionalReview: 'pending', originalMetadataRetained: true, publicationEligible: false };
}
export function parsePrivatePhotoList(value: unknown): PrivatePhotoList {
  const r = record(value, ['schemaVersion', 'enabled', 'items']);
  if (r.schemaVersion !== PRIVATE_PHOTO_SCHEMA || typeof r.enabled !== 'boolean' || !Array.isArray(r.items) || r.items.length > 100 || (!r.enabled && r.items.length)) throw new Error('Invalid private photo list');
  const items = r.items.map(parsePrivatePhoto);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate private photo');
  return { schemaVersion: PRIVATE_PHOTO_SCHEMA, enabled: r.enabled, items };
}
