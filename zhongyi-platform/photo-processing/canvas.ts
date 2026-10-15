import type { Browser } from '@playwright/test';
import type { PhotoTranscoder } from '../server/photo-derivative-preparation.js';
import { stripEncodedJpegMetadata } from '../server/photo-derivative-jpeg.js';

export function canvasPhotoTranscoder(browser: Browser): PhotoTranscoder {
  return async ({ bytes, maxEdge, quality, signal }) => {
    if (signal.aborted) throw new DOMException('Photo preparation cancelled', 'AbortError');
    // No URLs, downloads, server or user profile. Input bytes cross the IPC only.
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
    let timedOut = false;
    const cancel = () => { void context.close().catch(() => undefined); };
    const timeout = setTimeout(() => { timedOut = true; cancel(); }, 30000);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) throw new DOMException('Photo preparation cancelled', 'AbortError');
      await context.route('**/*', route => route.abort('blockedbyclient'));
      const page = await context.newPage();
      const encoded = await page.evaluate(async ({ source, maxEdge, quality }) => {
        const binary = atob(source), input = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) input[i] = binary.charCodeAt(i);
        const bitmap = await createImageBitmap(new Blob([input], { type: 'image/jpeg' }), { imageOrientation: 'from-image' });
        const canvas = document.createElement('canvas');
        try {
          const decodedWidth = bitmap.width, decodedHeight = bitmap.height, ratio = Math.min(1, maxEdge / Math.max(decodedWidth, decodedHeight));
          canvas.width = Math.round(decodedWidth * ratio); canvas.height = Math.round(decodedHeight * ratio);
          const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' }); if (!ctx) throw new Error('Canvas unavailable');
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value && value.type === 'image/jpeg' ? resolve(value) : reject(new Error('JPEG encoder unavailable')), 'image/jpeg', quality));
          const output = new Uint8Array(await blob.arrayBuffer());
          let encoded = ''; for (let position = 0; position < output.length; position += 8192) encoded += String.fromCharCode(...output.subarray(position, position + 8192));
          return { base64: btoa(encoded), decodedWidth, decodedHeight };
        } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
      }, { source: Buffer.from(bytes).toString('base64'), maxEdge, quality });
      const output = stripEncodedJpegMetadata(Buffer.from(encoded.base64, 'base64'));
      // Decode final bytes independently after metadata removal, before accepting.
      const base64 = Buffer.from(output).toString('base64');
      await page.evaluate(async ({ base64, width, height, maxEdge }) => {
        const input = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
        const image = await createImageBitmap(new Blob([input], { type: 'image/jpeg' }));
        try {
          const ratio = Math.min(1, maxEdge / Math.max(width, height));
          if (image.width !== Math.round(width * ratio) || image.height !== Math.round(height * ratio)) throw new Error('Prepared image dimensions mismatch');
        } finally { image.close(); }
      }, { base64, width: encoded.decodedWidth, height: encoded.decodedHeight, maxEdge });
      return { ...encoded, base64 };
    } catch (error) {
      if (signal.aborted) throw new DOMException('Photo preparation cancelled', 'AbortError');
      if (timedOut) throw new Error('Photo preparation timed out'); throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); await context.close(); }
  };
}
