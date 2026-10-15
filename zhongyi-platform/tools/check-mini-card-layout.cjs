"use strict";

// Chromium layout probe of trusted repository WXML/WXSS, NOT a WeChat renderer.
// No DevTools, network, login, upload, real health input, or working DB access.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const probeSha256 = crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex");
const root = path.resolve(__dirname, "..");
const mini = path.resolve(root, "../zhongyi");
const inputs = ["data/ingredients.js", "utils/catalog-search.js", "utils/food-display.js", "utils/format.js",
  "utils/safety.js", "pages/index/index.js", "pages/favorites/favorites.js", "app.wxss",
  "pages/index/index.wxss", "pages/favorites/favorites.wxss",
  "components/ingredient-card/ingredient-card.wxml", "components/ingredient-card/ingredient-card.wxss"];
const read = f => fs.readFileSync(path.join(mini, f), "utf8");
const escape = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Expressions come ONLY from the checked-in trusted template, never data or CLI.
const evaluate = (expression, scope) => Function("scope", `with(scope){return (${expression});}`)(scope);
const bind = (value, scope) => value.replace(/{{([\s\S]*?)}}/g, (_, expr) => escape(evaluate(expr, scope)));

function parseTemplate(source, { pageLayout = false } = {}) {
  const document = { children: [] }, stack = [document];
  for (const token of source.match(/<!--[\s\S]*?-->|<\/?[\w-]+\b(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+/g) || []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) {
      assert.equal(stack.pop().tag, token.match(/^<\/([\w-]+)/)[1]); continue;
    }
    if (!token.startsWith("<")) { stack.at(-1).children.push({ text: token }); continue; }
    const tag = token.match(/^<([\w-]+)/)[1];
    assert(["view", "text", "button", ...(pageLayout ? ["block", "label", "checkbox-group", "checkbox", "switch", "scroll-view"] : [])].includes(tag));
    const attributes = Object.fromEntries([...token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:="([^"]*)")?/g)]
      .map(m => [m[1], m[2] ?? ""]));
    const node = { tag, attributes, children: [] }; stack.at(-1).children.push(node);
    if (!token.endsWith("/>")) stack.push(node);
  }
  assert.equal(stack.length, 1); return document;
}
function renderTemplate(tree, scope) {
  let chain = false;
  return tree.children.map(node => {
    if (node.text !== undefined) return bind(node.text, scope);
    const a = node.attributes;
    if (a["wx:if"] !== undefined) { chain = Boolean(evaluate(a["wx:if"].slice(2, -2), scope)); if (!chain) return ""; }
    else if (a["wx:elif"] !== undefined) { if (chain) return ""; chain = Boolean(evaluate(a["wx:elif"].slice(2, -2), scope)); if (!chain) return ""; }
    else if (a["wx:else"] !== undefined) { if (chain) return ""; chain = true; }
    else chain = false;
    const one = context => {
      if (node.tag === "block") return renderTemplate(node, context);
      if (["checkbox", "switch"].includes(node.tag)) return `<span class="probe-inert-control" aria-hidden="true">□</span>`;
      const tag = { view: "div", text: "span", button: "button", label: "label", "checkbox-group": "div", "scroll-view": "div" }[node.tag];
      const attrs = ["class", "aria-label", "id", "style"].filter(key => a[key] !== undefined)
        .map(key => ` ${key}="${bind(a[key], context)}"`).join("");
      const scroll = node.tag === "scroll-view" ? ' data-probe-scroll="true"' : "";
      const disabled = a.disabled && evaluate(a.disabled.slice(2, -2), context) ? " disabled" : "";
      return `<${tag}${attrs}${scroll}${disabled}>${renderTemplate(node, context)}</${tag}>`;
    };
    return a["wx:for"] === undefined ? one(scope) : evaluate(a["wx:for"].slice(2, -2), scope)
      .map((item, index) => one({ ...scope, [a["wx:for-item"] || "item"]: item, [a["wx:for-index"] || "index"]: index })).join("");
  }).join("");
}
function cssForBrowser(source, width, fontScale) {
  // Explicit stress scaling, not a prediction of WeChat's font-size behavior.
  return source.replace(/(^|[},])(\s*)page(?=\s*[{,:])/g, "$1$2body")
    .replace(/(^|[\s,}])text(?=\s*\{)/g, "$1span")
    .replace(/font-size:\s*([\d.]+)rpx/g, (_, n) => `font-size: ${Number(n) * width / 750 * fontScale}px`)
    .replace(/([\d.]+)rpx/g, (_, n) => `${Number(n) * width / 750}px`);
}
function cards() {
  const catalog = require(path.join(mini, "data/ingredients"));
  const memory = {}, app = { globalData: { sessionSafetyProfile: {} } };
  global.getApp = () => app;
  global.wx = { getStorageSync: k => memory[k] || "", setStorageSync: (k, v) => { memory[k] = v; },
    showTabBar() {}, hideTabBar() {}, showToast() {}, request() { throw new Error("unexpected_network"); } };
  const create = relative => {
    let definition; global.Page = v => { definition = v; }; require(path.join(mini, relative));
    const instance = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    if (instance.onLoad) instance.onLoad(); instance.onShow(); return instance;
  };
  const index = create("pages/index/index.js"); index.limit = 106; index.refreshCards();
  const storage = require(path.join(mini, "utils/storage")); storage.setFavorites(catalog.ingredients.map(v => v.id));
  const favorites = create("pages/favorites/favorites.js");
  assert.equal(index.data.rows.length, 106); assert.equal(favorites.data.rows.length, 106);
  const display = require(path.join(mini, "utils/catalog-search"));
  const addSearch = row => ({ ...row, ...display.searchMatchDisplay(catalog.ingredients.find(v => v.id === row.id),
    row.id === "di-huang" ? "熟地黄" : row.pinyin.replace(/\s+/g, "")) });
  const normalCatalog = index.data.rows.map(addSearch), normalFavorites = favorites.data.rows.map(addSearch);
  app.globalData.sessionSafetyProfile = { ageGroup: "adult", pregnancyStatus: "yes" };
  favorites.refresh(); const restricted = favorites.data.rows.map(addSearch);
  assert(restricted.some(v => v.blocked), "restricted layout must contain actual blocked cards");
  app.globalData.sessionSafetyProfile = {};
  global.wx.getStorageSync = () => { throw new Error("fictional_storage_read_failure"); };
  index.refreshCards(); const unavailable = index.data.rows.map(addSearch);
  assert.equal(index.data.favoritesAvailable, false); assert.equal(index.data.compareAvailable, false);
  return [
    { mode: "catalog", page: "index/index", compact: false, available: true, rows: normalCatalog },
    { mode: "favorites", page: "favorites/favorites", compact: true, available: true, rows: normalFavorites },
    { mode: "favorites-restricted", page: "favorites/favorites", compact: true, available: true, rows: restricted },
    { mode: "catalog-unavailable", page: "index/index", compact: false, available: false, rows: unavailable }
  ];
}
function ordinaryDirectory(directory) {
  for (let p = directory; ; p = path.dirname(p)) {
    const stat = fs.lstatSync(p);
    assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(fs.realpathSync(p).toLowerCase(), p.toLowerCase());
    if (path.dirname(p) === p) break;
  }
}
async function main() {
  assert.equal(process.argv.length, 2, "no CLI paths, templates or expressions accepted");
  const local = path.join(root, ".local"); ordinaryDirectory(local);
  const parent = path.join(local, "mini-card-layout-runs");
  if (!fs.existsSync(parent)) fs.mkdirSync(parent); ordinaryDirectory(parent);
  const directory = fs.mkdtempSync(path.join(parent, "run-")); ordinaryDirectory(directory);
  const template = parseTemplate(read("components/ingredient-card/ingredient-card.wxml")), scenarios = cards();
  const loaded = Object.keys(require.cache).filter(f => f.startsWith(mini + path.sep)).map(f => path.relative(mini, f).replace(/\\/g, "/"));
  assert(loaded.every(f => !f.startsWith("content-private/")));
  const bindings = [...new Set([...inputs, ...loaded])].sort()
    .map(file => ({ path: file, sha256: crypto.createHash("sha256").update(read(file)).digest("hex") }));
  const appCss = read("app.wxss"), componentCss = read("components/ingredient-card/ingredient-card.wxss");
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const browserVersion = browser.version();
  const results = [], errors = []; let networkAttempts = 0;
  try {
    for (const width of [320, 375, 430, 768]) for (const fontScale of [1, 1.6]) for (const scenario of scenarios) {
      const { mode, compact, available } = scenario;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/*", route => { networkAttempts++; return route.abort(); });
      const sheet = read(`pages/${scenario.page}.wxss`);
      const html = scenario.rows.map(item => `<section data-id="${escape(item.id)}">${renderTemplate(template,
        { item, compact, favoritesAvailable: available, compareAvailable: available })}</section>`).join("");
      await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0}button{font-family:inherit}section{min-width:0}
        ${cssForBrowser(appCss + sheet + componentCss, width, fontScale)}</style><main class="page-shell"><div class="${compact ? "favorite-list" : "ingredient-grid"}">${html}</div></main></html>`);
      const findings = await page.evaluate(() => {
        const violations = [], cards = [...document.querySelectorAll("section")];
        for (const section of cards) {
          const card = section.querySelector(".ingredient-card"), box = card.getBoundingClientRect();
          for (const el of card.querySelectorAll("div,span,button")) {
            if (!el.getClientRects().length) continue;
            const r = el.getBoundingClientRect();
            if (r.left < box.left - 1 || r.right > box.right + 1 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)) {
              violations.push({ id: section.dataset.id, selector: el.className, type: "horizontal_content_overflow" });
            }
          }
        }
        const buttons = [...document.querySelectorAll("button")].filter(b => b.getClientRects().length);
        return { cards: cards.length, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          buttons: buttons.length, disabledButtons: buttons.filter(b => b.disabled).length,
          minimumButtonWidth: Math.min(...buttons.map(b => b.getBoundingClientRect().width)),
          minimumButtonHeight: Math.min(...buttons.map(b => b.getBoundingClientRect().height)), violations };
      });
      if (width === 375 && mode === "catalog") {
        await page.locator('[data-id="di-huang"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(directory, `catalog-375-font-${fontScale}.png`) });
      }
      if (findings.violations.length) {
        const heading = page.locator(`[data-id="${findings.violations[0].id}"] .ingredient-card__head`);
        await heading.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(directory, `${mode}-${width}-font-${fontScale}-overflow.png`) });
        await heading.screenshot({ path: path.join(directory, `${mode}-${width}-font-${fontScale}-heading.png`) });
      }
      if (width === 768 && fontScale === 1.6 && ["catalog", "favorites"].includes(mode)) {
        await page.locator('[data-id="xing-ren"] .ingredient-card__head').screenshot({
          path: path.join(directory, `${mode}-768-font-1.6-xingren-heading.png`) });
      }
      results.push({ width, fontScale, mode, ...findings }); await page.close();
    }
  } finally { await browser.close(); }
  for (const binding of bindings) assert.equal(crypto.createHash("sha256").update(read(binding.path)).digest("hex"), binding.sha256);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"), probeSha256, "probe changed during execution");
  const passed = results.every(r => r.cards === 106 && r.buttons === 318 && !r.documentOverflow &&
    r.violations.length === 0 && r.minimumButtonWidth >= 47.9 && r.minimumButtonHeight >= 47.9 &&
    (r.mode !== "catalog-unavailable" || r.disabledButtons === 212)) && !errors.length && !networkAttempts;
  const report = { schemaVersion: 1, kind: "browser_css_stress_not_wechat", testedAt: new Date().toISOString(),
    passed, probeSha256, browserVersion, bindings, results, errors, networkAttempts, fontScaleMeaning: "explicit_css_font_size_multiplier",
    conversion: "trusted_component_template_view_to_div_text_to_span_rpx_scaled_by_viewport_browser_buttons",
    interactionsTested: false,
    devtoolsExecuted: false, actualIosVerified: false, actualAndroidVerified: false, actualHarmonyosVerified: false,
    deploymentVerified: false };
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ kind: report.kind, passed, report: path.join(directory, "report.json"),
    cases: results.length, renderedCards: results.reduce((sum, r) => sum + r.cards, 0),
    overflowCases: results.filter(r => r.violations.length || r.documentOverflow).length, networkAttempts }));
  if (!passed) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error("Card CSS probe failed; no device, deployment or content approval performed."); process.exitCode = 1; });
module.exports = { parseTemplate, renderTemplate, cssForBrowser };
