"use strict";

// Actual page/utility handlers with fictional state; not WeChat/device evidence.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, beforeEach, after } = require("node:test");
const storage = require("../utils/storage");
const privacy = require("../utils/privacy");
const publicCatalog = require("../utils/public-catalog");
const globals = { Page: global.Page, wx: global.wx, getApp: global.getApp };
const originalClear = publicCatalog.clear;
const originalDelete = privacy.clearAllLocalData;
let definition;
global.Page = (value) => { definition = value; };
require("../pages/privacy/privacy");
if (globals.Page === undefined) delete global.Page; else global.Page = globals.Page;
let app, memory, modals, toasts, navigations, removals, catalogClears, readFails, infoFails, removalFailure, modalThrows;
const clone = (value) => JSON.parse(JSON.stringify(value));
function page() {
  const instance = { ...definition, data: clone(definition.data) };
  instance.setData = function (patch) { Object.assign(this.data, patch); };
  instance.onShow();
  return instance;
}
function open(instance) { instance.deleteLocalData(); return modals.at(-1); }
function confirm(modal) { modal.success({ confirm: true, cancel: false }); }
function seedNewRecords() {
  storage.setFavorites(["huang-qi"]); storage.setCompare(["shan-yao"]);
  storage.setChecklist({ identity: true });
  app.globalData.sessionSafetyProfile = { medicationStatus: "yes", medications: ["fictional-new-medication"] };
}
beforeEach(() => {
  privacy.clearAllLocalData = originalDelete;
  memory = {}; modals = []; toasts = []; navigations = []; removals = []; catalogClears = 0;
  readFails = false; infoFails = false; removalFailure = ""; modalThrows = false;
  app = { globalData: {
    sessionDataRevision: 0,
    sessionSafetyProfile: { ageGroup: "adult", medications: ["fictional-private-medication"], medicationStatus: "yes", redFlags: ["sudden_severe_chest_pain"] },
    sessionRecipeAcknowledgements: { adult_diabetes: true },
    sessionSymptoms: ["fictional-legacy-symptom"]
  } };
  global.getApp = () => app;
  global.wx = {
    getStorageSync(key) { if (readFails) throw new Error("injected read failure"); return memory[key] == null ? "" : memory[key]; },
    setStorageSync(key, value) { memory[key] = clone(value); },
    getStorageInfoSync() { if (infoFails) throw new Error("injected enumeration failure"); return { keys: Object.keys(memory) }; },
    removeStorageSync(key) { removals.push(key); if (key === removalFailure) throw new Error("injected removal failure"); delete memory[key]; },
    showModal(options) { if (modalThrows) throw new Error("injected modal failure"); modals.push(options); },
    showToast(options) { toasts.push(options); },
    reLaunch(options) { navigations.push({ method: "reLaunch", options }); },
    switchTab(options) { navigations.push({ method: "switchTab", options }); }
  };
  publicCatalog.clear = () => { catalogClears += 1; return originalClear(); };
  storage.setFavorites(["dang-shen"]); storage.setCompare(["dang-shen"]);
  storage.setChecklist({ identity: true, medications: true });
  memory.zhongyi_legacy_health_v0 = { synthetic: "fictional-legacy-private" };
  memory.unrelated_runtime_key = "keep";
});
after(() => {
  privacy.clearAllLocalData = originalDelete;
  publicCatalog.clear = originalClear; originalClear(); storage.setChecklist({});
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});

test("explicit current confirmation clears all owned data even under red flags", () => {
  const instance = page(); assert.equal(instance.data.triageBlocked, true);
  confirm(open(instance));
  assert.deepEqual(Object.keys(memory), ["unrelated_runtime_key"]);
  assert.equal(memory.unrelated_runtime_key, "keep");
  assert.deepEqual(app.globalData.sessionSafetyProfile, privacy.createEmptySessionSafetyProfile());
  assert.deepEqual(app.globalData.sessionRecipeAcknowledgements, {});
  for (const key of privacy.LEGACY_SESSION_HEALTH_KEYS) assert.equal(key in app.globalData, false);
  assert.deepEqual(storage.getChecklist(), {}); assert.equal(app.globalData.sessionDataRevision, 1);
  assert.equal(catalogClears, 1); assert.equal(navigations.length, 1);
  assert.equal(navigations[0].options.url, "/pages/index/index?privacyCleared=1");
  assert.equal(instance.data.hasSessionData, false); assert.equal(instance.data.triageBlocked, false);
});
test("cancel preserves persistent/session data and does not clear the catalog", () => {
  const instance = page(), before = clone(memory), session = clone(app.globalData), checklist = storage.getChecklist();
  open(instance).success({ confirm: false, cancel: true });
  assert.deepEqual(memory, before); assert.deepEqual(app.globalData, session);
  assert.deepEqual(storage.getChecklist(), checklist); assert.equal(catalogClears, 0);
  assert.equal(removals.length, 0); assert.equal(navigations.length, 0);
  assert.equal(instance.data.confirming, false);
});
test("rapid delete clicks open one confirmation and keep the button busy", () => {
  const instance = page(); open(instance); instance.deleteLocalData();
  assert.equal(modals.length, 1); assert.equal(instance.data.confirming, true); assert.equal(removals.length, 0);
});
test("duplicate confirmation delivery does not delete newly created records", () => {
  const instance = page(), modal = open(instance); confirm(modal); seedNewRecords();
  const before = clone(memory), session = clone(app.globalData), count = removals.length;
  confirm(modal);
  assert.deepEqual(memory, before); assert.deepEqual(app.globalData, session);
  assert.equal(removals.length, count); assert.equal(catalogClears, 1); assert.equal(navigations.length, 1);
});
for (const lifecycle of ["onHide", "onUnload"]) test(`${lifecycle} rejects old confirmation without touching the view`, () => {
  const instance = page(), modal = open(instance), before = clone(memory);
  assert.equal(typeof instance[lifecycle], "function"); instance[lifecycle]();
  instance.setData = () => assert.fail("late view update");
  confirm(modal); instance.deleteLocalData(); instance.refresh();
  assert.deepEqual(memory, before); assert.equal(catalogClears, 0); assert.equal(navigations.length, 0);
});
test("hide/show invalidates the old confirmation but accepts a new explicit one", () => {
  const instance = page(), old = open(instance); instance.onHide(); instance.onShow();
  const current = open(instance); confirm(old); assert.equal(removals.length, 0);
  confirm(current); assert.equal(app.globalData.sessionDataRevision, 1); assert.equal(catalogClears, 1);
});
test("onShow alone does not unlock a still-pending confirmation", () => {
  const instance = page(), modal = open(instance); instance.onShow(); instance.deleteLocalData();
  assert.equal(modals.length, 1); confirm(modal); assert.equal(catalogClears, 1);
});
const changes = {
  "same-count favorites": () => storage.setFavorites(["huang-qi"]),
  "same-count comparison": () => storage.setCompare(["shan-yao"]),
  "health contents": () => { app.globalData.sessionSafetyProfile.medications = ["fictional-new-medication"]; },
  "new red flags": () => { app.globalData.sessionSafetyProfile.redFlags = ["severe_dyspnea"]; },
  "diagnosis confirmations": () => { app.globalData.sessionRecipeAcknowledgements = { adult_hypertension: true }; },
  "same-count checklist": () => storage.setChecklist({ sources: true, allergy: true }),
  "legacy health session": () => { app.globalData.sessionSymptoms = ["fictional-new-symptom"]; },
  "owned legacy storage": () => { memory.zhongyi_legacy_health_v0 = { synthetic: "fictional-new-legacy" }; },
  "another deletion revision": () => { assert.equal(privacy.clearAllLocalData(app).ok, true); seedNewRecords(); },
  "new unreadable storage": () => { readFails = true; },
  "new enumeration failure": () => { infoFails = true; }
};
for (const [name, change] of Object.entries(changes)) test(`changed ${name} requires fresh consent without deleting the new state`, () => {
  const instance = page(), modal = open(instance); change();
  const before = clone(memory), session = clone(app.globalData), count = removals.length;
  confirm(modal);
  assert.deepEqual(memory, before); assert.deepEqual(app.globalData, session);
  assert.equal(removals.length, count); assert.equal(catalogClears, 0); assert.equal(navigations.length, 0);
  assert.match(instance.data.deleteStatus, /重新确认/); assert.equal(instance.data.confirming, false);
});
test("failed confirmation dialog releases its lock and ignores older callbacks", () => {
  const instance = page(), old = open(instance); old.fail({ errMsg: "injected" });
  assert.equal(instance.data.confirming, false); const current = open(instance);
  confirm(old); assert.equal(removals.length, 0); confirm(current); assert.equal(catalogClears, 1);
});
test("thrown confirmation API releases its lock for retry", () => {
  const instance = page(); modalThrows = true;
  assert.doesNotThrow(() => instance.deleteLocalData()); assert.equal(instance.data.confirming, false);
  assert.equal(removals.length, 0); modalThrows = false; confirm(open(instance)); assert.equal(catalogClears, 1);
});
test("partial removal clears session but reports failure, then explicit retry succeeds", () => {
  const instance = page(); removalFailure = storage.KEYS.favorites; const old = open(instance); confirm(old);
  assert.deepEqual(app.globalData.sessionSafetyProfile, privacy.createEmptySessionSafetyProfile());
  assert.deepEqual(storage.getChecklist(), {}); assert.equal(instance.data.favoritesCount, 1);
  assert.match(instance.data.deleteStatus, /未能验证/); assert.equal(navigations.length, 0);
  assert.equal(toasts.some(t => t.icon === "success"), false); assert.equal(instance.data.deleting, false);
  removalFailure = ""; const retry = open(instance); confirm(old); assert.equal(catalogClears, 1);
  confirm(retry); assert.equal(catalogClears, 2); assert.equal(navigations.length, 1);
});
test("persistent read failure still allows deletion but never claims verified success", () => {
  readFails = true; const instance = page(); assert.equal(instance.data.favoritesAvailable, false);
  confirm(open(instance)); assert.equal(catalogClears, 1); assert.ok(removals.length > 0);
  assert.equal(instance.data.hasSessionData, false); assert.equal(instance.data.favoritesAvailable, false);
  assert.match(instance.data.deleteStatus, /未能验证/); assert.equal(navigations.length, 0);
  readFails = false; confirm(open(instance)); assert.equal(navigations.length, 1);
});
test("unknown owned-key enumeration does not claim complete deletion", () => {
  infoFails = true; const instance = page(); confirm(open(instance));
  assert.equal(catalogClears, 1); assert.equal(instance.data.hasSessionData, false);
  assert.equal(memory.zhongyi_legacy_health_v0.synthetic, "fictional-legacy-private");
  assert.match(instance.data.deleteStatus, /未能验证/); assert.equal(navigations.length, 0);
  infoFails = false; confirm(open(instance)); assert.equal(memory.zhongyi_legacy_health_v0, undefined);
  assert.equal(navigations.length, 1);
});
test("confirmed corrupt records can be deleted without treating them as readable empty data", () => {
  memory[storage.KEYS.favorites] = { broken: true };
  const instance = page(); assert.equal(instance.data.favoritesAvailable, false); confirm(open(instance));
  assert.equal(instance.data.favoritesAvailable, true); assert.equal(instance.data.favoritesCount, 0);
  assert.equal(navigations.length, 1);
});
test("navigation failure falls back once and does not repeat deletion", () => {
  const instance = page(); confirm(open(instance)); const initial = navigations[0];
  initial.options.fail({}); initial.options.fail({});
  assert.equal(navigations.length, 2); assert.equal(navigations[1].method, "switchTab");
  assert.equal(catalogClears, 1); navigations[1].options.fail({});
  assert.match(instance.data.deleteStatus, /首页.*未能打开/); assert.equal(instance.data.returning, false);
  seedNewRecords(); const before = clone(memory); instance.returnToHome(); instance.returnToHome();
  assert.equal(navigations.length, 3); assert.deepEqual(memory, before); assert.equal(catalogClears, 1);
});
test("hidden navigation failure does not move the user or emit late feedback", () => {
  const instance = page(); confirm(open(instance)); instance.onHide();
  instance.setData = () => assert.fail("late navigation view update"); navigations[0].options.fail({});
  assert.equal(navigations.length, 1); assert.equal(catalogClears, 1);
});
test("unloaded navigation failure cannot trigger fallback after a different page opens", () => {
  const instance = page(); confirm(open(instance)); instance.onUnload();
  instance.setData = () => assert.fail("late navigation view update"); navigations[0].options.fail({});
  assert.equal(navigations.length, 1);
});
test("missing relaunch uses switchTab, with a retryable error if neither API exists", () => {
  delete global.wx.reLaunch; const instance = page(); confirm(open(instance));
  assert.equal(navigations.length, 1); assert.equal(navigations[0].method, "switchTab");
  navigations[0].options.fail({}); delete global.wx.switchTab;
  assert.doesNotThrow(() => instance.returnToHome()); assert.equal(instance.data.returning, false);
  assert.match(instance.data.deleteStatus, /首页.*未能打开/); assert.equal(catalogClears, 1);
});
test("successful navigation remains locked until lifecycle transition, ignoring late failure", () => {
  const instance = page(); confirm(open(instance)); navigations[0].options.success({});
  navigations[0].options.fail({}); instance.returnToHome(); instance.deleteLocalData();
  assert.equal(navigations.length, 1); assert.equal(catalogClears, 1); assert.equal(modals.length, 1);
  instance.onHide(); instance.onShow(); instance.returnToHome(); assert.equal(navigations.length, 2);
});
test("summary and confirmation never echo private health contents", () => {
  const instance = page(); open(instance);
  const displayed = JSON.stringify([instance.data, modals, toasts]);
  for (const value of ["fictional-private-medication", "fictional-legacy-symptom", "fictional-legacy-private"]) assert.equal(displayed.includes(value), false);
  const template = fs.readFileSync(path.join(__dirname, "../pages/privacy/privacy.wxml"), "utf8");
  assert.ok(template.includes('bindtap="returnToHome"'));
  assert.ok(template.includes('disabled="{{confirming || deleting || returning}}"'));
});
test("confirmation snapshots are released when cancelled or hidden", () => {
  const instance = page(), first = open(instance), cancelled = instance.pendingDelete;
  assert.equal(typeof cancelled.context, "string"); first.success({ confirm: false });
  assert.equal(cancelled.context, null); assert.equal(instance.pendingDelete, null);
  open(instance); const hidden = instance.pendingDelete; instance.onHide();
  assert.equal(hidden.context, null); assert.equal(instance.pendingDelete, null);
});
test("malformed confirmation results never authorize deletion", () => {
  const instance = page();
  for (const result of [null, {}, { confirm: "true" }, { cancel: true }]) open(instance).success(result);
  assert.equal(removals.length, 0); assert.equal(catalogClears, 0); assert.equal(instance.data.confirming, false);
});
test("old failure and cancel callbacks cannot unlock a newer confirmation", () => {
  const instance = page(), old = open(instance); old.success({ confirm: false });
  const current = open(instance); old.fail({}); old.success({ confirm: false }); instance.deleteLocalData();
  assert.equal(modals.length, 2); assert.equal(instance.data.confirming, true);
  confirm(current); assert.equal(catalogClears, 1);
});
test("changed corrupt record contents require fresh confirmation", () => {
  memory[storage.KEYS.favorites] = { invalid: "before" };
  const instance = page(), modal = open(instance); memory[storage.KEYS.favorites] = { invalid: "after" };
  confirm(modal); assert.equal(removals.length, 0); assert.match(instance.data.deleteStatus, /重新确认/);
  confirm(open(instance)); assert.equal(navigations.length, 1);
});
test("changes outside the owned storage namespace do not block deletion or get deleted", () => {
  const instance = page(), modal = open(instance); memory.unrelated_runtime_key = "new-unrelated-value";
  confirm(modal); assert.equal(memory.unrelated_runtime_key, "new-unrelated-value"); assert.equal(catalogClears, 1);
});
test("failed failure-notification dialog still leaves an explicit retry", () => {
  const instance = page(), modal = open(instance); removalFailure = storage.KEYS.favorites; modalThrows = true;
  assert.doesNotThrow(() => confirm(modal)); assert.equal(instance.data.deleting, false);
  assert.match(instance.data.deleteStatus, /未能验证/); assert.equal(navigations.length, 0);
  removalFailure = ""; modalThrows = false; confirm(open(instance)); assert.equal(navigations.length, 1);
});
test("success-toast failure does not prevent page-stack reset", () => {
  global.wx.showToast = () => { throw new Error("injected toast failure"); };
  const instance = page(); assert.doesNotThrow(() => confirm(open(instance)));
  assert.equal(catalogClears, 1); assert.equal(navigations.length, 1); assert.equal(instance.data.hasSessionData, false);
});
test("unexpected deletion error is not called success and releases the busy state", () => {
  privacy.clearAllLocalData = () => { throw new Error("injected deletion failure"); };
  const instance = page(); assert.doesNotThrow(() => confirm(open(instance)));
  assert.equal(instance.data.deleting, false); assert.match(instance.data.deleteStatus, /未能验证/);
  assert.equal(navigations.length, 0); assert.equal(toasts.some(t => t.icon === "success"), false);
  assert.equal(modals.at(-1).content.includes("会话健康信息已清空"), false);
  privacy.clearAllLocalData = originalDelete; confirm(open(instance)); assert.equal(navigations.length, 1);
});
test("catalog-clear failure does not prevent clearing health information or falsely verify success", () => {
  publicCatalog.clear = () => { throw new Error("injected cache cancellation failure"); };
  const instance = page(); confirm(open(instance));
  assert.equal(instance.data.hasSessionData, false); assert.deepEqual(storage.getChecklist(), {});
  assert.match(instance.data.deleteStatus, /未能验证/); assert.equal(navigations.length, 0);
});
test("thrown navigation APIs leave a non-destructive return retry", () => {
  global.wx.reLaunch = global.wx.switchTab = () => { throw new Error("injected navigation failure"); };
  const instance = page(); assert.doesNotThrow(() => confirm(open(instance)));
  assert.equal(instance.data.returning, false); assert.equal(instance.data.returnAvailable, true);
  assert.match(instance.data.deleteStatus, /首页.*未能打开/); assert.equal(catalogClears, 1);
});
