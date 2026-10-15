"use strict";
// Local browser CSS/layout evidence ONLY: no WeChat, installation or upload.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { cssForBrowser } = require("./check-mini-card-layout.cjs");
const { prepareShellTemplate, renderShell } = require("./mini-shell-template.cjs");
const root = path.resolve(__dirname, ".."), mini = path.resolve(root, "../zhongyi");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = file => fs.readFileSync(path.join(mini, file), "utf8");

function ordinaryDirectory(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current); assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(fs.realpathSync(current).toLowerCase(), current.toLowerCase());
    if (path.dirname(current) === current) return;
  }
}

function scenarios() {
  const memory = {}, app = { globalData: { sessionSafetyProfile: {}, sessionDataRevision: 0 } };
  global.getApp = () => app;
  global.wx = { getStorageSync: key => memory[key] || "", setStorageSync: (key, value) => { memory[key] = structuredClone(value); },
    getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
    showTabBar() {}, hideTabBar() {}, showToast() {}, request() { throw new Error("unexpected_network"); } };
  const definitions = new Map(), cases = [];
  for (const page of ["index", "favorites", "privacy"]) {
    const relative = `pages/${page}/${page}`;
    global.Page = definition => definitions.set(relative, definition); require(path.join(mini, relative + ".js"));
  }
  const save = (name, page, prepare) => {
    const relative = `pages/${page}/${page}`, definition = definitions.get(relative);
    const instance = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    instance.onLoad?.(); instance.onShow?.(); prepare?.(instance);
    cases.push({ name, relative, data: structuredClone(instance.data), compact: page === "favorites" });
    instance.onUnload?.();
  };
  const search = (page, value) => (page.onSearchConfirm || page.onSearchInput).call(page, { detail: { value }, currentTarget: { dataset: {
    version: page.data.interactionVersion ?? page.data.searchVersion } } });
  save("home", "index", page => assert(page.data.rows.length > 0));
  save("home-search", "index", page => { search(page, "百合"); assert.equal(page.data.rows.length, 1); });
  save("home-empty", "index", page => { search(page, "not-a-food-123"); assert.equal(page.data.rows.length, 0); });
  save("home-guide", "index", page => page.toggleUsageGuide({ currentTarget: { dataset: { version: page.data.interactionVersion } } }));
  save("home-filters", "index", page => page.openFilters());
  save("home-safety", "index", page => page.openSafety());
  save("favorites-empty", "favorites", page => assert.equal(page.data.rows.length, 0));
  const storage = require(path.join(mini, "utils/storage"));
  storage.setFavorites(["bai-he", "lian-zi"]);
  save("favorites-filled", "favorites", page => assert.equal(page.data.rows.length, 2));
  save("favorites-no-match", "favorites", page => { search(page, "not-a-food-123"); assert.equal(page.data.rows.length, 0); });
  save("privacy", "privacy");
  app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] };
  save("home-redflag", "index", page => assert.equal(page.data.triageBlocked, true));
  return cases;
}

async function main() {
  assert.equal(process.argv.length, 2, "no user paths accepted");
  const parent = path.join(root, ".local", "mini-shell-layout-runs");
  ordinaryDirectory(path.dirname(parent));
  if (!fs.existsSync(parent)) fs.mkdirSync(parent); ordinaryDirectory(parent);
  const directory = fs.mkdtempSync(path.join(parent, "run-")); ordinaryDirectory(directory);
  const probes = [__filename, path.join(__dirname, "mini-shell-template.cjs"), path.join(__dirname, "check-mini-card-layout.cjs")]
    .map(file => ({ file, sha256: sha(fs.readFileSync(file)) }));
  const cases = scenarios(), inputs = new Set(["app.wxss", "components/ingredient-card/ingredient-card.wxml", "components/ingredient-card/ingredient-card.wxss"]);
  for (const scenario of cases) {
    for (const extension of ["js", "json", "wxml", "wxss"]) inputs.add(scenario.relative + "." + extension);
    scenario.template = prepareShellTemplate(read(scenario.relative + ".wxml"), read("components/ingredient-card/ingredient-card.wxml"));
  }
  for (const file of Object.keys(require.cache).filter(file => file.startsWith(mini + path.sep))) inputs.add(path.relative(mini, file).replace(/\\/g, "/"));
  const bindings = [...inputs].sort().map(file => ({ path: file, sha256: sha(read(file)) }));
  assert(bindings.every(binding => !binding.path.startsWith("content-private/")));
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const browserVersion = browser.version(), results = [], errors = []; let networkAttempts = 0;
  try {
    for (const width of [320, 375, 430, 768]) for (const fontScale of [1, 1.6]) for (const scenario of cases) {
      const page = await browser.newPage({ viewport: { width, height: 812 } });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => { networkAttempts++; return route.abort(); });
      const css = cssForBrowser(read("app.wxss") + read(scenario.relative + ".wxss") + read("components/ingredient-card/ingredient-card.wxss"), width, fontScale);
      const html = cssForBrowser(renderShell(scenario.template, scenario.data, { compact: scenario.compact }), width, 1);
      await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0}button{font-family:inherit}.probe-input{display:flex;align-items:center;overflow-wrap:anywhere} [data-probe-scroll]{overflow:auto;display:block}.probe-inert-control{display:inline-block;flex-shrink:0;width:24px;height:24px;font-size:18px;line-height:24px}${css}</style>${html}</html>`);
      const findings = await page.evaluate(() => {
        const visible = element => element.getClientRects().length > 0, violations = [];
        for (const element of document.querySelectorAll("div,span,button,label")) {
          if (!visible(element) || element.closest("[data-probe-scroll]")) continue;
          const box = element.getBoundingClientRect();
          if (box.left < -1 || box.right > innerWidth + 1 || (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1))
            violations.push({ selector: element.className, type: "horizontal_content_overflow" });
        }
        const buttons = [...document.querySelectorAll("button")].filter(visible);
        const search = document.querySelector(".search-box"), firstCard = document.querySelector(".ingredient-card");
        return { violations, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          minimumButtonWidth: Math.min(...buttons.map(element => element.getBoundingClientRect().width)),
          minimumButtonHeight: Math.min(...buttons.map(element => element.getBoundingClientRect().height)),
          searchBottom: search?.getBoundingClientRect().bottom ?? null, firstCardTop: firstCard?.getBoundingClientRect().top ?? null };
      });
      // Native app chrome is NOT simulated; first-fold assertion uses page content only.
      if (scenario.name === "home" && fontScale === 1 && width <= 430) {
        if (!(findings.searchBottom < 690 && findings.firstCardTop < 812)) findings.violations.push({ selector: "home", type: "core_catalog_below_first_fold" });
      }
      if (width === 375 && fontScale === 1 && ["home", "home-search", "favorites-empty", "privacy", "home-safety"].includes(scenario.name))
        await page.screenshot({ path: path.join(directory, scenario.name + ".png") });
      if (findings.violations.length || findings.documentOverflow)
        await page.screenshot({ path: path.join(directory, `${scenario.name}-${width}-${fontScale}-overflow.png`) });
      results.push({ name: scenario.name, width, fontScale, ...findings }); await page.close();
    }
  } finally { await browser.close(); }
  for (const binding of bindings) assert.equal(sha(read(binding.path)), binding.sha256);
  for (const probe of probes) assert.equal(sha(fs.readFileSync(probe.file)), probe.sha256);
  const passed = results.every(result => !result.documentOverflow && !result.violations.length && result.minimumButtonWidth >= 47.9 && result.minimumButtonHeight >= 47.9)
    && !errors.length && !networkAttempts;
  const report = { schemaVersion: 1, kind: "browser_shell_layout_not_wechat", testedAt: new Date().toISOString(), passed,
    browserVersion, bindings, probes, results, errors, networkAttempts,
    conversion: "trusted_WXML_inputs_and_radios_inert_component_inlined_rpx_scaled", interactionsTested: false,
    devtoolsExecuted: false, actualAndroidVerified: false, actualIosVerified: false, actualHarmonyosVerified: false,
    deploymentVerified: false };
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ passed, cases: results.length, overflowCases: results.filter(result => result.documentOverflow || result.violations.length).length,
    report: path.join(directory, "report.json"), networkAttempts }));
  if (!passed) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { scenarios };
