"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PUBLIC_TESTS = Object.freeze([
  "test-safety.js", "test-search.js", "test-compare.js", "test-recipes.js", "test-privacy.js", "test-storage.js",
  "test-navigation.js", "test-clipboard.js", "test-detail-page.js", "test-list-actions.js", "test-entry-actions.js",
  "test-privacy-page.js", "test-public-catalog.js", "test-catalog-read-lifecycle.js", "test-device-preflight.js",
  "smoke-pages.js", "test-professional-review.js", "test-professional-review-legacy.js", "version-test.js"
]);
// These tests bind real local source/rights/review files. They stay in the
// original full check/test commands; absent files are never treated as approval.
const PRIVATE_TESTS = Object.freeze([
  "test-media-drafts.js", "test-specimen-candidates.js", "test-food-form-candidates.js", "test-food-form-gap-research.js",
  "test-research-refresh.js", "test-external-food-source-candidates.js", "test-professional-review-scoped.js"
]);

function publicProjectConfig() {
  return {
    appid: "touristappid", projectname: "food-education-public-ci", description: "Public source test fixture",
    miniprogramRoot: "./", compileType: "miniprogram", simulatorType: "wechat", libVersion: "3.7.6",
    setting: { urlCheck: true, es6: true, enhance: true, postcss: true, minified: true, minifyWXSS: true, minifyWXML: true,
      checkInvalidKey: true, checkSiteMap: true, ignoreDevUnusedFiles: false, ignoreUploadUnusedFiles: false,
      uploadWithSourceMap: false, compileHotReLoad: false },
    editorSetting: { tabIndent: "insertSpaces", tabSize: 2 },
    packOptions: { include: [], ignore: [
      ...["tools", "docs", "content-private", ".local"].map(value => ({ type: "folder", value })),
      ...["data/recipes.js", "README.md", "package.json", ".gitignore"].map(value => ({ type: "file", value }))
    ] },
    condition: { miniprogram: { list: [
      ["目录", "pages/index/index"], ["收藏", "pages/favorites/favorites"], ["对比", "pages/compare/compare"],
      ["安全", "pages/plan/plan"], ["隐私", "pages/privacy/privacy"]
    ].map(([name, pathName]) => ({ name, pathName, query: "", scene: null })) } }
  };
}

function ordinary(target) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink(), "Linked public CI path refused");
    assert.equal(fs.realpathSync(current).toLowerCase(), current.toLowerCase(), "Redirected public CI path refused");
    if (stat.isFile()) assert.equal(stat.nlink, 1, "Hard-linked public CI input refused");
    if (path.dirname(current) === current) break;
  }
}

function preparePublicProject(root) {
  root = path.resolve(root); ordinary(root);
  for (const file of ["package.json", "app.json", "tools/check-project.js"]) ordinary(path.join(root, file));
  assert(!fs.existsSync(path.join(root, "content-private")), "Public CI must use an isolated source tree, never the working private corpus");
  const filename = path.join(root, "project.config.json");
  const serialized = JSON.stringify(publicProjectConfig(), null, 2) + "\n";
  if (fs.existsSync(filename)) {
    ordinary(filename);
    assert.equal(fs.readFileSync(filename, "utf8"), serialized, "Existing project config preserved; refusing to replace it with a test fixture");
  } else fs.writeFileSync(filename, serialized, { flag: "wx" });
  return filename;
}

function assertCompletePartition(root) {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  const full = scripts.test.split(" && ").map(command => {
    const match = /^node tools\/([a-z0-9-]+\.js)$/.exec(command); assert(match, "Unclassified legacy test command"); return match[1];
  });
  assert.equal(new Set([...PUBLIC_TESTS, ...PRIVATE_TESTS]).size, full.length);
  assert.deepEqual([...PUBLIC_TESTS, ...PRIVATE_TESTS].sort(), full.sort(), "A legacy test disappeared from the public/private partition");
}

function main(args) {
  assert.equal(args.length, 1); assert(["--check", "--test"].includes(args[0]), "Choose --check or --test");
  const root = path.resolve(__dirname, ".."); assertCompletePartition(root); preparePublicProject(root);
  const files = args[0] === "--check" ? ["version-verify.js", "check-project.js"] : PUBLIC_TESTS;
  for (const file of files) {
    const filename = path.join(root, "tools", file); ordinary(filename);
    console.log(`[public-source-ci] ${file}`);
    const result = spawnSync(process.execPath, [filename], { cwd: root, windowsHide: true, stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error(`Public source verification failed: ${file}`);
  }
  console.log(JSON.stringify({ scope: "public-source-and-synthetic-fixtures", scriptFilesPassed: files.length,
    privateCorpusVerified: false, privateTestFilesNotInPublicScope: PRIVATE_TESTS, professionalApprovalGranted: false, deviceVerified: false }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { PUBLIC_TESTS, PRIVATE_TESTS, publicProjectConfig, preparePublicProject, assertCompletePartition };
