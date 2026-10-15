"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const VERSION_RUNTIME_PATH = "data/version-runtime.js";
const CONFIG_RUNTIME_PATH = "config/public-api.js";

function renderRuntimeProjection(value) {
  return '"use strict";\n\n// WeChat runtime projection; tools/check-project.js verifies the JSON source.\nmodule.exports = ' + JSON.stringify(value, null, 2) + ';\n';
}

function versionRuntimeReplacement(active) {
  assert(active && typeof active.releaseId === "string" && active.releaseId.length > 0, "Missing active release ID");
  assert(/^sha256:[a-f0-9]{64}$/.test(active.releaseDigest), "Invalid active release digest");
  return { relative: VERSION_RUNTIME_PATH, bytes: Buffer.from(renderRuntimeProjection({
    releaseId: active.releaseId, releaseDigest: active.releaseDigest
  }), "utf8") };
}

function runtimeReplacements(readSource = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8")) {
  const config = JSON.parse(readSource("config/public-api.json"));
  const active = JSON.parse(readSource("data/version-active.json"));
  return [
    { relative: CONFIG_RUNTIME_PATH, bytes: Buffer.from(renderRuntimeProjection(config), "utf8") },
    versionRuntimeReplacement(active)
  ];
}

function checkRuntimeJsonProjections(readSource = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8")) {
  for (const { relative, bytes } of runtimeReplacements(readSource)) {
    assert.strictEqual(readSource(relative).replace(/\r\n/g, "\n"), bytes.toString("utf8"),
      `WeChat runtime projection differs from JSON source: ${relative}`);
  }
}

module.exports = { VERSION_RUNTIME_PATH, CONFIG_RUNTIME_PATH, renderRuntimeProjection,
  versionRuntimeReplacement, runtimeReplacements, checkRuntimeJsonProjections };
