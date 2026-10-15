import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import { preparePhotoDerivative, validatePhotoDerivative } from '../server/photo-derivative-preparation.js';
import type { PhotoDerivative } from '../shared/photo-derivatives.js';
import { canvasPhotoTranscoder } from './canvas.js';

export function readPreparationArgs(args: readonly string[]) {
  if (args.length !== 7 || args[0] !== '--prepare-private' || args[1] !== '--asset-root' || args[3] !== '--manifest' || args[5] !== '--browser' ||
    !isAbsolute(args[2]) || !isAbsolute(args[4]) || !['edge', 'chromium'].includes(args[6])) throw new Error('Expected --prepare-private --asset-root ABSOLUTE_PATH --manifest ABSOLUTE_PATH --browser edge|chromium');
  return { assetRoot: resolve(args[2]), manifest: resolve(args[4]), browser: args[6] === 'edge' ? 'edge' as const : 'chromium' as const };
}
function regularDirectory(path: string) {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const stat = lstatSync(cursor);
    const actual = realpathSync(cursor), expected = resolve(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) throw new Error('Preparation directory must not contain links');
    if (cursor === dirname(cursor)) break;
  }
}
function inside(root: string, target: string) { const rel = relative(root, target); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));

export async function preparePrivatePhotoLibrary(options: ReturnType<typeof readPreparationArgs>, workspace = process.cwd()) {
  const root = resolve(workspace); regularDirectory(root);
  if (!existsSync(join(root, 'server/private-photos.ts')) || !existsSync(join(root, 'package.json'))) throw new Error('Run from the content-platform project');
  const privateRoot = resolve(root, '../zhongyi/content-private');
  if (!inside(privateRoot, options.assetRoot)) throw new Error('Use an existing project-private original directory');
  const registry = new PrivatePhotoRegistry(options.assetRoot, options.manifest);
  registry.assertStaticIsolation(join(root, 'dist')); registry.assertStaticIsolation(resolve(root, '../apps/miniprogram'));
  const originalManifestDigest = hash(readFileSync(options.manifest)), candidates = registry.list().items;
  if (!candidates.length) throw new Error('No private candidates configured');
  const parent = join(root, '.local', 'photo-derivatives');
  for (const path of [join(root, '.local'), parent]) { if (!existsSync(path)) mkdirSync(path); regularDirectory(path); }
  const directory = join(parent, `run-${randomUUID()}`); mkdirSync(directory); regularDirectory(directory);
  const controller = new AbortController(), cancel = () => controller.abort(); process.once('SIGINT', cancel);
  let browser: Browser | undefined;
  const items: PhotoDerivative[] = [], written = new Set<string>(), preparedAt = new Date().toISOString();
  try {
    browser = await chromium.launch({ ...(options.browser === 'edge' ? { channel: 'msedge' } : {}), headless: true });
    const transcode = canvasPhotoTranscoder(browser), encoderVersion = `${options.browser}/${browser.version()}`;
    for (const photo of candidates) {
      const original = registry.asset(photo.id); if (!original) throw new Error('Original unavailable');
      const { metadata, bytes } = await preparePhotoDerivative(photo, original, transcode, encoderVersion, controller.signal);
      if (!written.has(metadata.assetFilename)) {
        regularDirectory(directory); writeFileSync(join(directory, metadata.assetFilename), bytes, { flag: 'wx' }); written.add(metadata.assetFilename);
      }
      validatePhotoDerivative(metadata, readFileSync(join(directory, metadata.assetFilename)), photo); items.push(metadata);
    }
    // Reopen the originals: cached bytes alone cannot prove their on-disk state.
    const reread = new PrivatePhotoRegistry(options.assetRoot, options.manifest);
    if (hash(readFileSync(options.manifest)) !== originalManifestDigest || JSON.stringify(reread.list()) !== JSON.stringify(registry.list())) throw new Error('Original library changed during preparation');
    const bundle = { schemaVersion: 'private-photo-derivative-bundle.1', preparedAt, encoderVersion, originalManifestDigest, publicationEligible: false, items };
    regularDirectory(directory); writeFileSync(join(directory, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx' });
    const cards = items.map(item => `<article><img src="${item.assetFilename}" alt="${escapeHtml(item.candidate.name)}"><h2>${escapeHtml(item.candidate.name)}</h2><p>${item.width} × ${item.height} · ${Math.round(item.bytes / 1024)} KB</p><p>${escapeHtml(item.candidate.author)} · ${item.candidate.declaredLicense}</p><a href="${escapeHtml(item.candidate.sourcePage)}?oldid=${item.candidate.sourceRevision}">来源文件页</a></article>`).join('');
    writeFileSync(join(directory, 'review.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>食材照片 · 展示图候选</title><style>body{margin:0;padding:28px;background:#f5f3eb;color:#283f32;font-family:system-ui,"Microsoft YaHei",sans-serif}header{max-width:1100px;margin:0 auto 24px}h1{font-size:28px;margin:0 0 12px}header p{line-height:1.7}main{max-width:1100px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}article{background:white;border-radius:14px;overflow:hidden;padding-bottom:18px}img{width:100%;height:220px;object-fit:contain;background:#eeeae1}h2,p,a{margin:12px 18px;overflow-wrap:anywhere}h2{font-size:18px}p,a{font-size:13px;line-height:1.6}a{color:#3d6546}</style><header><h1>食材照片 · 展示图候选</h1><p>${items.length} 张照片已完成等比例缩放与重新编码。来源许可、画面隐私及食材匹配继续审核。</p></header><main>${cards}</main></html>`, { flag: 'wx' });
    const originalBytes = candidates.reduce((sum, item) => sum + item.bytes, 0), derivativeBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const report = { schemaVersion: 'photo-derivative-preparation.1', status: 'prepared-private', candidates: items.length, ingredients: new Set(candidates.map(item => item.ingredientId)).size,
      originalBytes, derivativeBytes, originalBytesModified: false, publicPhotosAdded: 0, browser: encoderVersion, finishedAt: new Date().toISOString() };
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return { directory, ...report };
  } catch (error) {
    writeFileSync(join(directory, 'failed.json'), JSON.stringify({ status: 'incomplete-private', publicationEligible: false, preparedCount: items.length }) + '\n', { flag: 'wx' });
    throw error;
  } finally { process.removeListener('SIGINT', cancel); await browser?.close(); }
}
