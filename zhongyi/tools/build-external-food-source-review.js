"use strict";

const fs = require("fs");
const path = require("path");
const { MANIFEST_RELATIVE, REVIEW_RELATIVE, ROOT, loadManifest } = require("./external-food-source-candidate-core");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function buildReviewHtml(manifestInput) {
  const manifest = manifestInput || loadManifest();
  const candidateCards = manifest.candidates.map((candidate) => `
    <article class="card">
      <p class="status">待专业复核 · 不可发布</p>
      <h2>${escapeHtml(candidate.source.title)}</h2>
      <p><strong>候选 ID：</strong><code>${escapeHtml(candidate.id)}</code></p>
      <p><strong>目标记录：</strong>${candidate.targetFoodIds.map(escapeHtml).join("、")}</p>
      <p><strong>候选范围：</strong>${candidate.candidateDomains.map(escapeHtml).join("、")}</p>
      <p><strong>发布机构：</strong>${escapeHtml(candidate.source.publisher)}</p>
      <p><strong>标准/目录：</strong>${candidate.source.standardIds.map(escapeHtml).join("、")}</p>
      <p class="url"><strong>官方链接（纯文本）：</strong>${escapeHtml(candidate.source.url)}</p>
      <ul>${candidate.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      <details><summary>摘要绑定</summary><p>source ${escapeHtml(candidate.sourceMetadataDigest)}</p><p>semantic ${escapeHtml(candidate.candidateSemanticDigest)}</p></details>
    </article>`).join("");
  const evidenceCards = manifest.evidenceItems.map((item) => `
    <article class="card evidence" data-evidence-id="${escapeHtml(item.id)}">
      <p class="status">逐域证据候选 · 待专业复核 · 不可发布</p>
      <h2>${escapeHtml(item.source.title)}</h2>
      <p><strong>目标：</strong>${item.targetFoodIds.map((id) => `<code>${escapeHtml(id)}</code>`).join("、")}</p>
      <p><strong>证据域：</strong>${escapeHtml(item.domain)}；支持级别 ${escapeHtml(item.supportLevel)}（不表示该域已完成）</p>
      <p><strong>定位：</strong>${item.claimLocator.map(escapeHtml).join("；")}</p>
      <h3>精确支持</h3><ul>${item.preciseClaims.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>
      <h3>不能支持</h3><ul>${item.limitations.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>
      <p class="url"><strong>官方链接（纯文本）：</strong>${escapeHtml(item.source.url)}</p>
      <details><summary>摘要绑定</summary><p>source ${escapeHtml(item.sourceMetadataDigest)}</p><p>semantic ${escapeHtml(item.evidenceSemanticDigest)}</p></details>
    </article>`).join("");
  const coverageCards = manifest.targetCoverage.map((coverage) => `
    <article class="card coverage" data-food-id="${escapeHtml(coverage.foodId)}">
      <p class="status">四域覆盖视图 · 全部仍未就绪</p><h2>${escapeHtml(coverage.foodId)}</h2>
      <ul>${Object.entries(coverage.domains).map(([domain, slot]) => `<li><strong>${escapeHtml(domain)}</strong>：${slot.candidateIds.length ? slot.candidateIds.map(escapeHtml).join("、") : "无候选"}；残余缺口 ${slot.residualGapCodes.map(escapeHtml).join("、")}；ready=false</li>`).join("")}</ul>
    </article>`).join("");
  const gapCards = manifest.gaps.map((gap) => `
    <article class="card gap">
      <p class="status">明确缺口 · 不可用候选替代</p>
      <h2>${escapeHtml(gap.foodId)}</h2>
      <p><strong>缺口码：</strong><code>${escapeHtml(gap.gapCode)}</code></p>
      <p>${escapeHtml(gap.reason)}</p>
      <p><strong>下一步：</strong>${escapeHtml(gap.nextSearch)}</p>
      <details><summary>摘要绑定</summary><p>${escapeHtml(gap.gapSemanticDigest)}</p></details>
    </article>`).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<title>普通食品官方来源私有候选审阅</title><style>
body{margin:0;background:#f5f1e8;color:#28271f;font:15px/1.65 system-ui,sans-serif}.wrap{max-width:1120px;margin:auto;padding:28px}.notice{padding:18px;border:2px solid #7c2e2e;background:#fff8ee}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:18px}.card{background:#fff;border:1px solid #d9d0c2;border-radius:14px;padding:18px;overflow-wrap:anywhere}.gap{border-color:#a65d35}.evidence{border-color:#356b5a}.coverage{border-color:#546b93}.status{color:#8b2d2d;font-weight:700}.url{font-size:13px}code{font-size:12px}h1,h2{line-height:1.25}
</style></head><body><main class="wrap"><h1>普通食品官方来源私有候选审阅</h1>
<div class="notice">这是研究线索，不是已审来源。类别标准不能自动证明具体食材身份、食用部位、配方形态或个体安全；全部候选 publicationEligible=false、runtimePlacements=[]，不得复制到运行时数据。</div>
<p>版本 ${escapeHtml(manifest.contentVersion)}；规则 ${escapeHtml(manifest.rulesVersion)}；${manifest.candidateCount} 条类别线索、${manifest.evidenceCount} 条逐域证据候选，覆盖全部 ${manifest.targetCount} 条普通食品记录；${manifest.domainSlotCount} 个证据域中就绪数仍为 ${manifest.readyDomainSlotCount}。</p>
<h2>逐域证据候选</h2><section class="grid">${evidenceCards}</section>
<h2>${manifest.targetCount} 项四域覆盖与残余缺口</h2><section class="grid">${coverageCards}</section>
<h2>旧类别/产品范围线索</h2><section class="grid">${candidateCards}</section>
<h2>目标级明确缺口</h2><section class="grid">${gapCards}</section></main></body></html>`;
}

function main() {
  const output = path.resolve(ROOT, ...REVIEW_RELATIVE.split("/"));
  const html = buildReviewHtml();
  fs.writeFileSync(output, html, "utf8");
  console.log(JSON.stringify({ output: REVIEW_RELATIVE, bytes: Buffer.byteLength(html) }));
  return html;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[build-external-food-source-review] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildReviewHtml, main };
