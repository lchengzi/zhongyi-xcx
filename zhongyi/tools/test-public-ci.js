"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PUBLIC_TESTS, PRIVATE_TESTS, publicProjectConfig, preparePublicProject, assertCompletePartition } = require("./public-ci");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "food-public-ci-unit-"));
  fs.mkdirSync(path.join(root, "tools"));
  for (const name of ["package.json", "app.json", "tools/check-project.js"]) fs.writeFileSync(path.join(root, name), "{}", { flag: "wx" });
  return root;
}
test("all original legacy tests remain classified and original full checks are untouched", () => {
  assertCompletePartition(path.resolve(__dirname, ".."));
  assert.equal(PUBLIC_TESTS.length, 19); assert.equal(PRIVATE_TESTS.length, 7);
  for (const name of ["test-safety.js", "test-privacy.js", "test-professional-review.js", "version-test.js"]) assert(PUBLIC_TESTS.includes(name));
  for (const name of ["test-research-refresh.js", "test-professional-review-scoped.js"]) assert(PRIVATE_TESTS.includes(name));
});
test("public config is a tourist-only synthetic fixture with strict upload and domain protection", () => {
  const config = publicProjectConfig(); assert.equal(config.appid, "touristappid"); assert.equal(config.setting.urlCheck, true);
  assert.equal(config.setting.uploadWithSourceMap, false); assert.equal(config.setting.ignoreUploadUnusedFiles, false);
  assert(config.packOptions.ignore.some(value => value.value === "content-private"));
  assert(config.condition.miniprogram.list.every(value => value.query === ""));
  const root = fixture(), filename = preparePublicProject(root), before = fs.readFileSync(filename);
  preparePublicProject(root); assert.deepEqual(fs.readFileSync(filename), before);
});
test("public preparation refuses a working corpus or existing config without overwriting either", () => {
  const root = fixture(), filename = path.join(root, "project.config.json");
  fs.writeFileSync(filename, '{"appid":"synthetic-existing-id"}', { flag: "wx" }); const before = fs.readFileSync(filename);
  assert.throws(() => preparePublicProject(root), /Existing project config preserved/); assert.deepEqual(fs.readFileSync(filename), before);
  const privateRoot = fixture(); fs.mkdirSync(path.join(privateRoot, "content-private"));
  assert.throws(() => preparePublicProject(privateRoot), /isolated source tree/); assert(!fs.existsSync(path.join(privateRoot, "project.config.json")));
});
test("a removed or newly unclassified test fails the partition instead of being silently omitted", () => {
  const root = fixture(); const scripts = PUBLIC_TESTS.concat(PRIVATE_TESTS).map(value => `node tools/${value}`);
  for (const commands of [scripts.slice(1), scripts.concat("node tools/new-test.js")]) {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: commands.join(" && ") } }));
    assert.throws(() => assertCompletePartition(root));
  }
});
