"use strict";

const fs = require("fs");
const path = require("path");
const { loadAndValidate, sha256Buffer } = require("./specimen-candidate-core");
const { buildManifest } = require("./build-specimen-candidate-manifest");
const { buildReviewHtml } = require("./build-specimen-review");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_SCAN_EXCLUDES = new Set([
  "content-private", "docs", "tools", "node_modules", ".git", "cloud-assets"
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir, relative = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relative, entry.name);
    if (PUBLIC_SCAN_EXCLUDES.has(next.split(path.sep)[0])) return [];
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute, next) : [absolute];
  });
}

function main() {
  const { manifest, result } = loadAndValidate(ROOT);
  assert(JSON.stringify(manifest) === JSON.stringify(buildManifest()),
    "Private specimen manifest is stale; run npm run build:media-drafts");
  const reviewPagePath = path.join(ROOT, "content-private", "media-candidates", "specimens", "review-index.html");
  assert(fs.existsSync(reviewPagePath), "Private specimen review gallery is missing; run npm run build:media-drafts");
  const reviewPage = fs.readFileSync(reviewPagePath, "utf8");
  assert(reviewPage === buildReviewHtml(),
    "Private specimen review gallery is stale; run npm run build:media-drafts");
  assert((reviewPage.match(/<article\b/g) || []).length === manifest.count &&
    (reviewPage.match(/<img\b/g) || []).length === manifest.count &&
    !/<script\b|<link\b/i.test(reviewPage) &&
    !/(?:src|href)=["']https?:\/\//i.test(reviewPage),
  "Private specimen review gallery must remain local, static and one-card-per-candidate");

  const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
  const ignores = new Set(((projectConfig.packOptions && projectConfig.packOptions.ignore) || [])
    .map((item) => item && item.value));
  assert(ignores.has("content-private"), "project.config.json must exclude content-private from upload");

  const publicAllFiles = walk(ROOT);
  const privateAssetDigests = new Set(manifest.records.flatMap((record) =>
    [record.assets.original.sha256, record.assets.review.sha256]));
  for (const file of publicAllFiles) {
    assert(!privateAssetDigests.has(sha256Buffer(fs.readFileSync(file))),
      "Private specimen image bytes were copied into runtime file " + path.relative(ROOT, file));
  }
  const publicFiles = publicAllFiles.filter((file) => /\.(?:js|json|wxml|wxss)$/.test(file));
  const forbiddenTokens = [
    "content-private/media-candidates/specimens/",
    ...manifest.records.map((record) => record.id),
    ...manifest.records.map((record) => record.source.mediaIdentifier)
  ];
  for (const file of publicFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const token of forbiddenTokens) {
      assert(!source.includes(token),
        "Private specimen candidate leaked into runtime file " + path.relative(ROOT, file));
    }
  }

  console.log(JSON.stringify({
    specimenCandidates: result.count,
    originalBytes: result.originalBytes,
    reviewBytes: result.reviewBytes,
    publicRuntimeReferences: 0,
    publicBinaryCopies: 0,
    clientUploadAllowed: false,
    publicationEligible: 0
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[check-specimen-candidates] " + error.message);
    process.exit(1);
  }
}

module.exports = { main };
