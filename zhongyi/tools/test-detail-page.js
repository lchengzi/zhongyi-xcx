"use strict";

// Execute the actual registered page with deterministic WeChat interfaces.
// This is not WeChat runtime or physical-device evidence.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, beforeEach, after } = require("node:test");
const storage = require("../utils/storage");
const publicCatalog = require("../utils/public-catalog");
const catalog = require("../data/ingredients");
const globals = { Page: global.Page, wx: global.wx, getApp: global.getApp };
let definition;
global.Page = (value) => { definition = value; };
require("../subpackages/catalog/detail/detail");
if (globals.Page === undefined) delete global.Page; else global.Page = globals.Page;
const id = catalog.ingredients[0].id;
let app, memory, writes, clipboard, titles, requests;
const PHOTO_NOTICE = {
  state: "unavailable",
  title: "实物图片暂未提供",
  message: "当前版本没有可展示的实物照片。请结合下方文字核对部位与加工资料；本页不用于采集、鉴别或判断能否食用。"
};
const sourceDisplay = require("../utils/source-display");
function sourceEvent(sourceId) { return { currentTarget: { dataset: { id: sourceId } } }; }

test("recorded source dates preserve month-only precision and reject impossible or inferred dates", () => {
  assert.equal(sourceDisplay.recordedDate("2002-03"), "2002-03（仅记录到月份）");
  for (const date of ["2023-11-09", "2024-02-29", "2000-02-29"]) assert.equal(sourceDisplay.recordedDate(date), date);
  for (const date of [null, undefined, {}, "", "2026-13", "2026-00", "2026-02-29", "1900-02-29", "2026-04-31", "2026-08-00", "今天", "2026-08-10T00:00:00Z"]) {
    assert.equal(sourceDisplay.recordedDate(date), "待确认");
  }
});

test("all 106 detail source rows preserve publication/check dates, type, publisher and scope", () => {
  const ids = new Set(), expectedKeys = "id title issuer url typeText publishedAt checkedAt scope".split(" ").sort();
  for (const item of catalog.ingredients) {
    const instance = page({ id: item.id });
    assert.equal(instance.data.sourceRows.length, item.sources.length);
    instance.data.sourceRows.forEach((row, i) => {
      const source = item.sources[i]; ids.add(row.id);
      assert.deepEqual(Object.keys(row).sort(), expectedKeys);
      assert.equal(row.title, source.title); assert.equal(row.issuer, source.publisher);
      assert.equal(row.scope, source.scope); assert.equal(row.url, source.url);
      assert.equal(row.typeText, sourceDisplay.TYPE_TEXT[source.type]);
      assert.equal(row.publishedAt, sourceDisplay.recordedDate(source.publishedAt));
      assert.equal(row.checkedAt, source.checkedAt);
    });
  }
  assert.equal(ids.size, 9); assert.equal(writes, 0); assert.equal(requests, 0);
});

test("missing source metadata and prototype-like types stay unknown and extra fields are omitted", () => {
  const marker = "PRIVATE_SOURCE_FIXTURE_OMIT", raw = { id: "fictional", privateNotes: marker, reviewed: true, imageUrl: marker };
  for (const type of [undefined, null, {}, "__proto__", "constructor", "reviewed", "future_type"]) {
    const row = sourceDisplay.sourceDisplay({ ...raw, type });
    assert.equal(row.typeText, "来源类型待确认"); assert.equal(row.publishedAt, "待确认"); assert.equal(row.checkedAt, "待确认");
    assert.equal(row.scope, "该来源支持范围待确认"); assert(!JSON.stringify(row).includes(marker));
  }
});

test("copying a source link retains its exact URL and does not silently become a full record", () => {
  const instance = page({ id: "huang-qi" }), source = instance.data.sourceRows[0];
  instance.copySource(sourceEvent(source.id));
  assert.deepEqual(clipboard, [source.url]); assert.equal(writes, 0); assert.equal(requests, 0);
});

test("every source record copy binds its ingredient, original dates, scope and content version without health text", () => {
  const marker = "FICTIONAL_PRIVATE_HEALTH_OMIT";
  app.globalData.sessionSafetyProfile = { allergyText: marker, conditionText: marker, medicationText: marker };
  const session = JSON.stringify(app.globalData);
  for (const item of catalog.ingredients) {
    const instance = page({ id: item.id });
    for (const source of instance.data.sourceRows) {
      instance.copySourceRecord(sourceEvent(source.id)); const copied = clipboard.at(-1);
      for (const expected of [`${item.name}｜来源记录`, source.title, source.issuer, source.typeText,
        `资料标注发布日期：${source.publishedAt}`, `项目记录的来源复核日期：${source.checkedAt}`,
        source.scope, source.url, catalog.contentVersion, "目录来源核对截至：2026-08-10", "不表示今天已重新核验链接或目录"]) assert(copied.includes(expected));
      assert(!copied.includes(marker));
    }
  }
  assert.equal(JSON.stringify(app.globalData), session); assert.equal(writes, 0); assert.equal(requests, 0);
});

test("malformed or foreign source IDs cannot copy records or use prototype properties", () => {
  const instance = page({ id: "huang-qi" });
  for (const event of [undefined, {}, sourceEvent(null), sourceEvent({}), sourceEvent("__proto__"), sourceEvent("constructor"), sourceEvent("not-a-source")]) {
    assert.doesNotThrow(() => instance.copySourceRecord(event));
  }
  assert.deepEqual(clipboard, []);
  wx.showToast = () => { throw new Error("FICTIONAL_NOTICE_FAILURE"); };
  assert.doesNotThrow(() => instance.copySourceRecord(sourceEvent("not-a-source")));
  assert.deepEqual(clipboard, []);
});

test("record copying rechecks current source data, not cached publication dates or scope", () => {
  const original = publicCatalog.getCatalog, item = catalog.ingredients[0];
  try {
    const instance = page(), sourceId = instance.data.sourceRows[0].id;
    publicCatalog.getCatalog = () => [{ ...item, sources: item.sources.map((s, i) => i ? s :
      { ...s, publishedAt: "2001-02", scope: "虚构当前来源范围；不代表真实来源变化" }) }];
    instance.copySourceRecord(sourceEvent(sourceId));
    assert(clipboard.at(-1).includes("资料标注发布日期：2001-02（仅记录到月份）"));
    assert(clipboard.at(-1).includes("虚构当前来源范围"));
  } finally { publicCatalog.getCatalog = original; }
});

test("red flags, missing details, hide and unload stop source record copies while record-read faults stay readable", () => {
  for (const change of [v => redFlag(), v => { v.id = "not-in-catalog"; }, v => v.onHide(), v => v.onUnload()]) {
    clearProfile(); const instance = page(), event = sourceEvent(instance.data.sourceRows[0].id), before = clipboard.length;
    change(instance); instance.copySourceRecord(event); assert.equal(clipboard.length, before);
  }
  clearProfile(); const instance = page(), event = sourceEvent(instance.data.sourceRows[0].id);
  wx.getStorageSync = () => { throw new Error("FICTIONAL_STORAGE_READ_FAILURE"); };
  const before = clipboard.length; instance.copySourceRecord(event);
  assert.equal(clipboard.length, before + 1); assert(instance.data.storageIssue); assert.equal(writes, 0);
});

test("source record copy failure reports generic retry, never retries automatically and silences old callbacks", () => {
  const instance = page(), event = sourceEvent(instance.data.sourceRows[0].id), calls = [], notices = [];
  wx.setClipboardData = options => calls.push(options); wx.showToast = options => notices.push(options);
  instance.copySourceRecord(event); assert.equal(calls.length, 1);
  calls[0].fail({ errMsg: "FICTIONAL_PRIVATE_PLATFORM_ERROR" }); calls[0].fail({});
  assert.equal(calls.length, 1); assert.deepEqual(notices.map(n => n.title), ["复制未完成，请再次点击重试"]);
  instance.copySourceRecord(event); instance.onHide(); instance.onShow();
  calls[1].fail({}); assert.equal(notices.length, 1);
  instance.copySourceRecord(event); app.globalData.sessionDataRevision = 1; calls[2].fail({}); assert.equal(notices.length, 1);
  wx.setClipboardData = () => { throw new Error("FICTIONAL_THROW"); };
  assert.doesNotThrow(() => instance.copySourceRecord(event)); assert.equal(notices.length, 2);
  assert.equal(writes, 0); assert.equal(requests, 0);
});

test("source template separates publication/check dates and offers two explicit copy actions with privacy notice", () => {
  const template = fs.readFileSync(path.join(__dirname, "../subpackages/catalog/detail/detail.wxml"), "utf8");
  for (const token of ["{{item.typeText}}", "资料标注发布日期：{{item.publishedAt}}", "项目记录的来源复核：{{item.checkedAt}}",
    "记录的支持范围：{{item.scope}}", "本程序不读取剪贴板", "删除本机记录不能清空已复制的内容"]) assert(template.includes(token));
  for (const method of ["copySource", "copySourceRecord"]) assert(new RegExp(`<button[^>]*data-id="\\{\\{item.id\\}\\}"[^>]*bindtap="${method}"`).test(template));
  assert(!template.includes("链接复核：")); assert(!/<web-view\b/.test(template));
});

function page(options = { id }) {
  const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  instance.setData = function (patch) { Object.assign(this.data, patch); };
  instance.onLoad(options);
  return instance;
}
function redFlag() { app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] }; }
function clearProfile() { app.globalData.sessionSafetyProfile = {}; }
function assertEmpty(instance) {
  assert.equal(instance.data.ingredient, null);
  assert.equal(instance.data.photoNotice, null);
  assert.equal(instance.data.partScopeNotice, "");
  for (const key of ["identityFacts", "regulatoryFacts", "traditionalFacts", "goalRows", "foodForms", "preparationNotes", "safetyGroups", "sourceRows"]) {
    assert.deepEqual(instance.data[key], [], `stale ${key}`);
  }
  assert.deepEqual(instance.sourceById, {});
}
beforeEach(() => {
  app = { globalData: { sessionSafetyProfile: {} } };
  memory = {}; writes = 0; clipboard = []; titles = []; requests = 0;
  global.getApp = () => app;
  global.wx = {
    getStorageSync: (key) => memory[key] || "",
    setStorageSync: (key, value) => { writes += 1; memory[key] = value; },
    setNavigationBarTitle: ({ title }) => titles.push(title),
    setClipboardData: ({ data }) => clipboard.push(data),
    showToast() {},
    request() { requests += 1; throw new Error("detail must not fetch unapproved photos"); }
  };
  publicCatalog.clear();
});
after(() => {
  publicCatalog.clear();
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});

test("valid detail still renders source and food-form review information", () => {
  const instance = page();
  assert.equal(instance.data.ingredient.id, id);
  assert(instance.data.sourceRows.length > 0);
  assert(instance.data.foodUseReviewText);
  assert.equal(titles.at(-1), catalog.ingredients[0].name);
});

test("all details use the same recorded part and review status as comparison without writes", () => {
  const display = require("../utils/food-display"), compare = require("../utils/compare");
  for (const item of catalog.ingredients) {
    const instance = page({ id: item.id }), expected = display.foodIdentityDisplay(item);
    const facts = instance.data.identityFacts;
    assert.equal(facts.find(r => r.label === display.PART_LABEL).value, expected.partText);
    assert.equal(facts.find(r => r.label === "部位资料复核").value, expected.partReviewText);
    assert(!facts.some(r => r.label === "可食部位"));
    assert(!instance.data.regulatoryFacts.some(r => r.label === "允许部位"));
    assert.equal(instance.data.regulatoryFacts.find(r => r.label === display.PART_LABEL).value, expected.partText);
    assert.equal(instance.data.partScopeNotice, display.PART_SCOPE_NOTICE);
    const row = compare.buildCompareGroups([item], false).flatMap(g => g.rows).find(r => r.label === "部位资料复核");
    assert.equal(row.values[0], expected.partReviewText);
  }
  assert.equal(writes, 0); assert.equal(requests, 0);
});

test("missing part or untrusted reviewed flag cannot become an allowed-part claim in detail", () => {
  const original = publicCatalog.getCatalog;
  try {
    for (const identity of [{ ediblePart: "", partReviewState: "source_checked" },
      { ediblePart: "虚构测试部位", partReviewState: "reviewed" }]) {
      publicCatalog.getCatalog = () => [{ ...catalog.ingredients[0], identity }];
      const instance = page();
      assert.equal(instance.data.identityFacts.find(r => r.label === "目录记录部位").value, identity.ediblePart || "待确认");
      assert.equal(instance.data.identityFacts.find(r => r.label === "部位资料复核").value, "部位资料待复核");
    }
  } finally { publicCatalog.getCatalog = original; }
});

test("detail keeps the part boundary adjacent to identity and labels forms as not processing steps", () => {
  const template = fs.readFileSync(path.join(__dirname, "../subpackages/catalog/detail/detail.wxml"), "utf8");
  assert(template.indexOf("{{partScopeNotice}}") > template.indexOf('id="detail-identity"'));
  assert(template.indexOf("{{partScopeNotice}}") < template.indexOf('id="detail-regulatory"'));
  assert(template.includes("食用形式标签（不是加工步骤）"));
});
test("all 106 details explain unavailable real photos without network or storage writes", () => {
  for (const ingredient of catalog.ingredients) {
    const instance = page({ id: ingredient.id });
    assert.deepEqual(instance.data.photoNotice, PHOTO_NOTICE);
    assert.equal(instance.data.ingredient.id, ingredient.id);
    assert(instance.data.foodUseReviewText);
  }
  assert.equal(requests, 0); assert.equal(writes, 0);
});
test("detail template displays the photo notice as text inside food-form boundaries", () => {
  const template = fs.readFileSync(path.join(__dirname, "../subpackages/catalog/detail/detail.wxml"), "utf8");
  const section = template.match(/食用资料与加工边界([\s\S]*?)禁忌与不确定信息/);
  assert(section);
  assert(section[1].includes('{{photoNotice.title}}'));
  assert(section[1].includes('{{photoNotice.message}}'));
  assert(section[1].includes('wx:if="{{photoNotice}}"'));
  assert(!/<image\b/.test(template), "no decorative or research image is substituted");
});
test("new red flag clears the photo notice with the rest of detail", () => {
  const instance = page();
  assert.deepEqual(instance.data.photoNotice, PHOTO_NOTICE);
  redFlag(); instance.onShow();
  assert.equal(instance.data.photoNotice, null);
  assert(instance.data.triageBlocked);
  clearProfile(); instance.onShow();
  assert.deepEqual(instance.data.photoNotice, PHOTO_NOTICE);
});
test("missing detail clears the previous photo notice and cannot restore it through actions", () => {
  const instance = page();
  instance.id = "not-in-catalog"; instance.loadIngredient();
  assert.equal(instance.data.photoNotice, null);
  instance.toggleFavorite(); instance.toggleCompare(); instance.copySafetySummary();
  assert.equal(instance.data.photoNotice, null);
  assert.equal(writes, 0); assert.deepEqual(clipboard, []);
});
test("connection mode never relabels absent photos as loading, loaded or approved", () => {
  const original = publicCatalog.getState;
  try {
    for (const mode of ["offline", "loading", "fallback", "online"]) {
      publicCatalog.getState = () => ({ ...original(), mode });
      const instance = page();
      assert.equal(instance.data.network.mode, mode);
      assert.deepEqual(instance.data.photoNotice, PHOTO_NOTICE);
    }
  } finally { publicCatalog.getState = original; }
  assert.equal(requests, 0);
});
test("unrecognized candidate photo fields cannot promote or leak through detail data", () => {
  const original = publicCatalog.getCatalog;
  const marker = "PRIVATE_PHOTO_FIXTURE_OMIT";
  const item = catalog.ingredients[0];
  try {
    publicCatalog.getCatalog = () => [{ ...item,
      photoNotice: { state: "reviewed", title: marker, message: marker },
      media: { imageUrl: `https://example.invalid/${marker}.jpg`, publicationEligible: true },
      imageUrl: `https://example.invalid/${marker}.jpg`
    }];
    const instance = page();
    assert.deepEqual(instance.data.photoNotice, PHOTO_NOTICE);
    assert(!JSON.stringify(instance.data).includes(marker));
  } finally { publicCatalog.getCatalog = original; }
  assert.equal(requests, 0); assert.equal(writes, 0);
});
test("all detail headers use only page-owned fields while preserving existing actions and labels", () => {
  const format = require("../utils/format");
  const safety = require("../utils/safety");
  const expectedKeys = "id pinyin nameCn latinName categoryText auditText safetyLabel isFavorite inCompare blocked warningCount blockedReason warningText auditDetail sourceCheckedAt professionalReviewedAt".split(" ").sort();
  storage.setFavorites([id]); storage.setCompare([id]);
  const beforeWrites = writes;
  for (const item of catalog.ingredients) {
    const instance = page({ id: item.id });
    const view = format.detailView(item, [id], [id], safety.evaluateIngredient(item, {}));
    assert.deepEqual(Object.keys(instance.data.ingredient).sort(), expectedKeys);
    for (const field of ["auditText", "safetyLabel", "isFavorite", "inCompare", "warningText"]) {
      assert.equal(instance.data.ingredient[field], view[field]);
    }
    assert.equal(instance.data.ingredient.categoryText, view.regulatoryText);
    assert.equal(instance.data.ingredient.blockedReason, view.reasonText);
    assert.equal(instance.data.ingredient.sourceCheckedAt, item.audit.sourceCheckedAt || "待确认");
  }
  assert.equal(writes, beforeWrites); assert.equal(requests, 0);
});
test("cold-load red flag stops detail; explicit profile clearing and onShow recover it", () => {
  redFlag();
  const instance = page();
  assert(instance.data.triageBlocked);
  clearProfile();
  instance.onShow();
  assert(instance.data.ingredient, "detail did not recover from the cleared triage state");
  assert.equal(instance.data.triageBlocked, false);
});
test("visible detail becomes blocked without retaining source or evaluated view caches", () => {
  const instance = page();
  redFlag(); instance.onShow();
  assert(instance.data.triageBlocked);
  assertEmpty(instance);
  clearProfile(); instance.onShow();
  assert.equal(instance.data.ingredient.id, id);
});
test("not-found transition clears the previous detail and lookup cache", () => {
  const instance = page();
  instance.id = "not-in-catalog";
  instance.loadIngredient();
  assert(instance.data.notFound);
  assertEmpty(instance);
  assert.equal(titles.at(-1), "食养资料");
});
test("missing detail handlers do not write IDs or copy a stale summary/source", () => {
  const instance = page();
  const oldSource = instance.data.sourceRows[0].id;
  instance.id = "not-in-catalog";
  instance.loadIngredient();
  assert.doesNotThrow(() => {
    instance.toggleFavorite(); instance.toggleCompare(); instance.copySafetySummary();
    instance.copySource({ currentTarget: { dataset: { id: oldSource } } });
  });
  assert.equal(writes, 0);
  assert.deepEqual(clipboard, []);
});
test("all detail actions recheck a newly committed red flag before side effects", () => {
  for (const action of [
    (v) => v.toggleFavorite(), (v) => v.toggleCompare(), (v) => v.copySafetySummary(),
    (v) => v.copySource({ currentTarget: { dataset: { id: v.data.sourceRows[0].id } } })
  ]) {
    clearProfile(); const instance = page(); redFlag();
    const beforeWrites = writes, beforeClipboard = clipboard.length;
    action(instance);
    assert.equal(writes, beforeWrites);
    assert.equal(clipboard.length, beforeClipboard);
    assert(instance.data.triageBlocked);
    assertEmpty(instance);
  }
});
test("changed age restrictions block adding a cached detail to favorites or compare", () => {
  const instance = page({ id: "dang-shen" });
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.toggleFavorite(); instance.toggleCompare();
  assert.equal(writes, 0);
  assert(instance.data.ingredient.blocked);
});
test("restricted existing favorites and compare IDs can still be removed without red flags", () => {
  storage.setFavorites(["dang-shen"]); storage.setCompare(["dang-shen"]);
  const instance = page({ id: "dang-shen" });
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.toggleFavorite(); instance.toggleCompare();
  assert.deepEqual(storage.getFavorites(), []);
  assert.deepEqual(storage.getCompare(), []);
});
test("copied summary reflects current evaluation rather than the previous page view", () => {
  const instance = page({ id: "dang-shen" });
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.copySafetySummary();
  assert(instance.data.ingredient.blocked);
  assert.equal(clipboard.length, 1);
  assert(clipboard[0].includes(`本次状态：${instance.data.ingredient.safetyLabel}`));
  assert(clipboard[0].includes("阻止原因："));
});
test("share falls back to catalog after live red flag or a missing detail", () => {
  const instance = page();
  assert.equal(instance.onShareAppMessage().path, `/subpackages/catalog/detail/detail?id=${id}`);
  redFlag();
  assert.equal(instance.onShareAppMessage().path, "/pages/index/index");
  clearProfile(); instance.id = "not-in-catalog"; instance.loadIngredient();
  assert.equal(instance.onShareAppMessage().path, "/pages/index/index");
});
test("malformed cold-load options are safe empty states, not crashes", () => {
  for (const options of [null, {}, { id: null }, { id: {} }, { id: "" }]) {
    const instance = page(options);
    assert(instance.data.notFound);
    assertEmpty(instance);
  }
});
test("unloaded detail cannot perform late action writes, clipboard or title updates", () => {
  const instance = page();
  const sourceId = instance.data.sourceRows[0].id;
  instance.onUnload();
  const beforeTitles = titles.length;
  instance.toggleFavorite(); instance.toggleCompare(); instance.copySafetySummary();
  instance.copySource({ currentTarget: { dataset: { id: sourceId } } });
  assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.equal(titles.length, beforeTitles);
  assert.equal(instance.onShareAppMessage().path, "/pages/index/index");
});

test("detail copy reports asynchronous rejection without exposing platform errors and allows explicit retry", () => {
  const instance = page(); const calls = [], notices = [];
  wx.setClipboardData = (options) => calls.push(options);
  wx.showToast = (options) => notices.push(options);
  instance.copySafetySummary();
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].fail, "function");
  calls[0].fail({ errMsg: "FICTIONAL_HEALTH_DATA_MUST_NOT_APPEAR" });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "复制未完成，请再次点击重试");
  instance.copySafetySummary(); assert.equal(calls.length, 2);
});
test("detail source copy catches a synchronous platform throw without losing the readable detail", () => {
  const instance = page(); const notices = [];
  wx.showToast = (options) => notices.push(options);
  wx.setClipboardData = () => { throw new Error("FICTIONAL_PLATFORM_ERROR"); };
  assert.doesNotThrow(() => instance.copySource({ currentTarget: { dataset: { id: instance.data.sourceRows[0].id } } }));
  assert.equal(notices.length, 1); assert.equal(instance.data.ingredient.id, id);
});
test("hidden detail cannot write copy navigate or share until it is shown again", () => {
  const instance = page(); const sourceId = instance.data.sourceRows[0].id;
  assert.equal(typeof instance.onHide, "function"); instance.onHide();
  const beforeTitles = titles.length; const navigations = [];
  wx.switchTab = (options) => navigations.push(options);
  instance.toggleFavorite(); instance.toggleCompare(); instance.copySafetySummary();
  instance.copySource({ currentTarget: { dataset: { id: sourceId } } }); instance.goCatalog();
  assert.equal(writes, 0); assert.equal(clipboard.length, 0); assert.equal(navigations.length, 0);
  assert.equal(titles.length, beforeTitles);
  assert.equal(instance.onShareAppMessage().path, "/pages/index/index");
  instance.onShow(); instance.copySafetySummary(); assert.equal(clipboard.length, 1);
});
test("old clipboard failure stays silent after hide and return while a new user copy still reports failure", () => {
  const instance = page(); const calls = [], notices = [];
  wx.setClipboardData = (options) => calls.push(options); wx.showToast = (options) => notices.push(options);
  instance.copySafetySummary(); assert.equal(typeof instance.onHide, "function");
  instance.onHide(); instance.onShow(); instance.copySafetySummary();
  assert.equal(typeof calls[0].fail, "function"); assert.equal(typeof calls[1].fail, "function");
  calls[0].fail({}); assert.equal(notices.length, 0);
  calls[1].fail({}); assert.equal(notices.length, 1);
});

for (const failure of ["missing", "throws", "rejects"]) {
  test(`title interface ${failure} cannot block detail cold load or not-found recovery`, () => {
    if (failure === "missing") delete wx.setNavigationBarTitle;
    if (failure === "throws") wx.setNavigationBarTitle = () => { throw new Error("FICTIONAL_PLATFORM_ERROR"); };
    if (failure === "rejects") wx.setNavigationBarTitle = (options) => options.fail({ errMsg: "FICTIONAL_PLATFORM_ERROR" });
    const instance = page();
    assert.equal(instance.data.ingredient.id, id);
    instance.id = "not-in-catalog";
    assert.doesNotThrow(() => instance.loadIngredient()); assertEmpty(instance);
    assert.equal(instance.data.notFound, true);
    instance.id = id; instance.onShow();
    assert.equal(instance.data.ingredient.id, id);
    assert.equal(writes, 0); assert.equal(requests, 0); assert.deepEqual(clipboard, []);
  });

  test(`title interface ${failure} cannot retain detail data after a new red flag`, () => {
    const instance = page();
    if (failure === "missing") delete wx.setNavigationBarTitle;
    if (failure === "throws") wx.setNavigationBarTitle = () => { throw new Error("FICTIONAL_PLATFORM_ERROR"); };
    if (failure === "rejects") wx.setNavigationBarTitle = (options) => options.fail({ errMsg: "FICTIONAL_PLATFORM_ERROR" });
    redFlag();
    assert.doesNotThrow(() => instance.onShow());
    assert.equal(instance.data.triageBlocked, true); assertEmpty(instance);
    clearProfile(); instance.onShow();
    assert.equal(instance.data.ingredient.id, id);
    assert.equal(writes, 0); assert.equal(requests, 0); assert.deepEqual(clipboard, []);
  });
}

for (const failure of ["throws", "malformed"]) for (const dependency of ["both", "favorites", "compare"]) {
  test(`detail ${dependency} record ${failure} keeps sources readable and marks unknown until recovery`, () => {
    storage.setFavorites([id]); storage.setCompare([id]); storage.setChecklist({ identity: true }); writes = 0;
    const instance = page(), originalRead = wx.getStorageSync, saved = JSON.stringify(memory);
    const unavailable = (key) => dependency === "both" || key === storage.KEYS[dependency];
    wx.getStorageSync = (key) => {
      if (!unavailable(key)) return originalRead(key);
      if (failure === "throws") throw new Error("FICTIONAL_PRIVATE_STORAGE_ERROR");
      return { invalid: "FICTIONAL_PRIVATE_RECORD" };
    };
    instance.loadIngredient();
    assert(instance.data.storageIssue); assert.equal(instance.data.ingredient.id, id); assert(instance.data.sourceRows.length > 0);
    assert.equal(instance.data.favoritesAvailable, !unavailable(storage.KEYS.favorites));
    assert.equal(instance.data.compareAvailable, !unavailable(storage.KEYS.compare));
    assert.equal(instance.data.ingredient.isFavorite, unavailable(storage.KEYS.favorites) ? null : true);
    assert.equal(instance.data.ingredient.inCompare, unavailable(storage.KEYS.compare) ? null : true);
    if (unavailable(storage.KEYS.favorites)) instance.toggleFavorite();
    if (unavailable(storage.KEYS.compare)) instance.toggleCompare();
    assert.equal(writes, 0); assert.equal(JSON.stringify(memory), saved); assert.deepEqual(storage.getChecklist(), { identity: true });
    instance.copySource({ currentTarget: { dataset: { id: instance.data.sourceRows[0].id } } }); assert.equal(clipboard.length, 1);
    wx.getStorageSync = originalRead; instance.loadIngredient();
    assert.equal(instance.data.storageIssue, ""); assert.equal(instance.data.ingredient.isFavorite, true); assert.equal(instance.data.ingredient.inCompare, true);
    assert.equal(writes, 0); assert.deepEqual(storage.getChecklist(), { identity: true });
  });
}

test("detail record controls show unknown state and disable only the unavailable dependency", () => {
  const template = fs.readFileSync(path.join(__dirname, "../subpackages/catalog/detail/detail.wxml"), "utf8");
  assert(template.includes("收藏待读取")); assert(template.includes("对照待读取"));
  assert(template.includes('disabled="{{!favoritesAvailable ||')); assert(template.includes('disabled="{{!compareAvailable ||'));
});

for (const dependency of ["favorites", "compare"]) test(`detail keeps the readable control usable when only ${dependency} fails`, () => {
  storage.setFavorites([id]); storage.setCompare([id]); storage.setChecklist({ identity: true }); writes = 0;
  const instance = page(), originalRead = wx.getStorageSync;
  wx.getStorageSync = (key) => { if (key === storage.KEYS[dependency]) throw new Error("FICTIONAL_STORAGE_FAILURE"); return originalRead(key); };
  instance.loadIngredient(); instance[dependency === "favorites" ? "toggleCompare" : "toggleFavorite"]();
  assert.equal(writes, 1); assert(instance.data.storageIssue);
  assert.deepEqual(memory[storage.KEYS[dependency]], [id]);
  assert.deepEqual(memory[dependency === "favorites" ? storage.KEYS.compare : storage.KEYS.favorites], []);
  assert.deepEqual(storage.getChecklist(), dependency === "favorites" ? {} : { identity: true });
});

test("detail cold-load storage failure keeps educational content and sources readable", () => {
  wx.getStorageSync = () => { throw new Error("FICTIONAL_STORAGE_FAILURE"); };
  const instance = page(); assert.equal(instance.data.ingredient.id, id);
  assert.equal(instance.data.ingredient.isFavorite, null); assert.equal(instance.data.ingredient.inCompare, null);
  assert(instance.data.photoNotice); assert(instance.data.sourceRows.length > 0); assert.equal(writes, 0);
});

test("detail red flags still clear read-only content while record storage is unavailable", () => {
  const instance = page(); wx.getStorageSync = () => { throw new Error("FICTIONAL_STORAGE_FAILURE"); };
  redFlag(); instance.onShow(); assertEmpty(instance); assert.equal(instance.data.triageBlocked, true);
  instance.toggleFavorite(); instance.toggleCompare(); instance.copySafetySummary();
  assert.equal(writes, 0); assert.deepEqual(clipboard, []);
});

const SECTION_KEYS = ["safety", "identity", "regulatory", "food", "risks", "sources"];
const SECTION_FALLBACK = "快捷定位暂不可用，请向下滑动阅读完整资料。";
function sectionEvent(instance, section = "food", itemId = instance.id) {
  return { currentTarget: { dataset: { section, id: itemId } } };
}

test("all 106 details expose six reading shortcuts and top without writes or requests", () => {
  const calls = []; wx.pageScrollTo = (options) => { calls.push(options); options.success({}); };
  for (const item of catalog.ingredients) {
    const instance = page({ id: item.id });
    assert.deepEqual(instance.data.sectionLinks.map((link) => link.key), SECTION_KEYS);
    for (const section of [...SECTION_KEYS, "top"]) {
      instance.jumpToSection(sectionEvent(instance, section));
      assert.equal(calls.at(-1).selector, `#detail-${section}`);
      assert.equal(calls.at(-1).duration, 0);
      assert.equal(instance.data.sectionNotice, "");
    }
  }
  assert.equal(calls.length, catalog.ingredients.length * 7);
  assert.equal(writes, 0); assert.equal(requests, 0); assert.deepEqual(clipboard, []);
});

test("detail reading shortcuts bind real sections and keep all safety content in normal flow", () => {
  const template = fs.readFileSync(path.join(__dirname, "../subpackages/catalog/detail/detail.wxml"), "utf8");
  const normal = template.slice(template.indexOf('wx:elif="{{ingredient}}"'));
  assert(normal.includes('wx:for="{{sectionLinks}}"'));
  assert(normal.includes('data-section="{{item.key}}"'));
  assert(normal.includes('data-id="{{ingredient.id}}"'));
  assert(normal.includes('data-section="top"'));
  assert(normal.includes('{{sectionNotice}}'));
  for (const section of [...SECTION_KEYS, "top"]) {
    assert.equal((template.match(new RegExp(`id="detail-${section}"`, "g")) || []).length, 1);
  }
  assert(normal.includes("禁忌与不确定信息")); assert(normal.includes("本次安全状态"));
  assert(normal.indexOf("本次安全状态") < normal.indexOf("快速查阅"), "current safety is before the shortcuts");
  for (const [section, heading] of Object.entries({ safety: "本次安全状态", identity: "规范身份",
    regulatory: "法规与目录状态", food: "食用资料与加工边界", risks: "禁忌与不确定信息", sources: "来源与审校" })) {
    const start = normal.indexOf(`id="detail-${section}"`);
    const nextHeading = normal.indexOf('class="section-title"', start);
    assert(normal.slice(nextHeading, normal.indexOf("</view>", nextHeading)).includes(heading));
  }
  assert(!/<scroll-view\b/.test(template), "normal page scrolling remains available");
});

test("reading shortcuts reject arbitrary selectors, prototype keys and stale ingredient events", () => {
  const instance = page(), calls = []; wx.pageScrollTo = (options) => calls.push(options);
  for (const value of [undefined, null, {}, "food", [], 1,
    sectionEvent(instance, "#detail-food"), sectionEvent(instance, "__proto__"),
    sectionEvent(instance, "constructor"), sectionEvent(instance, "toString"),
    sectionEvent(instance, "food", "stale-id"), sectionEvent(instance, {}, id)]) {
    assert.doesNotThrow(() => instance.jumpToSection(value));
  }
  assert.deepEqual(calls, []); assert.equal(writes, 0); assert.equal(requests, 0);
});

test("shortcut action rechecks a new red flag and clears the previous detail", () => {
  const instance = page(), calls = []; wx.pageScrollTo = (options) => calls.push(options);
  redFlag(); instance.jumpToSection(sectionEvent(instance));
  assertEmpty(instance); assert.equal(instance.data.triageBlocked, true);
  assert.equal(instance.data.sectionNotice, ""); assert.deepEqual(calls, []);
  clearProfile(); instance.onShow(); instance.jumpToSection(sectionEvent(instance));
  assert.equal(calls.length, 1); assert.equal(writes, 0);
});

test("shortcut action cannot scroll a removed detail or retain an old error", () => {
  const instance = page(); instance.jumpToSection(sectionEvent(instance));
  assert.equal(instance.data.sectionNotice, SECTION_FALLBACK);
  instance.id = "not-in-catalog"; instance.jumpToSection(sectionEvent(instance));
  assertEmpty(instance); assert.equal(instance.data.sectionNotice, "");
});

test("hidden and unloaded details reject shortcut events while returning permits a new click", () => {
  const instance = page(), calls = []; wx.pageScrollTo = (options) => calls.push(options);
  instance.onHide(); instance.jumpToSection(sectionEvent(instance)); assert.equal(calls.length, 0);
  instance.onShow(); instance.jumpToSection(sectionEvent(instance)); assert.equal(calls.length, 1);
  instance.onUnload(); instance.jumpToSection(sectionEvent(instance)); assert.equal(calls.length, 1);
  assert.equal(writes, 0);
});

test("unreadable local records do not disable educational reading shortcuts", () => {
  const calls = []; wx.pageScrollTo = (options) => { calls.push(options); options.success({}); };
  wx.getStorageSync = () => { throw new Error("FICTIONAL_STORAGE_FAILURE"); };
  const instance = page(); instance.jumpToSection(sectionEvent(instance, "sources"));
  assert(instance.data.storageIssue); assert.equal(calls.length, 1);
  assert.equal(instance.data.ingredient.isFavorite, null); assert.equal(writes, 0);
});

for (const failure of ["missing", "throws", "rejects"]) test(`shortcut ${failure} leaves content readable and a new click can recover`, () => {
  const instance = page(), before = JSON.stringify(instance.data.ingredient);
  if (failure === "throws") wx.pageScrollTo = () => { throw new Error("FICTIONAL_PRIVATE_SCROLL_ERROR"); };
  if (failure === "rejects") wx.pageScrollTo = (options) => options.fail({ errMsg: "FICTIONAL_PRIVATE_SCROLL_ERROR" });
  assert.doesNotThrow(() => instance.jumpToSection(sectionEvent(instance)));
  assert.equal(instance.data.sectionNotice, SECTION_FALLBACK);
  assert.equal(JSON.stringify(instance.data.ingredient), before); assert(instance.data.sourceRows.length > 0);
  assert(!JSON.stringify(instance.data).includes("FICTIONAL_PRIVATE_SCROLL_ERROR"));
  wx.pageScrollTo = (options) => options.success({});
  instance.jumpToSection(sectionEvent(instance)); assert.equal(instance.data.sectionNotice, "");
  assert.equal(requests, 0); assert.equal(writes, 0);
});

test("only the newest shortcut attempt can settle its message and each attempt settles once", () => {
  const instance = page(), calls = []; wx.pageScrollTo = (options) => calls.push(options);
  instance.jumpToSection(sectionEvent(instance, "food")); instance.jumpToSection(sectionEvent(instance, "sources"));
  calls[0].fail({}); assert.equal(instance.data.sectionNotice, "");
  calls[1].fail({}); assert.equal(instance.data.sectionNotice, SECTION_FALLBACK);
  calls[1].success({}); assert.equal(instance.data.sectionNotice, SECTION_FALLBACK);
  instance.jumpToSection(sectionEvent(instance, "top")); calls[2].success({}); calls[2].fail({});
  assert.equal(instance.data.sectionNotice, ""); assert.equal(calls.length, 3);
});

test("shortcut callbacks from before hiding cannot modify a returned or unloaded page", () => {
  const instance = page(), calls = []; wx.pageScrollTo = (options) => calls.push(options);
  instance.jumpToSection(sectionEvent(instance)); instance.onHide(); instance.onShow();
  calls[0].fail({}); assert.equal(instance.data.sectionNotice, "");
  instance.jumpToSection(sectionEvent(instance)); instance.onUnload();
  calls[1].fail({}); assert.equal(instance.data.sectionNotice, "");
});

test("shortcut callbacks cannot label another ingredient or a red-flagged detail", () => {
  const instance = page(), calls = []; wx.pageScrollTo = (options) => calls.push(options);
  instance.jumpToSection(sectionEvent(instance)); instance.id = catalog.ingredients[1].id; instance.loadIngredient();
  calls[0].fail({}); assert.equal(instance.data.sectionNotice, "");
  instance.jumpToSection(sectionEvent(instance)); redFlag(); calls[1].fail({});
  assert.equal(instance.data.sectionNotice, ""); instance.onShow(); assertEmpty(instance);
});

test("detail actions have unique stable selectors bound to distinct handlers", () => {
  const template = fs.readFileSync(path.join(__dirname, "../subpackages/catalog/detail/detail.wxml"), "utf8");
  for (const [id, handler] of [["detail-favorite", "toggleFavorite"], ["detail-compare", "toggleCompare"], ["detail-copy-safety", "copySafetySummary"]]) {
    const buttons = template.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`, "g")) || [];
    assert.equal(buttons.length, 1);
    assert(buttons[0].includes(`bindtap="${handler}"`));
  }
});

test("ordinary show, reload and network state changes never trigger automatic scrolling", () => {
  const original = publicCatalog.getState, calls = []; wx.pageScrollTo = (options) => calls.push(options);
  try {
    for (const mode of ["offline", "loading", "fallback", "online"]) {
      publicCatalog.getState = () => ({ ...original(), mode });
      const instance = page(); instance.onShow(); instance.loadIngredient();
      assert.equal(instance.data.sectionNotice, "");
    }
  } finally { publicCatalog.getState = original; }
  assert.deepEqual(calls, []); assert.equal(requests, 0); assert.equal(writes, 0);
});
