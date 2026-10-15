import { parseEducationBinding, publicContentOrigin, type EducationBinding } from './education.js';

export const PHOTO_PATH = '/api/v1/public/photos/';
export const PHOTO_BATCH_SIZE = 12;
export interface PublicPhoto {
  readonly sha256: string; readonly width: number; readonly height: number; readonly bytes: number;
  readonly caption: string; readonly part: string; readonly processing: string;
  readonly author: string; readonly sourceUrl: string;
  readonly license: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0';
  readonly licenseUrl: string; readonly modification: string;
}
export interface PublicPhotoGallery extends EducationBinding {
  readonly schemaVersion: 'public-photo-gallery.1'; readonly version: number;
  readonly publishedAt: string; readonly validUntil: string; readonly photos: readonly PublicPhoto[];
}
function object(input: unknown, keys: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid photo payload');
  const value = Object.fromEntries(Object.entries(input)), fields = keys.split(' ');
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('Invalid photo fields');
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid photo text');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid photo number');
  return value;
}
function iso(value: unknown): string {
  const result = text(value, 24), time = Date.parse(result);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) throw new Error('Invalid photo date');
  return result;
}
const licenses = { 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/' };
/** Shape validation is not approval. Only a deployment-pinned publishing service
 * may supply this projection; private candidates cannot become public by parsing. */
export function parsePublicPhotoGallery(input: unknown, expected: EducationBinding, now: number): PublicPhotoGallery {
  const binding = parseEducationBinding(expected);
  const value = object(input, 'schemaVersion ingredientId name baseReleaseId version publishedAt validUntil photos');
  if (!Number.isFinite(now) || now < 0 || value.schemaVersion !== 'public-photo-gallery.1' || value.ingredientId !== binding.ingredientId || value.name !== binding.name || value.baseReleaseId !== binding.baseReleaseId) throw new Error('Photo identity or version mismatch');
  const publishedAt = iso(value.publishedAt), validUntil = iso(value.validUntil);
  if (Date.parse(publishedAt) > now || Date.parse(validUntil) <= now || Date.parse(validUntil) <= Date.parse(publishedAt)) throw new Error('Photo publication expired');
  if (!Array.isArray(value.photos) || value.photos.length < 1 || value.photos.length > 8) throw new Error('Invalid photo count');
  const photos = value.photos.map((input: unknown): PublicPhoto => {
    const photo = object(input, 'sha256 width height bytes caption part processing author sourceUrl license licenseUrl modification');
    const sha256 = text(photo.sha256, 71), sourceUrl = text(photo.sourceUrl, 2000);
    const url = /^(https:\/\/[a-z0-9.-]+(?::443)?)(?:[/?#][^\s<>"'\\]*)?$/i.exec(sourceUrl);
    if (!/^sha256:[a-f0-9]{64}$/.test(sha256) || !url || !publicContentOrigin(url[1])) throw new Error('Invalid photo address');
    const license = photo.license;
    if (license !== 'CC0-1.0' && license !== 'CC-BY-4.0' && license !== 'CC-BY-SA-4.0') throw new Error('Unsupported photo license');
    if (photo.licenseUrl !== licenses[license]) throw new Error('Photo license mismatch');
    return Object.freeze({ sha256, width: integer(photo.width, 16, 1280), height: integer(photo.height, 16, 1280), bytes: integer(photo.bytes, 32, 524288),
      caption: text(photo.caption, 180), part: text(photo.part, 200), processing: text(photo.processing, 200), author: text(photo.author, 500),
      sourceUrl, license, licenseUrl: licenses[license], modification: text(photo.modification, 500) });
  });
  if (new Set(photos.map(photo => photo.sha256)).size !== photos.length) throw new Error('Duplicate photo');
  return Object.freeze({ ...binding, schemaVersion: 'public-photo-gallery.1', version: integer(value.version, 1, Number.MAX_SAFE_INTEGER),
    publishedAt, validUntil, photos: Object.freeze(photos) });
}
/** No arbitrary CDN URL, local path, token or private filename is accepted. */
export function publicPhotoUrl(origin: string, gallery: PublicPhotoGallery, photo: PublicPhoto): string {
  const trusted = publicContentOrigin(origin);
  if (!trusted || !gallery.photos.includes(photo) || !/^sha256:[a-f0-9]{64}$/.test(photo.sha256) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(gallery.ingredientId) || !Number.isSafeInteger(gallery.version) || gallery.version < 1) throw new Error('Invalid public photo resource');
  return `${trusted}${PHOTO_PATH}${gallery.ingredientId}/${gallery.version}/${photo.sha256.slice(7)}.jpg`;
}
export function parsePublicPhotoBatch(input: unknown, expected: readonly EducationBinding[], now: number): readonly PublicPhotoGallery[] {
  if (!expected.length || expected.length > PHOTO_BATCH_SIZE) throw new Error('Invalid photo batch size');
  const bindings = expected.map(parseEducationBinding), release = bindings[0]!.baseReleaseId;
  if (new Set(bindings.map(item => item.ingredientId)).size !== bindings.length || bindings.some(item => item.baseReleaseId !== release)) throw new Error('Invalid batch identity');
  const value = object(input, 'schemaVersion baseReleaseId requestedIds galleries');
  if (value.schemaVersion !== 'public-photo-batch.1' || value.baseReleaseId !== release || !Array.isArray(value.requestedIds) ||
    JSON.stringify(value.requestedIds) !== JSON.stringify(bindings.map(item => item.ingredientId)) || !Array.isArray(value.galleries) || value.galleries.length > bindings.length) throw new Error('Invalid batch response');
  const galleries = value.galleries.map((input: unknown) => {
    if (!input || typeof input !== 'object' || !('ingredientId' in input)) throw new Error('Invalid gallery');
    const binding = bindings.find(item => item.ingredientId === input.ingredientId);
    if (!binding) throw new Error('Unrequested gallery');
    return parsePublicPhotoGallery(input, binding, now);
  });
  if (new Set(galleries.map(item => item.ingredientId)).size !== galleries.length) throw new Error('Duplicate batch gallery');
  return Object.freeze(galleries);
}
