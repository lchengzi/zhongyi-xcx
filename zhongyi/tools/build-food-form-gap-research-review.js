"use strict";

const fs = require("fs");
const path = require("path");
const { REVIEW_RELATIVE, ROOT, loadAndValidate } = require("./food-form-gap-research-core");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function buildReviewHtml(manifestInput) {
  const manifest = manifestInput || loadAndValidate();
  const cards = manifest.records.map((record) => `
    <article class="card">
      <p class="status">研究线索 · 不关闭缺口 · 不可发布</p>
      <h2>${escapeHtml(record.ingredientId)} / ${escapeHtml(record.source.figureLabel)}</h2>
      <p><strong>状态：</strong>${escapeHtml(record.leadState)}</p>
      <p><strong>论文：</strong>${escapeHtml(record.source.articleTitle)}</p>
      <p><strong>图注：</strong>${escapeHtml(record.source.figureCaption)}</p>
      <p><strong>材料上下文：</strong>${escapeHtml(record.evidence.materialContext)}</p>
      <p><strong>加工上下文：</strong>${escapeHtml(record.evidence.processingContext)}</p>
      <p><strong>来源页（仅文本，不会联网加载）：</strong><code>${escapeHtml(record.source.articleUrl)}</code></p>
      <p><strong>媒体 URL 状态：</strong>${record.source.figureUrl ? `<code>${escapeHtml(record.source.figureUrl)}</code>` : "尚未固定稳定媒体 URL"}</p>
      <h3>为什么仍不能使用</h3><ul>${record.evidence.unresolved.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <h3>下一步</h3><ul>${record.nextActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <details><summary>绑定摘要</summary><p>record ${escapeHtml(record.recordDigest)}</p><p>source ${escapeHtml(record.sourceMetadataDigest)}</p><p>ingredient ${escapeHtml(record.ingredientBinding.ingredientDigest)}</p><p>gap ${escapeHtml(record.gapBinding.gapDigest)}</p></details>
    </article>`).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>食材照片缺口升级研究线索</title><style>
body{margin:0;background:#f5f1e8;color:#28271f;font:15px/1.65 system-ui,sans-serif}.wrap{max-width:1080px;margin:auto;padding:28px}.notice{padding:18px;border:2px solid #7c2e2e;background:#fff8ee}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:18px}.card{background:#fff;border:1px solid #d9d0c2;border-radius:14px;padding:18px;overflow-wrap:anywhere}.status{color:#8b2d2d;font-weight:700}code{font-size:12px}h1,h2,h3{line-height:1.25}
</style></head><body><main class="wrap"><h1>食材照片缺口升级研究线索</h1>
<div class="notice">这些科研图只用于继续追溯来源。它们不会替代原来的明确缺口，不证明目录身份、可食部位、加工形态或安全，也不加载远程图片。</div>
<p>版本 ${escapeHtml(manifest.contentVersion)}；${manifest.recordCount} 条线索，${manifest.unresolvedCount} 条仍不关闭缺口；可发布 0，运行时位置 0。</p>
<section class="grid">${cards}</section></main></body></html>`;
}

function main() {
  const output = path.resolve(ROOT, ...REVIEW_RELATIVE.split("/"));
  const privateRoot = path.resolve(ROOT, "content-private", "media-candidates", "food-form-gap-upgrades");
  const rootStat = fs.lstatSync(privateRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("gap research private root must be a regular directory");
  if (!output.startsWith(`${privateRoot}${path.sep}`)) throw new Error("gap research review output escaped its private root");
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error("gap research review output may not be a symbolic link");
  const html = buildReviewHtml();
  fs.writeFileSync(output, html, "utf8");
  console.log(JSON.stringify({ output: REVIEW_RELATIVE, bytes: Buffer.byteLength(html) }));
  return html;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[build-food-form-gap-research-review] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildReviewHtml, main };
