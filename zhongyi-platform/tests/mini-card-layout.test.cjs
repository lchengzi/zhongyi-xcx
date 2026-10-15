"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path");
const { parseTemplate, renderTemplate, cssForBrowser } = require("../tools/check-mini-card-layout.cjs");
const { prepareShellTemplate, renderShell } = require("../tools/mini-shell-template.cjs");

test("shell input adapter is inert, escapes data and refuses executable input expressions", () => {
  const template = prepareShellTemplate('<input class="search-input" value="{{query}}" placeholder="名称" bindinput="write"/>');
  assert.equal(template.inputs, 1);
  const empty = renderShell(template, { query: "" }); assert(empty.includes("名称"));
  const filled = renderShell(template, { query: '<script>write()</script>{{secret()}}' });
  assert(filled.includes("&lt;script&gt;")); assert(filled.includes("{{secret()}}"));
  assert(!filled.includes("<input")); assert(!filled.includes("bindinput"));
  assert.throws(() => prepareShellTemplate('<input value="{{execute()}}"/>'));
  for (const tag of ["image", "script", "iframe", "web-view"])
    assert.throws(() => prepareShellTemplate(`<${tag}/>`));
});

test("shell native radio controls remain placeholders without making browser interactions claims", () => {
  const template = prepareShellTemplate('<radio-group bindchange="write"><label><radio checked="{{true}}"/>未知</label></radio-group>');
  const html = renderShell(template, {});
  assert(html.includes("probe-inert-control")); assert(html.includes("未知")); assert(!html.includes("write"));
});

test("shell component layout keeps row scope, native defaults and explicit unavailable states", () => {
  const component = '<view>{{item.name}}</view><button disabled="{{!favoritesAvailable}}">收藏</button>';
  const template = prepareShellTemplate('<ingredient-card wx:for="{{rows}}" wx:key="id" item="{{item}}"/>', component);
  assert.equal(template.components, 1);
  assert.equal(renderShell(template, { rows: [{ name: "百合" }] }), '<div>百合</div><button>收藏</button>');
  assert(renderShell(template, { rows: [{ name: "百合" }], favoritesAvailable: false }).includes("<button disabled>"));
  assert.throws(() => prepareShellTemplate('<ingredient-card wx:for="{{unknown}}"/>', component));
});

test("home prioritizes actual browsing while retaining safety, historical provenance and optional guidance", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../../zhongyi/pages/index/index.wxml"), "utf8");
  const position = value => { const index = template.indexOf(value); assert(index >= 0, value); return index; };
  assert(position('class="safety-summary') < position('class="search-box'));
  assert(position('class="search-box') < position('<ingredient-card'));
  assert(position('class="catalog-provenance') < position('<ingredient-card'));
  assert(position('<ingredient-card') < position('class="usage-guide card"'));
  assert(position('<ingredient-card') < position('class="catalog-connection card"'));
  for (const label of ["非医疗 · 食养教育", "非最新目录", "待专业审校", "不代表适合个人食用", "本地数据与删除"])
    assert(template.includes(label));
  assert(!template.includes("P3 ·"));
  const prepared = prepareShellTemplate(template, fs.readFileSync(path.resolve(__dirname, "../../zhongyi/components/ingredient-card/ingredient-card.wxml"), "utf8"));
  assert.equal(prepared.inputs, 4); assert.equal(prepared.components, 1);
});

test("home, favorites and privacy keep flexible 48px controls after the visual refresh", () => {
  for (const name of ["index", "favorites", "privacy"]) {
    const css = fs.readFileSync(path.resolve(__dirname, `../../zhongyi/pages/${name}/${name}.wxss`), "utf8");
    const block = css.match(new RegExp("\\." + name + "-page button\\s*\\{([^}]+)\\}"))[1];
    for (const declaration of ["min-width: 48px", "min-height: 48px", "white-space: normal", "overflow-wrap: anywhere"])
      assert(block.includes(declaration));
  }
});

test("native tab icons are local small transparent PNGs with distinct selected colors", () => {
  const mini = path.resolve(__dirname, "../../zhongyi");
  const app = JSON.parse(fs.readFileSync(path.join(mini, "app.json"), "utf8"));
  const seen = new Set();
  for (const item of app.tabBar.list) {
    const icons = [item.iconPath, item.selectedIconPath].map(file => {
      assert(/^assets\/tabbar\/[a-z-]+\.png$/.test(file)); assert(!seen.has(file)); seen.add(file);
      const bytes = fs.readFileSync(path.join(mini, file)); assert(bytes.length < 40000);
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), 72); assert.equal(bytes.readUInt32BE(20), 72);
      assert.equal(bytes[25], 6, "RGBA preserves the transparent background");
      return bytes;
    });
    assert(!icons[0].equals(icons[1]));
  }
  assert.equal(seen.size, 8);
});

test("CSS probe preserves conditional branch behavior including whitespace between if/elif", () => {
  const tree = parseTemplate('<view wx:if="{{blocked}}">blocked</view>\n<view wx:elif="{{warning}}">warning</view>');
  assert.match(renderTemplate(tree, { blocked: true, warning: true }), /blocked/);
  assert(!renderTemplate(tree, { blocked: true, warning: true }).includes("warning"));
  assert.match(renderTemplate(tree, { blocked: false, warning: true }), /warning/);
  assert.equal(renderTemplate(tree, { blocked: false, warning: false }).trim(), "");
});
test("CSS probe renders loop items in their own scope without replacing the parent row", () => {
  const tree = parseTemplate('<view wx:for="{{item.reasons}}">{{item}}</view><text>{{item.name}}</text>');
  assert.equal(renderTemplate(tree, { item: { name: "parent", reasons: ["one", "two"] } }), '<div>one</div><div>two</div><span>parent</span>');
});
test("data binding escapes markup and does not evaluate template syntax inside data", () => {
  const tree = parseTemplate('<view class="{{name}}">{{name}}</view>');
  const html = renderTemplate(tree, { name: '<img src="https://example.test">{{throwSecret()}}' });
  assert(!html.includes("<img")); assert(html.includes("&lt;img")); assert(html.includes("{{throwSecret()}}"));
});
test("native callbacks and unknown attributes never become browser event handlers", () => {
  const html = renderTemplate(parseTemplate('<button bindtap="doAction" data-id="private" disabled="{{disabled}}">go</button>'), { disabled: true });
  assert.equal(html, '<button disabled>go</button>');
});
test("unsupported tags and mismatched source structure stop the probe", () => {
  for (const source of ['<image></image>', '<script></script>', '<view></button>', '<view>']) assert.throws(() => parseTemplate(source));
});
test("rpx scaling and explicit font stress affect fonts only by the extra multiplier", () => {
  const css = cssForBrowser('page { font-size: 28rpx; padding: 20rpx; } .a text {font-size:24rpx}', 375, 1.6);
  assert(css.includes("body {")); assert(Math.abs(Number(css.match(/font-size:\s*([\d.]+)px/)[1]) - 22.4) < 0.00001);
  assert(css.includes("padding: 10px")); assert(css.includes(".a span {")); assert(!css.includes("rpx"));
});
test("tag conversion preserves class names such as page-shell and text labels", () => {
  const css = cssForBrowser('page {color:black} .page-shell {padding:24rpx} .text {color:red} .label text {font-size:24rpx}', 375, 1);
  assert(css.includes("body {")); assert(css.includes(".page-shell {padding:12px}"));
  assert(css.includes(".text {")); assert(css.includes(".label span {"));
});
test("the actual component retains readable search notes in compact mode", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../../zhongyi/components/ingredient-card/ingredient-card.wxml"), "utf8");
  const html = renderTemplate(parseTemplate(template), { compact: true, favoritesAvailable: true, compareAvailable: true,
    item: { nameCn: "地黄", pinyin: "di huang", safetyLabel: "需先确认", warningCount: 1,
      categoryText: "目录资料", searchMatchText: "别名命中：熟地黄（公告所述加工品）", searchMatchNote: "不能替代",
      matchReasons: [], warningText: "仍待核对", isFavorite: true } });
  assert(html.includes("ingredient-card--compact")); assert(html.includes("熟地黄（公告所述加工品）"));
  assert(html.includes("不能替代")); assert(html.includes("仍待核对")); assert.equal((html.match(/<button/g) || []).length, 3);
});
test("native card styles permit heading wrap, long text wrap and non-fixed touch heights", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../zhongyi/components/ingredient-card/ingredient-card.wxss"), "utf8");
  assert.match(css, /\.ingredient-card__head\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.ingredient-card__identity\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.card-action\s*\{[^}]*min-height:\s*48px/);
  assert.match(css, /\.card-action\s*\{[^}]*white-space:\s*normal/);
  assert(!/\.card-action\s*\{[^}]*[^-]height\s*:/.test(css));
});

test("page probe supports transparent blocks and named nested loop scopes", () => {
  const tree = parseTemplate('<block wx:for="{{groups}}" wx:for-item="group"><view wx:for="{{group.cells}}" wx:for-item="cell" wx:for-index="position">{{group.title}}/{{cell}}/{{position}}</view></block>', { pageLayout: true });
  assert.equal(renderTemplate(tree, { groups: [{ title: "资料", cells: ["一", "二"] }] }), '<div>资料/一/0</div><div>资料/二/1</div>');
});

test("page controls are inert placeholders and self-closing elements preserve siblings", () => {
  const tree = parseTemplate('<label><checkbox checked="{{true}}" bindtap="write"/><text>清单</text></label><switch/><view>末尾</view>', { pageLayout: true });
  const html = renderTemplate(tree, {});
  assert.equal((html.match(/probe-inert-control/g) || []).length, 2); assert(!html.includes("write"));
  assert(html.includes('<span>清单</span></label>')); assert(html.endsWith('<div>末尾</div>'));
});

test("page scroll emulation is explicit and inline rpx values are scaled", () => {
  const html = renderTemplate(parseTemplate('<scroll-view class="compare-scroll"><view style="width: {{size}}rpx;">表格</view></scroll-view>', { pageLayout: true }), { size: 800 });
  assert(html.includes('data-probe-scroll="true"')); assert(cssForBrowser(html, 375, 1).includes('width: 400px'));
});

test("page mode still refuses network media and active markup", () => {
  for (const tag of ["image", "script", "iframe", "web-view", "input"])
    assert.throws(() => parseTemplate(`<${tag}/>`, { pageLayout: true }));
  assert.throws(() => parseTemplate('<switch/>'));
});

test("quoted comparison operators do not terminate a template tag", () => {
  const template = '<view wx:if="{{count >= 2}}">多项</view><view wx:elif="{{count < 2}}">少项</view>';
  assert.equal(renderTemplate(parseTemplate(template), { count: 4 }), '<div>多项</div>');
  assert.equal(renderTemplate(parseTemplate(template), { count: 1 }), '<div>少项</div>');
});

test("reading page buttons retain flexible labels and a 48px layout lower bound", () => {
  for (const [file, selector] of [["pages/plan/plan.wxss", "plan-page"], ["pages/compare/compare.wxss", "compare-page"],
    ["subpackages/catalog/detail/detail.wxss", "detail-page"]]) {
    const css = fs.readFileSync(path.resolve(__dirname, "../../zhongyi", file), "utf8");
    const block = css.match(new RegExp("\\." + selector + " button\\s*\\{([^}]+)\\}"))[1];
    for (const declaration of ["min-width: 48px", "min-height: 48px", "white-space: normal", "overflow-wrap: anywhere"])
      assert(block.includes(declaration));
  }
});

test("official pages retain flexible touch controls and wrapping review/source rows", () => {
  for (const [file, selector] of [
    ["subpackages/official/official-plans/official-plans.wxss", "official-plans-page"],
    ["subpackages/official/official-plan-detail/official-plan-detail.wxss", "plan-detail-page"]
  ]) {
    const css = fs.readFileSync(path.resolve(__dirname, "../../zhongyi", file), "utf8");
    const block = css.match(new RegExp("\\." + selector + " button\\s*\\{([^}]+)\\}"));
    assert(block, "page-specific controls must not fall back to undersized text buttons");
    for (const declaration of ["min-width: 48px", "min-height: 48px", "white-space: normal", "overflow-wrap: anywhere"])
      assert(block[1].includes(declaration));
    const layoutSelector = selector === "official-plans-page" ? "pending-card__head" : "source-row";
    assert(new RegExp("\\." + layoutSelector + "\\s*\\{[^}]*flex-wrap:\\s*wrap").test(css));
  }
});

test("detail actions reserve natural flow height instead of a fixed spacer", () => {
  const base = path.resolve(__dirname, "../../zhongyi/subpackages/catalog/detail");
  const css = fs.readFileSync(path.join(base, "detail.wxss"), "utf8"), template = fs.readFileSync(path.join(base, "detail.wxml"), "utf8");
  assert.match(css, /\.detail-actions\s*\{[^}]*position:\s*sticky/);
  assert(!css.includes("detail-actions-space")); assert(!template.includes("detail-actions-space"));
  assert.match(css, /\.fact-row\s*\{[^}]*min-width:\s*0/);
});

test("mobile compare intro resets its row flex basis when switching to a column", () => {
  const base = path.resolve(__dirname, "../../zhongyi/pages/compare");
  const css = fs.readFileSync(path.join(base, "compare.wxss"), "utf8");
  const template = fs.readFileSync(path.join(base, "compare.wxml"), "utf8");
  assert(template.includes('class="compare-intro"'));
  assert(!css.includes("view:first-child"), "native view selectors must also work in browser layout projections");
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.compare-intro\s*\{[^}]*flex:\s*0 1 auto/);
});

test("reading layout probe is a bounded offline command with explicit device limits", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../tools/check-mini-reading-layout.cjs"), "utf8");
  const scripts = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).scripts;
  assert.equal(scripts["test:mini-reading-layout"], "node tools/check-mini-reading-layout.cjs");
  assert(source.includes('process.argv.length, 2')); assert(source.includes('return route.abort()'));
  assert(source.includes('actualHarmonyosVerified: false')); assert(source.includes('initialFooterVisible !== false'));
});
