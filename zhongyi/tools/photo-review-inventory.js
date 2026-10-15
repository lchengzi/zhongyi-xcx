"use strict";

// Supplemental private inventory: never edits a candidate, capture or review packet.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const captures = require("./photo-capture-core");
const { MANIFEST_RELATIVE, loadAndValidate } = require("./food-form-candidate-core");
const ROOT = path.resolve(__dirname, "..");
const PREFIX = "content-private/research-refresh/";
const INVENTORY_PATH = PREFIX + "2026-10-09-photo-review-inventory.json";
const HTML_PATH = PREFIX + "photo-review-inventory-20261009.html";
const CATALOG_PATH = "content-private/media-candidates/food-forms/food-form-catalog.json";
const SOURCES = [
  [CATALOG_PATH, "ccd0f652e2b9f6b3544ac58467b2f0a45d610de428832157de43a14d3580202c"],
  [MANIFEST_RELATIVE, "4424e645b07b3e19741feb5a36519a9145a30db0e8c9c5b6190eaaa44129ff15"],
  ["data/ingredients.js", "5b21a1e30d592cfa00017ad9021d591219cb0d74fb86c1f3ab5fad6c7115c092"],
  [captures.PHOTO_CAPTURE_RECORD_PATH, "fb0878f8bd41e4e64d7890330969ec412b80a61bfca428a5e8b169ddea24ea86"],
  [captures.PHOTO_CAPTURE_BATCH2_PATH, "e3bde6145d7405c8d03ab9f5cb9cbe45e9210323985e6d125bef97286d0c8eb4"],
  [captures.PHOTO_CAPTURE_BATCH3_PATH, "700be28697e20ef55f2b0d3f5e8d3497f7e9c4823ac9af44e914d140555d99f8"],
  [captures.PHOTO_CAPTURE_BATCH4_PATH, "b81a59b48a8658abdc62181a43f72f9582ba8bb58119fc6d9c6748659350c333"]
];
function sha(bytes) { return "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex"); }
function regularPath(relative, root = ROOT, missingLeaf = false) {
  assert(typeof relative === "string" && !relative.includes("\\") && !path.isAbsolute(relative));
  const parts = relative.split("/");
  assert(parts.length > 1 && parts.every(p => p && p !== "." && p !== ".." && !p.includes(":")));
  let current = path.resolve(root);
  // Inspect the root and its ancestors too, rather than following a junction into user data.
  for (let ancestor = current; ; ancestor = path.dirname(ancestor)) {
    assert(fs.lstatSync(ancestor).isDirectory() && !fs.lstatSync(ancestor).isSymbolicLink(), "linked root rejected");
    if (path.dirname(ancestor) === ancestor) break;
  }
  parts.forEach((part, i) => {
    current = path.join(current, part);
    if (i === parts.length - 1 && missingLeaf && !fs.existsSync(current)) {
      // existsSync is false for a dangling link; lstat must not silently accept one.
      try { fs.lstatSync(current); assert.fail("dangling output link rejected"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      return;
    }
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink(), "linked input/output rejected");
    assert(i === parts.length - 1 ? stat.isFile() : stat.isDirectory(), "unexpected input/output type");
  });
  return current;
}
function deriveInventory() {
  const bytes = new Map(SOURCES.map(([p, hash]) => {
    const b = fs.readFileSync(regularPath(p)); assert.equal(sha(b), "sha256:" + hash, "dated input changed: " + p);
    return [p, b];
  }));
  const catalog = JSON.parse(bytes.get(CATALOG_PATH));
  regularPath(MANIFEST_RELATIVE);
  const { manifest } = loadAndValidate(ROOT);
  const validators = [captures.validatePhotoCaptures, captures.validatePhotoCapturesBatch2,
    captures.validatePhotoCapturesBatch3, captures.validatePhotoCapturesBatch4];
  const batches = SOURCES.slice(3).map(([p], i) => {
    const record = JSON.parse(bytes.get(p)); validators[i](record); return { path: p, record };
  });
  const byCandidate = new Map();
  for (const batch of batches) for (const photo of batch.record.photoCaptures) {
    assert(!byCandidate.has(photo.candidateId), "duplicate capture candidate");
    byCandidate.set(photo.candidateId, { ...photo, recordPath: batch.path, checkedAt: batch.record.checkedAt });
  }
  const records = catalog.records.map(candidate => {
    const bound = manifest.records.find(r => r.id === candidate.id);
    assert(bound && bound.ingredientId === candidate.ingredientId);
    const original = byCandidate.get(candidate.id);
    const reviewOnly = !original && bound.retrieval.localAssetAvailable;
    const asset = original ? original.capture : reviewOnly ? bound.assets.review : null;
    if (asset) regularPath(asset.path);
    const concerns = [original?.partAlignmentConcern, original?.sourceCaptionConcern]
      .filter(v => v && v !== "unverified");
    return {
      candidateId: candidate.id, ingredientId: candidate.ingredientId,
      name: bound.depiction.canonicalName, catalogLatinName: bound.depiction.catalogLatinName,
      catalogPart: bound.depiction.catalogPart, historicalProcessingLabel: candidate.processingState,
      historicalRetrieval: candidate.retrieval, source: candidate.source,
      localState: original ? "full_original" : reviewOnly ? "historical_review_copy_only" : "no_local_image",
      localAsset: asset, captureEvidence: original || null,
      observation: original ? original.visualObservation.description : reviewOnly ? bound.depiction.visualObservation : null,
      concerns, limitations: original ? original.limitations : bound.depiction.riskNotes,
      identityReviewState: "pending", partProcessingReviewState: "pending", rightsReviewState: "pending",
      professionalReviewState: "pending", publicationEligible: false, runtimePlacements: []
    };
  });
  assert.equal(byCandidate.size, records.filter(r => r.localState === "full_original").length);
  return {
    schemaVersion: "photo-review-inventory.1", compiledAt: "2026-10-09", catalogSourceAsOf: "2026-08-10",
    scope: "private_supplemental_read_only", publicationEligible: false, runtimePlacements: [],
    professionalPacketModified: false, doesNotCloseGaps: true,
    bindings: SOURCES.map(([p, hash]) => ({ path: p, sha256: "sha256:" + hash })),
    summary: {
      targetIngredients: catalog.targetIngredientIds.length, candidateRecords: records.length,
      candidateIngredients: new Set(records.map(r => r.ingredientId)).size,
      fullOriginals: records.filter(r => r.localState === "full_original").length,
      fullOriginalIngredients: new Set(records.filter(r => r.localState === "full_original").map(r => r.ingredientId)).size,
      fullOriginalBytes: records.filter(r => r.localState === "full_original").reduce((n, r) => n + r.localAsset.bytes, 0),
      historicalReviewCopiesOnly: records.filter(r => r.localState === "historical_review_copy_only").length,
      noLocalImage: records.filter(r => r.localState === "no_local_image").length,
      priorityCandidates: records.filter(r => r.concerns.length).length,
      unresolvedGaps: catalog.gaps.length, publishablePhotos: 0
    },
    records, gaps: catalog.gaps,
    retrievalIssues: batches.flatMap(b => b.record.retrievalIssues.map(issue => ({ recordPath: b.path,
      ...(typeof issue === "string" ? { url: null, outcome: "historical_text_note", effect: issue } : issue) })))
  };
}
function validateInventory(inventory, expected = deriveInventory()) {
  assert.deepEqual(inventory, expected, "inventory differs from bound evidence; create a new dated inventory instead");
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function localImageUrl(assetPath) {
  assert(typeof assetPath === "string" && /^content-private\/(?:research-refresh\/photo-originals(?:-batch[234])?\/[a-z-]+-original\.jpg|media-candidates\/food-forms\/review\/[a-z-]+\.webp)$/.test(assetPath), "unrecognized local review asset");
  return path.posix.relative(path.posix.dirname(HTML_PATH), assetPath).split("/").map(encodeURIComponent).join("/");
}
function sourceLink(url, label) {
  const parsed = new URL(url); assert.equal(parsed.protocol, "https:"); assert(!parsed.username && !parsed.password);
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}
const STATES = { full_original: "完整原图已取得 · 仍待审核", historical_review_copy_only: "仅历史审阅副本 · 完整原图未取得", no_local_image: "没有本地图像 · 不作画面结论" };
const CONCERNS = { requires_part_recheck: "部位需重点复核", requires_processing_recheck: "加工状态需重点复核", requires_caption_recheck: "来源图文范围需重点复核" };
function renderInventory(inventory) {
  const s = inventory.summary;
  const cards = inventory.records.map(r => `<article id="${esc(r.candidateId)}" class="${r.concerns.length ? "priority" : ""}">
<h3>${esc(r.name)} <small>${esc(r.candidateId)}</small></h3><p class="state">${esc(STATES[r.localState])}</p>
${r.concerns.map(c => `<p class="warning">${esc(CONCERNS[c])}</p>`).join("")}
<p>目录部位：${esc(r.catalogPart)}。历史加工标签：${esc(r.historicalProcessingLabel)}（不是本次确认）。</p>
<details><summary>查看本地画面与核对资料</summary>
${r.localAsset ? `<img src="${esc(localImageUrl(r.localAsset.path))}" width="${esc(r.localAsset.width)}" height="${esc(r.localAsset.height)}" alt="${esc(r.name)}的私有待审${r.localState === "full_original" ? "原图" : "历史副本"}"><p>${esc(r.localAsset.width)}×${esc(r.localAsset.height)} · ${esc(r.localAsset.bytes)}字节 · ${esc(r.localAsset.sha256)}</p>` : "<p>未取得本地图片，不使用远程热链或其他材料替代。</p>"}
<p>目录拉丁名：${esc(r.catalogLatinName)}。单图不代表全部基原。</p>
<p>画面记录：${esc(r.observation || "没有本地图像观察")}</p>
${r.captureEvidence ? `<p>捕获记录：${esc(r.captureEvidence.recordPath)}；${esc(r.captureEvidence.checkedAt)}。观察者：AI辅助非专业观察，不是鉴别结论。${esc(r.captureEvidence.visualObservation.basis)}。</p><p>${esc(r.captureEvidence.sourceObservation?.licenseNote || "来源复核见原捕获记录绑定的历史观察编号；不新填摄影或上传日期。")}</p>` : "<p>历史副本/元数据仅来自2026-08-10记录，本汇总没有重新抓取或复核源站。</p>"}
<p>来源声明：${sourceLink(r.source.sourcePage, r.source.fileTitle)}；作者 ${esc(r.source.author)}；${sourceLink(r.source.licenseUrl, r.source.licenseName)}（历史声明，非权利审核通过）。</p>
<ul>${r.limitations.map(v => `<li>${esc(v)}</li>`).join("")}</ul>
<p>身份、部位加工、权利、专业审核：全部待审。禁止鉴别、可食性判断和医疗用途；未生成公开派生图。</p>
</details></article>`).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<title>食材实物照片 · 私有核对总览</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#253b34;font:16px/1.7 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:24px}h1{font-size:28px}h2{font-size:22px}h3{font-size:19px}p,li,a,small{overflow-wrap:anywhere}article,.panel{background:#fff;border:1px solid #d4ded7;border-radius:12px;padding:20px;margin:18px 0}.priority{border-left:5px solid #a86427}small{display:block;font-size:12px;font-weight:400;color:#53645c}.state{font-weight:650}.warning{color:#8a451c}a{color:#225d4b}summary{cursor:pointer;padding:10px 0}img{display:block;max-width:100%;width:auto;height:auto;max-height:420px;margin:18px auto}details>p{font-size:14px}.counts{font-size:18px}li{margin:8px 0}footer{padding:24px 0;color:#53645c}@media(max-width:600px){main{padding:14px}article,.panel{padding:14px}h1{font-size:24px}}
</style></head><body><main><h1>食材实物照片 · 私有核对总览</h1>
<p>汇总日期：${esc(inventory.compiledAt)}；正式目录来源截至 ${esc(inventory.catalogSourceAsOf)}，不是最新性声明。本页只汇集已有证据，不是专业审校提交包，不写入审核结果。</p>
<section class="panel"><h2>当前材料，分开计数</h2><p class="counts">${s.fullOriginals}张完整原图 / ${s.fullOriginalIngredients}种食材 · ${s.historicalReviewCopiesOnly}张仅历史审阅副本 · ${s.noLocalImage}条候选无本地图像</p>
<p>${s.candidateRecords}条候选涉及${s.candidateIngredients}种食材；目标${s.targetIngredients}种；另有${s.unresolvedGaps}个明确缺口。完整原图合计${s.fullOriginalBytes}字节。可公开照片：${s.publishablePhotos}。</p>
<p>麦冬历史副本不计入13张完整原图；铁皮石斛有两种候选形态，不能解释为同批加工前后。保留源字节/元数据不等于隐私或权利审查完成。</p></section>
<nav class="panel" aria-label="优先核对"><h2>优先核对的四处疑点</h2><ul>${inventory.records.filter(r => r.concerns.length).map(r => `<li><a href="#${esc(r.candidateId)}">${esc(r.name)}：${esc(r.concerns.map(c => CONCERNS[c]).join("、"))}</a></li>`).join("")}</ul></nav>
<section class="panel" id="gaps"><h2>三个缺口仍未关闭</h2>${inventory.gaps.map(g => `<h3>${esc(({ "gou-qi-zi": "枸杞子", "di-huang": "地黄", "tian-dong": "天冬" })[g.ingredientId])}</h3><p>${esc(g.reason)}</p>`).join("")}<p>以上为历史目录缺口，不把后续论文线索、下载失败、整株标本或AI插画算成食用部位照片。</p></section>
<h2>全部候选 · 点击展开资料</h2>${cards}
<details class="panel"><summary>查看抓取问题留痕（失败不计作成功）</summary><ul>${inventory.retrievalIssues.map(issue => `<li>${esc(issue.outcome)}：${esc(issue.url)}<br>${esc(issue.effect)}<br>记录：${esc(issue.recordPath)}</li>`).join("")}</ul></details>
<footer>只读私有补充入口。无脚本、表单、自动联网或审核按钮；外部来源仅在主动点击时打开。旧目录、捕获记录、正式制品及专业审校包均不改写。</footer></main></body></html>\n`;
}
function artifacts(inventory) {
  return [[INVENTORY_PATH, Buffer.from(JSON.stringify(inventory, null, 2) + "\n")], [HTML_PATH, Buffer.from(renderInventory(inventory))]];
}
function writeArtifacts(inventory, root = ROOT) {
  const outputs = artifacts(inventory).map(([p, b]) => [regularPath(p, root, true), b]);
  // Validate both destinations before creating either, so a mismatched pair is never overwritten.
  for (const [p, b] of outputs) if (fs.existsSync(p)) assert(fs.readFileSync(p).equals(b), "immutable inventory output differs; use a new dated version");
  for (const [p, b] of outputs) if (!fs.existsSync(p)) fs.writeFileSync(p, b, { flag: "wx", mode: 0o600 });
}
function checkRuntimeIsolation(root, outputs, relative = "") {
  const excluded = new Set(["content-private", ".local", "docs", "tools", "node_modules", ".git", "cloud-assets"]);
  const sizes = new Set(outputs.map(([, b]) => b.length));
  const hashes = new Set(outputs.map(([, b]) => sha(b)));
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (!relative && excluded.has(entry.name)) continue;
    const next = path.join(relative, entry.name), p = path.join(root, next), stat = fs.lstatSync(p);
    assert(!stat.isSymbolicLink(), "runtime symlink rejected");
    if (entry.isDirectory()) checkRuntimeIsolation(root, outputs, next);
    else {
      if (sizes.has(stat.size)) assert(!hashes.has(sha(fs.readFileSync(p))), "private inventory copied into public runtime");
      if (/\.(?:js|json|html|wxml|wxss)$/i.test(entry.name)) {
        const text = fs.readFileSync(p, "utf8");
        for (const token of ["photo-review-inventory.1", INVENTORY_PATH, HTML_PATH]) assert(!text.includes(token), "private inventory reference entered runtime");
      }
    }
  }
}
function check() {
  const inventory = deriveInventory(), expected = artifacts(inventory);
  for (const [p, bytes] of expected) assert(fs.readFileSync(regularPath(p)).equals(bytes), "private inventory drift: " + p);
  checkRuntimeIsolation(ROOT, expected);
  return inventory.summary;
}
if (require.main === module) {
  try {
    assert.deepEqual(process.argv.slice(2), [], "no path or overwrite overrides allowed");
    const inventory = deriveInventory(); writeArtifacts(inventory); console.log(JSON.stringify(check()));
  } catch (error) { console.error("[photo-review-inventory] " + error.message); process.exitCode = 1; }
}
module.exports = { ROOT, INVENTORY_PATH, HTML_PATH, deriveInventory, validateInventory, renderInventory,
  localImageUrl, sourceLink, artifacts, writeArtifacts, checkRuntimeIsolation, check };
