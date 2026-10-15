import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { object } from '../shared/workflow-response.js';
import { parseEditorialReference, type EditorialReference } from '../shared/editorial-references.js';
import { EditorialReferenceRegistry } from '../server/editorial-references.js';
import { parseEditorialReviewPack, readEditorialReviewPack, type EditorialReviewPack } from '../server/editorial-review-pack.js';
import { editorialReviewHtml } from '../server/editorial-review-html.js';
import { photoPath } from '../server/photo-files.js';
import { DERIVATIVE_MAX_EDGE, DERIVATIVE_JPEG_QUALITY, inspectDerivativeJpeg } from '../server/photo-derivative-jpeg.js';
import { canvasPhotoTranscoder } from './canvas.js';

const sha = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const inside = (parent: string, child: string) => { const rel = relative(parent, child); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
export interface ResearchDisplay {
  reference: EditorialReference; filename: string; sha256: string; bytes: number; width: number; height: number;
  decodedWidth: number; decodedHeight: number; metadataPolicy: 'jfif-only-no-thumbnail';
}
export function researchPacketHtml(pack: EditorialReviewPack, items: ResearchDisplay[]): string {
  const base = editorialReviewHtml(parseEditorialReviewPack(pack));
  const safeItems = items.map(item => {
    const reference = parseEditorialReference(item.reference);
    if (!/^sha256:[a-f0-9]{64}$/.test(item.sha256) || item.filename !== `${reference.id}-${item.sha256.slice(7)}.jpg` ||
      !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || Math.min(item.width, item.height) < 16 || Math.max(item.width, item.height) > DERIVATIVE_MAX_EDGE) throw new Error('Invalid research display metadata');
    return { ...item, reference };
  });
  const cards = safeItems.map(item => `<article><h3>${escape(item.reference.name)}</h3><img src="${item.filename}" width="${item.width}" height="${item.height}" alt="${escape(item.reference.name)}，待审研究展示图"><p>${escape(item.reference.publisher)} · ${escape(item.reference.author)}</p>
<p><a href="${escape(item.reference.sourceUrl)}" target="_blank" rel="noopener noreferrer">图片出处</a> · ${item.reference.licenseUrl ? `<a href="${escape(item.reference.licenseUrl)}" target="_blank" rel="noopener noreferrer">${item.reference.declaredLicense}声明</a>` : '转载许可未取得'}</p>
<p>${escape(item.reference.locator)}</p><p>${escape(item.reference.observation)}</p><ul>${item.reference.concerns.map(text => `<li>${escape(text)}</li>`).join('')}</ul>
<p class="notice">本包对登记参考文件依其方向等比例缩放、sRGB JPEG重编码并移除附加元数据，无裁切或生成式修改。来源站缩略/仓储图仍不是作者原件；本地展示图处理不解决旧原件问题、版权、画面隐私或专业匹配。</p><p>${item.width} × ${item.height} · ${item.bytes}字节</p></article>`).join('');
  const excludedBaiheScene = pack.drafts.some(draft => draft.ingredientId === 'bai-he') ? '含可辨人脸的湖南现场不在本包，' : '';
  const section = `<section id="research-images"><h2>逐图研究参考与待审问题</h2><p class="notice">${items.length}张内部核对展示图。来源声明许可或转载权限仍须逐项核对，未获准公开或不特定分发；本包没有专业签审。${excludedBaiheScene}原始图片、完整标准原件、账户和数据库均未装入。</p>${cards}<p><a href="review-notes.txt">空白意见记录</a> · <a href="basis.json">版本和展示图绑定</a> · <a href="pack.json">本版稿件快照</a></p></section>`;
  if (base.split('</main>').length !== 2) throw new Error('Unexpected editorial handoff template');
  return base.replace("default-src 'none'; style-src", "default-src 'none'; img-src 'self'; style-src")
    .replace('</style>', 'img{display:block;width:100%;height:auto;max-height:420px;object-fit:contain;background:#efeee6}li{overflow-wrap:anywhere}#research-images article{padding:16px}a[href="#research-images"]{display:inline-block;margin-top:12px}</style>')
    .replace('</header>', '<p><a href="#research-images">跳到图片与逐项问题</a></p></header>').replace('</main>', `${section}</main>`);
}
export function researchPacketArgs(args: readonly string[]) {
  if (args.length !== 6 || args[0] !== '--pack' || args[2] !== '--references' || args[4] !== '--browser' || !isAbsolute(args[1]) || !isAbsolute(args[3]) || !['edge', 'chromium'].includes(args[5])) throw new Error('Explicit --pack ABSOLUTE_JSON --references ABSOLUTE_JSON --browser edge|chromium required');
  return { pack: args[1], references: args[3], browser: args[5] === 'edge' ? 'edge' as const : 'chromium' as const };
}
export async function prepareResearchPacket(options: ReturnType<typeof researchPacketArgs>, workspace = process.cwd()) {
  const root = photoPath(resolve(workspace), true), privateRoot = resolve(root, '../zhongyi/content-private');
  if (!existsSync(join(root, 'server/editorial-references.ts')) || !inside(privateRoot, resolve(options.pack)) || !inside(privateRoot, resolve(options.references))) throw new Error('Use explicit project-private research inputs');
  const packPath = photoPath(options.pack, false), referencesPath = photoPath(options.references, false);
  const pack = readEditorialReviewPack(packPath), registry = new EditorialReferenceRegistry(referencesPath), references = registry.list().items;
  if (!references.length || references.some(item => !pack.drafts.some(draft => draft.ingredientId === item.ingredientId))) throw new Error('Research images must match the selected drafts');
  const packDigest = sha(JSON.stringify(pack)), manifestDigest = sha(readFileSync(referencesPath)), packFileDigest = sha(readFileSync(packPath));
  const parent = join(root, '.local/research-review-packets');
  registry.assertIsolation(parent);
  for (const path of [join(root, '.local'), parent]) { if (!existsSync(path)) mkdirSync(path); photoPath(path, true); }
  const directory = join(parent, `run-${randomUUID()}`); mkdirSync(directory); photoPath(directory, true);
  const controller = new AbortController(), cancel = () => controller.abort(); process.once('SIGINT', cancel);
  let browser: Browser | undefined; const items: ResearchDisplay[] = [];
  try {
    browser = await chromium.launch({ ...(options.browser === 'edge' ? { channel: 'msedge' } : {}), headless: true });
    const transcode = canvasPhotoTranscoder(browser), encoderVersion = `${options.browser}/${browser.version()}`;
    for (const reference of references) {
      const input = registry.image(reference.id); if (!input || controller.signal.aborted) throw new Error('Research preparation cancelled or unavailable');
      const output = object(await transcode({ bytes: input, maxEdge: DERIVATIVE_MAX_EDGE, quality: DERIVATIVE_JPEG_QUALITY, signal: controller.signal }), 'base64 decodedWidth decodedHeight');
      if (typeof output.base64 !== 'string' || output.base64.length > 700000 || output.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(output.base64) ||
        typeof output.decodedWidth !== 'number' || typeof output.decodedHeight !== 'number' || !Number.isSafeInteger(output.decodedWidth) || !Number.isSafeInteger(output.decodedHeight) ||
        !((output.decodedWidth === reference.width && output.decodedHeight === reference.height) || (output.decodedWidth === reference.height && output.decodedHeight === reference.width))) throw new Error('Invalid research processor response');
      const bytes = Buffer.from(output.base64, 'base64'); if (bytes.toString('base64') !== output.base64) throw new Error('Invalid research image encoding');
      const info = inspectDerivativeJpeg(bytes), ratio = Math.min(1, DERIVATIVE_MAX_EDGE / Math.max(output.decodedWidth, output.decodedHeight));
      if (info.width !== Math.round(output.decodedWidth * ratio) || info.height !== Math.round(output.decodedHeight * ratio) || controller.signal.aborted) throw new Error('Research display dimensions or cancellation');
      const digest = sha(bytes), filename = `${reference.id}-${digest.slice(7)}.jpg`;
      writeFileSync(join(directory, filename), bytes, { flag: 'wx' });
      inspectDerivativeJpeg(readFileSync(join(directory, filename)));
      items.push({ reference, filename, sha256: digest, bytes: info.bytes, width: info.width, height: info.height, decodedWidth: output.decodedWidth, decodedHeight: output.decodedHeight, metadataPolicy: info.metadataPolicy });
    }
    const reread = new EditorialReferenceRegistry(referencesPath);
    if (sha(readFileSync(packPath)) !== packFileDigest || sha(readFileSync(referencesPath)) !== manifestDigest || JSON.stringify(reread.list()) !== JSON.stringify(registry.list()) || controller.signal.aborted) throw new Error('Research inputs changed');
    const basis = { schemaVersion: 'private-research-handoff.1', preparedAt: new Date().toISOString(), packDigest, manifestDigest, encoderVersion, pipeline: 'canvas-jpeg.v1',
      maxEdge: DERIVATIVE_MAX_EDGE, quality: DERIVATIVE_JPEG_QUALITY, crop: 'none', generativeEdit: false, sourceFilesIncluded: false, workflowRecordsRead: false, publicationEligible: false, professionalReview: 'pending', items };
    writeFileSync(join(directory, 'start.html'), researchPacketHtml(pack, items), { flag: 'wx' });
    writeFileSync(join(directory, 'pack.json'), JSON.stringify(pack, null, 2), { flag: 'wx' });
    writeFileSync(join(directory, 'review-notes.txt'), '百合研究材料意见记录（空白，不构成批准）\r\n核对人/角色/日期：________________\r\n资格与实际职责核对：________________\r\n条目/图片ID/版本：________________\r\n身份、部位与加工证据及定位：________________\r\n来源冲突或无法确认项：________________\r\n许可、署名、修改说明与画面隐私：________________\r\n需补材料及建议：________________\r\n请将实际核对与具名审校按既有工作台流程登记；本文件不能直接授予发布权限。\r\n', { flag: 'wx' });
    // Commit marker last. Failed directories never qualify for export.
    writeFileSync(join(directory, 'basis.json'), JSON.stringify(basis, null, 2), { flag: 'wx' });
    return { directory, packDigest, manifestDigest, references: items.length, sourceBytes: references.reduce((sum, item) => sum + item.bytes, 0), displayBytes: items.reduce((sum, item) => sum + item.bytes, 0), publicationEligible: false };
  } catch (error) { writeFileSync(join(directory, 'FAILED.json'), JSON.stringify({ status: 'incomplete-private', processed: items.length, publicationEligible: false }), { flag: 'wx' }); throw error; }
  finally { process.removeListener('SIGINT', cancel); await browser?.close(); }
}
if (/\/research-packet\.(?:ts|js)$/.test(process.argv[1]?.replaceAll('\\', '/') ?? '')) {
  try { console.log(JSON.stringify(await prepareResearchPacket(researchPacketArgs(process.argv.slice(2))))); }
  catch { console.error('Private research packet failed; incomplete output retained. No publication or working database change.'); process.exitCode = 1; }
}
