"use strict";

// Actual page functions, controlled wx interfaces and fictional data only.
const assert = require("node:assert/strict");
const { test, beforeEach, after } = require("node:test");
const storage = require("../utils/storage");
const privacy = require("../utils/privacy");
const publicCatalog = require("../utils/public-catalog");
const platformUi = require("../utils/platform-ui");
const recipes = require("../data/recipes-public");
const fs = require("node:fs");
const path = require("node:path");
const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
const definitions = {};
for (const [name, modulePath] of [
  ["index", "../pages/index/index"],
  ["directory", "../subpackages/official/official-plans/official-plans"],
  ["detail", "../subpackages/official/official-plan-detail/official-plan-detail"]
]) {
  global.Page = (value) => { definitions[name] = value; };
  require(modulePath);
}
if (previous.Page === undefined) delete global.Page; else global.Page = previous.Page;
const previousComponent = global.Component;
let component;
global.Component = (value) => { component = value; };
require("../components/ingredient-card/ingredient-card");
if (previousComponent === undefined) delete global.Component; else global.Component = previousComponent;
let app, memory, writes, clipboard, navigations, titles;
const id = "dang-shen";
const recipeId = "black-bean-huangqi-goji-soup";
const targetId = "adult_diabetes";
const card = { detail: { id, interactionVersion: 0 } };
const target = { currentTarget: { dataset: { id: targetId } } };
function page(name, options = { id: recipeId }) {
  const result = { ...definitions[name], data: JSON.parse(JSON.stringify(definitions[name].data)) };
  result.setData = function (patch) { Object.assign(this.data, patch); };
  if (result.onLoad) result.onLoad(name === "index" ? {} : options);
  result.onShow();
  return result;
}
function redFlag() { app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] }; }
function connectionEvent(instance) { return { currentTarget: { dataset: { version: instance.data.interactionVersion } } }; }

test("catalog cards across every page expose the recorded part and review state without new writes", () => {
  const display = require("../utils/food-display"), catalog = require("../data/ingredients");
  const instance = page("index");
  for (let n = 0; n < 12 && instance.data.hasMore; n++) instance.loadMore();
  assert.equal(instance.data.rows.length, 106);
  for (const item of instance.data.rows) {
    const source = catalog.ingredients.find(x => x.id === item.id), expected = display.foodIdentityDisplay(source);
    assert.equal(item.partText, expected.partText); assert.equal(item.partReviewText, expected.partReviewText);
  }
  assert.equal(writes, 0); assert.deepEqual(navigations, []); assert.deepEqual(clipboard, []);
});

test("catalog pending identity text remains pending rather than inferred from the name", async () => {
  const instance = page("index"); instance.onSearchInput({ ...connectionEvent(instance), detail: { value: "枸杞子" } });
  await new Promise(resolve => setTimeout(resolve, 200));
  const goji = instance.data.rows.find(r => r.id === "gou-qi-zi");
  assert(goji); assert.equal(goji.partReviewText, "部位资料待复核"); assert(goji.partText.includes("待发布前复核"));
});

test("usage guide starts collapsed and explicit toggles only change local display state", () => {
  const instance = page("index");
  assert.equal(instance.data.usageGuideOpen, false);
  const before = JSON.stringify(instance.data.rows), session = JSON.stringify(app.globalData);
  instance.toggleUsageGuide(connectionEvent(instance)); assert.equal(instance.data.usageGuideOpen, true);
  instance.toggleUsageGuide(connectionEvent(instance)); assert.equal(instance.data.usageGuideOpen, false);
  assert.equal(JSON.stringify(instance.data.rows), before); assert.equal(JSON.stringify(app.globalData), session);
  assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(navigations, []);
});

test("usage guide rejects malformed and old controls including replay of the same toggle", () => {
  const instance = page("index"), old = connectionEvent(instance);
  for (const event of [undefined, null, {}, { currentTarget: { dataset: {} } },
    { currentTarget: { dataset: { version: String(instance.data.interactionVersion) } } }]) {
    assert.doesNotThrow(() => instance.toggleUsageGuide(event)); assert.equal(instance.data.usageGuideOpen, false);
  }
  instance.toggleUsageGuide(old); assert.equal(instance.data.usageGuideOpen, true);
  instance.toggleUsageGuide(old); assert.equal(instance.data.usageGuideOpen, true);
});

test("usage guide survives ordinary return but hidden and unloaded controls do not execute", () => {
  const instance = page("index"); instance.toggleUsageGuide(connectionEvent(instance)); const old = connectionEvent(instance);
  instance.onHide(); instance.toggleUsageGuide(old); instance.openUsagePrivacy(old); assert.equal(instance.data.usageGuideOpen, true);
  instance.onShow(); instance.toggleUsageGuide(old); assert.equal(instance.data.usageGuideOpen, true);
  instance.toggleUsageGuide(connectionEvent(instance)); assert.equal(instance.data.usageGuideOpen, false);
  instance.onUnload(); instance.setData = () => assert.fail("unloaded usage guide updated the view");
  instance.toggleUsageGuide(old); instance.openUsagePrivacy(old); assert.deepEqual(navigations, []); assert.equal(writes, 0);
});

test("privacy deletion closes usage guide and rejects controls from the deleted session", () => {
  const instance = page("index"); instance.toggleUsageGuide(connectionEvent(instance)); const old = connectionEvent(instance);
  clearPrivate(); instance.onShow(); assert.equal(instance.data.usageGuideOpen, false);
  instance.toggleUsageGuide(old); instance.openUsagePrivacy(old);
  assert.equal(instance.data.usageGuideOpen, false); assert.deepEqual(navigations, []); assert.equal(writes, 0);
});

test("red flags close optional usage help and keep its controls inactive", () => {
  const instance = page("index"); instance.toggleUsageGuide(connectionEvent(instance)); const old = connectionEvent(instance);
  redFlag(); instance.toggleUsageGuide(old); instance.openUsagePrivacy(old);
  assert.equal(instance.data.triageBlocked, true); assert.equal(instance.data.usageGuideOpen, false);
  assert.deepEqual(instance.data.rows, []); assert.deepEqual(navigations, []); assert.equal(writes, 0);
});

test("guide is readable with unknown local records without restoring IDs or performing any network read", () => {
  const originalRead = wx.getStorageSync, originalLoad = publicCatalog.load; let reads = 0;
  try {
    wx.getStorageSync = () => { throw new Error("fictional read failure"); };
    publicCatalog.load = () => { reads += 1; throw new Error("guide must not connect"); };
    const instance = page("index"); assert(instance.data.storageIssue);
    instance.toggleUsageGuide(connectionEvent(instance)); assert.equal(instance.data.usageGuideOpen, true);
    assert(instance.data.rows.length > 0); assert.equal(instance.data.favoriteCount, null);
    assert.equal(instance.data.compareCount, null); assert.equal(reads, 0); assert.equal(writes, 0);
  } finally { wx.getStorageSync = originalRead; publicCatalog.load = originalLoad; }
});

test("privacy help entry requires a current open guide and uses existing guarded navigation", () => {
  const instance = page("index"); instance.openUsagePrivacy(connectionEvent(instance)); assert.deepEqual(navigations, []);
  const old = connectionEvent(instance); instance.toggleUsageGuide(old); instance.openUsagePrivacy(old); assert.deepEqual(navigations, []);
  instance.openUsagePrivacy(connectionEvent(instance)); instance.openUsagePrivacy(connectionEvent(instance));
  assert.equal(navigations.length, 1); assert.equal(navigations[0].url, "/pages/privacy/privacy");
  assert.equal(writes, 0); assert.deepEqual(clipboard, []);
});

test("guide controls behind safety or filter overlays cannot toggle or navigate", () => {
  for (const overlay of ["openSafety", "openFilters"]) {
    const instance = page("index"); instance.toggleUsageGuide(connectionEvent(instance)); instance[overlay]();
    instance.toggleUsageGuide(connectionEvent(instance)); instance.openUsagePrivacy(connectionEvent(instance));
    assert.equal(instance.data.usageGuideOpen, true); assert.deepEqual(navigations, []); instance.onUnload();
  }
});

test("usage guide presents the full browsing loop and explains real display labels without a forced modal", () => {
  const template = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../pages/index/index.js"), "utf8");
  const guide = template.match(/<view wx:if="\{\{!triageBlocked\}\}" class="usage-guide card">([\s\S]*?)<\/block>\s*<\/view>/);
  assert(guide, "optional help is inside a non-triage branch");
  for (const label of ["使用指南与状态说明", "查找与看部位", "收藏与资料对照", "安全问项与咨询", "名称有官方目录来源",
    "来源已核对，专业审校待完成", "未命中已知阻止项", "需先确认", "不代表适合个人食用", "查找食材、管理收藏、对照资料", "不填也能浏览"]) {
    assert(guide[1].includes(label), label);
  }
  assert(guide[1].includes('wx:if="{{usageGuideOpen}}"'));
  for (const handler of ["toggleUsageGuide", "openUsagePrivacy"]) {
    assert(new RegExp(`<button[^>]*bindtap="${handler}"[^>]*data-version="\\{\\{interactionVersion\\}\\}"`).test(guide[1]));
  }
  const handlers = source.slice(source.indexOf("  toggleUsageGuide("), source.indexOf("  readServiceCatalog("));
  for (const forbidden of ["showModal", "publicCatalog.load", "setStorageSync", "setClipboardData"]) assert(!handlers.includes(forbidden));
});
test("home copy stays concise without removing the educational boundary", () => {
  const template = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  for (const phrase of ["这里只", "只收录", "无需登录", "不必填写健康信息"]) assert(!template.includes(phrase), phrase);
  assert(template.includes("非医疗 · 食养教育"));
  assert(template.includes("食材知识供学习参考，不用于诊断、治疗或处方指导。"));
  assert(template.includes("非最新目录 · 待专业审校"));
});
function clearPrivate() { assert.equal(privacy.clearAllLocalData(app).ok, true); }
function assertDetailEmpty(instance) {
  assert.equal(instance.data.recipe, null); assert.equal(instance.data.target, null);
  assert.equal(instance.data.evaluation, null);
  for (const key of ["sourceRows", "ingredientRows", "stepRows"]) assert.deepEqual(instance.data[key], []);
  assert.deepEqual(instance.sourceById, {});
}
beforeEach(() => {
  app = { globalData: { sessionSafetyProfile: {}, sessionRecipeAcknowledgements: {} } };
  memory = {}; writes = 0; clipboard = []; navigations = []; titles = [];
  global.getApp = () => app;
  global.wx = {
    getStorageSync: (key) => memory[key] || "",
    setStorageSync: (key, value) => { writes += 1; memory[key] = value; },
    getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
    removeStorageSync: (key) => { delete memory[key]; },
    showToast() {}, showTabBar() {}, hideTabBar() {},
    setNavigationBarTitle: ({ title }) => titles.push(title),
    setClipboardData: ({ data }) => clipboard.push(data),
    navigateTo: (options) => navigations.push(options),
    switchTab: (options) => navigations.push(options)
  };
  storage.setChecklist({}); publicCatalog.clear();
});
after(() => {
  storage.setChecklist({}); publicCatalog.clear();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});

for (const action of ["toggleFavorite", "toggleCompare", "openDetail", "openOfficialPlans"]) {
  test(`home ${action} rechecks committed red flags rather than the cached card`, () => {
    const instance = page("index"); redFlag(); instance[action](card);
    assert.equal(writes, 0); assert.deepEqual(navigations, []);
    assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.rows, []);
  });
}
test("home additions re-evaluate new age restrictions", () => {
  const instance = page("index");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.toggleFavorite(card); instance.toggleCompare(card);
  const current = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.toggleFavorite(current); instance.toggleCompare(current);
  assert.equal(writes, 0); assert.deepEqual(storage.getFavorites(), []); assert.deepEqual(storage.getCompare(), []);
});
test("old home card events do not immediately recreate IDs after privacy deletion", () => {
  const instance = page("index"); clearPrivate(); instance.toggleFavorite(card);
  assert.equal(writes, 0); assert.deepEqual(storage.getFavorites(), []);
  // All queued old events stay invalid, not only the first one after deletion.
  instance.toggleFavorite(card); instance.toggleCompare(card); instance.openDetail(card);
  assert.equal(writes, 0); assert.deepEqual(navigations, []);
  // A new deliberate interaction from the refreshed component is allowed.
  instance.toggleFavorite({ detail: { id, interactionVersion: instance.data.interactionVersion } });
  assert.deepEqual(storage.getFavorites(), [id]);
});
test("home ignores malformed, nonexistent and no-longer-visible card events", () => {
  const instance = page("index"); instance.setData({ query: "不存在的资料xyz" }); instance.applyFilters();
  for (const event of [card, null, {}, { detail: { id: "missing" } }]) {
    instance.toggleFavorite(event); instance.toggleCompare(event); instance.openDetail(event);
  }
  assert.equal(writes, 0); assert.deepEqual(navigations, []);
});
for (const transition of ["onHide", "onUnload"]) test(`home ${transition} prevents late card actions and health input`, () => {
  const instance = page("index"); instance.openSafety(); instance[transition]();
  const profile = JSON.stringify(app.globalData.sessionSafetyProfile);
  instance.onSafetyTextInput({ currentTarget: { dataset: { key: "medicationText" } }, detail: { value: "fictional-secret" } });
  instance.applySafetyAndClose(); instance.toggleFavorite(card); instance.toggleCompare(card);
  assert.equal(JSON.stringify(app.globalData.sessionSafetyProfile), profile); assert.equal(writes, 0);
});
test("deleting privacy while a safety draft exists invalidates late apply and close", () => {
  const instance = page("index"); instance.openSafety();
  instance.onSafetyTextInput({ currentTarget: { dataset: { key: "medicationText" } }, detail: { value: "fictional-secret" } });
  instance.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } });
  clearPrivate(); instance.applySafetyAndClose(); instance.closeSafety();
  assert.deepEqual(app.globalData.sessionSafetyProfile.medications, []);
  assert.deepEqual(app.globalData.sessionSafetyProfile.redFlags, []);
  assert.equal(instance.data.medicationText, ""); assert.equal(instance.data.safetyOpen, false);
});
test("new authority during an open draft cannot be overwritten by an older apply", () => {
  const instance = page("index"); instance.openSafety();
  instance.onAgeGroupChange({ detail: { value: "adult" } }); redFlag();
  instance.applySafetyAndClose();
  assert.deepEqual(app.globalData.sessionSafetyProfile.redFlags, ["sudden_severe_chest_pain"]);
  assert.equal(instance.data.triageBlocked, true);
});
test("normal draft apply, cancel and conservative red-flag close remain usable", () => {
  const instance = page("index"); instance.openSafety();
  instance.onAgeGroupChange({ detail: { value: "adult" } }); instance.closeSafety();
  assert.notEqual(app.globalData.sessionSafetyProfile.ageGroup, "adult");
  instance.openSafety(); instance.onAgeGroupChange({ detail: { value: "adult" } }); instance.applySafetyAndClose();
  assert.equal(app.globalData.sessionSafetyProfile.ageGroup, "adult");
  instance.openSafety(); instance.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } }); instance.onHide();
  assert.equal(app.globalData.sessionSafetyProfile.redFlags.length, 1);
  instance.onShow(); instance.openSafety(); instance.onRedFlagChange({ detail: { value: [] } }); instance.applySafetyAndClose();
  assert.deepEqual(app.globalData.sessionSafetyProfile.redFlags, []);
});
test("home input arriving after the draft has closed is ignored", () => {
  const instance = page("index"); instance.openSafety(); instance.closeSafety();
  instance.onSafetyTextInput({ currentTarget: { dataset: { key: "allergyText" } }, detail: { value: "fictional-secret" } });
  instance.applySafetyAndClose(); assert.equal(instance.data.allergyText, "");
  assert.deepEqual(app.globalData.sessionSafetyProfile, {});
});
test("home cannot start an external read from a newly red-flagged session", () => {
  const instance = page("index"); let calls = 0; const original = publicCatalog.load;
  publicCatalog.load = () => { calls += 1; return Promise.resolve(publicCatalog.getState()); };
  try { redFlag(); instance.readServiceCatalog(connectionEvent(instance)); assert.equal(calls, 0); }
  finally { publicCatalog.load = original; }
});
test("pending home read cannot update the view after hiding then returning", async () => {
  const instance = page("index"); let resolve; const original = publicCatalog.load;
  publicCatalog.load = () => new Promise((done) => { resolve = done; });
  try {
    instance.readServiceCatalog(connectionEvent(instance)); instance.onHide(); instance.onShow();
    let updates = 0; instance.setData = () => { updates += 1; };
    resolve(); await Promise.resolve();
    assert.equal(updates, 0, "old request updated returned view");
  } finally { publicCatalog.load = original; }
});

test("directory rechecks red flags and removes cached target, acknowledgement and summary", () => {
  const instance = page("directory"); instance.selectTarget(target);
  redFlag(); instance.copyTargetSource();
  assert.deepEqual(clipboard, []); assert.equal(instance.data.selectedTarget, null);
  assert.equal(instance.data.selectedTargetId, ""); assert.equal(instance.data.diagnosisConfirmed, false);
  assert.equal(instance.data.triageBlocked, true);
});
test("directory cannot restore an old diagnosis acknowledgement after privacy deletion", () => {
  const instance = page("directory"); instance.selectTarget(target); clearPrivate();
  instance.onDiagnosisChange({ detail: { value: ["confirmed"] } });
  assert.deepEqual(app.globalData.sessionRecipeAcknowledgements, {});
  assert.equal(instance.data.selectedTarget, null);
});
test("directory never accepts diagnosis confirmation when no published card renders that control", () => {
  const instance = page("directory"); instance.selectTarget(target);
  assert.equal(instance.data.publishedCards.length, 0);
  instance.onDiagnosisChange({ detail: { value: ["confirmed"] } });
  assert.deepEqual(app.globalData.sessionRecipeAcknowledgements, {});
});
test("directory does not trust a stale or fabricated published card for navigation", () => {
  const instance = page("directory"); instance.selectTarget(target);
  instance.data.publishedCards = [{ id: recipeId, blocked: false }]; redFlag();
  instance.openDetail({ currentTarget: { dataset: { id: recipeId } } });
  assert.deepEqual(navigations, []);
});
for (const transition of ["onHide", "onUnload"]) test(`directory ${transition} ignores late selection, copy and confirmation`, () => {
  const instance = page("directory"); instance.selectTarget(target); instance[transition]();
  instance.selectTarget({ currentTarget: { dataset: { id: "adult_hypertension" } } });
  instance.onDiagnosisChange({ detail: { value: ["confirmed"] } }); instance.copyTargetSource();
  assert.deepEqual(clipboard, []); assert.deepEqual(app.globalData.sessionRecipeAcknowledgements, {});
});

for (const state of ["red-flag", "not-found", "withdrawn"]) test(`recipe detail ${state} clears all old caches and refuses source copy`, () => {
  const instance = page("detail"); const sourceId = instance.data.sourceRows[0].id;
  instance.data.ingredientRows = [{ id: "old" }]; instance.data.stepRows = ["old"];
  const recipe = recipes.recipes.find((item) => item.id === recipeId); const originalStatus = recipe.status;
  try {
    if (state === "red-flag") redFlag();
    if (state === "not-found") instance.id = "missing";
    if (state === "withdrawn") recipe.status = "withdrawn";
    instance.refresh(); assertDetailEmpty(instance);
    instance.copySource({ currentTarget: { dataset: { id: sourceId } } }); assert.deepEqual(clipboard, []);
  } finally { recipe.status = originalStatus; }
});
test("recipe detail source copy rechecks a red flag before any onShow", () => {
  const instance = page("detail"); const sourceId = instance.data.sourceRows[0].id;
  redFlag(); instance.copySource({ currentTarget: { dataset: { id: sourceId } } });
  assert.deepEqual(clipboard, []); assertDetailEmpty(instance);
});
for (const transition of ["onHide", "onUnload"]) test(`recipe detail ${transition} rejects late copy and refresh`, () => {
  const instance = page("detail"); const sourceId = instance.data.sourceRows[0].id; instance[transition]();
  instance.setData = () => assert.fail("hidden/disposed detail view updated");
  const before = titles.length;
  instance.copySource({ currentTarget: { dataset: { id: sourceId } } }); instance.refresh();
  assert.deepEqual(clipboard, []); assert.equal(titles.length, before);
});
test("recipe source metadata stays readable for a draft, but material and step rows remain empty", () => {
  const instance = page("detail"); const source = instance.data.sourceRows[0];
  instance.copySource({ currentTarget: { dataset: { id: source.id } } });
  assert.deepEqual(clipboard, [source.url]);
  assert.equal(instance.data.contentHidden, true); assert.deepEqual(instance.data.ingredientRows, []); assert.deepEqual(instance.data.stepRows, []);
});
test("explicit red-flag clearing recovers directory and draft detail without publishing", () => {
  const directory = page("directory"), detail = page("detail"); redFlag(); directory.onShow(); detail.onShow();
  app.globalData.sessionSafetyProfile = {}; directory.onShow(); detail.onShow();
  assert.equal(directory.data.triageBlocked, false); assert.equal(detail.data.triageBlocked, false);
  assert.equal(directory.data.publishableCount, 0); assert.equal(detail.data.contentHidden, true);
  assert.equal(detail.data.recipe.id, recipeId);
});

test("card component carries only the ID and rendered interaction version", () => {
  const events = [];
  const context = { data: { item: { id, privateValue: "fictional-secret" }, interactionVersion: 7 }, triggerEvent: (name, detail) => events.push({ name, detail }) };
  for (const method of ["openDetail", "toggleFavorite", "toggleCompare"]) component.methods[method].call(context);
  assert.deepEqual(events.map((item) => item.name), ["detail", "favorite", "compare"]);
  for (const event of events) assert.deepEqual(event.detail, { id, interactionVersion: 7 });
  const template = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  assert(template.includes('interaction-version="{{interactionVersion}}"'));
});
test("old card events stay invalid after hiding then returning, while new events still work", () => {
  const instance = page("index"); const old = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.onHide(); instance.onShow();
  for (let count = 0; count < 3; count += 1) { instance.toggleFavorite(old); instance.toggleCompare(old); }
  assert.equal(writes, 0);
  instance.toggleFavorite({ detail: { id, interactionVersion: instance.data.interactionVersion } });
  assert.deepEqual(storage.getFavorites(), [id]);
});
test("new restrictions remove a home row without silently deleting its saved IDs", () => {
  storage.setFavorites([id]); storage.setCompare([id]); writes = 0;
  const instance = page("index");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.onShow(); const current = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.toggleFavorite(current); instance.toggleCompare(current);
  assert(!instance.data.rows.some((item) => item.id === id));
  assert.deepEqual(storage.getFavorites(), [id]); assert.deepEqual(storage.getCompare(), [id]);
  assert.equal(writes, 0);
});
test("currently visible saved home rows remain removable", () => {
  storage.setFavorites([id]); storage.setCompare([id]);
  const instance = page("index"); const current = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.toggleFavorite(current); instance.toggleCompare(current);
  assert.deepEqual(storage.getFavorites(), []); assert.deepEqual(storage.getCompare(), []);
});
test("debounced home search cannot restore its old query after privacy deletion", async () => {
  const instance = page("index");
  instance.onSearchInput({ ...connectionEvent(instance), detail: { value: "fictional-private-search" } }); clearPrivate();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(instance.data.query, ""); assert.equal(instance.data.resultCount, 106);
  instance.onUnload();
});
test("malformed recipe startup options safely enter an empty state", () => {
  for (const options of [null, {}, { id: {} }, { id: "" }]) {
    const instance = page("detail", options); assert.equal(instance.data.notFound, true); assertDetailEmpty(instance);
  }
});

test("recipe sharing stays at the directory for drafts, red flags and disposed views", () => {
  const instance = page("detail"); const directory = "/subpackages/official/official-plans/official-plans";
  assert.equal(instance.onShareAppMessage().path, directory);
  redFlag(); assert.equal(instance.onShareAppMessage().path, directory);
  app.globalData.sessionSafetyProfile = {}; instance.onUnload();
  assert.equal(instance.onShareAppMessage().path, directory);
});

for (const failure of ["missing", "throws", "rejects"]) {
  function breakInterface(method) {
    if (failure === "missing") delete wx[method];
    if (failure === "throws") wx[method] = () => { throw new Error("FICTIONAL_PLATFORM_ERROR"); };
    if (failure === "rejects") wx[method] = (options) => options.fail({ errMsg: "FICTIONAL_PLATFORM_ERROR" });
  }
  test(`recipe title interface ${failure} cannot block draft loading or red-flag clearing`, () => {
    breakInterface("setNavigationBarTitle");
    const instance = page("detail");
    assert.equal(instance.data.recipe.id, recipeId); assert.equal(instance.data.contentHidden, true);
    assert.deepEqual(instance.data.ingredientRows, []); assert.deepEqual(instance.data.stepRows, []);
    redFlag(); assert.doesNotThrow(() => instance.onShow()); assertDetailEmpty(instance);
    assert.equal(instance.data.triageBlocked, true);
    app.globalData.sessionSafetyProfile = {}; instance.onShow();
    assert.equal(instance.data.recipe.id, recipeId); assert.equal(instance.data.contentHidden, true);
    assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(navigations, []);
  });

  test(`tab-bar interface ${failure} cannot block safety apply, red flags or privacy reset`, () => {
    breakInterface("hideTabBar"); breakInterface("showTabBar");
    const instance = page("index");
    assert.doesNotThrow(() => instance.openSafety()); assert.equal(instance.data.safetyOpen, true);
    instance.onAgeGroupChange({ detail: { value: "adult" } });
    assert.doesNotThrow(() => instance.applySafetyAndClose());
    assert.equal(instance.data.safetyOpen, false); assert.equal(app.globalData.sessionSafetyProfile.ageGroup, "adult");
    instance.openSafety(); instance.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } });
    assert.doesNotThrow(() => instance.closeSafety());
    assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.rows, []);
    assert.equal(app.globalData.sessionSafetyProfile.redFlags.length, 1);
    clearPrivate(); assert.doesNotThrow(() => instance.onShow());
    assert.equal(instance.data.safetyOpen, false); assert.equal(instance.data.allergyText, "");
    assert.equal(instance.data.triageBlocked, false); assert.equal(instance.data.resultCount, 106);
    assert.doesNotThrow(() => instance.onHide()); assert.doesNotThrow(() => instance.onUnload());
    assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(navigations, []);
  });
}

test("native UI wrappers preserve method context and only send presentation options", () => {
  const calls = [];
  for (const method of ["setNavigationBarTitle", "showTabBar", "hideTabBar"]) {
    wx[method] = function (options) { assert.equal(this, wx); calls.push({ method, options }); };
  }
  assert.equal(platformUi.setTitle("食养资料"), true);
  assert.equal(platformUi.setTabBarVisible(true), true); assert.equal(platformUi.setTabBarVisible(false), true);
  assert.deepEqual(calls.map((item) => item.method), ["setNavigationBarTitle", "showTabBar", "hideTabBar"]);
  assert.deepEqual(Object.keys(calls[0].options).sort(), ["fail", "title"]);
  for (const call of calls.slice(1)) assert.deepEqual(Object.keys(call.options).sort(), ["animation", "fail"]);
  for (const call of calls) { assert.equal(typeof call.options.fail, "function"); call.options.fail({}); }
  assert.equal(calls.length, 3, "cosmetic failure must not retry");
});

test("native UI wrappers reject malformed values without probing a platform method", () => {
  wx.setNavigationBarTitle = wx.showTabBar = wx.hideTabBar = () => assert.fail("unexpected platform invocation");
  for (const value of [undefined, null, {}, 5, "", "  "]) assert.equal(platformUi.setTitle(value), false);
  for (const value of [undefined, null, {}, 1, "true"]) assert.equal(platformUi.setTabBarVisible(value), false);
});

test("native UI wrappers tolerate an absent platform and throwing API accessors", () => {
  delete global.wx;
  assert.equal(platformUi.setTitle("食养资料"), false); assert.equal(platformUi.setTabBarVisible(true), false);
  global.wx = {};
  for (const method of ["setNavigationBarTitle", "showTabBar", "hideTabBar"]) {
    Object.defineProperty(wx, method, { get() { throw new Error("FICTIONAL_PLATFORM_ERROR"); } });
  }
  assert.equal(platformUi.setTitle("食养资料"), false);
  assert.equal(platformUi.setTabBarVisible(true), false); assert.equal(platformUi.setTabBarVisible(false), false);
});

test("late cosmetic failure cannot update a hidden page, show an error or write data", () => {
  const calls = [];
  wx.hideTabBar = wx.showTabBar = wx.setNavigationBarTitle = (options) => calls.push(options);
  const instance = page("index"); instance.openSafety(); instance.onHide(); instance.onUnload();
  const count = calls.length;
  instance.setData = () => assert.fail("late cosmetic failure updated disposed page");
  wx.showToast = () => assert.fail("platform error must remain private");
  for (const call of calls) call.fail({ errMsg: "FICTIONAL_PRIVATE_PLATFORM_ERROR" });
  assert.equal(calls.length, count); assert.equal(writes, 0); assert.deepEqual(navigations, []); assert.deepEqual(clipboard, []);
});

function filterEvent(instance, key, value, version = instance.data.interactionVersion) {
  return { currentTarget: { dataset: { key, version } }, detail: { value } };
}

test("filter drawer hides native tabs through selection and clear, restoring them only on close", () => {
  const tabs = []; wx.showTabBar = () => tabs.push(true); wx.hideTabBar = () => tabs.push(false);
  const instance = page("index"); instance.openFilters();
  assert.equal(instance.data.filterOpen, true); assert.equal(tabs.at(-1), false);
  instance.onGroupChange(filterEvent(instance, "categories", ["food_medicine"]));
  assert.deepEqual(instance.data.filters.categories, ["food_medicine"]); assert.equal(tabs.at(-1), false);
  instance.onToggleFilter(filterEvent(instance, "onlySourceChecked", true));
  assert.equal(instance.data.filters.onlySourceChecked, true); assert.equal(tabs.at(-1), false);
  instance.clearDrawerFilters(filterEvent(instance));
  assert.deepEqual(instance.data.filters.categories, []); assert.equal(instance.data.filters.onlySourceChecked, false);
  assert.equal(instance.data.filterOpen, true); assert.equal(tabs.at(-1), false);
  instance.closeFilters(filterEvent(instance));
  assert.equal(instance.data.filterOpen, false); assert.equal(tabs.at(-1), true);
  assert.equal(writes, 0); assert.deepEqual(navigations, []);
});

test("foreground refresh does not expose native tabs behind a visible filter drawer", () => {
  const tabs = []; wx.showTabBar = () => tabs.push(true); wx.hideTabBar = () => tabs.push(false);
  const instance = page("index"); instance.openFilters(); instance.onShow();
  assert.equal(instance.data.filterOpen, true); assert.equal(tabs.at(-1), false);
});

for (const transition of ["onHide", "onUnload"]) test(`filter drawer ${transition} closes overlay, restores tabs and ignores late controls`, () => {
  const tabs = []; wx.showTabBar = () => tabs.push(true); wx.hideTabBar = () => tabs.push(false);
  const instance = page("index"); instance.openFilters();
  instance.onGroupChange(filterEvent(instance, "categories", ["food_medicine"]));
  const old = filterEvent(instance, "categories", []);
  instance[transition]();
  assert.equal(instance.data.filterOpen, false); assert.equal(tabs.at(-1), true);
  instance.onGroupChange(old); assert.deepEqual(instance.data.filters.categories, ["food_medicine"]);
  if (transition === "onHide") {
    instance.onShow(); assert.equal(instance.data.filterOpen, false);
    instance.openFilters(); assert.deepEqual(instance.data.filters.categories, ["food_medicine"]);
    instance.closeFilters(filterEvent(instance));
  }
});

test("opening safety replaces the filter overlay and stale filter-close cannot expose tabs", () => {
  const tabs = []; wx.showTabBar = () => tabs.push(true); wx.hideTabBar = () => tabs.push(false);
  const instance = page("index"); instance.openFilters(); const old = filterEvent(instance);
  instance.openSafety();
  assert.equal(instance.data.filterOpen, false); assert.equal(instance.data.safetyOpen, true);
  instance.closeFilters(old); assert.equal(tabs.at(-1), false);
  instance.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } }); instance.closeSafety();
  assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.rows, []);
  assert.equal(tabs.at(-1), true);
});

test("filter overlay ignores background card, search, network and navigation actions", () => {
  const instance = page("index"); instance.openFilters();
  const current = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  let reads = 0; const original = publicCatalog.load;
  publicCatalog.load = () => { reads += 1; return Promise.resolve(publicCatalog.getState()); };
  try {
    instance.toggleFavorite(current); instance.toggleCompare(current); instance.openDetail(current); instance.openOfficialPlans();
    instance.readServiceCatalog(connectionEvent(instance)); instance.onSearchInput({ ...connectionEvent(instance), detail: { value: "fictional-background" } });
    assert.equal(instance.data.query, ""); assert.equal(reads, 0);
    assert.equal(writes, 0); assert.deepEqual(navigations, []); assert.deepEqual(clipboard, []);
  } finally { publicCatalog.load = original; clearTimeout(instance.searchTimer); instance.onUnload(); }
});

test("card events queued before or during a drawer cannot execute after closing it", () => {
  const instance = page("index"); const before = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.openFilters(); const during = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.closeFilters(filterEvent(instance));
  for (const event of [before, during]) { instance.toggleFavorite(event); instance.toggleCompare(event); instance.openDetail(event); }
  assert.equal(writes, 0); assert.deepEqual(navigations, []);
  instance.toggleFavorite({ detail: { id, interactionVersion: instance.data.interactionVersion } });
  assert.deepEqual(storage.getFavorites(), [id]);
});

test("closed drawer ignores queued selection toggle and clear", () => {
  const instance = page("index"); instance.openFilters();
  instance.onGroupChange(filterEvent(instance, "categories", ["food_medicine"]));
  const group = filterEvent(instance, "categories", []), toggle = filterEvent(instance, "onlySourceChecked", true);
  instance.closeFilters(filterEvent(instance));
  instance.onGroupChange(group); instance.onToggleFilter(toggle); instance.clearDrawerFilters(group);
  assert.deepEqual(instance.data.filters.categories, ["food_medicine"]); assert.equal(instance.data.filters.onlySourceChecked, false);
});

test("reopened drawer rejects all controls from a previous overlay version", () => {
  const instance = page("index"); instance.openFilters(); const old = filterEvent(instance, "categories", ["food_medicine"]);
  instance.closeFilters(filterEvent(instance)); instance.openFilters();
  instance.onGroupChange(old); instance.onToggleFilter({ ...old, currentTarget: { dataset: { key: "onlySourceChecked", version: old.currentTarget.dataset.version } }, detail: { value: true } });
  instance.clearDrawerFilters(old); instance.closeFilters(old);
  assert.equal(instance.data.filterOpen, true); assert.deepEqual(instance.data.filters.categories, []);
  assert.equal(instance.data.filters.onlySourceChecked, false);
  instance.onGroupChange(filterEvent(instance, "categories", ["food_medicine"]));
  assert.deepEqual(instance.data.filters.categories, ["food_medicine"]);
});

test("malformed and unrendered filter controls cannot alter query or filter state", () => {
  const instance = page("index"); instance.openFilters(); const before = JSON.stringify(instance.data.filters);
  for (const event of [null, {}, filterEvent(instance, "query", ["fictional"]), filterEvent(instance, "__proto__", []),
    filterEvent(instance, "categories", "food_medicine"), filterEvent(instance, "categories", ["fictional-not-rendered"]),
    filterEvent(instance, "categories", [null]), filterEvent(instance, "categories", [], "0")]) {
    assert.doesNotThrow(() => instance.onGroupChange(event));
  }
  for (const event of [null, {}, filterEvent(instance, "query", true), filterEvent(instance, "onlySourceChecked", "false")]) {
    assert.doesNotThrow(() => instance.onToggleFilter(event));
  }
  assert.equal(JSON.stringify(instance.data.filters), before); assert.equal(instance.data.query, "");
});

test("privacy reset closes a filter drawer and old controls cannot restore filters", () => {
  const instance = page("index"); instance.openFilters(); const old = filterEvent(instance, "categories", ["food_medicine"]);
  clearPrivate(); instance.onGroupChange(old);
  assert.equal(instance.data.filterOpen, false); assert.deepEqual(instance.data.filters.categories, []);
  instance.openFilters(); instance.onGroupChange(old); assert.deepEqual(instance.data.filters.categories, []);
  assert.equal(writes, 0);
});

test("new committed red flag closes a filter drawer before applying a queued selection", () => {
  const instance = page("index"); instance.openFilters(); const old = filterEvent(instance, "categories", ["food_medicine"]);
  redFlag(); instance.onGroupChange(old);
  assert.equal(instance.data.filterOpen, false); assert.equal(instance.data.triageBlocked, true);
  assert.deepEqual(instance.data.rows, []); assert.deepEqual(instance.data.filters.categories, []);
  assert.equal(writes, 0);
});

test("native tab errors cannot prevent filter editing, clearing or closing", () => {
  wx.hideTabBar = wx.showTabBar = () => { throw new Error("FICTIONAL_PLATFORM_ERROR"); };
  const instance = page("index"); instance.openFilters();
  instance.onGroupChange(filterEvent(instance, "categories", ["food_medicine"]));
  assert.deepEqual(instance.data.filters.categories, ["food_medicine"]);
  instance.clearDrawerFilters(filterEvent(instance)); instance.closeFilters(filterEvent(instance));
  assert.equal(instance.data.filterOpen, false); assert.equal(instance.data.resultCount, 106);
});

test("filter controls retain existing infant restrictions without deleting saved IDs", () => {
  storage.setFavorites([id]); writes = 0;
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  const instance = page("index"); instance.openFilters();
  instance.onGroupChange(filterEvent(instance, "categories", ["food_medicine"]));
  instance.clearDrawerFilters(filterEvent(instance)); instance.closeFilters(filterEvent(instance));
  assert(!instance.data.rows.some((item) => item.id === id)); assert.deepEqual(storage.getFavorites(), [id]); assert.equal(writes, 0);
});

test("rendered filter controls and close actions carry the current interaction version", () => {
  const template = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  const section = template.slice(template.indexOf('<view wx:if="{{filterOpen}}"'), template.indexOf('<view wx:if="{{safetyOpen}}"'));
  const controls = section.match(/<[^>]+bind(?:change|tap)="(?:onGroupChange|onToggleFilter|clearDrawerFilters|closeFilters)"[^>]*>/g) || [];
  assert.equal(controls.length, 9);
  for (const tag of controls) assert(tag.includes('data-version="{{interactionVersion}}"'));
});

for (const failure of ["throws", "malformed"]) for (const dependency of ["both", "favorites", "compare"]) {
  test(`home ${dependency} record ${failure} remains readable with unknown marks and explicit-only recovery`, () => {
    storage.setFavorites([id]); storage.setCompare([id, "huang-qi"]); storage.setChecklist({ identity: true }); writes = 0;
    const instance = page("index"), originalRead = wx.getStorageSync;
    const saved = JSON.stringify(memory);
    const unavailable = (key) => dependency === "both" || key === storage.KEYS[dependency];
    wx.getStorageSync = (key) => {
      if (!unavailable(key)) return originalRead(key);
      if (failure === "throws") throw new Error("FICTIONAL_PRIVATE_STORAGE_ERROR");
      return { invalid: "FICTIONAL_PRIVATE_RECORD" };
    };
    instance.refreshCards();
    assert(instance.data.storageIssue); assert.equal(instance.data.resultCount, 106); assert(instance.data.rows.length > 0);
    const row = instance.data.rows.find((item) => item.id === id); assert(row);
    assert.equal(instance.data.favoritesAvailable, !unavailable(storage.KEYS.favorites));
    assert.equal(instance.data.compareAvailable, !unavailable(storage.KEYS.compare));
    assert.equal(instance.data.favoriteCount, unavailable(storage.KEYS.favorites) ? null : 1);
    assert.equal(instance.data.compareCount, unavailable(storage.KEYS.compare) ? null : 2);
    assert.equal(row.isFavorite, unavailable(storage.KEYS.favorites) ? null : true);
    assert.equal(row.inCompare, unavailable(storage.KEYS.compare) ? null : true);
    const old = { detail: { id, interactionVersion: instance.data.interactionVersion } };
    if (unavailable(storage.KEYS.favorites)) instance.toggleFavorite(old);
    if (unavailable(storage.KEYS.compare)) instance.toggleCompare(old);
    assert.equal(writes, 0); assert.equal(JSON.stringify(memory), saved); assert.deepEqual(storage.getChecklist(), { identity: true });
    instance.openDetail(old); assert.equal(navigations.length, 1, "read-only detail remains available");
    wx.getStorageSync = originalRead;
    const action = dependency === "compare" ? "toggleCompare" : "toggleFavorite";
    instance[action](old); // Recovery must invalidate, not execute, the old rendered gesture.
    assert.equal(writes, 0); assert.equal(instance.data.storageIssue, "");
    assert.equal(instance.data.favoriteCount, 1); assert.equal(instance.data.compareCount, 2);
    const recovered = instance.data.rows.find((item) => item.id === id);
    assert.equal(recovered.isFavorite, true); assert.equal(recovered.inCompare, true);
    assert.deepEqual(storage.getChecklist(), { identity: true }); assert.deepEqual(clipboard, []);
    instance[action]({ detail: { id, interactionVersion: instance.data.interactionVersion } });
    assert.equal(writes, 1, "only a new deliberate action may update records"); instance.onUnload();
  });
}

test("home unreadable records cannot bypass a newly committed red flag", () => {
  storage.setFavorites([id]); storage.setCompare([id]); writes = 0;
  const instance = page("index"); wx.getStorageSync = () => { throw new Error("FICTIONAL_STORAGE_FAILURE"); };
  instance.refreshCards(); redFlag(); instance.onShow();
  assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.rows, []);
  assert.equal(instance.data.favoriteCount, null); assert.equal(instance.data.compareCount, null);
  const current = { detail: { id, interactionVersion: instance.data.interactionVersion } };
  instance.toggleFavorite(current); instance.toggleCompare(current); instance.openDetail(current);
  assert.equal(writes, 0); assert.deepEqual(navigations, []);
});

test("card component suppresses unavailable record controls but preserves detail and readable controls", () => {
  const events = [];
  const context = { data: { item: { id }, interactionVersion: 3, favoritesAvailable: false, compareAvailable: false },
    triggerEvent: (name) => events.push(name) };
  component.methods.toggleFavorite.call(context); component.methods.toggleCompare.call(context); component.methods.openDetail.call(context);
  assert.deepEqual(events, ["detail"]);
  context.data.favoritesAvailable = true; component.methods.toggleFavorite.call(context);
  assert.deepEqual(events, ["detail", "favorite"]);
  context.data.compareAvailable = true; component.methods.toggleCompare.call(context);
  assert.deepEqual(events, ["detail", "favorite", "compare"]);
});

test("home and card templates distinguish unreadable record marks from confirmed empty records", () => {
  const home = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  const cardTemplate = fs.readFileSync(path.join(__dirname, "../components/ingredient-card/ingredient-card.wxml"), "utf8");
  assert(home.includes("favoritesAvailable ? favoriteCount : '待读取'"));
  assert(home.includes("compareAvailable ? compareCount + '/4' : '待读取'"));
  assert(home.includes('favorites-available="{{favoritesAvailable}}"')); assert(home.includes('compare-available="{{compareAvailable}}"'));
  assert(cardTemplate.includes("收藏待读取")); assert(cardTemplate.includes("对照待读取"));
  assert(cardTemplate.includes('disabled="{{!favoritesAvailable ||')); assert(cardTemplate.includes('disabled="{{!compareAvailable ||'));
});

for (const dependency of ["favorites", "compare"]) test(`home keeps the readable control usable when only ${dependency} fails`, () => {
  storage.setFavorites([id]); storage.setCompare([id]); storage.setChecklist({ identity: true }); writes = 0;
  const instance = page("index"), originalRead = wx.getStorageSync;
  wx.getStorageSync = (key) => { if (key === storage.KEYS[dependency]) throw new Error("FICTIONAL_STORAGE_FAILURE"); return originalRead(key); };
  instance.refreshCards();
  const action = dependency === "favorites" ? "toggleCompare" : "toggleFavorite";
  instance[action]({ detail: { id, interactionVersion: instance.data.interactionVersion } });
  assert.equal(writes, 1); assert(instance.data.storageIssue);
  assert.deepEqual(memory[storage.KEYS[dependency]], [id]);
  assert.deepEqual(memory[dependency === "favorites" ? storage.KEYS.compare : storage.KEYS.favorites], []);
  assert.deepEqual(storage.getChecklist(), dependency === "favorites" ? {} : { identity: true });
});

test("home cold-load storage failure still permits actual offline search without writes", async () => {
  wx.getStorageSync = () => { throw new Error("FICTIONAL_STORAGE_FAILURE"); };
  const instance = page("index");
  assert.equal(instance.data.favoriteCount, null); assert.equal(instance.data.compareCount, null);
  assert.equal(instance.data.favoritesAvailable, false); assert.equal(instance.data.compareAvailable, false);
  instance.onSearchInput({ ...connectionEvent(instance), detail: { value: "huangqi" } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(instance.data.rows.some((item) => item.id === "huang-qi"));
  assert.equal(instance.data.query, "huangqi"); assert.equal(writes, 0); assert.deepEqual(clipboard, []);
  instance.onUnload();
});
