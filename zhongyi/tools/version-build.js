"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { verifyWorkspace } = require("./version-core");
const { buildRuntimeConfig } = require("./build-runtime-config");

const ROOT = path.resolve(__dirname, "..");

function main() {
  const before = verifyWorkspace(ROOT);
  const build = spawnSync(process.execPath, [path.join(__dirname, "build-public-recipes.js")], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Public recipe build failed with exit code ${build.status}`);
  const after = verifyWorkspace(ROOT);
  const runtime = buildRuntimeConfig(ROOT);
  console.log(JSON.stringify({ before: before.releaseId, after: after.releaseId, runtime, verified: true }, null, 2));
  return after;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[version-build] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
