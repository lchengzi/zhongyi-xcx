"use strict";

// Real page and client handlers; controlled transport, not a WeChat device.
const assert = require("node:assert/strict");
const { test, beforeEach, afterEach } = require("node:test");
const network = require("../utils/public-catalog");
const contract = require("../utils/public-catalog-contract");
const catalog = require("../data/ingredients");
const storage = require("../utils/storage");
const previousGlobals = { Page: global.Page, wx: global.wx, getApp: global.getApp };
const definitions = {};
for (const [name, modulePath] of [["index", "../pages/index/index"], ["privacy", "../pages/privacy/privacy"]]) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(modulePath);
}
if (previousGlobals.Page === undefined) delete global.Page; else global.Page = previousGlobals.Page;
const methods = ["load", "clear", "getState", "getCatalog", "getPendingRead"];
const originalMethods = Object.fromEntries(methods.map((key) => [key, network[key]]));
let client, app, requests, aborts, memory, modals, writes;
const clone = (value) => JSON.parse(JSON.stringify(value));

function page(name = "index") {
  const instance = { ...definitions[name], data: clone(definitions[name].data), patches: [] };
  instance.setData = function (patch) { this.patches.push(patch); Object.assign(this.data, patch); };
  if (instance.onLoad) instance.onLoad({});
  instance.onShow();
  return instance;
}
function success(index = 0) { requests[index].success({ statusCode: 200, data: contract.expectedEnvelope() }); }
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function controlEvent(instance) { return { currentTarget: { dataset: { version: instance.data.interactionVersion } } }; }
function read(instance) { instance.readServiceCatalog(controlEvent(instance)); }
function useLocal(instance) { instance.useLocalCatalog(controlEvent(instance)); }
function assertLocal(instance, mode) {
  assert.equal(instance.data.network.mode, mode);
  assert.equal(instance.data.network.sourceAsOf, "2026-08-10");
  assert.deepEqual(instance.allIngredients, catalog.ingredients);
  assert(instance.data.rows.length > 0);
}
beforeEach(() => {
  requests = []; aborts = 0; memory = {}; modals = []; writes = 0;
  app = { globalData: { sessionDataRevision: 0, sessionSafetyProfile: {}, sessionRecipeAcknowledgements: {} } };
  global.getApp = () => app;
  global.wx = {
    getStorageSync: (key) => memory[key] == null ? "" : memory[key],
    setStorageSync: (key, value) => { writes += 1; memory[key] = clone(value); },
    getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
    removeStorageSync: (key) => { delete memory[key]; },
    showToast() {}, showTabBar() {}, hideTabBar() {},
    showModal: (options) => modals.push(options),
    reLaunch: (options) => options.success({}),
    switchTab: (options) => options.success({})
  };
  client = network.createClient({ baseUrl: "https://content.example.test" }, (options) => {
    requests.push(options);
    return { abort() { aborts += 1; options.fail({ errMsg: "controlled_abort" }); } };
  });
  for (const key of methods) network[key] = client[key];
  storage.setChecklist({});
});
afterEach(async () => {
  client.clear(); storage.setChecklist({});
  await flush();
  for (const key of methods) {
    if (originalMethods[key] === undefined) delete network[key]; else network[key] = originalMethods[key];
  }
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});

test("pending-read accessor observes an existing operation without starting or restarting transport", async () => {
  assert.equal(typeof client.getPendingRead, "function");
  assert.equal(client.getPendingRead(), null); assert.equal(requests.length, 0);
  const pending = client.load(); assert.equal(client.getPendingRead(), pending);
  assert.equal(client.getPendingRead(), client.load()); assert.equal(requests.length, 1);
  success(); await pending;
  assert.equal(client.getPendingRead(), null); assert.equal(requests.length, 1);
  client.clear(); assert.equal(client.getPendingRead(), null); assert.equal(requests.length, 1);
});
test("startup and ordinary show cycles never initiate a directory request", () => {
  const instance = page();
  for (let i = 0; i < 3; i += 1) { instance.onHide(); instance.onShow(); }
  assertLocal(instance, "offline"); assert.equal(requests.length, 0); assert.equal(writes, 0);
});
test("returning before a pending read succeeds settles the visible spinner without another request", async () => {
  const instance = page(); read(instance); instance.onHide(); instance.onShow();
  assert.equal(instance.data.network.mode, "loading"); assert.equal(requests.length, 1);
  success(); await flush();
  assertLocal(instance, "online"); assert(instance.data.network.loadedAt);
  assert.equal(requests.length, 1); assert.equal(writes, 0);
});
test("returning before failure exposes local fallback and permits an explicit retry", async () => {
  const instance = page(); read(instance); instance.onHide(); instance.onShow();
  requests[0].fail({ errMsg: "controlled_network_failure" }); await flush();
  assertLocal(instance, "fallback"); assert.equal(instance.data.network.loadedAt, "");
  read(instance); assert.equal(requests.length, 2);
  success(1); await flush(); assertLocal(instance, "online");
});
test("the original independent deadline still settles a returned page and aborts once", async () => {
  let deadline; let delay;
  const originalSetTimeout = global.setTimeout;
  const instance = page();
  try {
    // Capture only the client's existing deadline; no clock or timeout is shortened.
    global.setTimeout = (callback, ms) => { deadline = callback; delay = ms; return 0; };
    read(instance);
  } finally { global.setTimeout = originalSetTimeout; }
  assert.equal(delay, network.TIMEOUT_MS + 250);
  instance.onHide(); instance.onShow(); deadline(); await flush();
  assertLocal(instance, "fallback"); assert.match(instance.data.network.message, /超时/);
  assert.equal(aborts, 1); assert.equal(requests.length, 1);
  success(); await flush(); assertLocal(instance, "fallback");
});
test("multiple hide and show transitions retain only the newest page observer", async () => {
  const instance = page(); read(instance);
  for (let i = 0; i < 3; i += 1) { instance.onHide(); instance.onShow(); }
  success(); await flush();
  assertLocal(instance, "online"); assert.equal(requests.length, 1);
  assert.equal(instance.patches.filter((patch) => patch.network && patch.network.mode === "online").length, 1);
});
test("hidden completion never updates the hidden page and is read on the next show", async () => {
  for (const outcome of ["success", "failure"]) {
    const instance = page(); read(instance); instance.onHide();
    const before = instance.patches.length;
    if (outcome === "success") success(requests.length - 1); else requests.at(-1).fail({});
    await flush(); assert.equal(instance.patches.length, before);
    instance.onShow(); assertLocal(instance, outcome === "success" ? "online" : "fallback");
    instance.onUnload(); client.clear();
  }
});
test("switching to local after returning cancels the read and rejects late callbacks", async () => {
  const instance = page(); read(instance); instance.onHide(); instance.onShow();
  useLocal(instance); await flush(); assertLocal(instance, "offline");
  assert.equal(aborts, 1); success(); requests[0].fail({}); await flush(); assertLocal(instance, "offline");
  assert.equal(requests.length, 1);
  read(instance); success(1); await flush(); assertLocal(instance, "online");
});
test("a new page can observe an existing read without updating the unloaded instance", async () => {
  const oldPage = page(); read(oldPage); oldPage.onUnload();
  const before = oldPage.patches.length;
  const current = page(); assert.equal(requests.length, 1);
  success(); await flush();
  assert.equal(oldPage.patches.length, before); assertLocal(current, "online");
});
test("confirmed deletion on the actual privacy page cancels read and cannot restore old health or query", async () => {
  const instance = page(); read(instance); instance.onHide();
  app.globalData.sessionSafetyProfile = { medicationStatus: "yes", medications: ["fictional-private-medication"] };
  instance.data.query = "fictional-private-query";
  storage.setFavorites(["dang-shen"]); storage.setCompare(["dang-shen"]);
  const privacyPage = page("privacy"); privacyPage.deleteLocalData(); modals.at(-1).success({ confirm: true });
  await flush(); assert.equal(privacyPage.data.deleteStatus, "本机数据已全部删除。"); assert.equal(aborts, 1);
  instance.onShow(); success(); await flush();
  assertLocal(instance, "offline"); assert.equal(instance.data.query, ""); assert.equal(instance.data.medicationText, "");
  assert.deepEqual(app.globalData.sessionSafetyProfile, {
    ageGroup: "unknown", pregnancyStatus: "unknown", breastfeedingStatus: "unknown", allergyStatus: "unknown",
    conditionStatus: "unknown", medicationStatus: "unknown", riskFlags: [], redFlags: [], allergies: [], conditions: [], medications: []
  });
  assert.deepEqual(storage.getFavorites(), []); assert.deepEqual(storage.getCompare(), []);
  assert.equal(requests.length, 1); assert(!JSON.stringify(requests[0]).includes("fictional-private"));
});
test("new red flags during a resumed read still stop candidate display and further requests", async () => {
  const instance = page(); read(instance); instance.onHide(); instance.onShow();
  app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] };
  success(); await flush();
  assert.equal(instance.data.triageBlocked, true); assert.deepEqual(instance.data.rows, []);
  read(instance); assert.equal(requests.length, 1); assert.equal(writes, 0);
  assert(!JSON.stringify(requests[0]).includes("sudden_severe_chest_pain"));
});

test("connection controls reject missing, malformed and noncurrent event versions", () => {
  const instance = page();
  for (const event of [undefined, null, {}, { currentTarget: {} }, { currentTarget: { dataset: {} } },
    { currentTarget: { dataset: { version: String(instance.data.interactionVersion) } } },
    { currentTarget: { dataset: { version: -1 } } }]) {
    assert.doesNotThrow(() => instance.readServiceCatalog(event));
    assert.doesNotThrow(() => instance.useLocalCatalog(event));
  }
  assert.equal(requests.length, 0); assert.equal(aborts, 0); assertLocal(instance, "offline");
});

test("a delayed old local control cannot cancel a subsequently started read", async () => {
  const instance = page(), old = controlEvent(instance); read(instance);
  instance.useLocalCatalog(old); await flush();
  assert.equal(instance.data.network.mode, "loading"); assert.equal(aborts, 0);
  success(); await flush(); assertLocal(instance, "online"); assert.equal(requests.length, 1);
});

test("completed-read controls cannot start another request but a fresh explicit read can", async () => {
  const instance = page(), old = controlEvent(instance); instance.readServiceCatalog(old);
  success(); await flush(); instance.readServiceCatalog(old);
  assert.equal(requests.length, 1); assertLocal(instance, "online");
  read(instance); assert.equal(requests.length, 2); success(1); await flush(); assertLocal(instance, "online");
});

test("a local control from a failed read cannot abort the current explicit retry", async () => {
  const instance = page(); read(instance); const stale = controlEvent(instance);
  requests[0].fail({}); await flush(); assertLocal(instance, "fallback");
  read(instance); instance.useLocalCatalog(stale); await flush();
  assert.equal(instance.data.network.mode, "loading"); assert.equal(aborts, 0);
  success(1); await flush(); assertLocal(instance, "online"); assert.equal(requests.length, 2);
});

test("a local control from the loading state expires when that read settles", async () => {
  const instance = page(); read(instance); const stale = controlEvent(instance);
  success(); await flush(); instance.useLocalCatalog(stale);
  assertLocal(instance, "online"); assert.equal(aborts, 0);
  useLocal(instance); assertLocal(instance, "offline"); assert.equal(requests.length, 1);
});

test("controls queued before hide and return cannot request or cancel in the returned page", async () => {
  const instance = page(), old = controlEvent(instance); instance.onHide(); instance.onShow();
  instance.readServiceCatalog(old); assert.equal(requests.length, 0);
  read(instance); const pendingControl = controlEvent(instance); instance.onHide(); instance.onShow();
  instance.useLocalCatalog(pendingControl); await flush();
  assert.equal(aborts, 0); assert.equal(instance.data.network.mode, "loading");
  useLocal(instance); await flush(); assertLocal(instance, "offline"); assert.equal(aborts, 1);
  success(); await flush(); assertLocal(instance, "offline");
});

test("profile changes invalidate old connection controls without starting or cancelling transport", async () => {
  const instance = page(), old = controlEvent(instance);
  app.globalData.sessionSafetyProfile = { ageGroup: "adult" };
  instance.readServiceCatalog(old); assert.equal(requests.length, 0);
  read(instance); const pendingControl = controlEvent(instance);
  app.globalData.sessionSafetyProfile = { ageGroup: "child" };
  instance.useLocalCatalog(pendingControl); await flush();
  assert.equal(aborts, 0); assert.equal(instance.data.network.mode, "loading");
  success(); await flush(); assertLocal(instance, "online"); assert.equal(requests.length, 1);
});

test("privacy deletion and a fresh read cannot revive old read or cancellation controls", async () => {
  const instance = page(), old = controlEvent(instance); read(instance); const oldCancel = controlEvent(instance);
  instance.onHide(); const privacyPage = page("privacy");
  privacyPage.deleteLocalData(); modals.at(-1).success({ confirm: true }); await flush(); instance.onShow();
  instance.readServiceCatalog(old); assert.equal(requests.length, 1); assertLocal(instance, "offline");
  read(instance); instance.useLocalCatalog(oldCancel); await flush();
  assert.equal(aborts, 1); assert.equal(instance.data.network.mode, "loading");
  success(0); await flush(); assert.equal(instance.data.network.mode, "loading");
  success(1); await flush(); assertLocal(instance, "online"); assert.equal(writes, 0);
});

test("explicit cancellation preserves query, loaded local rows, saved IDs and checklist", async () => {
  storage.setFavorites(["huang-qi"]); storage.setCompare(["huang-qi"]); storage.setChecklist({ identity: true }); writes = 0;
  const instance = page(); instance.setData({ query: "黄芪" }); instance.applyFilters();
  const before = clone(instance.data.rows); read(instance); useLocal(instance); await flush();
  assertLocal(instance, "offline"); assert.equal(instance.data.query, "黄芪"); assert.deepEqual(instance.data.rows, before);
  assert.deepEqual(storage.getFavorites(), ["huang-qi"]); assert.deepEqual(storage.getCompare(), ["huang-qi"]);
  assert.deepEqual(storage.getChecklist(), { identity: true }); assert.equal(writes, 0); assert.equal(aborts, 1);
});

test("expanding optional help while reading leaves transport and result observation intact", async () => {
  const instance = page(); read(instance);
  instance.toggleUsageGuide(controlEvent(instance)); assert.equal(instance.data.usageGuideOpen, true);
  assert.equal(instance.data.network.mode, "loading"); assert.equal(requests.length, 1); assert.equal(aborts, 0);
  success(); await flush(); assertLocal(instance, "online"); assert.equal(instance.data.usageGuideOpen, true);
  instance.toggleUsageGuide(controlEvent(instance)); assert.equal(instance.data.usageGuideOpen, false);
  assert.equal(requests.length, 1); assert.equal(aborts, 0); assert.equal(writes, 0);
});

test("both visible connection buttons bind the current interaction version inside the triage gate", () => {
  const fs = require("node:fs"), path = require("node:path");
  const template = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
  const opening = template.match(/<view wx:if="\{\{!triageBlocked\}\}" class="catalog-connection card">/);
  assert(opening, "service controls must be inside the explicit non-triage view");
  const tail = template.slice(opening.index);
  let depth = 0, end = -1;
  for (const match of tail.matchAll(/<\/?view\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) { end = match.index + match[0].length; break; }
  }
  assert(end > 0, "the non-triage service view must close");
  const section = tail.slice(0, end);
  assert.equal((section.match(/<button\b/g) || []).length, 2);
  for (const handler of ["readServiceCatalog", "useLocalCatalog"]) {
    assert(new RegExp(`<button[^>]*bindtap="${handler}"[^>]*data-version="\\{\\{interactionVersion\\}\\}"`).test(section));
  }
});
