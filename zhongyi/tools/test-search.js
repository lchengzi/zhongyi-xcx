"use strict";

// Real catalogue and page functions; wx is simulated, with no network or health writes.
const assert = require("node:assert/strict");
const { test, beforeEach, afterEach, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../data/ingredients");
const filters = require("../utils/filter");
const { searchCatalog, filterCatalogText, searchMatchDisplay } = require("../utils/catalog-search");
const safety = require("../utils/safety");
const publicCatalog = require("../utils/public-catalog");
const storage = require("../utils/storage");
const privacy = require("../utils/privacy");
const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
let definition;
global.Page = (value) => { definition = value; };
require("../pages/index/index");
if (previous.Page === undefined) delete global.Page; else global.Page = previous.Page;
let app, writes, networkCalls, memory;
let instances = [];

function ids(query, profile = {}, options = {}, source = catalog.ingredients) {
  return searchCatalog(source, { ...options, query }, profile).map((item) => item.id);
}
function page() {
  const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  instance.setData = function (patch) { Object.assign(this.data, patch); };
  instance.onLoad(); instance.onShow();
  instances.push(instance);
  return instance;
}
function pendingSearch(instance, query) {
  const original = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let callback;
  try {
    global.setTimeout = (fn) => { callback = fn; return 1; };
    global.clearTimeout = () => {};
    instance.onSearchInput(searchEvent(instance, query));
  } finally { Object.assign(global, original); }
  assert.equal(typeof callback, "function");
  return callback;
}

function searchEvent(instance, value) {
  return { currentTarget: { dataset: { version: instance.data.interactionVersion, query: instance.data.query } }, detail: { value } };
}

test("homepage ignores malformed search payloads and stale input versions without throwing", () => {
  const instance = page();
  for (const event of [undefined, null, {}, { detail: {} }, searchEvent(instance, {}), searchEvent(instance, 7),
    { detail: { value: "old" }, currentTarget: { dataset: { version: -1 } } }]) {
    assert.doesNotThrow(() => instance.onSearchInput(event)); assert.equal(instance.data.query, "");
  }
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("homepage truncates the visible query as well as lookup to sixty characters", () => {
  const instance = page(); pendingSearch(instance, "x".repeat(100))();
  assert.equal(instance.data.query.length, 60); assert.equal(instance.data.filters.query.length, 60);
});

test("only the current search callback may refresh results or reset the expanded list", () => {
  const instance = page(), older = pendingSearch(instance, "dangshen"), current = pendingSearch(instance, "huangqi");
  const before = JSON.stringify(instance.data); let updates = 0; const setData = instance.setData;
  instance.setData = function (patch) { updates++; setData.call(this, patch); };
  older(); assert.equal(updates, 0); assert.equal(JSON.stringify(instance.data), before);
  current(); assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi"]);
  assert.equal(networkCalls, 0); assert.equal(writes, 0);
});

for (const action of ["clearSearch", "clearFiltersAndSearch"]) test(`${action} cancels old debounce even if its callback was already queued`, () => {
  const instance = page(), callback = pendingSearch(instance, "huangqi");
  instance[action](searchEvent(instance, "")); instance.loadMore();
  assert.equal(instance.data.visibleCount, 24);
  const before = JSON.stringify(instance.data); callback();
  assert.equal(instance.data.visibleCount, 24); assert.equal(JSON.stringify(instance.data), before);
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("keyboard confirmation immediately applies its bounded value and retires pending debounce", () => {
  const instance = page(), callback = pendingSearch(instance, "dangshen");
  instance.onSearchConfirm(searchEvent(instance, "HUÁNGQÍ"));
  assert.equal(instance.data.query, "HUÁNGQÍ"); assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi"]);
  let updates = 0; const setData = instance.setData; instance.setData = function (patch) { updates++; setData.call(this, patch); };
  callback(); assert.equal(updates, 0); assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("search confirmation and input from before hide cannot overwrite the returned page", () => {
  const instance = page(), old = searchEvent(instance, "stale");
  pendingSearch(instance, "huangqi")(); instance.onHide(); instance.onShow();
  instance.onSearchInput(old); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, "huangqi"); assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi"]);
  instance.onSearchConfirm(searchEvent(instance, "dangshen")); assert.deepEqual(instance.data.rows.map(x => x.id), ["dang-shen"]);
});

test("queued raw input cannot recreate a search after privacy deletion, even on repeated delivery", () => {
  const instance = page(), old = searchEvent(instance, "FICTIONAL_PRIVATE_SEARCH");
  assert.equal(privacy.clearAllLocalData(app).ok, true);
  instance.onSearchInput(old); instance.onSearchInput(old); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, ""); assert.equal(instance.data.resultCount, 106);
  pendingSearch(instance, "huangqi")(); assert.equal(instance.data.rows[0].id, "huang-qi");
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

for (const action of ["clearSearch", "clearFiltersAndSearch"]) test(`${action} rejects a clear button rendered for an older query`, () => {
  const instance = page(); pendingSearch(instance, "dangshen")(); const older = searchEvent(instance, "");
  pendingSearch(instance, "huangqi")(); instance[action](older);
  assert.equal(instance.data.query, "huangqi"); assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi"]);
  instance[action](searchEvent(instance, "")); assert.equal(instance.data.query, ""); assert.equal(instance.data.resultCount, 106);
});

test("explicit clear invalidates queued input while allowing newly rendered input", () => {
  const instance = page(); pendingSearch(instance, "huangqi")(); const old = searchEvent(instance, "dangshen");
  instance.clearSearch(searchEvent(instance, "")); instance.onSearchInput(old);
  assert.equal(instance.data.query, ""); pendingSearch(instance, "dangshen")(); assert.equal(instance.data.rows[0].id, "dang-shen");
});

test("filter removal accepts only currently displayed chips and preserves query and safety", () => {
  const instance = page(); instance.setData({ query: "huangqi", filters: filters.cleanFilters({ onlySourceChecked: true }) }); instance.applyFilters();
  const before = JSON.stringify(instance.data), profile = JSON.stringify(app.globalData.sessionSafetyProfile);
  for (const event of [undefined, {}, { currentTarget: { dataset: { version: -1, key: "onlySourceChecked", value: true } } },
    { currentTarget: { dataset: { version: instance.data.interactionVersion, key: "__proto__", value: "bad" } } }]) {
    assert.doesNotThrow(() => instance.removeChip(event)); assert.equal(JSON.stringify(instance.data), before);
  }
  instance.removeChip({ currentTarget: { dataset: { version: instance.data.interactionVersion, key: "onlySourceChecked", value: true } } });
  assert.equal(instance.data.filters.onlySourceChecked, false); assert.equal(instance.data.query, "huangqi");
  assert.equal(JSON.stringify(app.globalData.sessionSafetyProfile), profile); assert.equal(writes, 0);
});

test("filter-only clear retains query, retires search callbacks and requires the current control", () => {
  const instance = page(); instance.setData({ filters: filters.cleanFilters({ onlySourceChecked: true }) }); instance.applyFilters();
  const callback = pendingSearch(instance, "huangqi");
  instance.clearFilters({ currentTarget: { dataset: { version: -1 } } }); assert.equal(instance.data.filters.onlySourceChecked, true);
  instance.clearFilters(searchEvent(instance, "")); assert.equal(instance.data.filters.onlySourceChecked, false); assert.equal(instance.data.query, "huangqi");
  const before = JSON.stringify(instance.data); callback(); assert.equal(JSON.stringify(instance.data), before);
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("homepage template binds current search input, keyboard confirmation and clear query snapshot", () => {
  const wxml = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  const input = wxml.match(/<input\b[^>]*\bclass="search-input"[^>]*>/)[0];
  assert.match(input, /bindconfirm="onSearchConfirm"/); assert.match(input, /data-version="\{\{interactionVersion\}\}"/);
  for (const name of ["clearSearch", "clearFiltersAndSearch"]) {
    const button = wxml.match(new RegExp(`<button\\b[^>]*bindtap="${name}"[^>]*>`))[0];
    assert.match(button, /data-version="\{\{interactionVersion\}\}"/); assert.match(button, /data-query="\{\{query\}\}"/);
  }
});

for (const [label, fields, query, expected] of [
  ["canonical name", { name: "测试名称" }, "测 试", "名称命中：测试名称"],
  ["pinyin spelling", { pinyin: "huáng qí" }, "HUANGQI", "拼音命中：huáng qí"],
  ["Latin name", { identity: { latinName: "Cornus officinalis" } }, "CORNUS", "拉丁名命中：Cornus officinalis"],
  ["part", { identity: { ediblePart: "干燥块根" } }, "块根", "目录记录部位命中：干燥块根"],
  ["plant name", { identity: { plantNames: ["测试原植物"] } }, "原植物", "原植物名称命中：测试原植物"],
  ["alias", { aliases: ["测试别称"] }, "别称", "别名命中：测试别称"],
  ["tag", { tags: ["测试标签"] }, "标签", "资料标签命中：测试标签"],
  ["topic", { goals: ["测试主题"] }, "主题", "资料主题命中：测试主题"],
  ["form", { usageTypes: ["测试形式"] }, "形式", "食用形式标签命中：测试形式"],
  ["sensory", { sensory: { tastes: ["测试感官"] } }, "感官", "感官标签命中：测试感官"]
]) {
  test(`search explanation uses the actual ${label} field`, () => {
    const item = { id: "fixture", ...fields };
    assert.deepEqual(filterCatalogText([item], query), [item]);
    const result = searchMatchDisplay(item, query);
    assert.equal(result.searchMatchText, expected);
    assert.equal(Boolean(result.searchMatchNote), label === "alias");
  });
}

test("all recorded searchable fields still match and have a non-mutating field explanation", () => {
  const before = JSON.stringify(catalog);
  for (const item of catalog.ingredients) {
    const identity = item.identity || {}, sensory = item.sensory || {};
    const queries = [item.name, item.pinyin, identity.latinName, identity.ediblePart,
      ...(identity.plantNames || []), ...(item.aliases || []), ...(item.tags || []),
      ...(item.goals || []), ...(item.usageTypes || []), ...(sensory.tastes || [])];
    for (const query of queries.filter(v => typeof v === "string" && v.trim())) {
      assert.equal(filterCatalogText([item], query)[0], item, `${item.id}: ${query}`);
      assert(searchMatchDisplay(item, query).searchMatchText, `${item.id}: missing explanation`);
    }
    assert.match(searchMatchDisplay(item, item.pinyin.replace(/\s+/g, "")).searchMatchText, /^拼音命中：/);
  }
  assert.equal(JSON.stringify(catalog), before); assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("search explanation omits empty, unmatched and private input and has stable name priority", () => {
  const item = { name: "黄芪", pinyin: "huang qi", aliases: ["黄芪"], secret: "SECRET_HEALTH",
    identity: { secret: "SECRET_HEALTH" }, sources: [{ title: "SECRET_HEALTH" }] };
  for (const query of [null, {}, 42, "", "  ", "SECRET_HEALTH", "huang.*qi", "黄芪 huang"]) {
    assert.deepEqual(searchMatchDisplay(item, query), { searchMatchText: "", searchMatchNote: "" });
  }
  for (const value of [null, undefined, 42, "invalid"]) assert.equal(searchMatchDisplay(value, "黄芪").searchMatchText, "");
  assert.deepEqual(searchMatchDisplay(item, "黄芪"), { searchMatchText: "名称命中：黄芪", searchMatchNote: "" });
});

test("homepage alias explanation warns about processing without changing safety or release state", () => {
  const instance = page(); pendingSearch(instance, "熟地黄")();
  assert.deepEqual(instance.data.rows.map(v => v.id), ["di-huang"]);
  const row = instance.data.rows[0];
  assert.equal(row.searchMatchText, "别名命中：熟地黄（公告所述加工品）");
  assert.match(row.searchMatchNote, /不表示不同部位或加工形态相同、可替代/);
  const item = catalog.ingredients.find(v => v.id === row.id);
  const expected = require("../utils/format").cardView(item, [], [], safety.evaluateIngredient(item, {}));
  assert.equal(row.safetyLabel, expected.safetyLabel); assert.equal(row.blockedReason, expected.reasonText);
  assert.equal(item.audit.professionalReviewState, "pending");
  instance.clearSearch(searchEvent(instance, ""));
  assert(instance.data.rows.every(v => !v.searchMatchText && !v.searchMatchNote));
  pendingSearch(instance, "huangqi")();
  assert.equal(instance.data.rows[0].searchMatchText, "拼音命中：huang qi");
  assert.equal(instance.data.rows[0].searchMatchNote, "");
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("search explanation stays visible on compact cards and is not conditionally a safety approval", () => {
  const wxml = fs.readFileSync(path.join(__dirname, "../components/ingredient-card/ingredient-card.wxml"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../components/ingredient-card/ingredient-card.wxss"), "utf8");
  assert.match(wxml, /wx:if="{{item.searchMatchText}}"/);
  assert.match(wxml, /wx:if="{{item.searchMatchNote}}"/);
  assert(!/\.ingredient-card--compact\s+\.ingredient-card__search/.test(css));
  assert.match(css, /\.ingredient-card__search-match\s*\{[^}]*overflow-wrap: anywhere/);
});
beforeEach(() => {
  instances = [];
  app = { globalData: { sessionSafetyProfile: {}, sessionRecipeAcknowledgements: {} } };
  writes = 0; networkCalls = 0; memory = {};
  global.getApp = () => app;
  global.wx = {
    getStorageSync: (key) => memory[key] || "",
    setStorageSync: (key, value) => { writes += 1; memory[key] = value; },
    getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
    removeStorageSync: (key) => { delete memory[key]; },
    request: () => { networkCalls += 1; throw new Error("search must stay local"); },
    showToast() {}, showTabBar() {}, hideTabBar() {}
  };
  storage.setChecklist({}); publicCatalog.clear();
});
afterEach(() => { for (const instance of instances) instance.onUnload(); });
after(() => {
  storage.setChecklist({}); publicCatalog.clear();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});

for (const [label, query] of [
  ["canonical Chinese", "黄芪"],
  ["stored pinyin", "huang qi"],
  ["joined pinyin", "huangqi"],
  ["uppercase joined pinyin", "HUANGQI"],
  ["tone-marked pinyin", "huáng qí"],
  ["decomposed tone marks", "hua\u0301ng qi\u0301"],
  ["full-width pinyin", "ＨＵＡＮＧ　ＱＩ"],
  ["repeated whitespace", "huang\t  qi"],
  ["hyphenated pinyin", "huang-qi"],
  ["apostrophe-separated pinyin", "huang’qi"],
  ["spaced Chinese", "黄　芪"]
]) {
  test(`search finds the existing Huangqi record using ${label}`, () => {
    assert.deepEqual(ids(query), ["huang-qi"]);
  });
}

test("Chinese alias spacing uses only existing fields, not invented aliases", () => {
  assert.deepEqual(ids("枸 杞"), ["gou-qi-zi"]);
  assert.deepEqual(ids("熟地黄"), ["di-huang"]);
  assert.deepEqual(ids("生地黄"), []);
});

test("Latin names accept case and repeated spacing, not stripped word boundaries or accents", () => {
  assert.deepEqual(ids("  CORNUS   OFFICINALIS  "), ["shan-zhu-yu"]);
  assert.deepEqual(ids("Cornusofficinalis"), []);
  assert.deepEqual(ids("Córnus officinalis"), []);
});

test("literal query does not join separate name, pinyin or metadata fields", () => {
  assert.deepEqual(ids("黄芪 huang"), []);
});

test("all 106 historical records remain searchable by their existing joined pinyin", () => {
  for (const item of catalog.ingredients) {
    const query = item.pinyin.replace(/\s+/g, "");
    assert(query, `missing pinyin for ${item.id}`);
    assert(ids(query).includes(item.id), `joined pinyin missed ${item.id}`);
  }
});

test("umlaut pinyin remains distinct from u; v and u-colon are spelling forms only", () => {
  const base = catalog.ingredients.find((item) => item.id === "huang-qi");
  const fixture = [
    { ...base, id: "fixture-lv", name: "测试甲", pinyin: "lü dou", aliases: [], identity: {}, goals: [], tags: [], usageTypes: [] },
    { ...base, id: "fixture-lu", name: "测试乙", pinyin: "lu dou", aliases: [], identity: {}, goals: [], tags: [], usageTypes: [] }
  ];
  for (const query of ["lǜdòu", "lv dou", "lu: dou", "lu\u0308\u0300 dou"]) {
    assert.deepEqual(ids(query, {}, {}, fixture), ["fixture-lv"]);
  }
  assert.deepEqual(ids("ludou", {}, {}, fixture), ["fixture-lu"]);
});

test("empty normalized pinyin and query metacharacters never match everything", () => {
  const base = catalog.ingredients.find((item) => item.id === "huang-qi");
  const clean = { ...base, aliases: [], identity: {}, goals: [], tags: [], usageTypes: [], sensory: {} };
  const fixture = [
    { ...clean, id: "fixture-literal", name: "测试甲", tags: ["literal%_"] },
    { ...clean, id: "fixture-control", name: "测试乙" }
  ];
  for (const query of ["--", "''", "huang.*qi", "[huangqi]"]) assert.deepEqual(ids(query, {}, {}, fixture), []);
  // These characters may legitimately occur in tags; they are literal, not SQL wildcards.
  for (const query of ["%", "_"]) assert.deepEqual(ids(query, {}, {}, fixture), ["fixture-literal"]);
});

test("search spelling never bypasses red flags, population or explicit allergy blocks", () => {
  for (const query of ["黄芪", "huangqi", "huáng qí", "ＨＵＡＮＧＱＩ"]) {
    assert.deepEqual(ids(query, { redFlags: ["sudden_severe_chest_pain"] }), []);
    assert.deepEqual(ids(query, { pregnancy: "yes" }), []);
    assert.deepEqual(ids(query, { allergies: ["黄芪"], allergyStatus: "yes" }), []);
  }
  for (const profile of [{}, { ageGroup: "child" }, { pregnancy: "yes" }, { medications: ["藜芦"], medicationStatus: "yes" }, { redFlags: ["sudden_severe_chest_pain"] }]) {
    const eligible = new Set(filters.applyCatalogFilters(catalog.ingredients, {}, profile).map((item) => item.id));
    for (const query of ["huangqi", "天", "root", "gouqizi", ""]) {
      assert(ids(query, profile).every((id) => eligible.has(id)), "search adapter exceeded the original safety-filter result");
    }
  }
});

test("other filters and source-check restriction still apply after normalized search", () => {
  const item = catalog.ingredients.find((value) => value.id === "huang-qi");
  assert.deepEqual(ids("huangqi", {}, { categories: [item.category], onlySourceChecked: true }), [item.id]);
  assert.deepEqual(ids("huangqi", {}, { categories: ["nonexistent-category"] }), []);
});

test("normalization changes neither input, catalogue, risk evaluations nor release metadata", () => {
  const input = { query: "  HUÁNG QÍ  ", categories: [] };
  const before = JSON.stringify(catalog);
  const beforeRisk = safety.evaluateIngredient(catalog.ingredients.find((item) => item.id === "huang-qi"), {});
  assert.deepEqual(searchCatalog(catalog.ingredients, input, {}).map((item) => item.id), ["huang-qi"]);
  assert.deepEqual(input, { query: "  HUÁNG QÍ  ", categories: [] });
  assert.equal(JSON.stringify(catalog), before);
  assert.deepEqual(safety.evaluateIngredient(catalog.ingredients.find((item) => item.id === "huang-qi"), {}), beforeRisk);
  assert.equal(catalog.ingredients.find((item) => item.id === "huang-qi").audit.professionalReviewState, "pending");
});

test("missing Unicode normalize support falls back without blocking ordinary or tone-marked search", () => {
  const normalize = String.prototype.normalize;
  try {
    String.prototype.normalize = undefined;
    assert.deepEqual(ids("黄芪"), ["huang-qi"]);
    assert.deepEqual(ids("huangqi"), ["huang-qi"]);
    assert.deepEqual(ids("huáng qí"), ["huang-qi"]);
  } finally { String.prototype.normalize = normalize; }
});

test("query limit and canonical name sorting stay unchanged", () => {
  assert.equal(filters.cleanFilters({ query: "x".repeat(200) }).query.length, 60);
  assert.deepEqual(ids(" "), catalog.ingredients.slice().sort((a, b) => a.order - b.order).map((item) => item.id));
  const result = searchCatalog(catalog.ingredients, { sort: "name" }, {});
  assert.deepEqual(result.map((item) => item.id), result.slice().sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).map((item) => item.id));
});

test("real homepage debounce uses normalized lookup while preserving typed text and staying offline", () => {
  const instance = page(); const callback = pendingSearch(instance, "HUÁNGQÍ"); callback();
  assert.deepEqual(instance.data.rows.map((item) => item.id), ["huang-qi"]);
  assert.equal(instance.data.query, "HUÁNGQÍ");
  assert.equal(instance.data.resultCount, 1);
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
  assert.deepEqual(storage.getFavorites(), []);
  assert.deepEqual(storage.getCompare(), []);
});

test("real homepage applies current safety state before the delayed search result", () => {
  const instance = page(); const callback = pendingSearch(instance, "huangqi");
  app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] }; callback();
  assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.rows, []);
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("a delayed normalized search cannot restore deleted query or private data", () => {
  const instance = page(); const callback = pendingSearch(instance, "huángqí");
  assert.equal(privacy.clearAllLocalData(app).ok, true); callback();
  assert.equal(instance.data.query, "");
  assert.equal(instance.data.resultCount, 106);
  assert.equal(writes, 0); assert.equal(networkCalls, 0);
});

test("homepage input length matches the actual lookup limit", () => {
  const wxml = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  const input = wxml.match(/<input\b[^>]*\bclass="search-input"[^>]*>/);
  assert(input); assert.match(input[0], /\bmaxlength="60"/);
});

test("local evidence must be excluded as a folder, not a misleading file ignore", () => {
  const { checkUploadIgnoreBoundary } = require("./check-project");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../project.config.json"), "utf8"));
  assert.doesNotThrow(() => checkUploadIgnoreBoundary(config));
  const removed = JSON.parse(JSON.stringify(config));
  removed.packOptions.ignore = removed.packOptions.ignore.filter((item) => item.value !== ".local");
  assert.throws(() => checkUploadIgnoreBoundary(removed), /missing \.local \(folder\)/);
  const wrongType = JSON.parse(JSON.stringify(config));
  wrongType.packOptions.ignore.find((item) => item.value === ".local").type = "file";
  assert.throws(() => checkUploadIgnoreBoundary(wrongType), /missing \.local \(folder\)/);
});

test("actual source traversal excludes local test reports and other private roots", () => {
  const { walk } = require("./check-project");
  const root = path.resolve(__dirname, ".."); const files = walk(root);
  assert(files.includes(path.join(root, "utils/catalog-search.js")));
  for (const file of files) assert(!/^(?:\.local|content-private|tools|docs)(?:\/|$)/.test(path.relative(root, file).replace(/\\/g, "/")));
});

test("runtime imports cannot reference excluded private recipe data even when the file exists", () => {
  const { walk, checkRuntimePackageImports } = require("./check-project");
  const root = path.resolve(__dirname, "..");
  const files = walk(root).filter((file) => file !== path.join(root, "data/recipes.js"));
  assert.doesNotThrow(() => checkRuntimePackageImports(files));
  const evidence = path.join(root, "data/recipes.js");
  assert(fs.existsSync(evidence)); assert(!files.includes(evidence));
  const source = path.join(root, "utils/catalog-search.js"); const readFileSync = fs.readFileSync;
  try {
    // Inject only the read of an existing runtime module; do not write a payload to disk.
    fs.readFileSync = function (file, ...args) {
      if (file === source) return 'require("../data/recipes")';
      return readFileSync.call(this, file, ...args);
    };
    assert.throws(() => checkRuntimePackageImports(files), /excluded file/);
  } finally { fs.readFileSync = readFileSync; }
});
