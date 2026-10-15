"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { verifyWorkspace } = require("./version-core");
const {
  ROOT, buildPacket, canonicalJson, packetPaths, profileFromCli, readJson, resultsTemplate, reviewerRegistryTemplate,
  packetBuildOptionsFromVerification, validateResultsEnvelope, validateReviewerRegistry
} = require("./professional-review-core");

function ensureDirectoryChain(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe professional review directory");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe professional review directory: ${current}`);
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
}

function ensureWritableFile(file, privateRoot, label) {
  const relative = path.relative(privateRoot, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes private review root`);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-link file`);
  }
}

function writeNewJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const handle = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function fileDigest(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`review file must remain a regular non-link file: ${file}`);
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function acquireLock(privateRoot) {
  const lockFile = path.join(privateRoot, ".packet-build.lock");
  let handle;
  try { handle = fs.openSync(lockFile, "wx", 0o600); }
  catch (error) {
    if (error && error.code === "EEXIST") throw new Error("professional review packet is locked by another writer");
    throw error;
  }
  fs.writeFileSync(handle, `${process.pid}\n`, "utf8");
  fs.fsyncSync(handle);
  return {
    file: lockFile,
    release() {
      try { fs.closeSync(handle); } finally {
        if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
      }
    }
  };
}

function existingJson(relative, label) {
  const file = path.resolve(ROOT, ...relative.split("/"));
  return fs.existsSync(file) ? readJson(relative, label) : null;
}

function hasHumanEntries(registry, results) {
  return Boolean((registry && Array.isArray(registry.reviewers) && registry.reviewers.length) ||
    (results && Array.isArray(results.submissions) && results.submissions.length) ||
    (results && Array.isArray(results.results) && results.results.length));
}

function sameKeys(left, right) {
  return Boolean(left) && typeof left === "object" && !Array.isArray(left) &&
    JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort());
}

function recognizedEmptyRegistry(registry, packet) {
  if (!registry) return true;
  const expected = reviewerRegistryTemplate(packet);
  if (!sameKeys(registry, expected) || !Array.isArray(registry.reviewers) || registry.reviewers.length) return false;
  const normalized = { ...registry, packetId: expected.packetId, packetDigest: expected.packetDigest };
  return canonicalJson(normalized) === canonicalJson(expected);
}

function recognizedEmptyResults(results, packet) {
  if (!results) return true;
  const expected = resultsTemplate(packet);
  if (!sameKeys(results, expected) || !Array.isArray(results.submissions) || results.submissions.length) return false;
  const normalized = { ...results, packetId: expected.packetId, packetDigest: expected.packetDigest };
  return canonicalJson(normalized) === canonicalJson(expected);
}

function main(profileKey) {
  const paths = packetPaths(profileKey);
  const verified = verifyWorkspace(ROOT);
  const packetOptions = { ...packetBuildOptionsFromVerification(verified), profileKey: paths.profileKey };
  const packet = buildPacket(packetOptions);
  if (packet.generatedFromReleaseId !== verified.releaseId) throw new Error("review packet release binding differs from verified active release");
  const privateRoot = path.resolve(ROOT, ...paths.privatePrefix.split("/").filter(Boolean));
  ensureDirectoryChain(ROOT, privateRoot);
  const lock = acquireLock(privateRoot);
  try {
    const manifestFile = path.resolve(ROOT, ...paths.manifestRelative.split("/"));
    const registryFile = path.resolve(ROOT, ...paths.reviewerRegistryRelative.split("/"));
    const resultsFile = path.resolve(ROOT, ...paths.resultsRelative.split("/"));
    const files = [
      [manifestFile, "professional review manifest"],
      [registryFile, "professional reviewer registry"],
      [resultsFile, "professional review submissions"]
    ];
    files.forEach(([file, label]) => ensureWritableFile(file, privateRoot, label));
    const presentCount = files.filter(([file]) => fs.existsSync(file)).length;
    if (presentCount !== 0 && presentCount !== files.length) {
      throw new Error("professional review slot is partially initialized; archive it and allocate a new packet ID");
    }
    if (presentCount === files.length) {
      const existingManifest = existingJson(paths.manifestRelative, "existing professional review manifest");
      const existingRegistry = existingJson(paths.reviewerRegistryRelative, "existing professional reviewer registry");
      const existingResults = existingJson(paths.resultsRelative, "existing professional review submissions");
      if (canonicalJson(existingManifest) !== canonicalJson(packet)) {
        throw new Error("professional review slots are immutable; content/release drift requires a new packet ID");
      }
      validateReviewerRegistry(existingRegistry, packet);
      validateResultsEnvelope(existingResults, packet, existingRegistry);
      console.log(JSON.stringify({
        output: paths.manifestRelative, unchanged: true, reason: "immutable_packet_slot_already_initialized",
        packetDigest: packet.packetDigest, humanEntries: hasHumanEntries(existingRegistry, existingResults)
      }));
      return packet;
    }

    writeNewJson(manifestFile, packet);
    writeNewJson(registryFile, reviewerRegistryTemplate(packet));
    writeNewJson(resultsFile, resultsTemplate(packet));
    console.log(JSON.stringify({
      output: paths.manifestRelative,
      packetDigest: packet.packetDigest,
      materials: packet.materialTaskCount,
      catalog: packet.catalogMaterialTaskCount,
      external: packet.externalFoodTaskCount,
      recipes: packet.recipeTaskCount,
      reviewableMaterials: packet.reviewableMaterialTaskCount,
      reviewableRecipes: packet.reviewableRecipeTaskCount,
      approvalReady: false
    }));
    return packet;
  } finally {
    lock.release();
  }
}

if (require.main === module) {
  try { main(profileFromCli(process.argv.slice(2))); }
  catch (error) { console.error(`[build-professional-review-packet] ${error.code || "error"}: ${error.message}`); process.exitCode = 1; }
}
module.exports = {
  acquireLock, ensureDirectoryChain, fileDigest, hasHumanEntries, main,
  recognizedEmptyRegistry, recognizedEmptyResults, writeNewJson
};
