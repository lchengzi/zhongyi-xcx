import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import { PhotoDerivativeRegistry } from '../server/photo-derivative-registry.js';
import { photoPath } from '../server/photo-files.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function prepareReviewPacket(originals: PrivatePhotoRegistry, display: PhotoDerivativeRegistry) {
  if (display.originals !== originals || !originals.list().items.length) throw new Error('Review packet requires one bound nonempty private library');
  const local = photoPath(resolve('.local'), true), parent = resolve(local, 'photo-review-packets');
  display.assertIsolation(parent);
  if (existsSync(parent)) photoPath(parent, true); else mkdirSync(parent);
  const directory = resolve(parent, `run-${randomUUID()}`); mkdirSync(directory); photoPath(directory, true);
  const copied = new Set<string>();
  const items = originals.list().items.map(candidate => {
    const derivative = display.metadata(candidate.id), bytes = display.asset(candidate.id);
    if (!derivative || !bytes) throw new Error('Missing reviewed display artifact');
    if (!copied.has(derivative.assetFilename)) { writeFileSync(resolve(directory, derivative.assetFilename), bytes, { flag: 'wx' }); copied.add(derivative.assetFilename); }
    return derivative;
  });
  const preparedAt = new Date().toISOString(), count = new Set(items.map(item => item.candidate.ingredientId)).size;
  const cards = items.map((item, index) => {
    const photo = item.candidate;
    return `<article><header><p class="eyebrow">候选 ${index + 1} / ${items.length} · 待审</p><h2>${escapeHtml(photo.name)}</h2><p class="identifier">${escapeHtml(photo.id)} · ${escapeHtml(photo.ingredientId)}</p></header>
      <img src="${item.assetFilename}" alt="${escapeHtml(photo.name)}，待核对展示图">
      <div class="body"><p><strong>来源观察（待核对）：</strong>${escapeHtml(photo.observation)}</p><h3>待核对事项</h3><ul>${photo.concerns.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>
      <h3>来源与使用声明</h3><p>作者：${escapeHtml(photo.author)}</p><p><a href="${escapeHtml(photo.sourcePage)}?oldid=${photo.sourceRevision}" target="_blank" rel="noopener noreferrer">来源文件页 · 固定修订 ${photo.sourceRevision}</a> · <a href="${escapeHtml(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${photo.declaredLicense} 声明</a></p>
      <p>${escapeHtml(item.transformationNotice)}</p><p>${item.width} × ${item.height} · ${Math.ceil(item.bytes / 1024)} KB</p>
      <details><summary>原件与展示图绑定</summary><p class="identifier">原件：${photo.sha256}</p><p class="identifier">展示图：${item.sha256}</p><p class="identifier">处理记录：${item.digest}</p></details>
      <table><caption>意见记录（尚未填写，不构成批准）</caption><tbody><tr><th>中医师</th><td>姓名/资格核对：________<br>身份：________ 部位：________ 加工：________<br>依据与意见：________________<br>签名/日期：________________</td></tr><tr><th>药师</th><td>姓名/资格核对：________<br>身份：________ 部位：________ 加工：________<br>依据与意见：________________<br>签名/日期：________________</td></tr><tr><th>权利与画面</th><td>署名/许可/修改说明：________________<br>可见隐私/方向/细节：________________<br>核对人/日期：________________</td></tr></tbody></table></div></article>`;
  }).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>首批食材照片 · 待审资料</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f3f1e9;color:#293f33;font:15px/1.7 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1100px;margin:auto;padding:28px}h1{font-size:30px;line-height:1.3}h2{font-size:22px;margin:4px 0}h3{font-size:17px}a{color:#3e684d;overflow-wrap:anywhere}p,li,td{overflow-wrap:anywhere}.intro,article{background:white;border-radius:18px;margin-bottom:24px;overflow:hidden}.intro,.body,article header{padding:24px}.note{background:#f0e7d0;padding:14px;border-radius:10px}.eyebrow{color:#667a63;font-size:12px;letter-spacing:1px}.identifier{font-size:12px;font-family:monospace;word-break:break-all}article img{display:block;width:100%;height:360px;object-fit:contain;background:#eeeae1}table{width:100%;border-collapse:collapse;margin-top:20px}caption{text-align:left;font-weight:600;margin-bottom:8px}th,td{text-align:left;border:1px solid #d7ddcf;padding:12px;vertical-align:top}th{width:110px}li{margin:6px 0}details{margin:16px 0}@media(max-width:600px){main{padding:14px}.intro,.body,article header{padding:16px}h1{font-size:24px}article img{height:260px}th{width:70px}th,td{padding:8px;font-size:13px}}@media print{body{background:white}main{padding:0}article{break-before:page;border:1px solid #ddd}article img{height:280px}.intro{break-after:page}a{color:inherit}}
    </style></head><body><main><section class="intro"><p class="eyebrow">食养图录 · 私有待审材料</p><h1>首批食材照片</h1><p>${items.length} 张候选 · ${count} 种食材 · 整理时间 ${preparedAt.slice(0, 10)}</p><p class="note">审核人员待联系。材料保留待审状态，没有生成专业意见、权利批准或发布记录。仅供内部核对，不应作为已获准的公开食材图集。</p>
    <h2>核对职责</h2><ul><li>中医师与药师分别核对身份、实际部位和加工形态，记录可定位的依据；不能确认时标明缺口。</li><li>权利核对人员确认固定来源修订、作者、声明许可、署名和修改说明，并检查适用范围。</li><li>发布管理员核对展示图方向、颜色、细节与可见隐私，待已有审核要求满足后再明确发布。</li></ul>
    <h2>后续怎么使用</h2><p>可逐张查看或打印意见栏。原件未装入此资料包，原件摘要已保留；需要原件复核时按候选 ID 联系项目负责人。本材料不读取工作库的审核结论，实际人员、资格核验、依据及意见需再登记到管理工作台。</p><p>展示图与原件独立保存；本包的图片未再次重编码。生成材料不会改变任何候选或数据库状态。</p></section>${cards}</main></body></html>`;
  writeFileSync(resolve(directory, 'index.html'), html, { flag: 'wx' });
  writeFileSync(resolve(directory, 'review-basis.json'), JSON.stringify({ schemaVersion: 'private-photo-review-packet.1', preparedAt, reviewerAvailability: 'not-yet-arranged',
    workflowRecordsRead: false, publicationEligible: false, originalFilesIncluded: false, items }, null, 2), { flag: 'wx' });
  return { directory, candidates: items.length, ingredients: count, displayBytes: items.reduce((sum, item) => sum + item.bytes, 0), publicationEligible: false };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/review-packet.ts') || process.argv[1]?.replaceAll('\\', '/').endsWith('/review-packet.js')) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--asset-root' || args[2] !== '--manifest' || args[4] !== '--derivatives' || ![args[1], args[3], args[5]].every(isAbsolute)) throw new Error('Explicit absolute --asset-root --manifest --derivatives required');
  const originals = new PrivatePhotoRegistry(args[1], args[3]);
  console.log(JSON.stringify(prepareReviewPacket(originals, new PhotoDerivativeRegistry(args[5], originals))));
}
