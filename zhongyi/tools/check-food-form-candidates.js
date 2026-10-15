"use strict";

const fs = require("fs");
const path = require("path");
const { ARTIFACT_PATHS } = require("./version-core");
const { loadAndValidate, sha256Buffer } = require("./food-form-candidate-core");
const { buildManifest } = require("./build-food-form-candidate-manifest");
const { buildReviewHtml } = require("./build-food-form-review");

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

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function main() {
  const { manifest, result } = loadAndValidate(ROOT);
  assert(JSON.stringify(manifest) === JSON.stringify(buildManifest()),
    "Private food-form manifest is stale; run npm run build:media-drafts");
  const reviewPath = path.join(ROOT, "content-private", "media-candidates", "food-forms", "review-index.html");
  assert(fs.existsSync(reviewPath), "Private food-form review gallery is missing; run npm run build:media-drafts");
  const reviewHtml = fs.readFileSync(reviewPath, "utf8");
  assert(reviewHtml === buildReviewHtml(),
    "Private food-form review gallery is stale; run npm run build:media-drafts");
  assert(count(reviewHtml, /<article class="candidate-card"/g) === manifest.count &&
    count(reviewHtml, /<article class="gap-card"/g) === manifest.gapCount &&
    count(reviewHtml, /<img\b/g) === result.localReviewCopies &&
    count(reviewHtml, /data-retrieval="remote_metadata_only"/g) === result.remoteMetadataOnly,
  "Private food-form gallery card, image or placeholder counts drifted");
  assert(!/<script\b|<link\b|\son[a-z]+\s*=/i.test(reviewHtml) &&
    !/(?:src|href)=["']https?:\/\//i.test(reviewHtml) &&
    /connect-src 'none'/.test(reviewHtml),
  "Private food-form gallery must remain local, static and network-disabled");

  assert(result.count === 19 && result.targetCount === 20 && result.gapCount === 3 &&
    result.localReviewCopies === 1 && result.remoteMetadataOnly === 18,
  "Food-form candidate batch counts drifted from the reviewed selection");
  assert(manifest.records.every((record) => record.publicationEligible === false && record.placements.length === 0) &&
    manifest.gaps.every((gap) => gap.publicationEligible === false && gap.placements.length === 0 && gap.fallbackAllowed === false),
  "A food-form candidate or gap escaped its fail-closed state");

  const privateRoot = path.join(ROOT, "content-private", "media-candidates", "food-forms");
  const allowedRootEntries = new Set([
    "food-form-catalog.json", "manifest.json", "review-index.html", "source", "review"
  ]);
  for (const entry of fs.readdirSync(privateRoot, { withFileTypes: true })) {
    assert(allowedRootEntries.has(entry.name),
      "Unmanaged food-form evidence or directory exists: " + entry.name);
    assert(!entry.isSymbolicLink(), "Food-form private root may not contain symbolic links");
    if (entry.name === "source" || entry.name === "review") {
      assert(entry.isDirectory(), entry.name + " must be a private asset directory");
    } else {
      assert(entry.isFile(), entry.name + " must be a regular workflow file");
    }
  }
  assert(!fs.existsSync(path.join(privateRoot, "research-inspection")) &&
    !fs.existsSync(path.join(privateRoot, "research-review")),
  "Rejected research images must not remain as unmanaged private binaries");

  const expectedLocalPaths = new Set(manifest.records.flatMap((record) => record.assets ?
    [record.assets.sourceCopy.path, record.assets.review.path] : []));
  const actualLocalPaths = [];
  for (const folder of ["source", "review"]) {
    const absoluteFolder = path.join(ROOT, "content-private", "media-candidates", "food-forms", folder);
    for (const entry of fs.readdirSync(absoluteFolder, { withFileTypes: true })) {
      assert(entry.isFile() && !entry.isSymbolicLink(), "Food-form local asset folders may contain only regular files");
      actualLocalPaths.push(path.posix.join("content-private/media-candidates/food-forms", folder, entry.name));
    }
  }
  assert(actualLocalPaths.length === expectedLocalPaths.size &&
    actualLocalPaths.every((relative) => expectedLocalPaths.has(relative)),
  "Untracked or missing files exist in food-form source/review asset folders");

  const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
  const ignores = new Set(((projectConfig.packOptions && projectConfig.packOptions.ignore) || [])
    .map((item) => item && item.value));
  assert(ignores.has("content-private"), "project.config.json must exclude content-private from upload");
  assert(ARTIFACT_PATHS.every((artifactPath) => !artifactPath.startsWith("content-private/")),
    "Private food-form candidates must not enter release artifacts");

  const publicAllFiles = walk(ROOT);
  const localDigests = new Set(manifest.records.flatMap((record) => record.assets ?
    [record.assets.sourceCopy.sha256, record.assets.review.sha256] : []));
  for (const file of publicAllFiles) {
    assert(!localDigests.has(sha256Buffer(fs.readFileSync(file))),
      "Private food-form image bytes were copied into runtime file " + path.relative(ROOT, file));
  }

  const publicFiles = publicAllFiles.filter((file) => /\.(?:js|json|wxml|wxss)$/.test(file));
  const forbiddenTokens = [
    "content-private/media-candidates/food-forms/",
    ...manifest.records.map((record) => record.id),
    ...manifest.gaps.map((gap) => gap.id),
    ...manifest.records.flatMap((record) => [record.source.sourcePage, record.source.originalUrl, record.source.fileTitle])
  ];
  for (const file of publicFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const token of forbiddenTokens) {
      assert(!source.includes(token),
        "Private food-form candidate leaked into runtime file " + path.relative(ROOT, file));
    }
  }

  console.log(JSON.stringify({
    foodFormCandidates: result.count,
    targetIngredients: result.targetCount,
    locallyReviewable: result.localReviewCopies,
    remoteMetadataOnly: result.remoteMetadataOnly,
    explicitGaps: result.gapCount,
    localPrivateBytes: result.localBytes,
    publicRuntimeReferences: 0,
    publicBinaryCopies: 0,
    publicationEligible: 0
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[check-food-form-candidates] " + error.message);
    process.exit(1);
  }
}

module.exports = { main };
