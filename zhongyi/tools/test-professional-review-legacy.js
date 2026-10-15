"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const CORE_SOURCE = path.join(ROOT, "tools", "professional-review-core.js");
const SNAPSHOT_ROOT = path.join(ROOT, "tools", "version-snapshots");
const RELEASES = [
  "release-2026.08.10-full-catalog.3",
  "release-2026.08.11-pattern-recipe-drafts.4",
  "release-2026.08.11-pattern-recipe-drafts.5",
  "release-2026.08.11-external-food-registry.6"
];

function safeCleanup(root) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  const relative = path.relative(tempRoot, resolved);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert(path.basename(resolved).startsWith("zhongyi-review-legacy-"));
  fs.rmSync(resolved, { recursive: true });
}

function writeSnapshotArtifacts(root, snapshot) {
  for (const artifact of snapshot.artifacts) {
    const output = path.join(root, ...artifact.path.split("/"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(artifact.contentBase64, "base64"));
  }
  const coreOutput = path.join(root, "tools", "professional-review-core.js");
  fs.mkdirSync(path.dirname(coreOutput), { recursive: true });
  fs.copyFileSync(CORE_SOURCE, coreOutput);
}

function loadCore(root, release) {
  const file = path.join(root, "tools", "professional-review-core.js");
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === file && request === "../data/version-active.json") {
      return { releaseId: release.releaseId, activatedAt: release.createdAt };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(file); }
  finally { Module._load = originalLoad; }
}

const results = [];
for (const releaseId of RELEASES) {
  const snapshotFile = path.join(SNAPSHOT_ROOT, `${releaseId}.json`);
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-review-legacy-"));
  try {
    writeSnapshotArtifacts(tempRoot, snapshot);
    const core = loadCore(tempRoot, snapshot);
    const packet = core.buildPacket({ releaseId: snapshot.releaseId, activatedAt: snapshot.createdAt });
    assert.strictEqual(packet.generatedFromReleaseId, releaseId);
    assert(packet.materialTasks.length > 0 && packet.recipeTasks.length > 0);
    assert.strictEqual(packet.reviewableRecipeTaskCount, 0);
    packet.materialTasks.forEach((task) => assert.strictEqual(core.rawDigest(task.reviewContent), task.subjectDigest));
    const legacy = packet.materialTasks.filter((task) => task.registry === "legacy_unregistered");
    legacy.forEach((task) => {
      assert(task.blockers.includes("legacy_material_registry_missing"));
      assert.strictEqual(task.publicationEligible, false);
    });
    if ([".3", ".4", ".5"].some((suffix) => releaseId.endsWith(suffix))) assert(legacy.length > 0);
    if (releaseId.endsWith(".6")) assert.strictEqual(legacy.length, 0);
    results.push({ releaseId, materials: packet.materialTaskCount, legacy: legacy.length, recipes: packet.recipeTaskCount });
  } finally {
    safeCleanup(tempRoot);
  }
}

console.log(JSON.stringify({ legacyReleases: results, assertions: "passed" }));
