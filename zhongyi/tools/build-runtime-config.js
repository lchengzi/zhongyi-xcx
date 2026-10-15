"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { verifyWorkspace } = require("./version-core");
const { transactionalReplace } = require("./version-rollback");
const { runtimeReplacements, checkRuntimeJsonProjections } = require("./runtime-projections");
const { validBaseUrl } = require("../utils/public-api-config");
const ROOT = path.resolve(__dirname, "..");

function buildRuntimeConfig(root = ROOT, options) {
  const before = verifyWorkspace(root, options);
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const config = JSON.parse(read("config/public-api.json"));
  assert(config && typeof config === "object" && !Array.isArray(config) &&
    Object.keys(config).length === 1 && Object.hasOwn(config, "baseUrl"), "Only public baseUrl configuration may enter the mini program");
  assert(config.baseUrl === "" || validBaseUrl(config) === config.baseUrl, "Public API requires an allowed HTTPS origin or an empty offline address");
  const replacements = runtimeReplacements(read).filter(({ relative, bytes }) =>
    !fs.existsSync(path.join(root, relative)) || !fs.readFileSync(path.join(root, relative)).equals(bytes));
  const verify = () => {
    checkRuntimeJsonProjections(read);
    const after = verifyWorkspace(root, options);
    assert.strictEqual(after.releaseId, before.releaseId);
    return after;
  };
  if (replacements.length) transactionalReplace(root, replacements, verify);
  else verify();
  return { releaseId: before.releaseId, updated: replacements.map((item) => item.relative), verified: true };
}

if (require.main === module) {
  try { console.log(JSON.stringify(buildRuntimeConfig(), null, 2)); }
  catch (error) { console.error(`[build-runtime-config] ${error.code || "error"}: ${error.message}`); process.exitCode = 1; }
}

module.exports = { buildRuntimeConfig };
