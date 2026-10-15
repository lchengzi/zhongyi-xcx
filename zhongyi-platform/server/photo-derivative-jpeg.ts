// Narrow output gate for our baseline Canvas JPEG pipeline, not a JPEG decoder.
// APP1/Exif/XMP, APP2/ICC, APP13/IPTC, other APPn, COM, thumbnails and trailers
// are rejected. Browser pixel decoding remains an independent required check.
export const DERIVATIVE_MAX_EDGE = 1280;
export const DERIVATIVE_MAX_BYTES = 512 * 1024;
export const DERIVATIVE_JPEG_QUALITY = 0.84;
export interface DerivativeJpegInfo { width: number; height: number; bytes: number; metadataPolicy: 'jfif-only-no-thumbnail' }
const invalid = (): never => { throw new Error('Unsupported or unsafe derivative JPEG'); };
const word = (bytes: Uint8Array, offset: number) => bytes[offset] * 256 + bytes[offset + 1];

// Apply only to freshly re-encoded pixels, never to an original candidate.
// Chromium may attach its own ICC profile even when the canvas is sRGB.
export function stripEncodedJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 32 || bytes.length > DERIVATIVE_MAX_BYTES + 65536 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2, scanned = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) invalid();
    const marker = bytes[offset + 1], length = word(bytes, offset + 2), end = offset + 2 + length;
    if (length < 2 || end > bytes.length) invalid();
    if (marker === 0xda) { chunks.push(bytes.subarray(offset)); scanned = true; break; }
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) chunks.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!scanned) invalid();
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0; for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
  inspectDerivativeJpeg(result);
  return result;
}

export function inspectDerivativeJpeg(bytes: Uint8Array): DerivativeJpegInfo {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || bytes.length > DERIVATIVE_MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let offset = 2, width = 0, height = 0, jfif = false, frame = false, tables = 0, huffman = 0;
  const components = new Set<number>();
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) invalid();
    const marker = bytes[offset + 1], length = word(bytes, offset + 2), end = offset + 2 + length;
    if (length < 2 || end > bytes.length) invalid();
    const payload = bytes.subarray(offset + 4, end);
    if (marker === 0xe0) {
      // Fixed JFIF header, no extra bytes or embedded thumbnail.
      if (jfif || offset !== 2 || payload.length !== 14 || payload.slice(0, 5).some((value, index) => value !== [0x4a, 0x46, 0x49, 0x46, 0][index]) ||
        payload[5] !== 1 || payload[6] > 2 || payload[7] > 2 || !word(payload, 8) || !word(payload, 10) || payload[12] !== 0 || payload[13] !== 0) invalid();
      jfif = true;
    } else if (marker === 0xdb) {
      if (frame || !payload.length || payload.length % 65 !== 0) invalid();
      for (let position = 0; position < payload.length; position += 65) {
        if (payload[position] > 3 || payload.subarray(position + 1, position + 65).some(value => !value)) invalid();
      }
      tables++;
    } else if (marker === 0xc4) {
      let position = 0;
      while (position < payload.length) {
        const selector = payload[position++];
        if (position + 16 > payload.length || (selector >> 4) > 1 || (selector & 15) > 1) invalid();
        const values = payload.subarray(position, position + 16).reduce((sum, count) => sum + count, 0);
        position += 16;
        if (!values || values > 256 || position + values > payload.length) invalid();
        position += values;
      }
      if (!position) invalid(); huffman++;
    } else if (marker === 0xc0) {
      if (frame || !tables || payload.length !== 15 || payload[0] !== 8 || payload[5] !== 3) invalid();
      height = word(payload, 1); width = word(payload, 3);
      if (Math.min(width, height) < 16 || Math.max(width, height) > DERIVATIVE_MAX_EDGE) invalid();
      for (let position = 6; position < payload.length; position += 3) {
        const component = payload[position], sample = payload[position + 1];
        if (components.has(component) || component < 1 || component > 3 || (sample >> 4) < 1 || (sample >> 4) > 4 || (sample & 15) < 1 || (sample & 15) > 4 || payload[position + 2] > 3) invalid();
        components.add(component);
      }
      frame = true;
    } else if (marker === 0xda) {
      if (!jfif || !frame || !huffman || payload.length !== 10 || payload[0] !== 3 || payload[7] !== 0 || payload[8] !== 63 || payload[9] !== 0) invalid();
      const scanned = new Set<number>();
      for (let position = 1; position <= 5; position += 2) {
        if (!components.has(payload[position]) || scanned.has(payload[position]) || (payload[position + 1] >> 4) > 1 || (payload[position + 1] & 15) > 1) invalid();
        scanned.add(payload[position]);
      }
      let position = end, data = 0;
      while (position < bytes.length) {
        if (bytes[position++] !== 0xff) { data++; continue; }
        const code = bytes[position++];
        if (code === 0) { data++; continue; }
        // Single baseline scan, no restart interval, no inter-scan metadata.
        if (code === 0xd9 && position === bytes.length && data > 0) return { width, height, bytes: bytes.length, metadataPolicy: 'jfif-only-no-thumbnail' };
        invalid();
      }
      invalid();
    } else invalid();
    offset = end;
  }
  return invalid();
}
