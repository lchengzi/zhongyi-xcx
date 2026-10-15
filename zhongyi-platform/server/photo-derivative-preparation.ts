import { createHash } from 'node:crypto';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { PHOTO_DERIVATIVE_SCHEMA, parsePhotoDerivative, type PhotoDerivative } from '../shared/photo-derivatives.js';
import { photoBindingDigest } from './photo-note-values.js';
import { jpegDimensions } from './private-photos.js';
import { DERIVATIVE_MAX_EDGE, DERIVATIVE_JPEG_QUALITY, inspectDerivativeJpeg } from './photo-derivative-jpeg.js';

export type PhotoTranscoder = (input: { bytes: Uint8Array; maxEdge: number; quality: number; signal: AbortSignal }) => Promise<unknown>;
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = (value: unknown) => sha256(Buffer.from(JSON.stringify(value)));
const aborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Photo preparation cancelled', 'AbortError'); };

export function validatePhotoDerivative(value: unknown, bytes: Uint8Array, expected?: PrivatePhoto): PhotoDerivative {
  const item = parsePhotoDerivative(value), info = inspectDerivativeJpeg(bytes), { digest: expectedDigest, ...payload } = item;
  if (item.sha256 !== sha256(bytes) || item.bindingDigest !== photoBindingDigest(item.candidate) || item.bytes !== info.bytes || item.width !== info.width || item.height !== info.height ||
    digest(payload) !== expectedDigest || (expected && JSON.stringify(parsePrivatePhoto(expected)) !== JSON.stringify(item.candidate))) throw new Error('Photo derivative binding or digest mismatch');
  return item;
}
export async function preparePhotoDerivative(value: PrivatePhoto, original: Uint8Array, transcode: PhotoTranscoder, encoderVersion: string,
  signal: AbortSignal, now: () => Date = () => new Date()): Promise<{ metadata: PhotoDerivative; bytes: Buffer }> {
  // Own all input before the first await; caller mutations cannot change intent.
  const candidate = parsePrivatePhoto(value);
  if (!(original instanceof Uint8Array) || original.byteLength !== candidate.bytes) throw new Error('Original photo size mismatch');
  const bytes = Buffer.from(original), bindingDigest = photoBindingDigest(candidate);
  aborted(signal);
  const dimensions = jpegDimensions(bytes);
  if (bytes.length !== candidate.bytes || sha256(bytes) !== candidate.sha256 || dimensions.width !== candidate.width || dimensions.height !== candidate.height) throw new Error('Original photo binding mismatch');
  const result = await transcode({ bytes: Buffer.from(bytes), maxEdge: DERIVATIVE_MAX_EDGE, quality: DERIVATIVE_JPEG_QUALITY, signal });
  aborted(signal);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).sort().join(',') !== 'base64,decodedHeight,decodedWidth' ||
    !('base64' in result) || typeof result.base64 !== 'string' || result.base64.length > 700000 || result.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64) ||
    !('decodedWidth' in result) || !('decodedHeight' in result)) throw new Error('Invalid image processor response');
  const output = Buffer.from(result.base64, 'base64');
  if (output.toString('base64') !== result.base64) throw new Error('Noncanonical processor bytes');
  const info = inspectDerivativeJpeg(output), hash = sha256(output);
  const payload = { schemaVersion: PHOTO_DERIVATIVE_SCHEMA, candidate, bindingDigest, assetFilename: `${hash.slice(7)}.jpg`, sha256: hash,
    bytes: output.length, width: info.width, height: info.height, pipeline: 'canvas-jpeg.v1', encoderVersion,
    decodedWidth: result.decodedWidth, decodedHeight: result.decodedHeight, maxEdge: DERIVATIVE_MAX_EDGE, quality: DERIVATIVE_JPEG_QUALITY,
    orientation: 'from-image', crop: 'none', generativeEdit: false, metadataPolicy: info.metadataPolicy,
    transformationNotice: '依据原图方向等比例缩放并重新编码为JPEG；未裁切、未使用生成式修改。附加元数据不保留，画面可见信息另行审核。',
    licenseReview: 'pending', visualPrivacyReview: 'pending', derivativeReview: 'pending', publicationEligible: false, preparedAt: now().toISOString() };
  const metadata = validatePhotoDerivative({ ...payload, digest: digest(payload) }, output, candidate);
  aborted(signal); return { metadata, bytes: output };
}
