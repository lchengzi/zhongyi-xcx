"use strict";

const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const {
  MANIFEST_RELATIVE,
  PRIVATE_PREFIX,
  loadAndValidate,
  sha256Buffer,
  validateManifest
} = require("./food-form-candidate-core");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_RELATIVE = "content-private/media-candidates/food-forms/review-index.html";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ingredientName(id) {
  const ingredient = catalog.ingredients.find((item) => item.id === id);
  return ingredient ? ingredient.name : id;
}

function renderImage(record) {
  if (!record.retrieval.localAssetAvailable) {
    return `<div class="placeholder" data-retrieval="remote_metadata_only">
      <strong>仅远端元数据</strong>
      <span>图片尚未复制到私有审校区；本页不会远程加载或热链。</span>
    </div>`;
  }
  const relative = record.assets.review.path.slice(PRIVATE_PREFIX.length);
  return `<figure>
      <img src="./${escapeHtml(relative)}" alt="${escapeHtml(record.depiction.canonicalName)}加工形态私有候选图，仅供审校，不用于鉴别" width="${record.assets.review.width}" height="${record.assets.review.height}">
      <figcaption>本地缓存预览的审校派生图，不是 Wikimedia 原图，也不是身份、可食性或质量证明。</figcaption>
    </figure>`;
}

function renderRecord(record, index) {
  const risks = record.depiction.riskNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<article class="candidate-card" data-candidate-id="${escapeHtml(record.id)}">
    <div class="card-head">
      <div>
        <p class="eyebrow">候选 ${index + 1} · ${escapeHtml(record.retrieval.state)}</p>
        <h2>${escapeHtml(record.depiction.canonicalName)}</h2>
        <p class="latin">${escapeHtml(record.depiction.catalogLatinName)}</p>
      </div>
      <span class="badge">未发布 / 待审</span>
    </div>
    ${renderImage(record)}
    <dl>
      <dt>目录部位</dt><dd>${escapeHtml(record.depiction.catalogPart)}</dd>
      <dt>来源原话</dt><dd>${escapeHtml(record.depiction.sourceLabelExact)}</dd>
      <dt>视觉观察</dt><dd>${escapeHtml(record.depiction.visualObservation)}</dd>
      <dt>目录部位假设</dt><dd>${escapeHtml(record.depiction.catalogPartHypothesis)}</dd>
      <dt>加工状态标签</dt><dd>${escapeHtml(record.depiction.processingState)}（待审）</dd>
      <dt>来源身份证据</dt><dd>${escapeHtml(record.depiction.sourceIdentityEvidence.label)} · ${escapeHtml(record.depiction.sourceIdentityEvidence.evidenceKind)}</dd>
      <dt>基原覆盖</dt><dd>${escapeHtml(record.depiction.originCoverage)}</dd>
      <dt>名称关系</dt><dd>${escapeHtml(record.depiction.scientificNameMatchState)}</dd>
      <dt>来源</dt><dd>${escapeHtml(record.source.fileTitle)}</dd>
      <dt>作者 / 权利人</dt><dd>${escapeHtml(record.source.author)} / ${escapeHtml(record.source.rightsHolder)}</dd>
      <dt>许可元数据</dt><dd>${escapeHtml(record.source.licenseName)} · 权利审校仍为 pending</dd>
      <dt>来源页面（纯文本）</dt><dd class="url">${escapeHtml(record.source.sourcePage)}</dd>
      <dt>远端原图（纯文本）</dt><dd class="url">${escapeHtml(record.source.originalUrl)}</dd>
      <dt>来源元数据摘要</dt><dd class="digest">${escapeHtml(record.source.sourceMetadataDigest)}</dd>
      <dt>材料摘要</dt><dd class="digest">${escapeHtml(record.bindings.ingredientDigest)}</dd>
    </dl>
    <h3>必须保留的风险</h3>
    <ul>${risks}</ul>
  </article>`;
}

function renderGap(gap) {
  const summaries = gap.searchSummary.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const sources = gap.checkedSources.map((item) =>
    `<li><span class="url">${escapeHtml(item.url)}</span><br><strong>${escapeHtml(item.reviewState)}</strong> · ${escapeHtml(item.note)}</li>`
  ).join("");
  return `<article class="gap-card" data-gap-id="${escapeHtml(gap.id)}">
    <p class="eyebrow">明确缺口 · ${escapeHtml(gap.reasonCode)}</p>
    <h2>${escapeHtml(ingredientName(gap.ingredientId))}</h2>
    <p>${escapeHtml(gap.reason)}</p>
    <h3>检索判断</h3><ul>${summaries}</ul>
    <h3>已检查来源（纯文本）</h3><ul>${sources}</ul>
    <p class="warning">fallbackAllowed=false：不得用通用商品图、模糊标本图或 AI 图替代。</p>
  </article>`;
}

function buildReviewHtml(manifestInput) {
  const manifest = manifestInput || loadAndValidate(ROOT).manifest;
  validateManifest(manifest, ROOT);
  const digest = sha256Buffer(Buffer.from(JSON.stringify(manifest), "utf8"));
  const records = manifest.records.map(renderRecord).join("\n");
  const gaps = manifest.gaps.map(renderGap).join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; connect-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>真实食材部位与加工形态候选 · 私有审校</title>
  <style>
    :root{color-scheme:light;background:#f2eee5;color:#20231d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:32px 20px 64px}.hero{background:#203c2c;color:#fff;border-radius:20px;padding:28px;margin-bottom:24px}.hero h1{margin:0 0 12px;font-size:28px}.hero p{line-height:1.65;margin:8px 0}.hero code{word-break:break-all}.summary{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.summary span,.badge{background:#e9b65f;color:#241a0c;border-radius:999px;padding:6px 10px;font-weight:700;font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}.candidate-card,.gap-card{background:#fff;border:1px solid #d8d1c3;border-radius:18px;padding:18px;box-shadow:0 8px 26px rgba(50,42,30,.06)}.card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.eyebrow{color:#8a5b16;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.candidate-card h2,.gap-card h2{margin:2px 0 4px}.latin{font-size:13px;color:#5e665d;margin:0 0 12px}.badge{white-space:nowrap;background:#f3dfb5}.placeholder,figure{margin:14px 0;background:#ece8df;border:1px dashed #aa9e89;border-radius:14px;min-height:230px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:8px;padding:20px}.placeholder strong{font-size:18px}.placeholder span,figcaption{font-size:13px;color:#5f625b;line-height:1.5}figure img{display:block;max-width:100%;height:auto;border-radius:10px}dl{display:grid;grid-template-columns:105px 1fr;gap:7px 10px;font-size:13px}dt{font-weight:800;color:#39433b}dd{margin:0;min-width:0;overflow-wrap:anywhere}.url,.digest{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-wrap:anywhere}h3{font-size:14px;margin:16px 0 8px}ul{margin:0;padding-left:20px}li{line-height:1.55;margin:4px 0}.gaps-title{margin:34px 0 12px}.gap-card{border-color:#be8e5f;background:#fffaf1}.warning{background:#fee8df;color:#7a2f1c;border-radius:10px;padding:10px;font-weight:700}@media(max-width:520px){.wrap{padding:18px 12px 44px}.grid{grid-template-columns:1fr}.card-head{display:block}.badge{display:inline-block;margin-top:8px}dl{grid-template-columns:1fr}dt{margin-top:7px}}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>真实可食部位 / 加工形态候选（私有审校）</h1>
      <p>这些记录尚未完成身份、部位、加工、权利与专业审核。图片和元数据均不可用于鉴别、采集、选购、食用、煎煮、配伍或诊疗判断，也不会进入小程序上传包。</p>
      <p>远端元数据候选不会在本页联网加载；只有已取得的私有审校副本才显示本地图像。来源许可字段只是待核元数据，不代表项目已完成转载审核。</p>
      <code>manifest ${escapeHtml(MANIFEST_RELATIVE)} · ${escapeHtml(digest)}</code>
      <div class="summary"><span>${manifest.count} 条候选</span><span>${manifest.records.filter((item) => item.retrieval.localAssetAvailable).length} 条本地审校副本</span><span>${manifest.records.filter((item) => !item.retrieval.localAssetAvailable).length} 条仅元数据</span><span>${manifest.gapCount} 个明确缺口</span></div>
    </section>
    <section class="grid" aria-label="食材照片候选">${records}</section>
    <h2 class="gaps-title">明确缺口</h2>
    <section class="grid" aria-label="未找到合格照片的食材">${gaps}</section>
  </main>
</body>
</html>\n`;
}

function main() {
  const html = buildReviewHtml();
  const output = path.join(ROOT, ...OUTPUT_RELATIVE.split("/"));
  fs.writeFileSync(output, html, "utf8");
  console.log(JSON.stringify({ output: OUTPUT_RELATIVE, bytes: Buffer.byteLength(html, "utf8") }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[build-food-form-review] " + error.message);
    process.exit(1);
  }
}

module.exports = { buildReviewHtml, main };
