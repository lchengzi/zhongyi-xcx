"use strict";
// Owned offline Edge CSS stress, not WeChat rendering or input interaction.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { parseTemplate, renderTemplate, cssForBrowser } = require("./check-mini-card-layout.cjs");
const root = path.resolve(__dirname, ".."), mini = path.resolve(root, "../zhongyi");
const read = f => fs.readFileSync(path.join(mini, f), "utf8");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const probes = [__filename, path.join(__dirname, "check-mini-card-layout.cjs")].map(file => ({ file, sha256: sha(fs.readFileSync(file)) }));
let phase = "initialize";
function ordinaryDirectory(directory) {
  for (let p = directory; ; p = path.dirname(p)) {
    const stat = fs.lstatSync(p); assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(fs.realpathSync(p).toLowerCase(), p.toLowerCase());
    if (path.dirname(p) === p) break;
  }
}
function scenarios() {
  const memory = {}, app = { globalData: { sessionSafetyProfile: {} } }, result = [];
  global.getApp = () => app;
  global.wx = { getStorageSync: key => memory[key] || "", setStorageSync: (key, value) => { memory[key] = structuredClone(value); },
    showTabBar() {}, hideTabBar() {}, showToast() {}, setNavigationBarTitle() {},
    request() { throw new Error("unexpected_network"); } };
  const definitions = new Map();
  for (const relative of ["subpackages/catalog/detail/detail", "pages/compare/compare", "pages/plan/plan",
    "subpackages/official/official-plans/official-plans", "subpackages/official/official-plan-detail/official-plan-detail"]) {
    global.Page = definition => definitions.set(relative, definition); require(path.join(mini, relative + ".js"));
  }
  const create = (relative, options) => {
    const definition = definitions.get(relative);
    const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    page.onLoad?.(options); page.onShow?.(); return page;
  };
  const save = (name, relative, options, prepare) => {
    phase = name;
    const page = create(relative, options); prepare?.(page);
    result.push({ name, relative, data: structuredClone(page.data) }); page.onUnload?.();
  };
  const storage = require(path.join(mini, "utils/storage"));
  const ids = ["xing-ren", "huang-qi", "jiang", "di-huang"];
  for (const id of ids) {
    save(`detail-${id}`, "subpackages/catalog/detail/detail", { id }, page => assert.equal(page.data.ingredient.id, id));
  }
  for (const count of [1, 2, 4]) {
    storage.setCompare(ids.slice(0, count));
    save(`compare-${count}-stacked`, "pages/compare/compare", undefined, page => assert.equal(page.data.ingredients.length, count));
  }
  save("compare-4-table", "pages/compare/compare", undefined, page => {
    page.setReadingMode({ currentTarget: { dataset: { mode: "table", version: page.data.displayVersion } } });
    assert.equal(page.data.readingMode, "table");
  });
  storage.setFavorites(ids); storage.setChecklist({ identity: true, no_combination: true });
  save("plan-filled", "pages/plan/plan", undefined, page => {
    assert.equal(page.data.shortlist.length + page.data.excludedItems.length, 4); assert.equal(page.data.checkedCount, 2);
  });
  app.globalData.sessionSafetyProfile = { ageGroup: "adult", pregnancyStatus: "yes" };
  save("plan-restricted", "pages/plan/plan", undefined, page => assert(page.data.excludedItems.length > 0));
  app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] };
  save("plan-redflag", "pages/plan/plan", undefined, page => assert.equal(page.data.triageBlocked, true));
  app.globalData.sessionSafetyProfile = {}; storage.setCompare([]); storage.setFavorites([]); storage.setChecklist({});
  save("plan-empty", "pages/plan/plan", undefined, page => assert.equal(page.data.shortlist.length, 0));
  const directory = "subpackages/official/official-plans/official-plans";
  const detail = "subpackages/official/official-plan-detail/official-plan-detail";
  const recipes = require(path.join(mini, "data/recipes-public"));
  assert.equal(recipes.targets.length, 3); assert.equal(recipes.recipes.length, 5);
  save("official-directory", directory, undefined, page => {
    assert.equal(page.data.targets.length, 3); assert.equal(page.data.publishableCount, 0);
  });
  for (const target of recipes.targets) {
    save(`official-target-${target.id}`, directory, undefined, page => {
      page.selectTarget({ currentTarget: { dataset: { id: target.id } } });
      assert.equal(page.data.selectedTarget.id, target.id);
      assert.equal(page.data.publishedCards.length, 0);
    });
  }
  for (const recipe of recipes.recipes) {
    save(`official-detail-${recipe.id}`, detail, { id: recipe.id }, page => {
      assert.equal(page.data.recipe.id, recipe.id); assert.equal(page.data.contentHidden, true);
      assert.equal(page.data.ingredientRows.length, 0); assert.equal(page.data.stepRows.length, 0);
    });
  }
  save("official-detail-not-found", detail, { id: "invalid-recipe-id" }, page => assert.equal(page.data.notFound, true));
  app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] };
  save("official-directory-redflag", directory, undefined, page => {
    assert.equal(page.data.triageBlocked, true); assert.equal(page.data.targets.length, 0);
  });
  save("official-detail-redflag", detail, { id: recipes.recipes[0].id }, page => {
    assert.equal(page.data.triageBlocked, true); assert.equal(page.data.recipe, null);
  });
  assert.equal(result.length, 24);
  return result;
}
async function main() {
  assert.equal(process.argv.length, 2, "no user paths or templates accepted");
  const local = path.join(root, ".local"); ordinaryDirectory(local);
  const parent = path.join(local, "mini-reading-layout-runs");
  if (!fs.existsSync(parent)) fs.mkdirSync(parent); ordinaryDirectory(parent);
  const directory = fs.mkdtempSync(path.join(parent, "run-")); ordinaryDirectory(directory);
  const cases = scenarios(), inputs = new Set(["app.wxss"]);
  for (const scenario of cases) {
    phase = "parse " + scenario.name;
    for (const extension of ["js", "wxml", "wxss", "json"]) inputs.add(scenario.relative + "." + extension);
    scenario.template = parseTemplate(read(scenario.relative + ".wxml"), { pageLayout: true });
  }
  for (const file of Object.keys(require.cache).filter(file => file.startsWith(mini + path.sep))) inputs.add(path.relative(mini, file).replace(/\\/g, "/"));
  const bindings = [...inputs].sort().map(file => ({ path: file, sha256: sha(read(file)) }));
  assert(bindings.every(binding => !binding.path.startsWith("content-private/")));
  phase = "launch installed Edge";
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const browserVersion = browser.version(), results = [], errors = []; let networkAttempts = 0;
  try {
    for (const width of [320, 375, 430, 768]) for (const fontScale of [1, 1.6]) for (const scenario of cases) {
      phase = "render " + scenario.name;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => { networkAttempts++; return route.abort(); });
      const css = cssForBrowser(read("app.wxss") + read(scenario.relative + ".wxss"), width, fontScale);
      const html = cssForBrowser(renderTemplate(scenario.template, scenario.data), width, 1);
      await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0}button{font-family:inherit}
        [data-probe-scroll]{overflow-x:auto;display:block}.probe-inert-control{display:inline-block;flex-shrink:0;width:24px;height:24px;font-size:18px;line-height:24px}
        ${css}</style>${html}</html>`);
      const initialFooterVisible = await page.evaluate(() => {
        const footer = document.querySelector(".detail-actions"); if (!footer) return null;
        const box = footer.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight + 1;
      });
      const compareIntroGap = await page.evaluate(() => {
        const intro = document.querySelector(".compare-intro"), controls = document.querySelector(".compare-controls");
        return intro && controls ? controls.getBoundingClientRect().top - intro.getBoundingClientRect().bottom : null;
      });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const findings = await page.evaluate(() => {
        const visible = el => el.getClientRects().length > 0, violations = [];
        for (const el of document.querySelectorAll("div,span,button,label")) {
          if (!visible(el) || el.closest("[data-probe-scroll]")) continue;
          const box = el.getBoundingClientRect();
          if (box.left < -1 || box.right > innerWidth + 1 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1))
            violations.push({ selector: el.className, type: "horizontal_content_overflow" });
        }
        const buttons = [...document.querySelectorAll("button")].filter(visible);
        const footer = document.querySelector(".detail-actions"), finalReading = document.querySelector(".reading-top");
        if (footer && finalReading && finalReading.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1)
          violations.push({ selector: "reading-top", type: "fixed_footer_covers_last_action" });
        const scroll = document.querySelector("[data-probe-scroll]");
        let tableScroll = null;
        if (scroll) { scroll.scrollLeft = scroll.scrollWidth; tableScroll = scroll.scrollLeft > 0; }
        return { buttons: buttons.length, minimumButtonWidth: Math.min(...buttons.map(el => el.getBoundingClientRect().width)),
          minimumButtonHeight: Math.min(...buttons.map(el => el.getBoundingClientRect().height)),
          documentOverflow: document.documentElement.scrollWidth > innerWidth + 1, tableScroll, violations };
      });
      results.push({ name: scenario.name, width, fontScale, initialFooterVisible, compareIntroGap, ...findings });
      if (width === 320 && fontScale === 1.6 && ["detail-huang-qi", "compare-4-table", "plan-filled"].includes(scenario.name)) {
        await page.screenshot({ path: path.join(directory, scenario.name + "-bottom.png") });
        await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(directory, scenario.name + "-top.png") });
      }
      if (width === 375 && fontScale === 1 && ["official-target-adult_diabetes", "official-detail-black-bean-huangqi-goji-soup"].includes(scenario.name)) {
        await page.screenshot({ path: path.join(directory, scenario.name + "-bottom.png") });
        await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(directory, scenario.name + "-top.png") });
      }
      await page.close();
    }
  } finally { await browser.close(); }
  for (const binding of bindings) assert.equal(sha(read(binding.path)), binding.sha256, "native source changed during render");
  for (const probe of probes) assert.equal(sha(fs.readFileSync(probe.file)), probe.sha256, "probe changed during render");
  const passed = results.length === 192 && !errors.length && !networkAttempts && results.every(result =>
    !result.documentOverflow && !result.violations.length && result.initialFooterVisible !== false && result.minimumButtonWidth >= 47.9 && result.minimumButtonHeight >= 47.9 &&
    (result.width > 560 || result.compareIntroGap === null || result.compareIntroGap <= 24) &&
    (result.name !== "compare-4-table" || result.tableScroll));
  const report = { kind: "reading_css_stress_not_wechat", testedAt: new Date().toISOString(), passed, browserVersion,
    bindings, probes, results, errors, networkAttempts, fontScaleMeaning: "explicit_css_font_size_multiplier",
    conversion: "trusted_page_template_to_html_inert_checkbox_switch_scroll_view_emulated",
    interactionsTested: false, devtoolsExecuted: false, actualIosVerified: false, actualAndroidVerified: false, actualHarmonyosVerified: false };
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ passed, report: path.join(directory, "report.json"), cases: results.length,
    overflowCases: results.filter(result => result.documentOverflow || result.violations.length).length,
    shortButtonCases: results.filter(result => result.minimumButtonHeight < 47.9 || result.minimumButtonWidth < 47.9).length, networkAttempts }));
  if (!passed) process.exitCode = 1;
}
main().catch(() => { console.error(`Reading CSS probe failed at ${phase}; no device or release approval performed.`); process.exitCode = 1; });
