"use strict";

// Real page handlers with deterministic platform interfaces; not device evidence.
const assert = require("node:assert/strict");
const { test, beforeEach, after } = require("node:test");
const storage = require("../utils/storage");
const privacy = require("../utils/privacy");
const globals = { Page: global.Page, wx: global.wx, getApp: global.getApp };
const definitions = {};
for (const name of ["favorites", "compare", "plan"]) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(`../pages/${name}/${name}`);
}
if (globals.Page === undefined) delete global.Page; else global.Page = globals.Page;
let app, memory, writes, clipboard, modals, navigations, readFails, notices;
const id = "dang-shen";
const cardEvent = { detail: { id } };
const rowEvent = { currentTarget: { dataset: { id } } };

function page(name) {
  const value = { ...definitions[name], data: JSON.parse(JSON.stringify(definitions[name].data)) };
  value.setData = function (patch) { Object.assign(this.data, patch); };
  value.onShow();
  return value;
}
function redFlag() { app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] }; }
function clearPrivateData() { assert.equal(privacy.clearAllLocalData(app).ok, true); }
beforeEach(() => {
  app = { globalData: { sessionSafetyProfile: {} } };
  memory = {}; writes = 0; clipboard = []; modals = []; navigations = []; readFails = false; notices = [];
  global.getApp = () => app;
  global.wx = {
    getStorageSync: (key) => { if (readFails) throw new Error("injected read failure"); return memory[key] || ""; },
    setStorageSync: (key, value) => { writes += 1; memory[key] = value; },
    getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
    removeStorageSync: (key) => { delete memory[key]; },
    setClipboardData: ({ data }) => clipboard.push(data),
    showModal: (options) => modals.push(options),
    showToast: (options) => notices.push(options),
    navigateTo: (options) => navigations.push(options),
    switchTab: (options) => navigations.push(options)
  };
  storage.setChecklist({}); storage.setFavorites([id]); storage.setCompare([id]);
  writes = 0;
});
after(() => {
  storage.setChecklist({});
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});

function favoriteSearchEvent(instance, value) {
  return { detail: { value }, currentTarget: { dataset: { version: instance.data.searchVersion, query: instance.data.query } } };
}

test("favorites rejects a clear control from an older query while accepting the current clear", () => {
  storage.setFavorites([id, "huang-qi"]); writes = 0;
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen")); const oldClear = favoriteSearchEvent(instance, "");
  instance.onSearchInput(favoriteSearchEvent(instance, "huangqi")); instance.clearSearch(oldClear);
  assert.equal(instance.data.query, "huangqi"); assert.deepEqual(instance.data.rows.map(row => row.id), ["huang-qi"]);
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  assert.equal(instance.data.query, ""); assert.equal(instance.data.rows.length, 2); assert.equal(writes, 0);
});
test("favorites explicit clear retires queued input without deleting saved records", () => {
  storage.setFavorites([id, "huang-qi"]); writes = 0;
  const instance = page("favorites"); instance.onSearchInput(favoriteSearchEvent(instance, "huangqi"));
  const oldInput = favoriteSearchEvent(instance, "dangshen");
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  instance.onSearchInput(oldInput); instance.onSearchInput(oldInput);
  assert.equal(instance.data.query, ""); assert.equal(instance.data.rows.length, 2);
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen")); assert.equal(instance.data.rows[0].id, id);
  assert.deepEqual(storage.getFavorites(), [id, "huang-qi"]); assert.equal(writes, 0);
});
test("favorites duplicate clear cannot erase newly entered identical query after a clear", () => {
  const instance = page("favorites"); instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const oldClear = favoriteSearchEvent(instance, ""); instance.clearSearch(oldClear);
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen")); instance.clearSearch(oldClear);
  assert.equal(instance.data.query, "dangshen"); assert.equal(instance.data.rows[0].id, id); assert.equal(writes, 0);
});
test("favorites continuous input shares a generation until clear and accepts newly rendered input afterward", () => {
  const instance = page("favorites"), version = instance.data.searchVersion;
  for (const value of ["d", "da", "dang", "dangshen"]) {
    instance.onSearchInput({ detail: { value }, currentTarget: { dataset: { version } } });
    assert.equal(instance.data.query, value); assert.equal(instance.data.searchVersion, version);
  }
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  instance.onSearchInput(favoriteSearchEvent(instance, "党参"));
  assert.equal(instance.data.rows[0].id, id); assert.equal(writes, 0);
});

test("favorites explain alias hits with the same processing caution and clear it on new searches", () => {
  storage.setFavorites(["di-huang", "huang-qi"]); writes = 0;
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "熟地黄"));
  assert.equal(instance.data.rows.length, 1);
  assert.equal(instance.data.rows[0].searchMatchText, "别名命中：熟地黄（公告所述加工品）");
  assert.match(instance.data.rows[0].searchMatchNote, /不表示不同部位或加工形态相同、可替代/);
  instance.onSearchInput(favoriteSearchEvent(instance, "huangqi"));
  assert.equal(instance.data.rows[0].searchMatchText, "拼音命中：huang qi");
  assert.equal(instance.data.rows[0].searchMatchNote, "");
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  assert(instance.data.rows.every(v => !v.searchMatchText && !v.searchMatchNote));
  assert.deepEqual(storage.getFavorites(), ["di-huang", "huang-qi"]);
  assert.equal(writes, 0); assert.deepEqual(clipboard, []);
});

function readingEvent(instance, mode) {
  return { currentTarget: { dataset: { mode, version: instance.data.displayVersion } } };
}

function differenceEvent(instance, value) {
  return { detail: { value }, currentTarget: { dataset: { version: instance.data.displayVersion } } };
}

test("difference switch rejects a queued control after leaving and returning to comparison", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  const old = differenceEvent(instance, true);
  instance.onHide(); instance.onShow(); instance.setDifferenceMode(old);
  assert.equal(instance.data.differencesOnly, false);
  instance.setDifferenceMode(differenceEvent(instance, true)); assert.equal(instance.data.differencesOnly, true);
  assert.equal(writes, 0);
});

test("difference switch rejects an old list control even when its handler first observes a changed selection", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare");
  const old = differenceEvent(instance, true);
  storage.setCompare([id, "shan-yao"]); writes = 0;
  instance.setDifferenceMode(old);
  assert.deepEqual(instance.data.ingredients.map(item => item.id), [id, "shan-yao"]);
  assert.equal(instance.data.differencesOnly, false);
  instance.setDifferenceMode(differenceEvent(instance, true)); assert.equal(instance.data.differencesOnly, true);
  assert.equal(writes, 0);
});

test("difference switch cannot replay before privacy deletion into an identical new selection", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare");
  const old = differenceEvent(instance, true);
  clearPrivateData(); storage.setCompare([id, "huang-qi"]); writes = 0;
  instance.setDifferenceMode(old); assert.equal(instance.data.differencesOnly, false);
  assert.deepEqual(storage.getFavorites(), []); assert.deepEqual(storage.getChecklist(), {});
  instance.setDifferenceMode(differenceEvent(instance, true)); assert.equal(instance.data.differencesOnly, true);
  assert.equal(writes, 0);
});

test("difference switch retires accepted controls so duplicates cannot undo a later choice", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  const old = differenceEvent(instance, true);
  instance.setDifferenceMode(old); assert.equal(instance.data.differencesOnly, true);
  instance.setDifferenceMode(differenceEvent(instance, false)); assert.equal(instance.data.differencesOnly, false);
  instance.setDifferenceMode(old); assert.equal(instance.data.differencesOnly, false);
  assert.equal(writes, 0);
});

test("difference switch is unavailable with fewer than two comparison items", () => {
  const instance = page("compare"); writes = 0;
  instance.setDifferenceMode(differenceEvent(instance, true)); assert.equal(instance.data.differencesOnly, false);
  assert.deepEqual(storage.getCompare(), [id]); assert.equal(writes, 0);
});

test("difference switch requires current numeric generation and Boolean value", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  for (const event of [null, {}, { detail: { value: true } },
    { detail: { value: true }, currentTarget: { dataset: {} } },
    { detail: { value: true }, currentTarget: { dataset: { version: String(instance.data.displayVersion) } } },
    { detail: { value: true }, currentTarget: { dataset: { version: -1 } } },
    differenceEvent(instance, "true"), differenceEvent(instance, 1)]) {
    assert.doesNotThrow(() => instance.setDifferenceMode(event)); assert.equal(instance.data.differencesOnly, false);
  }
  instance.setDifferenceMode(differenceEvent(instance, true)); assert.equal(instance.data.differencesOnly, true);
  assert.equal(writes, 0);
});

test("difference switch rejects pre-failure controls after read recovery and red-flag recovery", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  const beforeFailure = differenceEvent(instance, true);
  readFails = true; instance.refresh(); readFails = false; instance.refresh();
  instance.setDifferenceMode(beforeFailure); assert.equal(instance.data.differencesOnly, false);
  const beforeRedFlag = differenceEvent(instance, true);
  redFlag(); instance.refresh(); app.globalData.sessionSafetyProfile = {}; instance.refresh();
  instance.setDifferenceMode(beforeRedFlag); assert.equal(instance.data.differencesOnly, false);
  instance.setDifferenceMode(differenceEvent(instance, true)); assert.equal(instance.data.differencesOnly, true);
  assert.equal(writes, 0);
});

test("all 106 favorite cards preserve the recorded part and pending review text", () => {
  const catalog = require("../data/ingredients"), display = require("../utils/food-display");
  for (const item of catalog.ingredients) {
    storage.setFavorites([item.id]); const beforeWrites = writes;
    const instance = page("favorites"), card = instance.data.rows[0];
    assert.equal(instance.data.rows.length, 1);
    const expected = display.foodIdentityDisplay(item);
    assert.equal(card.partText, expected.partText); assert.equal(card.partReviewText, expected.partReviewText);
    assert.equal(writes, beforeWrites);
  }
});

test("comparison selection cards keep part review visible in difference mode and both reading layouts", () => {
  const display = require("../utils/food-display");
  storage.setCompare(["huang-qi", "gou-qi-zi"]); const beforeWrites = writes;
  const instance = page("compare"); instance.setDifferenceMode(differenceEvent(instance, true));
  for (const mode of ["stacked", "table"]) {
    instance.setReadingMode(readingEvent(instance, mode));
    for (const item of instance.data.ingredients) {
      const expected = display.foodIdentityDisplay(item);
      assert.equal(item.partText, expected.partText); assert.equal(item.partReviewText, expected.partReviewText);
    }
    assert.equal(instance.data.partScopeNotice, display.PART_SCOPE_NOTICE);
  }
  assert.equal(writes, beforeWrites);
});

test("compact cards and single or multiple compare selections render part review next to recorded text", () => {
  const fs = require("node:fs"), path = require("node:path");
  const card = fs.readFileSync(path.join(__dirname, "../components/ingredient-card/ingredient-card.wxml"), "utf8");
  assert(card.includes("目录记录部位：{{item.partText}}")); assert(card.includes("{{item.partReviewText}}"));
  const css = fs.readFileSync(path.join(__dirname, "../components/ingredient-card/ingredient-card.wxss"), "utf8");
  assert(!/compact[^{}]*part-review[^{}]*\{[^}]*display\s*:\s*none/.test(css));
  const compare = fs.readFileSync(path.join(__dirname, "../pages/compare/compare.wxml"), "utf8");
  assert.equal((compare.match(/目录记录部位：\{\{item.partText\}\}/g) || []).length, 2);
  assert.equal((compare.match(/\{\{item.partReviewText\}\}/g) || []).length, 2);
  assert(compare.includes("{{partScopeNotice}}"));
});

test("comparison defaults to stacked reading and switching layout does not change any information or record", () => {
  storage.setCompare([id, "huang-qi"]); storage.setChecklist({ identity: true }); writes = 0;
  const instance = page("compare"), before = JSON.stringify(instance.data.groups);
  assert.equal(instance.data.readingMode, "stacked");
  instance.setReadingMode(readingEvent(instance, "table")); assert.equal(instance.data.readingMode, "table");
  assert.equal(JSON.stringify(instance.data.groups), before);
  instance.setReadingMode(readingEvent(instance, "stacked")); assert.equal(instance.data.readingMode, "stacked");
  assert.equal(JSON.stringify(instance.data.groups), before); assert.deepEqual(storage.getCompare(), [id, "huang-qi"]);
  assert.deepEqual(storage.getChecklist(), { identity: true }); assert.equal(writes, 0);
  assert.deepEqual(navigations, []); assert.deepEqual(modals, []); assert.deepEqual(clipboard, []);
});

test("comparison reading layout only accepts current fixed controls with two or more items", () => {
  const single = page("compare"); single.setReadingMode(readingEvent(single, "table")); assert.equal(single.data.readingMode, "stacked");
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  for (const event of [null, {}, { currentTarget: { dataset: { mode: "table" } } }, readingEvent(instance, "anything"),
    { currentTarget: { dataset: { mode: "table", version: -1 } } }]) {
    assert.doesNotThrow(() => instance.setReadingMode(event)); assert.equal(instance.data.readingMode, "stacked");
  }
  instance.setReadingMode(readingEvent(instance, "table")); assert.equal(instance.data.readingMode, "table"); assert.equal(writes, 0);
});

test("comparison preserves reading layout on normal return but rejects previous visibility controls", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  instance.setReadingMode(readingEvent(instance, "table")); const old = readingEvent(instance, "stacked");
  instance.onHide(); instance.setReadingMode(old); assert.equal(instance.data.readingMode, "table");
  instance.onShow(); instance.setReadingMode(old); assert.equal(instance.data.readingMode, "table");
  instance.setReadingMode(readingEvent(instance, "stacked")); assert.equal(instance.data.readingMode, "stacked");
  instance.onUnload(); instance.setData = () => assert.fail("late view update"); instance.setReadingMode(old); assert.equal(writes, 0);
});

test("comparison refresh rebinds every visible cell after removal without mixing names and values", () => {
  storage.setCompare([id, "huang-qi", "gou-qi-zi", "shan-yao"]); const instance = page("compare");
  instance.removeIngredient({ currentTarget: { dataset: { id: "huang-qi" } } });
  for (const group of instance.data.groups) for (const entry of group.rows) {
    assert.deepEqual(entry.cells.map(x => x.ingredientId), instance.data.ingredients.map(x => x.id));
    assert.deepEqual(entry.cells.map(x => x.nameCn), instance.data.ingredients.map(x => x.nameCn));
    assert.deepEqual(entry.cells.map(x => x.text), entry.values);
  }
  assert.deepEqual(instance.data.ingredients.map(x => x.id), [id, "gou-qi-zi", "shan-yao"]);
});

test("comparison difference filtering and reading layout remain independent and malformed switches do nothing", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  instance.setDifferenceMode(differenceEvent(instance, true));
  const before = JSON.stringify(instance.data.groups);
  instance.setReadingMode(readingEvent(instance, "table")); assert.equal(JSON.stringify(instance.data.groups), before);
  assert.equal(instance.data.differencesOnly, true);
  for (const event of [null, {}, { detail: {} }, { detail: { value: "false" } }, { detail: { value: 0 } }]) {
    assert.doesNotThrow(() => instance.setDifferenceMode(event)); assert.equal(instance.data.differencesOnly, true);
  }
  instance.setDifferenceMode(differenceEvent(instance, false)); assert.equal(instance.data.differencesOnly, false);
  assert.equal(instance.data.readingMode, "table"); assert.equal(writes, 0);
});

test("red flags and unreadable records hide both comparison views and reject old layout controls", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare"); writes = 0;
  const old = readingEvent(instance, "table"); redFlag(); instance.setReadingMode(old);
  assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.groups, []);
  app.globalData.sessionSafetyProfile = {}; instance.refresh(); instance.setReadingMode(old);
  assert.equal(instance.data.readingMode, "stacked");
  const readable = readingEvent(instance, "table"); readFails = true; instance.setReadingMode(readable);
  assert(instance.data.storageIssue); assert.deepEqual(instance.data.ingredients, []); assert.deepEqual(instance.data.groups, []);
  readFails = false; instance.refresh(); instance.setReadingMode(readable); assert.equal(instance.data.readingMode, "stacked");
  instance.setReadingMode(readingEvent(instance, "table")); assert.equal(instance.data.readingMode, "table"); assert.equal(writes, 0);
});

test("privacy deletion resets comparison reading layout and invalidates old controls after reselection", () => {
  storage.setCompare([id, "huang-qi"]); const instance = page("compare");
  instance.setReadingMode(readingEvent(instance, "table")); const old = readingEvent(instance, "table");
  clearPrivateData(); instance.refresh(); assert.equal(instance.data.readingMode, "stacked");
  storage.setCompare([id, "huang-qi"]); writes = 0; instance.refresh(); instance.setReadingMode(old);
  assert.equal(instance.data.readingMode, "stacked"); instance.setReadingMode(readingEvent(instance, "table"));
  assert.equal(instance.data.readingMode, "table"); assert.equal(writes, 0);
});

test("comparison templates share named data while keeping warnings, controls and stacked content outside horizontal scrolling", () => {
  const fs = require("node:fs"), path = require("node:path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/compare/compare.wxml"), "utf8");
  const gate = template.indexOf('wx:elif="{{!storageIssue && ingredients.length >= 2}}"');
  const selector = template.indexOf('class="reading-controls"');
  const stacked = template.indexOf('wx:if="{{readingMode === \'stacked\'}}"');
  const table = template.indexOf('<scroll-view wx:else');
  assert(gate >= 0 && selector > gate && stacked > selector && table > stacked);
  assert(template.indexOf("先看禁忌") < selector);
  assert(template.includes('data-mode="stacked" data-version="{{displayVersion}}"'));
  assert(template.includes('data-mode="table" data-version="{{displayVersion}}"'));
  const common = template.slice(gate, stacked);
  for (const token of ["item.reasonText", "item.warningText", 'bindtap="openDetail"', 'bindtap="removeIngredient"', 'bindtap="toggleFavorite"']) assert(common.includes(token));
  const vertical = template.slice(stacked, table);
  for (const token of ["{{group.title}}", "{{row.label}}", "{{cell.nameCn}}", "{{cell.text}}"]) assert(vertical.includes(token));
  assert(!vertical.includes("scroll-view"));
  const horizontal = template.slice(table);
  assert(horizontal.includes('scroll-x')); assert(horizontal.includes("{{cell.text}}"));
});

test("favorites search narrows saved records using the shared Chinese and pinyin matcher", () => {
  storage.setFavorites([id, "huang-qi", "gou-qi-zi"]); writes = 0;
  const instance = page("favorites");
  for (const query of ["黄芪", "huangqi", "huáng qí", "ＨＵＡＮＧ　ＱＩ"]) {
    instance.onSearchInput(favoriteSearchEvent(instance, query));
    assert.equal(instance.data.query, query);
    assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi"]);
    assert.equal(instance.data.favoriteCount, 3);
  }
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  assert.deepEqual(instance.data.rows.map(x => x.id), [id, "huang-qi", "gou-qi-zi"]);
  instance.onSearchInput(favoriteSearchEvent(instance, "NOT_A_SAVED_RECORD"));
  assert.deepEqual(instance.data.rows, []); assert.equal(instance.data.favoriteCount, 3);
  assert.equal(writes, 0); assert.deepEqual(storage.getFavorites(), [id, "huang-qi", "gou-qi-zi"]);
});

test("favorites search never includes matching records outside the saved list or reorders saved records", () => {
  storage.setFavorites(["huang-qi", id]); const instance = page("favorites"); writes = 0;
  instance.onSearchInput(favoriteSearchEvent(instance, ""));
  assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi", id]);
  instance.onSearchInput(favoriteSearchEvent(instance, "枸杞"));
  assert.deepEqual(instance.data.rows, []); assert.equal(instance.data.favoriteCount, 2);
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi", id]); assert.equal(writes, 0);
});

test("favorites search reuses actual aliases and Latin-name boundaries without network or storage writes", () => {
  const catalog = require("../data/ingredients").ingredients;
  const aliased = catalog.find(x => Array.isArray(x.aliases) && x.aliases.length);
  assert(aliased); storage.setFavorites([aliased.id, "huang-qi"]); writes = 0;
  const instance = page("favorites");
  wx.request = () => assert.fail("local search must not make network requests");
  instance.onSearchInput(favoriteSearchEvent(instance, aliased.aliases[0]));
  assert(instance.data.rows.some(x => x.id === aliased.id));
  instance.onSearchInput(favoriteSearchEvent(instance, "ASTRAGALUS   MEMBRANACEUS"));
  assert.deepEqual(instance.data.rows.map(x => x.id), ["huang-qi"]);
  instance.onSearchInput(favoriteSearchEvent(instance, "黄芪 huang")); assert.deepEqual(instance.data.rows, []);
  assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(modals, []); assert.deepEqual(navigations, []);
});

test("failed removal in filtered favorites retains the query, saved IDs and checklist for explicit retry", () => {
  storage.setFavorites([id, "huang-qi"]); storage.setChecklist({ identity: true }); writes = 0;
  const instance = page("favorites"); instance.onSearchInput(favoriteSearchEvent(instance, "huangqi"));
  const original = wx.setStorageSync; wx.setStorageSync = () => { throw Error("FICTIONAL_WRITE_FAILURE"); };
  instance.removeFavorite({ detail: { id: "huang-qi" } });
  assert.deepEqual(storage.getFavorites(), [id, "huang-qi"]); assert.equal(instance.data.query, "huangqi");
  assert.equal(instance.data.favoriteCount, 2); assert.equal(instance.data.rows[0].id, "huang-qi");
  assert.deepEqual(storage.getChecklist(), { identity: true }); assert.equal(writes, 0); assert.equal(notices.length, 1);
  wx.setStorageSync = original; instance.removeFavorite({ detail: { id: "huang-qi" } });
  assert.deepEqual(storage.getFavorites(), [id]); assert.equal(instance.data.query, "huangqi"); assert.deepEqual(instance.data.rows, []);
  assert.deepEqual(storage.getChecklist(), { identity: true });
});

test("favorites search preserves blocked saved records for reading and removal without allowing new compare", () => {
  storage.setCompare([]); const instance = page("favorites");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.refresh(); writes = 0;
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  assert.equal(instance.data.rows.length, 1); assert.equal(instance.data.rows[0].blocked, true);
  assert(instance.data.rows[0].blockedReason);
  instance.toggleCompare(cardEvent); assert.deepEqual(storage.getCompare(), []); assert.equal(writes, 0);
  instance.removeFavorite(cardEvent); assert.deepEqual(storage.getFavorites(), []); assert.equal(instance.data.favoriteCount, 0);
});

test("favorites search input is bounded and malformed events cannot clear the current query", () => {
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "黄芪" + "x".repeat(100)));
  assert.equal(instance.data.query.length, 60);
  const before = instance.data.query;
  for (const event of [null, {}, { detail: { value: "党参" } }, favoriteSearchEvent(instance, {}), favoriteSearchEvent(instance, 1)]) {
    assert.doesNotThrow(() => instance.onSearchInput(event)); assert.equal(instance.data.query, before);
  }
  instance.clearSearch({ currentTarget: { dataset: { version: -1 } } }); assert.equal(instance.data.query, before);
  instance.clearSearch(favoriteSearchEvent(instance, "")); assert.equal(instance.data.query, ""); assert.equal(writes, 0);
});

test("favorites search survives ordinary navigation but ignores hidden, unloaded and previous-generation input", () => {
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen")); const old = favoriteSearchEvent(instance, "黄芪");
  instance.onHide(); instance.onSearchInput(old); assert.equal(instance.data.query, "dangshen");
  instance.onShow(); assert.equal(instance.data.query, "dangshen");
  instance.onSearchInput(old); assert.equal(instance.data.query, "dangshen");
  instance.onSearchInput(favoriteSearchEvent(instance, "党参")); assert.equal(instance.data.query, "党参");
  instance.onUnload(); instance.setData = () => assert.fail("late view update");
  instance.onSearchInput(old); instance.clearSearch(old); assert.equal(writes, 0);
});

test("privacy deletion clears favorites query and stale input cannot restore it even after new selections", () => {
  const instance = page("favorites"); instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "dangshen"); clearPrivateData();
  instance.onSearchInput(old); assert.equal(instance.data.query, ""); assert.deepEqual(instance.data.rows, []);
  assert.equal(instance.data.favoriteCount, 0);
  storage.setFavorites(["huang-qi"]); writes = 0; instance.refresh();
  instance.onSearchInput(old); assert.equal(instance.data.query, ""); assert.equal(instance.data.rows[0].id, "huang-qi");
  instance.onSearchInput(favoriteSearchEvent(instance, "huangqi")); assert.equal(instance.data.query, "huangqi"); assert.equal(writes, 0);
});

test("favorites search keeps unknown counts and read recovery distinct from an empty or unmatched list", () => {
  const instance = page("favorites"); instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "黄芪"); readFails = true;
  instance.onSearchInput(old); assert.equal(instance.data.query, "dangshen");
  assert.equal(instance.data.favoriteCount, null); assert.deepEqual(instance.data.rows, []); assert(instance.data.storageIssue);
  readFails = false; instance.refresh();
  assert.equal(instance.data.query, "dangshen"); assert.equal(instance.data.favoriteCount, 1); assert.equal(instance.data.rows[0].id, id);
  instance.onSearchInput(old); assert.equal(instance.data.query, "dangshen");
  instance.clearSearch(favoriteSearchEvent(instance, "")); assert.equal(instance.data.query, ""); assert.equal(writes, 0);
});

test("new red flags suppress favorites search without clearing stored IDs or the current query", () => {
  const instance = page("favorites"); instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "黄芪"); redFlag(); instance.onSearchInput(old);
  assert.equal(instance.data.triageBlocked, true); assert.equal(instance.data.query, "dangshen");
  assert.deepEqual(instance.data.rows, []); assert.deepEqual(storage.getFavorites(), [id]);
  app.globalData.sessionSafetyProfile = {}; instance.refresh(); instance.onSearchInput(old);
  assert.equal(instance.data.query, "dangshen"); assert.equal(instance.data.rows[0].id, id); assert.equal(writes, 0);
});

test("row events hidden by favorites search cannot remove or select an unrelated saved record", () => {
  storage.setFavorites([id, "huang-qi"]); const instance = page("favorites"); writes = 0;
  instance.onSearchInput(favoriteSearchEvent(instance, "huangqi"));
  instance.removeFavorite(cardEvent); instance.toggleCompare(cardEvent); instance.openDetail(cardEvent);
  assert.equal(writes, 0); assert.deepEqual(navigations, []); assert.deepEqual(storage.getFavorites(), [id, "huang-qi"]);
  instance.removeFavorite({ detail: { id: "huang-qi" } });
  assert.deepEqual(storage.getFavorites(), [id]); assert.equal(instance.data.favoriteCount, 1); assert.deepEqual(instance.data.rows, []);
  instance.clearSearch(favoriteSearchEvent(instance, "")); assert.equal(instance.data.rows[0].id, id);
});

test("favorites keyboard confirmation applies its value and retires queued input and duplicate confirmation", () => {
  storage.setFavorites([id, "huang-qi"]); writes = 0;
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const oldInput = favoriteSearchEvent(instance, "dangshen");
  const confirmed = favoriteSearchEvent(instance, "HUÁNGQÍ");
  instance.onSearchConfirm(confirmed);
  assert.equal(instance.data.query, "HUÁNGQÍ");
  assert.deepEqual(instance.data.rows.map(row => row.id), ["huang-qi"]);
  const before = JSON.stringify(instance.data);
  instance.onSearchInput(oldInput); instance.onSearchConfirm(confirmed);
  assert.equal(JSON.stringify(instance.data), before);
  instance.onSearchInput(favoriteSearchEvent(instance, "党参"));
  assert.equal(instance.data.rows[0].id, id);
  assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(navigations, []);
});

test("favorites confirmation bounds input and ignores malformed events without retiring the current input", () => {
  const instance = page("favorites");
  wx.request = () => assert.fail("favorites confirmation must remain local");
  instance.onSearchConfirm(favoriteSearchEvent(instance, "x".repeat(100)));
  assert.equal(instance.data.query.length, 60);
  const before = JSON.stringify(instance.data);
  for (const event of [null, {}, { detail: { value: "党参" } }, favoriteSearchEvent(instance, {}), favoriteSearchEvent(instance, 1)]) {
    assert.doesNotThrow(() => instance.onSearchConfirm(event));
    assert.equal(JSON.stringify(instance.data), before);
  }
  instance.onSearchConfirm(favoriteSearchEvent(instance, "dangshen"));
  assert.equal(instance.data.rows[0].id, id); assert.equal(writes, 0);
});

test("favorites clear rejects queued keyboard confirmation and only fresh input may search again", () => {
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "dangshen");
  instance.clearSearch(favoriteSearchEvent(instance, ""));
  instance.onSearchConfirm(old); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, ""); assert.equal(instance.data.rows.length, 1);
  instance.onSearchConfirm(favoriteSearchEvent(instance, "党参"));
  assert.equal(instance.data.query, "党参"); assert.equal(instance.data.rows[0].id, id);
  assert.equal(writes, 0);
});

test("favorites confirmation rejects hidden, previous-generation and unloaded events", () => {
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "黄芪");
  instance.onHide(); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, "dangshen");
  instance.onShow(); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, "dangshen"); assert.equal(instance.data.rows[0].id, id);
  instance.onSearchConfirm(favoriteSearchEvent(instance, "党参"));
  assert.equal(instance.data.query, "党参");
  instance.onUnload(); instance.setData = () => assert.fail("late confirmation view update");
  instance.onSearchConfirm(old); assert.equal(writes, 0);
});

test("privacy deletion rejects queued favorites confirmation even after a new favorite is saved", () => {
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "dangshen");
  clearPrivateData(); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, ""); assert.deepEqual(instance.data.rows, []);
  assert.equal(instance.data.favoriteCount, 0);
  storage.setFavorites(["huang-qi"]); writes = 0; instance.refresh();
  instance.onSearchConfirm(old); instance.onSearchConfirm(old);
  assert.equal(instance.data.query, ""); assert.equal(instance.data.rows[0].id, "huang-qi");
  instance.onSearchConfirm(favoriteSearchEvent(instance, "huangqi"));
  assert.equal(instance.data.query, "huangqi"); assert.equal(writes, 0);
});

for (const restriction of ["unreadable storage", "red flags"]) test(`favorites confirmation respects ${restriction} and cannot replay after recovery`, () => {
  const instance = page("favorites");
  instance.onSearchInput(favoriteSearchEvent(instance, "dangshen"));
  const old = favoriteSearchEvent(instance, "黄芪");
  if (restriction === "unreadable storage") readFails = true;
  else redFlag();
  instance.onSearchConfirm(old);
  assert.equal(instance.data.query, "dangshen"); assert.deepEqual(instance.data.rows, []);
  if (restriction === "unreadable storage") { assert(instance.data.storageIssue); assert.equal(instance.data.favoriteCount, null); }
  else assert.equal(instance.data.triageBlocked, true);
  readFails = false; app.globalData.sessionSafetyProfile = {}; instance.refresh();
  instance.onSearchConfirm(old);
  assert.equal(instance.data.query, "dangshen"); assert.equal(instance.data.rows[0].id, id);
  assert.deepEqual(storage.getFavorites(), [id]); assert.equal(writes, 0);
});

test("favorites search template separates no matches, no saved records and unavailable records", () => {
  const fs = require("node:fs"), path = require("node:path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/favorites/favorites.wxml"), "utf8");
  assert(template.includes('wx:if="{{!storageIssue && !triageBlocked}}" class="favorite-search"'));
  const input = template.match(/<input\b[^>]*class="favorite-search__input"[^>]*>/)[0];
  for (const token of ['maxlength="60"', 'value="{{query}}"', 'bindinput="onSearchInput"',
    'bindconfirm="onSearchConfirm"', 'data-version="{{searchVersion}}"', 'confirm-type="search"']) assert(input.includes(token));
  assert(template.includes('bindtap="clearSearch" data-version="{{searchVersion}}"'));
  const clearControls = template.match(/<button\b[^>]*bindtap="clearSearch"[^>]*>/g);
  assert.equal(clearControls.length, 2);
  assert(clearControls.every(control => control.includes('data-query="{{query}}"')));
  assert(template.includes('wx:elif="{{!storageIssue && favoriteCount > 0}}"'));
  assert(template.includes("收藏中没有匹配条目")); assert(template.includes("显示 {{rows.length}} / {{favoriteCount}} 项收藏"));
  assert(template.includes("还没有收藏"));
});

test("single comparison template identifies the pending selection with guarded detail and removal actions", () => {
  const fs = require("node:fs"), path = require("node:path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/compare/compare.wxml"), "utf8");
  assert(template.includes('wx:elif="{{ingredients.length < 2 && !storageIssue}}"'));
  assert(template.includes("{{ingredients.length === 1 ? '已选一项，再添加一项开始对照' : '至少选择两项资料'}}"));
  const panel = template.match(/<view wx:if="\{\{ingredients.length === 1\}\}" class="pending-selection">([\s\S]*?)<\/block>\s*<\/view>/);
  assert(panel, "single selection panel must stay inside the guarded empty state");
  const empty = template.indexOf('wx:elif="{{ingredients.length < 2 && !storageIssue}}"');
  const table = template.indexOf('wx:elif="{{!storageIssue && ingredients.length >= 2}}"');
  assert(template.indexOf(panel[0]) > empty && template.indexOf(panel[0]) < table);
  for (const field of ["item.nameCn", "item.partText", "item.partReviewText", "item.safetyLabel", "item.reasonText", "item.warningText"]) {
    assert(panel[1].includes(`{{${field}}}`), `pending selection needs ${field}`);
  }
  assert(panel[1].includes('bindtap="openDetail" data-id="{{item.id}}"'));
  assert(panel[1].includes('bindtap="removeIngredient" data-id="{{item.id}}"'));
  assert(!panel[1].includes("toggleFavorite"));
  assert(template.includes('wx:if="{{ingredients.length >= 2}}" class="difference-toggle"'));
});

test("comparison preserves one selection while browsing and transitions two to one to empty", () => {
  storage.setChecklist({ identity: true });
  const instance = page("compare");
  assert.equal(instance.data.ingredients.length, 1);
  assert.equal(instance.data.ingredients[0].nameCn, "党参");
  instance.goCatalog();
  assert.equal(navigations.at(-1).url, "/pages/index/index");
  navigations.at(-1).success(); instance.onHide();
  assert.deepEqual(storage.getCompare(), [id]);
  assert.deepEqual(storage.getChecklist(), { identity: true });
  storage.toggleCompare("huang-qi"); instance.onShow();
  assert.equal(instance.data.ingredients.length, 2);
  instance.removeIngredient({ currentTarget: { dataset: { id: "huang-qi" } } });
  assert.deepEqual(instance.data.ingredients.map((item) => item.id), [id]);
  instance.openDetail(rowEvent);
  assert.equal(navigations.at(-1).url, "/subpackages/catalog/detail/detail?id=dang-shen");
  navigations.at(-1).success(); instance.onHide(); instance.onShow();
  assert.deepEqual(storage.getCompare(), [id]);
  instance.removeIngredient(rowEvent);
  assert.deepEqual(instance.data.ingredients, []);
  assert.deepEqual(storage.getCompare(), []);
  assert.deepEqual(storage.getFavorites(), [id]);
  assert.deepEqual(storage.getChecklist(), {});
});

test("single comparison removal failure retains the selection and checklist for an explicit retry", () => {
  storage.setChecklist({ identity: true });
  const instance = page("compare"), originalWrite = wx.setStorageSync;
  wx.setStorageSync = () => { throw new Error("FICTIONAL_PRIVATE_WRITE_ERROR"); };
  instance.removeIngredient(rowEvent);
  assert.deepEqual(storage.getCompare(), [id]);
  assert.deepEqual(instance.data.ingredients.map((item) => item.id), [id]);
  assert.deepEqual(storage.getChecklist(), { identity: true });
  assert.equal(notices.at(-1).title, "本机保存失败，请检查后重试");
  wx.setStorageSync = originalWrite; instance.refresh();
  assert.deepEqual(storage.getCompare(), [id]);
  instance.removeIngredient(rowEvent);
  assert.deepEqual(storage.getCompare(), []);
  assert.deepEqual(storage.getChecklist(), {});
});

test("single comparison remains removable when newly restricted but red flags and unreadable records hide it", () => {
  const instance = page("compare");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler" };
  instance.refresh();
  assert.equal(instance.data.ingredients.length, 1);
  assert.equal(instance.data.ingredients[0].blocked, true);
  assert(instance.data.ingredients[0].reasonText);
  writes = 0; redFlag(); instance.removeIngredient(rowEvent);
  assert.equal(instance.data.triageBlocked, true);
  assert.deepEqual(instance.data.ingredients, []);
  assert.deepEqual(storage.getCompare(), [id]); assert.equal(writes, 0);
  app.globalData.sessionSafetyProfile = {}; readFails = true; instance.refresh();
  assert(instance.data.storageIssue); assert.deepEqual(instance.data.ingredients, []);
  readFails = false; instance.refresh();
  assert.deepEqual(storage.getCompare(), [id]); assert.equal(writes, 0);
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler" };
  instance.removeIngredient(rowEvent);
  assert.deepEqual(storage.getCompare(), []);
});

test("single comparison old selection buttons cannot revive a record after deletion", () => {
  const instance = page("compare"); clearPrivateData();
  instance.openDetail(rowEvent); instance.removeIngredient(rowEvent);
  assert.deepEqual(navigations, []);
  assert.deepEqual(instance.data.ingredients, []);
  assert.deepEqual(storage.getCompare(), []); assert.deepEqual(storage.getFavorites(), []);
  assert.equal(writes, 0);
});

test("plan does not label a known adult age alone as high risk", () => {
  app.globalData.sessionSafetyProfile = { ageGroup: "adult" };
  const instance = page("plan");
  assert.equal(instance.data.profileSummaryTitle, "核心安全信息仍有未知");
  assert(instance.data.profileSummaryText.includes("年龄阶段：成年人"));
  assert(instance.data.profileSummaryText.includes("已填写 1/6 项"));
  assert(!instance.data.profileSummaryTitle.includes("高风险"));
});

test("plan explicitly preserves every unknown core safety answer", () => {
  const instance = page("plan");
  for (const label of ["年龄阶段", "孕期", "哺乳期", "过敏史", "基础疾病或肝肾问题", "在用药品或保健品"]) {
    assert(instance.data.profileSummaryText.includes(`${label}：未填写或未知`));
  }
  assert(instance.data.profileSummaryText.includes("已填写 0/6 项"));
  assert(instance.data.inquiryText.includes("本人填写不等于专业确认"));
  assert.equal(writes, 0);
});

for (const status of ["yes", "no"]) test(`plan displays canonical ${status} answers without requiring legacy flags or private names`, () => {
  app.globalData.sessionSafetyProfile = {
    ageGroup: "adult", pregnancyStatus: status, breastfeedingStatus: status,
    allergyStatus: status, conditionStatus: status, medicationStatus: status
  };
  const instance = page("plan");
  assert.equal(instance.data.profileSummaryTitle, "核心安全问项已填写");
  assert(instance.data.profileSummaryText.includes("已填写 6/6 项"));
  for (const label of ["孕期", "哺乳期", "过敏史", "基础疾病或肝肾问题", "在用药品或保健品"]) {
    assert(instance.data.profileSummaryText.includes(`${label}：本人填写为${status === "yes" ? "是" : "否"}`));
  }
  assert(instance.data.inquiryText.includes("不代表适合食用")); assert.equal(writes, 0);
});

test("plan summary follows canonical legacy fallback and conflicting detail normalization", () => {
  app.globalData.sessionSafetyProfile = {
    riskFlags: ["child", "pregnancy", "breastfeeding", "unknown-private-flag"],
    pregnancyStatus: "no", allergyStatus: "no", allergies: ["FICTIONAL_PRIVATE_ALLERGEN"]
  };
  const instance = page("plan");
  assert(instance.data.profileSummaryText.includes("年龄阶段：儿童或青少年"));
  assert(instance.data.profileSummaryText.includes("孕期：本人填写为否"));
  assert(instance.data.profileSummaryText.includes("哺乳期：本人填写为是"));
  assert(instance.data.profileSummaryText.includes("过敏史：本人填写为是"));
  assert(!instance.data.profileSummaryText.includes("unknown-private-flag"));
});

test("plan never echoes private health names or arbitrary flags into the summary or clipboard", () => {
  const secrets = ["FICTIONAL_PRIVATE_ALLERGY", "FICTIONAL_PRIVATE_CONDITION", "FICTIONAL_PRIVATE_DRUG", "FICTIONAL_PRIVATE_FLAG"];
  app.globalData.sessionSafetyProfile = { allergies: [secrets[0]], conditions: [secrets[1]], medications: [secrets[2]], riskFlags: [secrets[3]] };
  const instance = page("plan"); instance.copyInquiry();
  assert.equal(clipboard.length, 1);
  for (const secret of secrets) {
    assert(!JSON.stringify(instance.data).includes(secret)); assert(!clipboard[0].includes(secret));
  }
  assert(clipboard[0].includes("在用药品或保健品：本人填写为是")); assert.equal(writes, 0);
});

test("checking all consultation preparation items does not assert professional approval or remove unknowns", () => {
  const instance = page("plan"), keys = instance.data.checks.map(item => item.key);
  assert.equal(keys.length, 8);
  const before = instance.data.profileSummaryText;
  instance.onChecklistChange({ detail: { value: keys } });
  assert.equal(instance.data.checkedCount, 8); assert.equal(instance.data.profileSummaryText, before);
  assert(instance.data.inquiryText.includes("本人准备标记：8/8"));
  assert(instance.data.inquiryText.includes("仍需专业人员核对"));
  assert(instance.data.inquiryText.includes("不代表专业审校完成"));
  assert(!instance.data.inquiryText.includes("通用清单已逐项核对"));
  assert.equal(writes, 0);
});

test("plan excluded entries preserve the existing rule reasons and can open current details", () => {
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler" };
  const instance = page("plan");
  const source = require("../data/ingredients").ingredients.find(item => item.id === id);
  const profile = require("../utils/session-profile").fromSession(app.globalData.sessionSafetyProfile);
  const evaluated = require("../utils/safety").evaluateCatalog([source], profile)[0];
  const expected = require("../utils/format").cardView(source, [id], [id], evaluated);
  assert.equal(instance.data.shortlist.length, 0); assert.equal(instance.data.excludedItems.length, 1);
  assert.equal(instance.data.excludedItems[0].reasonText, expected.reasonText); assert(expected.reasonText);
  instance.openDetail(rowEvent); assert.equal(navigations.length, 1); assert.equal(writes, 0);
});

test("plan candidates retain existing pending warnings without interpreting them as approval", () => {
  const instance = page("plan");
  const source = require("../data/ingredients").ingredients.find(item => item.id === id);
  const profile = require("../utils/session-profile").fromSession({});
  const evaluated = require("../utils/safety").evaluateCatalog([source], profile)[0];
  const expected = require("../utils/format").cardView(source, [id], [id], evaluated);
  assert.equal(instance.data.shortlist[0].warningText, expected.warningText); assert(expected.warningText);
  assert.equal(instance.data.shortlist[0].reasonText, expected.reasonText);
});

test("plan template distinguishes self-marking from review and exposes current reasons without strikethrough", () => {
  const fs = require("node:fs"), path = require("node:path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/plan/plan.wxml"), "utf8");
  const style = fs.readFileSync(path.join(__dirname, "../pages/plan/plan.wxss"), "utf8");
  const privacyTemplate = fs.readFileSync(path.join(__dirname, "../pages/privacy/privacy.wxml"), "utf8");
  assert(template.includes("咨询准备清单")); assert(template.includes("本人已标记"));
  assert(template.includes("不代表专业审校完成")); assert(template.includes("不会补全未知信息"));
  assert(template.includes("{{item.reasonText}}")); assert(template.includes("{{item.warningText}}"));
  assert(template.includes('class="secondary-btn excluded-detail" bindtap="openDetail"'));
  assert(!style.includes("line-through")); assert(privacyTemplate.includes("咨询准备自记进度"));
});

test("copy inquiry rebuilds the current profile and candidate list", () => {
  const instance = page("plan");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.copyInquiry();
  assert.equal(clipboard.length, 1);
  assert(clipboard[0].includes("已由安全规则排除、不作为候选：党参"));
  assert(clipboard[0].includes("年龄阶段：婴幼儿"));
});
test("privacy deletion cannot leak the cached inquiry or restore checklist progress", () => {
  app.globalData.sessionSafetyProfile = { medications: ["fictional-private-drug"], medicationStatus: "yes" };
  const instance = page("plan"); clearPrivateData();
  instance.onChecklistChange({ detail: { value: ["identity"] } });
  assert.equal(storage.getChecklist().identity, undefined);
  instance.copyInquiry();
  assert.equal(clipboard.length, 1);
  assert(!clipboard[0].includes("已填写用药信息"));
  assert(!clipboard[0].includes("希望进一步核对：党参"));
});

test("a freshly displayed empty plan still permits a new checklist interaction", () => {
  clearPrivateData(); const instance = page("plan");
  instance.onChecklistChange({ detail: { value: ["identity"] } });
  assert.equal(storage.getChecklist().identity, true);
});

test("checklist events from an earlier safety profile do not re-check the new profile", () => {
  const instance = page("plan");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.onChecklistChange({ detail: { value: ["identity"] } });
  assert.deepEqual(storage.getChecklist(), {});
  instance.onChecklistChange({ detail: { value: ["identity"] } });
  assert.equal(storage.getChecklist().identity, true);
});

for (const [name, action] of [
  ["plan", (v) => v.copyInquiry()],
  ["plan", (v) => v.onChecklistChange({ detail: { value: ["identity"] } })],
  ["favorites", (v) => v.toggleCompare(cardEvent)],
  ["compare", (v) => v.toggleFavorite(rowEvent)]
]) test(`${name} action rechecks newly committed red flags before side effects: ${action}`, () => {
  const instance = page(name); redFlag(); action(instance);
  assert.equal(writes, 0); assert.equal(clipboard.length, 0);
  assert.deepEqual(storage.getChecklist(), {});
  assert.equal(instance.data.triageBlocked, true);
});

test("favorite removal is idempotent when a previous event already removed the row", () => {
  const instance = page("favorites");
  instance.removeFavorite(cardEvent); instance.removeFavorite(cardEvent);
  assert.deepEqual(storage.getFavorites(), []);
  assert.equal(writes, 1);
});
for (const [name, action] of [
  ["favorites", (v) => v.toggleCompare(cardEvent)],
  ["compare", (v) => v.toggleFavorite(rowEvent)]
]) test(`${name} does not recreate deleted IDs from a stale row event`, () => {
  const instance = page(name); clearPrivateData(); action(instance);
  assert.deepEqual(storage.getFavorites(), []); assert.deepEqual(storage.getCompare(), []);
  assert.equal(writes, 0);
});
test("changed restrictions block adding a cached favorite to comparison", () => {
  storage.setCompare([]); writes = 0;
  const instance = page("favorites");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.toggleCompare(cardEvent);
  assert.equal(writes, 0); assert.deepEqual(storage.getCompare(), []);
});
test("changed restrictions block adding a cached comparison to favorites", () => {
  storage.setFavorites([]); writes = 0;
  const instance = page("compare");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  instance.toggleFavorite(rowEvent);
  assert.equal(writes, 0); assert.deepEqual(storage.getFavorites(), []);
});
for (const name of ["compare", "plan"]) {
  const clear = name === "compare" ? "clearCompare" : "clearPlan";
  test(`${name} ignores a pending clear confirmation after privacy deletion and reselection`, () => {
    const instance = page(name); instance[clear]();
    assert.equal(modals.length, 1);
    clearPrivateData(); storage.setCompare(["huang-qi"]); storage.setChecklist({ identity: true });
    const before = writes;
    modals[0].success({ confirm: true });
    assert.deepEqual(storage.getCompare(), ["huang-qi"]);
    assert.deepEqual(storage.getChecklist(), { identity: true }); assert.equal(writes, before);
  });
  test(`${name} ignores old modal callbacks after hiding and returning`, () => {
    const instance = page(name); instance[clear]();
    assert.equal(typeof instance.onHide, "function");
    instance.onHide(); instance.onShow();
    modals[0].success({ confirm: true });
    assert.deepEqual(storage.getCompare(), [id]); assert.equal(writes, 0);
  });
  test(`${name} does not clear a changed selection using an older confirmation`, () => {
    const instance = page(name); instance[clear](); storage.setCompare(["huang-qi"]);
    const before = writes; modals[0].success({ confirm: true });
    assert.deepEqual(storage.getCompare(), ["huang-qi"]); assert.equal(writes, before);
  });
}
test("the current confirmed clear still resets selection and progress", () => {
  for (const name of ["compare", "plan"]) {
    storage.setCompare([id]); storage.setChecklist({ identity: true });
    const instance = page(name); instance[name === "compare" ? "clearCompare" : "clearPlan"]();
    modals.at(-1).success({ confirm: true });
    assert.deepEqual(storage.getCompare(), []); assert.deepEqual(storage.getChecklist(), {});
  }
});
test("new storage read failure blocks inquiry export and checklist mutation", () => {
  const instance = page("plan"); readFails = true;
  instance.copyInquiry(); instance.onChecklistChange({ detail: { value: ["identity"] } });
  assert.deepEqual(clipboard, []); assert.deepEqual(storage.getChecklist(), {});
  assert(instance.data.storageIssue);
});

for (const failedKey of ["all", storage.KEYS.favorites, storage.KEYS.compare]) {
  test(`plan read failure hides incomplete summaries without changing saved records: ${failedKey}`, () => {
    storage.setChecklist({ identity: true });
    const instance = page("plan");
    assert.equal(instance.data.checkedCount, 1);
    assert(instance.data.inquiryText.includes("党参"));
    const recordsBefore = JSON.stringify(memory);
    const originalRead = wx.getStorageSync;
    wx.getStorageSync = (key) => {
      if (failedKey === "all" || key === failedKey) throw new Error("FICTIONAL_PRIVATE_READ_ERROR");
      return originalRead(key);
    };
    writes = 0;
    instance.refresh();
    assert(instance.data.storageIssue);
    assert.equal(instance.data.favoritesCount, null, "unavailable context is not zero saved favorites");
    assert.deepEqual(instance.data.shortlist, []);
    assert.deepEqual(instance.data.excludedItems, []);
    assert.deepEqual(instance.data.checks, []);
    assert.equal(instance.data.inquiryText, "", "no fabricated none/empty consultation summary");
    instance.copyInquiry(); instance.clearPlan();
    instance.onChecklistChange({ detail: { value: ["identity", "allergy"] } });
    assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(modals, []);
    assert.equal(JSON.stringify(memory), recordsBefore);
    assert.deepEqual(storage.getChecklist(), { identity: true });
    wx.getStorageSync = originalRead;
    instance.refresh();
    assert.equal(instance.data.storageIssue, "");
    assert.equal(instance.data.favoritesCount, 1);
    assert.equal(instance.data.checkedCount, 1);
    assert.equal(instance.data.checks.length, 8);
    assert(instance.data.inquiryText.includes("党参"));
    assert.equal(writes, 0); assert.equal(JSON.stringify(memory), recordsBefore);
    instance.copyInquiry(); assert.equal(clipboard.length, 1);
  });
}

test("initial plan read failure does not fabricate an empty consultation and red flags retain priority", () => {
  readFails = true;
  const instance = page("plan");
  assert(instance.data.storageIssue); assert.equal(instance.data.favoritesCount, null);
  assert.equal(instance.data.inquiryText, ""); assert.deepEqual(instance.data.checks, []);
  redFlag(); instance.refresh();
  assert.equal(instance.data.triageBlocked, true);
  assert(instance.data.inquiryText.includes("食养筛选已停止"));
  assert.deepEqual(instance.data.shortlist, []); assert.deepEqual(instance.data.checks, []);
  instance.copyInquiry(); assert.deepEqual(clipboard, []); assert.equal(writes, 0);
});

test("plan template gates counts and dependent sections while keeping local read retry and triage", () => {
  const fs = require("node:fs"), path = require("node:path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/plan/plan.wxml"), "utf8");
  assert(template.includes('wx:if="{{!storageIssue}}" class="plan-overview card"'));
  assert(template.includes('wx:if="{{!storageIssue && !triageBlocked &&'));
  const dependentBlock = template.match(/<block wx:if="\{\{!storageIssue\}\}">([\s\S]*?)<\/block>/);
  assert(dependentBlock, "one closed branch for candidate, checklist and inquiry sections");
  for (const token of ["对照候选", "咨询准备清单", "inquiryText", 'bindtap="copyInquiry"']) assert(dependentBlock[1].includes(token));
  assert(template.includes('bindtap="refresh">重试读取本机记录'));
  assert(template.includes('wx:if="{{triageBlocked}}"'));
});

for (const name of ["favorites", "compare"]) {
  for (const failedKey of ["all", storage.KEYS.favorites, storage.KEYS.compare]) {
    test(`${name} hides dependent saved-list views during read failure and restores without replay: ${failedKey}`, () => {
      storage.setCompare([id, "huang-qi"]); storage.setChecklist({ identity: true });
      const instance = page(name);
      if (name === "favorites") {
        assert.equal(instance.data.rows.length, 1); assert.equal(instance.data.compareCount, 2);
      } else {
        instance.setDifferenceMode(differenceEvent(instance, true));
        assert.equal(instance.data.ingredients.length, 2); assert(instance.data.groups.length > 0);
      }
      const recordsBefore = JSON.stringify(memory), originalRead = wx.getStorageSync;
      wx.getStorageSync = (key) => {
        if (failedKey === "all" || key === failedKey) throw new Error("FICTIONAL_PRIVATE_READ_ERROR");
        return originalRead(key);
      };
      writes = 0; instance.refresh();
      assert(instance.data.storageIssue); assert.equal(instance.data.triageBlocked, false);
      if (name === "favorites") {
        assert.deepEqual(instance.data.rows, []); assert.equal(instance.data.compareCount, null);
        instance.removeFavorite(cardEvent); instance.toggleCompare(cardEvent);
        instance.openDetail(cardEvent); instance.openCompare();
      } else {
        assert.deepEqual(instance.data.ingredients, []); assert.deepEqual(instance.data.groups, []);
        assert.deepEqual(instance.rawItems, []); assert.equal(instance.data.visibleRows, 0);
        assert.equal(instance.data.tableWidth, 800); assert.equal(instance.data.gridTemplate, "200rpx repeat(2, 300rpx)");
        instance.removeIngredient(rowEvent); instance.toggleFavorite(rowEvent);
        instance.openDetail(rowEvent); instance.clearCompare();
        instance.setDifferenceMode(differenceEvent(instance, false));
        assert.equal(instance.data.differencesOnly, true, "a rejected event cannot change the user's display preference");
      }
      assert.equal(writes, 0); assert.deepEqual(modals, []); assert.deepEqual(navigations, []);
      assert.equal(JSON.stringify(memory), recordsBefore); assert.deepEqual(storage.getChecklist(), { identity: true });
      assert(!JSON.stringify(instance.data).includes("FICTIONAL_PRIVATE_READ_ERROR"));
      wx.getStorageSync = originalRead; instance.refresh();
      assert.equal(instance.data.storageIssue, "");
      if (name === "favorites") {
        assert.equal(instance.data.rows.length, 1); assert.equal(instance.data.rows[0].inCompare, true);
        assert.equal(instance.data.compareCount, 2);
      } else {
        assert.deepEqual(instance.data.ingredients.map((item) => item.id), [id, "huang-qi"]);
        assert.equal(instance.data.ingredients[0].isFavorite, true);
        assert(instance.data.groups.length > 0); assert.equal(instance.data.differencesOnly, true);
      }
      assert.equal(writes, 0); assert.deepEqual(modals, []); assert.deepEqual(navigations, []);
      assert.equal(JSON.stringify(memory), recordsBefore); assert.deepEqual(storage.getChecklist(), { identity: true });
      // Only a new, explicit action after recovery can remove the saved record.
      if (name === "favorites") instance.removeFavorite(cardEvent);
      else instance.removeIngredient(rowEvent);
      assert.equal(writes, 1);
    });
  }
  test(`${name} initial read failure retains red-flag priority without dependent lists`, () => {
    readFails = true; redFlag(); const instance = page(name);
    assert(instance.data.storageIssue); assert.equal(instance.data.triageBlocked, true);
    if (name === "favorites") { assert.deepEqual(instance.data.rows, []); assert.equal(instance.data.compareCount, null); }
    else { assert.deepEqual(instance.data.ingredients, []); assert.deepEqual(instance.data.groups, []); assert.deepEqual(instance.rawItems, []); }
    assert.equal(writes, 0);
  });
  test(`${name} template gates saved lists and controls independently of read-error or triage rendering`, () => {
    const fs = require("node:fs"), path = require("node:path");
    const template = fs.readFileSync(path.join(__dirname, `../pages/${name}/${name}.wxml`), "utf8");
    if (name === "favorites") {
      assert(template.includes('wx:if="{{!storageIssue && compareCount >= 2 && !triageBlocked}}"'));
      assert(template.includes('wx:elif="{{!storageIssue && rows.length}}"'));
    } else {
      assert(template.includes('wx:if="{{!storageIssue && ingredients.length}}" class="compare-controls"'));
      assert(template.includes('wx:elif="{{!storageIssue && ingredients.length >= 2}}"'));
    }
    assert(template.includes('wx:if="{{triageBlocked}}"'));
    assert(template.includes('bindtap="refresh">重试读取本机记录'));
  });
}
test("unloaded list pages ignore late actions without updating their view", () => {
  for (const name of ["favorites", "compare", "plan"]) {
    const instance = page(name); instance.onUnload();
    instance.setData = () => assert.fail("late view update");
    if (name === "favorites") { instance.toggleCompare(cardEvent); instance.removeFavorite(cardEvent); }
    if (name === "compare") { instance.toggleFavorite(rowEvent); instance.removeIngredient(rowEvent); instance.clearCompare(); }
    if (name === "plan") { instance.copyInquiry(); instance.clearPlan(); instance.onChecklistChange({ detail: { value: ["identity"] } }); }
  }
  assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(modals, []);
});
test("live red flags stop list navigation from an older row", () => {
  for (const name of ["favorites", "compare", "plan"]) {
    app.globalData.sessionSafetyProfile = {};
    const instance = page(name); redFlag();
    instance.openDetail(name === "favorites" ? cardEvent : rowEvent);
  }
  assert.deepEqual(navigations, []);
});
test("malformed and missing row IDs do not mutate list state", () => {
  for (const name of ["favorites", "compare"]) {
    const instance = page(name);
    for (const event of [null, {}, { detail: {} }, { detail: { id: "not-an-ingredient" }, currentTarget: { dataset: { id: "not-an-ingredient" } } }]) {
      if (name === "favorites") { instance.removeFavorite(event); instance.toggleCompare(event); }
      else { instance.removeIngredient(event); instance.toggleFavorite(event); }
    }
  }
  assert.equal(writes, 0);
});

test("hidden pages ignore late clipboard, write and checklist actions until shown again", () => {
  const favorites = page("favorites"), compare = page("compare"), plan = page("plan");
  for (const instance of [favorites, compare, plan]) instance.onHide();
  favorites.toggleCompare(cardEvent); compare.toggleFavorite(rowEvent);
  plan.copyInquiry(); plan.onChecklistChange({ detail: { value: ["identity"] } });
  assert.equal(writes, 0); assert.deepEqual(clipboard, []); assert.deepEqual(storage.getChecklist(), {});
  plan.onShow(); plan.copyInquiry(); assert.equal(clipboard.length, 1);
});
test("current restrictions do not prevent removing already selected entries", () => {
  const favorites = page("favorites"), compare = page("compare");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  favorites.toggleCompare(cardEvent); compare.toggleFavorite(rowEvent);
  assert.deepEqual(storage.getCompare(), []);
  // The comparison row has gone, so remove the restricted favorite via its own list.
  favorites.removeFavorite(cardEvent); assert.deepEqual(storage.getFavorites(), []);
});
test("freshly restricted comparison can remove its existing favorite", () => {
  const compare = page("compare");
  app.globalData.sessionSafetyProfile = { ageGroup: "infant_toddler", riskFlags: ["infant_toddler"] };
  compare.toggleFavorite(rowEvent);
  assert.deepEqual(storage.getFavorites(), []); assert.deepEqual(storage.getCompare(), [id]);
});
for (const name of ["compare", "plan"]) test(`${name} ignores duplicate confirmation delivery and permits retry after modal failure`, () => {
  const clear = name === "compare" ? "clearCompare" : "clearPlan";
  const instance = page(name); instance[clear](); instance[clear]();
  assert.equal(modals.length, 1);
  modals[0].fail(); instance[clear](); assert.equal(modals.length, 2);
  modals[1].success({ confirm: true }); const before = writes;
  storage.setCompare(["huang-qi"]); const afterSelection = writes;
  modals[1].success({ confirm: true });
  assert.equal(writes, afterSelection); assert.equal(afterSelection, before + 1);
  assert.deepEqual(storage.getCompare(), ["huang-qi"]);
});

for (const name of ["compare", "plan"]) {
  const clear = name === "compare" ? "clearCompare" : "clearPlan";
  const notice = "确认窗口未完成，请再次点击重试";
  test(`${name} synchronous confirmation exception preserves records and releases the retry state`, () => {
    const instance = page(name); storage.setChecklist({ identity: true });
    wx.showModal = () => { throw new Error("FICTIONAL_PRIVATE_MODAL_ERROR"); };
    assert.doesNotThrow(() => instance[clear]());
    assert.equal(instance.pendingClear, null); assert.equal(writes, 0);
    assert.deepEqual(storage.getCompare(), [id]); assert.deepEqual(storage.getChecklist(), { identity: true });
    assert.deepEqual(notices, [{ title: notice, icon: "none" }]);
    wx.showModal = (options) => modals.push(options); instance[clear](); assert.equal(modals.length, 1);
    modals[0].success({ confirm: true }); assert.deepEqual(storage.getCompare(), []);
  });
  test(`${name} missing confirmation API is recoverable and never implies user consent`, () => {
    const instance = page(name); delete wx.showModal;
    assert.doesNotThrow(() => instance[clear]()); assert.equal(instance.pendingClear, null);
    assert.equal(writes, 0); assert.deepEqual(storage.getCompare(), [id]);
    assert.equal(notices.at(-1).title, notice);
    wx.showModal = (options) => modals.push(options); instance[clear](); assert.equal(modals.length, 1);
  });
  test(`${name} asynchronous confirmation failure is visible once and retry requires a new gesture`, () => {
    const instance = page(name); instance[clear]();
    modals[0].fail({ errMsg: "FICTIONAL_PRIVATE_MODAL_ERROR" }); modals[0].fail({});
    assert.deepEqual(notices, [{ title: notice, icon: "none" }]); assert.equal(modals.length, 1);
    assert.equal(instance.pendingClear, null); assert.equal(writes, 0); assert.deepEqual(storage.getCompare(), [id]);
    instance[clear](); assert.equal(modals.length, 2);
    modals[0].success({ confirm: true }); assert.equal(writes, 0);
    modals[1].success({ confirm: false }); assert.equal(writes, 0);
  });
  test(`${name} failed notification does not crash or retain the confirmation state`, () => {
    const instance = page(name); instance[clear](); let attempted = 0;
    wx.showToast = () => { attempted += 1; throw new Error("notice unavailable"); };
    assert.doesNotThrow(() => modals[0].fail({})); assert.equal(attempted, 1);
    assert.equal(instance.pendingClear, null); instance[clear](); assert.equal(modals.length, 2);
    assert.equal(writes, 0);
  });
  test(`${name} a platform throw after synchronous user cancellation cannot become a false failure`, () => {
    const instance = page(name);
    wx.showModal = (options) => { modals.push(options); options.success({ confirm: false }); throw new Error("after callback"); };
    assert.doesNotThrow(() => instance[clear]()); assert.equal(writes, 0); assert.equal(instance.pendingClear, null);
    assert.deepEqual(notices, []); assert.deepEqual(storage.getCompare(), [id]);
  });
  test(`${name} a late failure cannot clear a newer confirmation or notify after hide`, () => {
    const instance = page(name); instance[clear](); const old = modals[0];
    instance.onHide(); old.fail({}); assert.deepEqual(notices, []);
    instance.onShow(); instance[clear](); const current = instance.pendingClear;
    old.fail({}); assert.equal(instance.pendingClear, current);
    instance[clear](); assert.equal(modals.length, 2); assert.equal(writes, 0);
    instance.onUnload(); modals[1].fail({}); assert.deepEqual(notices, []);
  });
  test(`${name} malformed confirmation results never count as explicit consent`, () => {
    const instance = page(name);
    for (const result of [null, undefined, {}, { confirm: "true" }, { confirm: 1 }, { confirm: {} }, { confirm: [] }, { confirm: false }]) {
      instance[clear]();
      assert.doesNotThrow(() => modals.at(-1).success(result));
      assert.equal(instance.pendingClear, null); assert.equal(writes, 0);
      assert.deepEqual(storage.getCompare(), [id]);
    }
  });
}
test("compare reading controls have stable IDs and preserve current display-version guards", () => {
  const fs = require("fs"), path = require("path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/compare/compare.wxml"), "utf8");
  for (const mode of ["stacked", "table"]) {
    const buttons = template.match(new RegExp(`<button\\b[^>]*id="compare-${mode}"[^>]*>`, "g")) || [];
    assert.equal(buttons.length, 1);
    for (const token of ['bindtap="setReadingMode"', `data-mode="${mode}"`, 'data-version="{{displayVersion}}"']) assert(buttons[0].includes(token));
  }
  const switches = template.match(/<switch\b[^>]*id="compare-differences"[^>]*>/g) || [];
  assert.equal(switches.length, 1);
  for (const token of ['bindchange="setDifferenceMode"', 'checked="{{differencesOnly}}"', 'data-version="{{displayVersion}}"']) assert(switches[0].includes(token));
});

test("hidden list and safety pages cannot issue auxiliary catalog or privacy navigation", () => {
  const favorites = page("favorites"), compare = page("compare"), plan = page("plan");
  for (const instance of [favorites, compare, plan]) instance.onHide();
  favorites.goCatalog(); compare.goCatalog(); plan.goCatalog(); plan.goPrivacy();
  assert.equal(navigations.length, 0); assert.equal(writes, 0);
  for (const instance of [favorites, compare, plan]) instance.onShow();
  favorites.goCatalog(); compare.goCatalog(); plan.goPrivacy(); assert.equal(navigations.length, 3);
});
