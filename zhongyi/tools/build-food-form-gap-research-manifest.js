"use strict";

const fs = require("fs");
const path = require("path");
const { MANIFEST_RELATIVE, ROOT, buildManifest } = require("./food-form-gap-research-core");

function main() {
  const manifest = buildManifest();
  const output = path.resolve(ROOT, ...MANIFEST_RELATIVE.split("/"));
  const privateRoot = path.resolve(ROOT, "content-private", "media-candidates", "food-form-gap-upgrades");
  if (fs.existsSync(privateRoot)) {
    const rootStat = fs.lstatSync(privateRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("gap research private root must be a regular directory");
  }
  if (!output.startsWith(`${privateRoot}${path.sep}`)) throw new Error("gap research manifest output escaped its private root");
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error("gap research manifest output may not be a symbolic link");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: MANIFEST_RELATIVE,
    researchLeads: manifest.recordCount,
    unresolved: manifest.unresolvedCount,
    publicationEligible: manifest.publicationEligibleCount,
    runtimePlacements: manifest.runtimePlacementCount
  }));
  return manifest;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[build-food-form-gap-research] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
