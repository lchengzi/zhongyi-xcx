"use strict";

// Controlled system callbacks and fictional data, not OS clipboard/device tests.
const assert = require("node:assert/strict");
const { test, beforeEach, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const clipboard = require("../utils/clipboard");
const storage = require("../utils/storage");
const privacy = require("../utils/privacy");
const { checkNonMedicalRuntimeBoundary } = require("./check-project");
const globals = { wx: global.wx, getApp: global.getApp, Page: global.Page };
const definitions = {};
for (const [name, location] of [
  ["ingredient", "../subpackages/catalog/detail/detail"], ["plan", "../pages/plan/plan"],
  ["directory", "../subpackages/official/official-plans/official-plans"],
  ["recipe", "../subpackages/official/official-plan-detail/official-plan-detail"]
]) {
  global.Page = (definition) => { definitions[name] = definition; }; require(location);
}
if (globals.Page === undefined) delete global.Page; else global.Page = globals.Page;
let app, calls, notices, memory, storageWrites, readClipboard, requests;
const NOTICE = "复制未完成，请再次点击重试";
beforeEach(() => {
  app = { globalData: { sessionSafetyProfile: {}, sessionRecipeAcknowledgements: {}, sessionDataRevision: 0 } };
  calls = []; notices = []; memory = {}; storageWrites = 0; readClipboard = 0; requests = 0;
  global.getApp = () => app;
  global.wx = {
    setClipboardData: (options) => calls.push(options), showToast: (options) => notices.push(options),
    getClipboardData() { readClipboard += 1; throw new Error("clipboard must not be read"); },
    getStorageSync: (key) => memory[key] || "", setStorageSync: (key, value) => { storageWrites += 1; memory[key] = value; },
    getStorageInfoSync: () => ({ keys: Object.keys(memory) }), removeStorageSync: (key) => { delete memory[key]; },
    setNavigationBarTitle() {}, request() { requests += 1; throw new Error("no clipboard transport"); }
  };
  storage.setChecklist({});
});
after(() => {
  storage.setChecklist({});
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});
function page(name) {
  const result = { ...definitions[name], data: JSON.parse(JSON.stringify(definitions[name].data)) };
  result.setData = function (patch) { Object.assign(this.data, patch); };
  if (result.onLoad) result.onLoad({ id: name === "ingredient" ? "huang-qi" : "black-bean-huangqi-goji-soup" });
  result.onShow();
  if (name === "directory") result.selectTarget({ currentTarget: { dataset: { id: "adult_diabetes" } } });
  return result;
}
function copy(instance, name) {
  if (name === "plan") return instance.copyInquiry();
  if (name === "directory") return instance.copyTargetSource();
  return instance.copySource({ currentTarget: { dataset: { id: instance.data.sourceRows[0].id } } });
}

test("copying starts only on an explicit call, passes exact text and adds no success toast", () => {
  assert.equal(calls.length, 0);
  assert.equal(clipboard.writeText({}, "虚构资料\n第二行"), true);
  assert.equal(calls.length, 1); assert.equal(calls[0].data, "虚构资料\n第二行");
  assert.deepEqual(Object.keys(calls[0]).sort(), ["data", "fail", "success"]);
  assert.equal(notices.length, 0); calls[0].success({}); assert.equal(notices.length, 0);
  assert.equal(readClipboard, 0); assert.equal(storageWrites, 0); assert.equal(requests, 0);
});
test("async failure uses fixed text without platform details and explicit retry is one new write", () => {
  const owner = {}; clipboard.writeText(owner, "虚构过敏说明");
  calls[0].fail({ errMsg: "FICTIONAL_PRIVATE_MARKER" });
  assert.deepEqual(notices, [{ title: NOTICE, icon: "none" }]);
  assert.equal(calls.length, 1); clipboard.writeText(owner, "重新整理后的虚构资料");
  assert.equal(calls.length, 2); assert.equal(calls[1].data, "重新整理后的虚构资料");
});
test("synchronous platform exception is contained and notification failure never retries copying", () => {
  let attempts = 0;
  wx.setClipboardData = () => { attempts += 1; throw new Error("PRIVATE_EXCEPTION"); };
  assert.equal(clipboard.writeText({}, "虚构资料"), false); assert.equal(notices.length, 1);
  wx.showToast = () => { throw new Error("notice unavailable"); };
  assert.doesNotThrow(() => clipboard.writeText({}, "虚构资料")); assert.equal(attempts, 2);
});
test("missing clipboard interface reports failure while a wholly absent platform does not crash", () => {
  delete wx.setClipboardData; assert.equal(clipboard.writeText({}, "虚构资料"), false);
  assert.equal(notices.length, 1); delete global.wx;
  assert.doesNotThrow(() => clipboard.writeText({}, "虚构资料"));
});
test("invalid text or hidden and disposed owners cannot start system writes", () => {
  for (const value of [null, undefined, 0, {}, "", "  ", "\n"]) assert.equal(clipboard.writeText({}, value), false);
  for (const owner of [null, undefined, "page", { pageHidden: true }, { pageDisposed: true }]) {
    assert.equal(clipboard.writeText(owner, "虚构资料"), false);
  }
  assert.equal(calls.length, 0); assert.equal(notices.length, 0);
});
test("duplicate and contradictory callbacks settle once and do not invent failures after success", () => {
  clipboard.writeText({}, "虚构资料"); const first = calls[0];
  first.success({}); first.fail({}); first.success({}); assert.equal(notices.length, 0);
  clipboard.writeText({}, "虚构资料"); const second = calls[1];
  second.fail({}); second.fail({}); second.success({}); assert.equal(notices.length, 1);
});
test("success followed by a synchronous throw cannot produce a contradictory failure notice", () => {
  wx.setClipboardData = (options) => { calls.push(options); options.success({}); throw new Error("after delivery"); };
  assert.doesNotThrow(() => clipboard.writeText({}, "虚构资料")); assert.equal(notices.length, 0);
});
test("an earlier operation cannot report failure over a later copy on the same page", () => {
  const owner = {}; clipboard.writeText(owner, "前一次虚构文本"); clipboard.writeText(owner, "新虚构文本");
  calls[0].fail({}); assert.equal(notices.length, 0);
  calls[1].fail({}); assert.equal(notices.length, 1);
});
test("feedback belongs to its page and does not suppress a different page operation", () => {
  clipboard.writeText({}, "甲页虚构文本"); clipboard.writeText({}, "乙页虚构文本");
  calls[0].fail({}); calls[1].fail({}); assert.equal(notices.length, 2);
});
test("reset invalidates a previous operation even after the owner becomes visible again", () => {
  const owner = {}; clipboard.writeText(owner, "虚构资料"); clipboard.reset(owner);
  calls[0].fail({}); assert.equal(notices.length, 0);
  clipboard.writeText(owner, "新的虚构资料"); calls[1].fail({}); assert.equal(notices.length, 1);
});
test("hidden and unloaded owners receive no late application failure notice", () => {
  for (const flag of ["pageHidden", "pageDisposed"]) {
    const owner = {}; clipboard.writeText(owner, "虚构资料"); owner[flag] = true; calls.at(-1).fail({});
  }
  assert.equal(notices.length, 0);
});
test("privacy deletion invalidates feedback without issuing another copy or claiming to clear the OS clipboard", () => {
  app.globalData.sessionSafetyProfile = { ageGroup: "adult" };
  const owner = {}; clipboard.writeText(owner, "虚构会话摘要");
  assert.equal(privacy.clearAllLocalData(app).ok, true);
  assert.equal(app.globalData.sessionDataRevision, 1); calls[0].fail({});
  assert.equal(notices.length, 0); assert.equal(calls.length, 1); assert.equal(readClipboard, 0);
});
test("no callback creates neither an application success claim nor a retry lock", () => {
  const owner = {}; clipboard.writeText(owner, "虚构资料");
  assert.equal(notices.length, 0); clipboard.writeText(owner, "再次主动点击");
  assert.equal(calls.length, 2); assert.equal(notices.length, 0);
});
test("all four real page entry points report rejection and allow fresh explicit retry", () => {
  for (const name of ["ingredient", "plan", "directory", "recipe"]) {
    const instance = page(name); const start = calls.length, noticeStart = notices.length;
    copy(instance, name); assert.equal(calls.length, start + 1, name);
    assert.equal(typeof calls[start].fail, "function", name); calls[start].fail({ errMsg: "PRIVATE" });
    assert.equal(notices.length, noticeStart + 1, name); assert.equal(notices.at(-1).title, NOTICE);
    copy(instance, name); assert.equal(calls.length, start + 2, name); calls.at(-1).success({});
    instance.onUnload();
  }
  assert.equal(readClipboard, 0); assert.equal(requests, 0); assert.equal(storageWrites, 0);
});
test("all four page lifecycles suppress stale failures and hidden copy entry points", () => {
  for (const name of ["ingredient", "plan", "directory", "recipe"]) {
    const instance = page(name); const start = calls.length, noticeStart = notices.length;
    const sourceId = instance.data.sourceRows && instance.data.sourceRows[0] && instance.data.sourceRows[0].id;
    copy(instance, name); instance.onHide();
    // Capture IDs before hiding, as a queued UI event may carry them later.
    const invoke = name === "ingredient" || name === "recipe"
      ? () => instance.copySource({ currentTarget: { dataset: { id: sourceId } } }) : () => copy(instance, name);
    invoke(); assert.equal(calls.length, start + 1, name);
    instance.onShow(); calls[start].fail({}); assert.equal(notices.length, noticeStart, name);
    copy(instance, name); assert.equal(calls.length, start + 2, name);
    instance.onUnload(); calls.at(-1).fail({}); assert.equal(notices.length, noticeStart, name);
  }
});
test("red flags still block all real copy actions before system writes", () => {
  for (const name of ["ingredient", "plan", "directory", "recipe"]) {
    app.globalData.sessionSafetyProfile = {}; const instance = page(name);
    const sourceId = instance.data.sourceRows && instance.data.sourceRows[0] && instance.data.sourceRows[0].id;
    app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] };
    const start = calls.length;
    if (name === "ingredient" || name === "recipe") instance.copySource({ currentTarget: { dataset: { id: sourceId } } });
    else copy(instance, name);
    assert.equal(calls.length, start, name); assert.equal(instance.data.triageBlocked, true, name);
    instance.onUnload();
  }
});
test("privacy wording explicitly separates app deletion from clipboard and external copies", () => {
  const template = fs.readFileSync(path.join(__dirname, "../pages/privacy/privacy.wxml"), "utf8");
  assert(template.includes("不能清空系统剪贴板")); assert(template.includes("已发起的系统复制也无法撤销"));
  assert(template.includes("确认接收方后再粘贴"));
});
test("runtime guard prohibits clipboard reads and page-level bypasses of the shared writer", () => {
  const pagePath = path.join(__dirname, "../pages/plan/plan.js");
  for (const source of ["wx.getClipboardData({})", "wx['getClipboardData']({})", "wx . getClipboardData({})"]) {
    assert.throws(() => checkNonMedicalRuntimeBoundary(pagePath, source), /clipboard reading/);
  }
  for (const source of ["wx.setClipboardData({data:'x'})", "wx['setClipboardData']({data:'x'})"]) {
    assert.throws(() => checkNonMedicalRuntimeBoundary(pagePath, source), /clipboard adapter/);
  }
  const adapterPath = path.join(__dirname, "../utils/clipboard.js");
  checkNonMedicalRuntimeBoundary(adapterPath);
  assert.throws(() => checkNonMedicalRuntimeBoundary(adapterPath, "wx.setClipboardData({}); wx.setClipboardData({});"), /exactly one/);
});
test("four page adapters retain their existing runtime non-medical and privacy boundaries", () => {
  for (const relative of ["pages/plan/plan.js", "subpackages/catalog/detail/detail.js", "subpackages/official/official-plans/official-plans.js", "subpackages/official/official-plan-detail/official-plan-detail.js"]) {
    checkNonMedicalRuntimeBoundary(path.join(__dirname, "..", relative));
  }
});
