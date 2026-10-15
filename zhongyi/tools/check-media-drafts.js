"use strict";

const fs = require("fs");
const path = require("path");
const { loadAndValidate, sha256Buffer } = require("./media-draft-core");
const { buildManifest } = require("./build-media-draft-manifest");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_SCAN_EXCLUDES = new Set(["content-private", "docs", "tools", "node_modules", ".git", "cloud-assets"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir, relative = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relative, entry.name);
    const topLevel = next.split(path.sep)[0];
    if (PUBLIC_SCAN_EXCLUDES.has(topLevel)) return [];
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute, next) : [absolute];
  });
}

function main() {
  const { manifest, result } = loadAndValidate(ROOT);
  assert(JSON.stringify(manifest) === JSON.stringify(buildManifest()),
    "Private media manifest is stale; run npm run build:media-drafts");
  const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
  const ignores = new Set(((projectConfig.packOptions && projectConfig.packOptions.ignore) || [])
    .map((item) => item && item.value));
  assert(ignores.has("content-private"), "project.config.json must exclude content-private from upload");

  const publicAllFiles = walk(ROOT);
  const privateAssetDigests = new Set(manifest.records.flatMap((record) =>
    Object.values(record.assets).map((asset) => asset.sha256)));
  for (const file of publicAllFiles) {
    assert(!privateAssetDigests.has(sha256Buffer(fs.readFileSync(file))),
      "Private media draft bytes were copied into runtime file " + path.relative(ROOT, file));
  }
  const publicFiles = publicAllFiles.filter((file) => /\.(?:js|json|wxml|wxss)$/.test(file));
  const forbiddenTokens = [
    "content-private/media-drafts/",
    ...manifest.records.map((record) => record.id)
  ];
  for (const file of publicFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const token of forbiddenTokens) {
      assert(!source.includes(token), "Private media draft leaked into runtime file " + path.relative(ROOT, file));
    }
  }

  console.log(JSON.stringify({
    mediaDrafts: result.count,
    privateDraftBytes: result.bytes,
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
    console.error("[check-media-drafts] " + error.message);
    process.exit(1);
  }
}

module.exports = { main };
