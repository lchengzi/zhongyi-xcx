"use strict";

const assert = require("node:assert/strict");
const { test, beforeEach, after } = require("node:test");
const navigation = require("../utils/navigation");
const previousWx = global.wx;
const previousGetPages = global.getCurrentPages;
let calls;
let notices;
let page;

beforeEach(() => {
  calls = [];
  notices = [];
  page = {};
  global.getCurrentPages = () => [];
  global.wx = {
    showToast(options) { notices.push(options); }
  };
  ["navigateTo", "navigateBack", "redirectTo", "switchTab"].forEach((method) => {
    global.wx[method] = (options) => { calls.push({ method, options }); };
  });
});
after(() => {
  if (previousWx === undefined) delete global.wx; else global.wx = previousWx;
  if (previousGetPages === undefined) delete global.getCurrentPages; else global.getCurrentPages = previousGetPages;
});

test("rapid clicks across destinations issue one navigation from the source page", () => {
  assert.equal(navigation.openIngredient(page, "dang-shen"), true);
  assert.equal(navigation.openIngredient(page, "another"), false);
  assert.equal(navigation.openPrivacy(page), false);
  assert.equal(navigation.switchTab(page, "compare"), false);
  assert.equal(calls.length, 1);
});

test("successful navigation stays locked until source onShow resets it", () => {
  navigation.openIngredient(page, "a");
  calls[0].options.success({});
  assert.equal(navigation.openIngredient(page, "b"), false);
  navigation.resume(page);
  assert.equal(navigation.openIngredient(page, "b"), true);
  assert.equal(calls.length, 2);
});

test("asynchronous failure notifies once, unlocks, and allows explicit retry", () => {
  navigation.openIngredient(page, "a");
  calls[0].options.fail({ errMsg: "SYNTHETIC_PRIVATE_ERROR" });
  calls[0].options.fail({});
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "页面打开失败，请稍后重试");
  assert(!JSON.stringify(notices).includes("SYNTHETIC_PRIVATE_ERROR"));
  assert.equal(navigation.openIngredient(page, "a"), true);
  assert.equal(calls.length, 2);
});

test("synchronous platform throw releases the lock without exposing errors", () => {
  global.wx.navigateTo = () => { throw new Error("SYNTHETIC_PRIVATE_ERROR"); };
  navigation.openPrivacy(page);
  navigation.openPrivacy(page);
  assert.equal(notices.length, 2);
  assert(!JSON.stringify(notices).includes("SYNTHETIC_PRIVATE_ERROR"));
});

test("a late callback after reset cannot unlock or notify for a newer navigation", () => {
  navigation.openPrivacy(page);
  const old = calls[0].options;
  navigation.reset(page);
  navigation.openIngredient(page, "a");
  old.fail({});
  old.success({});
  assert.equal(navigation.openOfficialDirectory(page), false);
  assert.equal(notices.length, 0);
  assert.equal(calls.length, 2);
});

test("a failure callback after success cannot generate a failure notice", () => {
  navigation.openPrivacy(page);
  calls[0].options.success({});
  calls[0].options.fail({});
  assert.equal(notices.length, 0);
  assert.equal(navigation.openPrivacy(page), false);
});

test("separate source pages do not block each other", () => {
  navigation.openPrivacy(page);
  assert.equal(navigation.openPrivacy({}), true);
  assert.equal(calls.length, 2);
});

test("missing platform API is a visible failure and can recover on retry", () => {
  delete global.wx.navigateTo;
  navigation.openPrivacy(page);
  assert.equal(notices.length, 1);
  global.wx.navigateTo = (options) => calls.push({ options });
  assert.equal(navigation.openPrivacy(page), true);
  assert.equal(calls.length, 1);
});

test("failed toast delivery does not leave the source locked", () => {
  global.wx.showToast = () => { throw new Error("synthetic toast failure"); };
  navigation.openPrivacy(page);
  calls[0].options.fail({});
  assert.equal(navigation.openPrivacy(page), true);
  assert.equal(calls.length, 2);
});

test("tab destinations are limited to the four registered main-package tabs", () => {
  ["index", "favorites", "compare", "plan"].forEach((key) => {
    navigation.reset(page);
    assert.equal(navigation.switchTab(page, key), true);
    assert.equal(calls[calls.length - 1].method, "switchTab");
    assert.equal(calls[calls.length - 1].options.url, `/pages/${key}/${key}`);
  });
  navigation.reset(page);
  ["privacy", "ingredient", "https://example.test", "../index", null].forEach((key) => {
    assert.equal(navigation.switchTab(page, key), false);
  });
  assert.equal(calls.length, 4);
});

test("detail IDs are encoded; invalid IDs do not issue navigation", () => {
  navigation.openIngredient(page, "a&other=1#x");
  assert.equal(calls[0].options.url, "/subpackages/catalog/detail/detail?id=a%26other%3D1%23x");
  navigation.reset(page);
  navigation.openOfficialDetail(page, "recipe-a");
  assert.equal(calls[1].options.url, "/subpackages/official/official-plan-detail/official-plan-detail?id=recipe-a");
  navigation.reset(page);
  ["", " a", "a ", "x".repeat(101), "\ud800", null, {}, 1].forEach((id) => {
    assert.equal(navigation.openIngredient(page, id), false);
    assert.equal(navigation.openOfficialDetail(page, id), false);
  });
  assert.equal(calls.length, 2);
});

test("cold-start official detail redirects to the directory without pushing another page", () => {
  navigation.backToOfficialDirectory(page);
  assert.equal(calls[0].method, "redirectTo");
  assert.equal(calls[0].options.url, "/subpackages/official/official-plans/official-plans");
  assert.equal(navigation.backToOfficialDirectory(page), false);
});

test("official detail opened from directory returns exactly one level", () => {
  global.getCurrentPages = () => [{ route: "subpackages/official/official-plans/official-plans" }, { route: "detail" }];
  navigation.backToOfficialDirectory(page);
  assert.equal(calls[0].method, "navigateBack");
  assert.equal(calls[0].options.delta, 1);
  calls[0].options.success({});
  assert.equal(calls.length, 1);
  assert.equal(notices.length, 0);
});

test("failed official back falls back to exactly one redirect", () => {
  global.getCurrentPages = () => [{ route: "subpackages/official/official-plans/official-plans" }, {}];
  navigation.backToOfficialDirectory(page);
  calls[0].options.fail({});
  calls[0].options.fail({});
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "redirectTo");
  assert.equal(navigation.backToOfficialDirectory(page), false);
  assert.equal(notices.length, 0);
});

test("failed fallback notifies and permits a fresh explicit attempt", () => {
  global.getCurrentPages = () => [{ route: "subpackages/official/official-plans/official-plans" }, {}];
  navigation.backToOfficialDirectory(page);
  calls[0].options.fail({});
  calls[1].options.fail({});
  assert.equal(notices.length, 1);
  assert.equal(navigation.backToOfficialDirectory(page), true);
  assert.equal(calls.length, 3);
});

test("missing back API can still use the directory redirect", () => {
  global.getCurrentPages = () => [{ route: "subpackages/official/official-plans/official-plans" }, {}];
  delete global.wx.navigateBack;
  navigation.backToOfficialDirectory(page);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "redirectTo");
});

test("unavailable page-stack metadata uses the cold-start redirect", () => {
  global.getCurrentPages = () => { throw new Error("synthetic stack failure"); };
  navigation.backToOfficialDirectory(page);
  assert.equal(calls[0].method, "redirectTo");
});

test("unsettled platform operation stays locked until source lifecycle reset", () => {
  navigation.openPrivacy(page);
  navigation.resume(page);
  assert.equal(navigation.openPrivacy(page), false);
  assert.equal(calls.length, 1);
  navigation.reset(page);
  calls[0].options.fail({});
  assert.equal(notices.length, 0);
  assert.equal(navigation.openPrivacy(page), true);
});

test("hidden and disposed source pages cannot begin any helper navigation", () => {
  for (const source of [{ pageHidden: true }, { pageDisposed: true }]) {
    for (const action of [() => navigation.openIngredient(source, "dang-shen"), () => navigation.openOfficialDetail(source, "recipe-a"),
      () => navigation.openOfficialDirectory(source), () => navigation.openPrivacy(source), () => navigation.switchTab(source, "index"),
      () => navigation.backToOfficialDirectory(source)]) assert.equal(action(), false);
  }
  assert.equal(calls.length, 0); assert.equal(notices.length, 0);
});
test("a failed back from a hidden or disposed source neither redirects nor displays an old failure", () => {
  global.getCurrentPages = () => [{ route: "subpackages/official/official-plans/official-plans" }, {}];
  for (const flag of ["pageHidden", "pageDisposed"]) {
    const source = {}; navigation.backToOfficialDirectory(source); const call = calls.at(-1);
    source[flag] = true; call.options.fail({});
  }
  assert.equal(calls.length, 2); assert(calls.every((call) => call.method === "navigateBack"));
  assert.equal(notices.length, 0);
});
test("an ordinary failed operation after source hide is silent and permits a later explicit retry", () => {
  navigation.openPrivacy(page); page.pageHidden = true; calls[0].options.fail({});
  assert.equal(notices.length, 0); page.pageHidden = false;
  assert.equal(navigation.openPrivacy(page), true); assert.equal(calls.length, 2);
});
test("a failed fallback after source hide cannot notify or reset a later user navigation", () => {
  global.getCurrentPages = () => [{ route: "subpackages/official/official-plans/official-plans" }, {}];
  navigation.backToOfficialDirectory(page); calls[0].options.fail({});
  const fallback = calls[1].options; page.pageHidden = true; fallback.fail({});
  assert.equal(notices.length, 0); page.pageHidden = false;
  navigation.openPrivacy(page); fallback.fail({});
  assert.equal(navigation.openPrivacy(page), false); assert.equal(calls.length, 3);
});
test("success while hidden stays recorded and only a visible resume releases its navigation lock", () => {
  navigation.openPrivacy(page); page.pageHidden = true; calls[0].options.success({});
  navigation.resume(page); page.pageHidden = false;
  assert.equal(navigation.openPrivacy(page), false);
  navigation.resume(page); assert.equal(navigation.openPrivacy(page), true); assert.equal(calls.length, 2);
});
