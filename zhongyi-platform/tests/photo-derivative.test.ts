import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { chromium, type Browser } from '@playwright/test';
import { canvasPhotoTranscoder } from '../photo-processing/canvas.js';
import { readPreparationArgs } from '../photo-processing/prepare.js';
import { inspectDerivativeJpeg, stripEncodedJpegMetadata } from '../server/photo-derivative-jpeg.js';
import { preparePhotoDerivative, validatePhotoDerivative } from '../server/photo-derivative-preparation.js';
import { notePhoto } from './photo-note-fixture.js';

let browser: Browser, original: Buffer;
before(async () => {
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  const page = await browser.newPage();
  try {
    original = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 48;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 48, 48);
      ctx.fillStyle = '#0000ff'; ctx.fillRect(48, 0, 48, 48);
      return canvas.toDataURL('image/jpeg', .9).split(',')[1];
    }), 'base64');
  } finally { await page.close(); }
});
after(async () => { await browser?.close(); });
const candidate = (bytes: Buffer) => ({ ...notePhoto(), bytes: bytes.length, width: 96, height: 48,
  sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
const signal = () => new AbortController().signal;
const comment = Buffer.from([0xff, 0xfe, 0, 8, ...Buffer.from('secret')]);
// Little-endian TIFF, one Orientation=6 entry (90 degrees clockwise).
const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');

test('real Canvas rotates EXIF pixels, removes metadata and leaves original untouched', async () => {
  const input = Buffer.concat([original.subarray(0, 2), exif, comment, original.subarray(2)]), snapshot = Buffer.from(input);
  const prepared = await preparePhotoDerivative(candidate(input), input, canvasPhotoTranscoder(browser), browser.version(), signal());
  assert.deepEqual(input, snapshot);
  assert.equal(prepared.metadata.width, 48); assert.equal(prepared.metadata.height, 96);
  assert.equal(prepared.metadata.publicationEligible, false);
  assert.equal(prepared.bytes.includes(Buffer.from('secret')), false);
  assert.equal(prepared.bytes.includes(Buffer.from('Exif')), false);
  assert.equal(prepared.bytes.includes(Buffer.from('ICC_PROFILE')), false);
  assert.deepEqual(validatePhotoDerivative(prepared.metadata, prepared.bytes, candidate(input)), prepared.metadata);
  const page = await browser.newPage();
  try {
    const pixels = await page.evaluate(async encoded => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))], { type: 'image/jpeg' }));
      try {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable'); ctx.drawImage(image, 0, 0);
        return { top: [...ctx.getImageData(24, 16, 1, 1).data], bottom: [...ctx.getImageData(24, 80, 1, 1).data] };
      } finally { image.close(); }
    }, prepared.bytes.toString('base64'));
    assert(pixels.top[0] > 220 && pixels.top[2] < 25);
    assert(pixels.bottom[2] > 220 && pixels.bottom[0] < 25);
  } finally { await page.close(); }
});

test('strict output gate rejects metadata, trailers, thumbnails and truncation', () => {
  const clean = Buffer.from(stripEncodedJpegMetadata(original));
  assert.equal(inspectDerivativeJpeg(clean).width, 96);
  for (const segment of [comment, exif, Buffer.from([255, 226, 0, 4, 1, 2])]) {
    const changed = Buffer.concat([clean.subarray(0, 20), segment, clean.subarray(20)]);
    assert.throws(() => inspectDerivativeJpeg(changed));
    assert.deepEqual(Buffer.from(stripEncodedJpegMetadata(changed)), clean);
  }
  const thumbnail = Buffer.from(clean); thumbnail[18] = 1;
  for (const bad of [thumbnail, clean.subarray(0, -1), Buffer.concat([clean, Buffer.from('secret')])]) {
    assert.throws(() => inspectDerivativeJpeg(bad)); assert.throws(() => stripEncodedJpegMetadata(bad));
  }
});

test('derivative bytes, metadata, source binding and publication flags cannot be forged', async () => {
  const result = await preparePhotoDerivative(candidate(original), original, canvasPhotoTranscoder(browser), browser.version(), signal());
  const changed = Buffer.from(result.bytes); changed[changed.length - 4] ^= 1;
  assert.throws(() => validatePhotoDerivative(result.metadata, changed));
  for (const metadata of [{ ...result.metadata, publicationEligible: true }, { ...result.metadata, derivativeReview: 'approved' },
    { ...result.metadata, encoderVersion: 'forged' }, { ...result.metadata, width: 95 }]) assert.throws(() => validatePhotoDerivative(metadata, result.bytes));
  assert.throws(() => validatePhotoDerivative(result.metadata, result.bytes, { ...candidate(original), sourceRevision: '2' }));
});

test('cancelled requests, bad originals and unknown processor results fail closed', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(preparePhotoDerivative(candidate(original), original, canvasPhotoTranscoder(browser), 'test', controller.signal), { name: 'AbortError' });
  await assert.rejects(preparePhotoDerivative({ ...candidate(original), sha256: `sha256:${'0'.repeat(64)}` }, original, async () => { assert.fail('must not transcode'); }, 'test', signal()));
  for (const response of [null, { base64: 'bad', decodedWidth: 96, decodedHeight: 48 }, { base64: original.toString('base64'), decodedWidth: 96, decodedHeight: 48, approved: true }]) {
    await assert.rejects(preparePhotoDerivative(candidate(original), original, async () => response, 'test', signal()));
  }
});

test('CLI requires explicit private preparation and absolute source paths', () => {
  assert.throws(() => readPreparationArgs([]));
  assert.throws(() => readPreparationArgs(['--prepare-private', '--asset-root', '.', '--manifest', 'input.json', '--browser', 'edge']));
});
