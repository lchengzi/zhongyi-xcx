"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ARTIFACT_PATHS } = require("./version-core");
const {
  CATALOG_RELATIVE, MANIFEST_RELATIVE, REVIEW_RELATIVE, ROOT,
  buildManifest, canonicalJson, loadAndValidate, readJson
} = require("./food-form-gap-research-core");
const { buildReviewHtml } = require("./build-food-form-gap-research-review");

const PUBLIC_SCAN_EXCLUDES = new Set(["content-private", "docs", "tools", "node_modules", ".git", "cloud-assets"]);

function walk(root, relative = "") {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relative, entry.name);
    if (PUBLIC_SCAN_EXCLUDES.has(next.split(path.sep)[0])) return [];
    const absolute = path.join(root, entry.name);
    const stat = fs.lstatSync(absolute);
    assert(!stat.isSymbolicLink(), `gap research boundary contains a symbolic link: ${absolute}`);
    return entry.isDirectory() ? walk(absolute, next) : entry.isFile() ? [absolute] : [];
  });
}

function main() {
  const catalog = readJson(CATALOG_RELATIVE, "research catalog");
  const manifest = loadAndValidate();
  const expected = buildManifest(catalog);
  assert.strictEqual(canonicalJson(manifest), canonicalJson(expected), "food-form gap research manifest is stale or hand-edited");
  assert.strictEqual(manifest.recordCount, 3, "food-form gap research lead count drifted");
  assert.strictEqual(manifest.unresolvedCount, 3, "a research lead unexpectedly closed an existing gap");
  assert.strictEqual(manifest.publicationEligibleCount, 0, "a research lead became publication eligible");
  assert.strictEqual(manifest.runtimePlacementCount, 0, "a research lead gained a runtime placement");
  assert(manifest.records.every((record) => record.decision.doesNotCloseGap === true &&
    record.decision.publicationEligible === false && record.decision.runtimePlacements.length === 0),
  "research leads must remain unresolved and private");

  const privateRoot = path.resolve(ROOT, "content-private", "media-candidates", "food-form-gap-upgrades");
  const expectedPrivate = new Set([CATALOG_RELATIVE, MANIFEST_RELATIVE, REVIEW_RELATIVE]);
  const actualPrivate = new Set(fs.readdirSync(privateRoot, { withFileTypes: true }).map((entry) => {
    assert(entry.isFile() && !entry.isSymbolicLink(), "gap research directory may contain only registered regular files");
    return path.relative(ROOT, path.join(privateRoot, entry.name)).replace(/\\/g, "/");
  }));
  assert.deepStrictEqual([...actualPrivate].sort(), [...expectedPrivate].sort(), "unregistered gap research file exists");
  const review = fs.readFileSync(path.resolve(ROOT, ...REVIEW_RELATIVE.split("/")), "utf8");
  assert.strictEqual(review, buildReviewHtml(manifest), "food-form gap research review page is stale");
  assert((review.match(/<article class="card">/g) || []).length === manifest.recordCount, "research review card count drifted");
  assert(!/<script\b|<img\b|<link\b|\son[a-z]+\s*=/i.test(review), "research review must remain script/image free");
  assert(!/(?:src|href)=["']https?:\/\//i.test(review) && /connect-src 'none'/.test(review), "research review attempted a network request");

  const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
  const ignores = new Set(((projectConfig.packOptions && projectConfig.packOptions.ignore) || []).map((item) => item && item.value));
  assert(ignores.has("content-private"), "content-private must remain excluded from upload");
  assert(ARTIFACT_PATHS.every((item) => !item.startsWith("content-private/")), "gap research entered release artifacts");
  const forbidden = [
    "content-private/media-candidates/food-form-gap-upgrades/",
    ...manifest.records.map((record) => record.id),
    ...manifest.records.flatMap((record) => [record.source.articleUrl, record.source.figureUrl].filter(Boolean))
  ];
  let runtimeReferences = 0;
  for (const file of walk(ROOT)) {
    if (!/\.(?:js|json|wxml|wxss)$/.test(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const token of forbidden) if (source.includes(token)) runtimeReferences += 1;
  }
  assert.strictEqual(runtimeReferences, 0, "private gap research leaked into runtime/upload files");
  console.log(JSON.stringify({ researchLeads: 3, unresolvedGaps: 3, publicationEligible: 0, runtimeReferences: 0, localBinaries: 0 }));
  return manifest;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[check-food-form-gap-research] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
