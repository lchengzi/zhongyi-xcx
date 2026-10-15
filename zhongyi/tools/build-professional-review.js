"use strict";

const fs = require("fs");
const path = require("path");
const { verifyWorkspace } = require("./version-core");
const {
  ROOT, loadPacket, packetBuildOptionsFromVerification, packetPaths, profileFromCli, validatePacket
} = require("./professional-review-core");
const { ensureDirectoryChain } = require("./build-professional-review-packet");

const CSP_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
const ACTIVE_HTML_PATTERN = /<(?:a|area|base|script|form|input|button|select|textarea|link|img|iframe|object|embed|audio|video|source|track|svg|math)\b|\son[a-z]+\s*=|\s(?:href|src|srcset|action|formaction|poster|data|xlink:href)\s*=|http-equiv=["']refresh/i;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function pretty(value) { return escapeHtml(JSON.stringify(value, null, 2)); }
function list(values, emptyText) {
  const items = Array.isArray(values) ? values : [];
  return items.length ? `<ul>${items.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : `<p class="muted">${escapeHtml(emptyText)}</p>`;
}
function keyValue(label, value) { return `<p><strong>${escapeHtml(label)}：</strong>${escapeHtml(value)}</p>`; }

function materialCard(task) {
  return `<article class="card material" data-task-id="${escapeHtml(task.taskId)}">
  <p class="status">${task.evidenceBlockers.length ? "证据缺口未闭合，不可提交就绪建议" : "可进入材料人工审阅；尚未获批准"}</p>
  <h2>${escapeHtml(task.name)}</h2>
  ${keyValue("任务", task.taskId)}${keyValue("登记域", task.registry)}
  ${keyValue("任务状态", task.state)}${keyValue("当前专业审校状态", task.currentProfessionalReviewState)}
  ${keyValue("材料摘要", task.subjectDigest)}${keyValue("内容版本", task.contentVersion)}
  ${keyValue("规则版本", task.rulesVersion)}${keyValue("审阅截止", task.reviewDueAt)}
  <section data-section="material-required-roles"><h3>必需角色</h3>${list(task.requiredRoles, "无")}</section>
  <section data-section="material-missing-domains"><h3>缺失证据域</h3>${list(task.missingDomains, "当前四个证据域均有已发布来源绑定；仍不代表完成真人审阅。")}</section>
  <section data-section="material-evidence-blockers"><h3>证据阻断</h3>${list(task.evidenceBlockers, "无证据阻断，可进入人工审阅。")}</section>
  <section data-section="material-direct-sources"><h3>直接来源绑定</h3><pre><code>${pretty(task.directSourceIds)}</code></pre></section>
  <section data-section="material-source-summary"><h3>来源摘要（URL 仅作文本）</h3><pre><code>${pretty(task.sources)}</code></pre></section>
  <section data-section="material-occurrence-evidence"><h3>配方出现证据（不是身份、法规、食用或安全直接证据）</h3><pre><code>${pretty(task.occurrenceEvidence)}</code></pre></section>
  <section data-section="material-uses"><h3>整方中的实际用途</h3><pre><code>${pretty(task.uses)}</code></pre></section>
  <section data-section="material-review-content"><h3>摘要输入内容</h3><pre class="projection"><code>${pretty(task.reviewContent)}</code></pre></section>
  </article>`;
}

function recipeCard(task) {
  return `<article class="card recipe" data-task-id="${escapeHtml(task.taskId)}">
  <p class="status">整方任务位于材料审阅之后；当前不可发布</p>
  <h2>${escapeHtml(task.name)}</h2>
  ${keyValue("任务", task.taskId)}${keyValue("内容版本", task.contentVersion)}
  ${keyValue("规则版本", task.rulesVersion)}${keyValue("整方摘要", task.expectedBundleDigest)}
  ${keyValue("提交绑定摘要", task.subjectDigest)}
  ${keyValue("原文摘要", task.expectedSourceTextDigest)}${keyValue("当前数据整方摘要", task.currentBundleDigest)}
  ${keyValue("当前数据原文摘要", task.currentSourceTextDigest)}${keyValue("审阅截止", task.reviewDueAt)}
  <section data-section="recipe-required-roles"><h3>必需角色</h3>${list(task.requiredRoles, "无")}</section>
  <section data-section="recipe-source-locator"><h3>官方定位</h3><pre><code>${pretty(task.sourceLocator)}</code></pre></section>
  <section data-section="recipe-prerequisites"><h3>材料前置任务</h3>${list(task.prerequisiteMaterialTaskIds, "无")}</section>
  <section data-section="recipe-prerequisite-blockers"><h3>材料前置阻断</h3>${list(task.prerequisiteBlockers, "无")}</section>
  <section data-section="recipe-technical-findings"><h3>完整技术检查结果</h3>${list(task.technicalFindings, "无")}</section>
  <section data-section="recipe-technical-blockers"><h3>进入整方审阅前必须消除的技术阻断</h3>${list(task.technicalBlockers, "无")}</section>
  <section data-section="recipe-review-content"><h3>摘要输入内容</h3><pre class="projection"><code>${pretty(task.reviewContent)}</code></pre></section>
  </article>`;
}

function buildReviewHtml(packetInput, packetBuildOptions) {
  const packet = validatePacket(packetInput || loadPacket(), packetBuildOptions);
  const scopedBoundary = packet.scopePolicy ? `<section class="notice" data-section="scoped-authority-boundary"><strong>限定范围：仅审阅所选配方中的材料使用语境。</strong>共享材料不得因此被全局改为 reviewed；本包不推断被省略配方的结论，不具备正式决定、发布或数据迁移权限。<pre><code>${pretty(packet.scopePolicy)}</code></pre></section>\n` : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">
<title>P3 私有专业审校任务索引</title><style>
body{margin:0;background:#f4f0e7;color:#26251f;font:15px/1.65 system-ui,sans-serif}.wrap{max-width:1240px;margin:auto;padding:28px}.notice{padding:18px;border:2px solid #8b2d2d;background:#fff8ed}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin:18px 0}.summary p,.card{background:#fff;border:1px solid #d6cdbd;border-radius:12px;padding:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:16px}.card{overflow-wrap:anywhere}.status{font-weight:700;color:#8b2d2d}.muted{color:#69645b}pre{max-height:440px;overflow:auto;background:#f7f6f2;border:1px solid #e4ded2;padding:12px;font-size:12px;white-space:pre-wrap}h1,h2,h3{line-height:1.3}h3{margin-bottom:5px}code{font-family:ui-monospace,monospace}
</style></head><body><main class="wrap"><h1>P3 私有专业审校任务索引</h1>
<div class="notice"><strong>只读、私有、不可发布。</strong>本页不收集、不保存审阅意见，也没有表单或脚本。仓库只能校验 JSON 的结构、版本和摘要绑定，不能验证真人身份、资质或签名；任何声明都不会自动写入 reviewed/published。</div>
${scopedBoundary}<section class="summary">
${keyValue("任务包", packet.packetId)}${keyValue("任务包摘要", packet.packetDigest)}
${keyValue("范围", packet.scope)}${keyValue("阶段", packet.stage)}
${keyValue("信任模式", packet.trustMode)}${keyValue("应用策略", packet.applicationPolicy)}
${keyValue("可发布", String(packet.publicationEligible))}
${keyValue("来源发布版本", packet.generatedFromReleaseId)}${keyValue("目录版本", packet.catalogContentVersion)}
${keyValue("整方版本", packet.recipeContentVersion)}${keyValue("普通食品版本", packet.externalFoodContentVersion)}
${keyValue("规则版本", packet.rulesVersion)}${keyValue("审阅窗口", `${packet.packetIssuedAt} — ${packet.reviewDueAt}`)}
${keyValue("材料任务", String(packet.materialTaskCount))}${keyValue("可进入材料人工审阅", String(packet.reviewableMaterialTaskCount))}
${keyValue("整方任务", String(packet.recipeTaskCount))}${keyValue("可进入整方人工审阅", String(packet.reviewableRecipeTaskCount))}
</section>
<h2>材料任务</h2><section class="grid materials">${packet.materialTasks.map(materialCard).join("")}</section>
<h2>整方任务</h2><section class="grid recipes">${packet.recipeTasks.map(recipeCard).join("")}</section>
</main></body></html>`;
}

function main(profileKey) {
  const paths = packetPaths(profileKey);
  const verified = verifyWorkspace(ROOT);
  const packetBuildOptions = { ...packetBuildOptionsFromVerification(verified), profileKey: paths.profileKey };
  const privateRoot = path.resolve(ROOT, ...paths.privatePrefix.split("/").filter(Boolean));
  ensureDirectoryChain(ROOT, privateRoot);
  const output = path.resolve(ROOT, ...paths.reviewRelative.split("/"));
  const relative = path.relative(privateRoot, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe professional review HTML path");
  if (fs.existsSync(output)) {
    const stat = fs.lstatSync(output);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("professional review HTML must be a regular non-link file");
  }
  const html = buildReviewHtml(loadPacket(paths.profileKey), packetBuildOptions);
  if (fs.existsSync(output)) {
    if (fs.readFileSync(output, "utf8") !== html) {
      throw new Error("professional review HTML is immutable; content/release drift requires a new packet ID");
    }
    console.log(JSON.stringify({ output: paths.reviewRelative, unchanged: true,
      reason: "immutable_packet_slot_already_initialized", bytes: Buffer.byteLength(html), forms: 0, scripts: 0, approvalReady: false }));
    return html;
  }
  const handle = fs.openSync(output, "wx", 0o600);
  try { fs.writeFileSync(handle, html, "utf8"); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  console.log(JSON.stringify({ output: paths.reviewRelative, bytes: Buffer.byteLength(html), forms: 0, scripts: 0, approvalReady: false }));
  return html;
}

if (require.main === module) {
  try { main(profileFromCli(process.argv.slice(2))); } catch (error) { console.error(`[build-professional-review] ${error.code || "error"}: ${error.message}`); process.exitCode = 1; }
}
module.exports = { ACTIVE_HTML_PATTERN, CSP_POLICY, buildReviewHtml, escapeHtml, main };
