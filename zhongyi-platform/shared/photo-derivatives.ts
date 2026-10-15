// Private preparation metadata. No approval flags can be supplied or upgraded.
import { parsePrivatePhoto, type PrivatePhoto } from './private-photos.js';
import { date, digest, invalid, literal, number, object, text } from './workflow-response.js';

export const PHOTO_DERIVATIVE_SCHEMA = 'private-photo-derivative.1';
function bounded(value: unknown, minimum: number, maximum: number): number {
  const parsed = number(value, minimum); return parsed <= maximum ? parsed : invalid();
}
export interface PhotoDerivative {
  schemaVersion: typeof PHOTO_DERIVATIVE_SCHEMA; candidate: PrivatePhoto; bindingDigest: string;
  assetFilename: string; sha256: string; bytes: number; width: number; height: number;
  pipeline: 'canvas-jpeg.v1'; encoderVersion: string; decodedWidth: number; decodedHeight: number;
  maxEdge: 1280; quality: 0.84; orientation: 'from-image'; crop: 'none'; generativeEdit: false;
  metadataPolicy: 'jfif-only-no-thumbnail'; transformationNotice: string;
  licenseReview: 'pending'; visualPrivacyReview: 'pending'; derivativeReview: 'pending';
  publicationEligible: false; preparedAt: string; digest: string;
}
export function parsePhotoDerivative(value: unknown): PhotoDerivative {
  const r = object(value, 'schemaVersion candidate bindingDigest assetFilename sha256 bytes width height pipeline encoderVersion decodedWidth decodedHeight maxEdge quality orientation crop generativeEdit metadataPolicy transformationNotice licenseReview visualPrivacyReview derivativeReview publicationEligible preparedAt digest');
  const candidate = parsePrivatePhoto(r.candidate), sha256 = digest(r.sha256), width = bounded(r.width, 16, 1280), height = bounded(r.height, 16, 1280);
  const decodedWidth = bounded(r.decodedWidth, 1, 12000), decodedHeight = bounded(r.decodedHeight, 1, 12000);
  if (r.maxEdge !== 1280 || r.quality !== 0.84 || r.schemaVersion !== PHOTO_DERIVATIVE_SCHEMA || r.assetFilename !== `${sha256.slice(7)}.jpg` ||
    !((decodedWidth === candidate.width && decodedHeight === candidate.height) || (decodedWidth === candidate.height && decodedHeight === candidate.width))) invalid();
  const ratio = Math.min(1, 1280 / Math.max(decodedWidth, decodedHeight));
  if (width !== Math.round(decodedWidth * ratio) || height !== Math.round(decodedHeight * ratio)) invalid();
  return { schemaVersion: PHOTO_DERIVATIVE_SCHEMA, candidate, bindingDigest: digest(r.bindingDigest), assetFilename: `${sha256.slice(7)}.jpg`, sha256,
    bytes: bounded(r.bytes, 32, 512 * 1024), width, height, pipeline: literal(r.pipeline, 'canvas-jpeg.v1'), encoderVersion: text(r.encoderVersion, 100),
    decodedWidth, decodedHeight, maxEdge: 1280, quality: 0.84, orientation: literal(r.orientation, 'from-image'),
    crop: literal(r.crop, 'none'), generativeEdit: literal(r.generativeEdit, false), metadataPolicy: literal(r.metadataPolicy, 'jfif-only-no-thumbnail'),
    transformationNotice: text(r.transformationNotice, 240), licenseReview: literal(r.licenseReview, 'pending'), visualPrivacyReview: literal(r.visualPrivacyReview, 'pending'),
    derivativeReview: literal(r.derivativeReview, 'pending'), publicationEligible: literal(r.publicationEligible, false), preparedAt: date(r.preparedAt), digest: digest(r.digest) };
}
