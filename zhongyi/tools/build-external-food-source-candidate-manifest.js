"use strict";

const fs = require("fs");
const path = require("path");
const { MANIFEST_RELATIVE, ROOT, buildManifest } = require("./external-food-source-candidate-core");

function main() {
  const output = path.resolve(ROOT, ...MANIFEST_RELATIVE.split("/"));
  const manifest = buildManifest();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: MANIFEST_RELATIVE,
    candidates: manifest.candidateCount,
    targets: manifest.targetCount,
    gaps: manifest.gapCount,
    publicationEligible: manifest.publicationEligibleCount
  }));
  return manifest;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[build-external-food-source-candidates] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
