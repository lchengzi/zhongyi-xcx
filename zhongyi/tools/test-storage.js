"use strict";

const assert = require("node:assert/strict");
const { test, beforeEach, after } = require("node:test");
const storage = require("../utils/storage");
const privacy = require("../utils/privacy");
const previousWx = global.wx;
let memory;
let failRead;
let failWrite;
let failRemove;
let writes;

beforeEach(() => {
  memory = Object.create(null);
  failRead = failWrite = failRemove = false;
  writes = 0;
  global.wx = {
    getStorageSync(key) {
      if (failRead) throw new Error("SYNTHETIC_PRIVATE_STORAGE_ERROR");
      return memory[key] == null ? "" : memory[key];
    },
    setStorageSync(key, value) {
      writes += 1;
      if (failWrite) throw new Error("SYNTHETIC_PRIVATE_STORAGE_ERROR");
      memory[key] = JSON.parse(JSON.stringify(value));
    },
    removeStorageSync(key) {
      if (failRemove) throw new Error("SYNTHETIC_PRIVATE_STORAGE_ERROR");
      delete memory[key];
    },
    getStorageInfoSync() { return { keys: Object.keys(memory) }; }
  };
  storage.checklist.clear();
});
after(() => { if (previousWx === undefined) delete global.wx; else global.wx = previousWx; });

test("empty storage is available; IDs normalize and reads return independent arrays", () => {
  assert.equal(storage.getPersistentState().message, "");
  const result = storage.trySetFavorites([" a ", "a", "b", {}, null]);
  assert.deepEqual(result.ids, ["a", "b"]);
  assert.equal(result.ok, true);
  const read = storage.getFavorites();
  read.push("not-persisted");
  assert.deepEqual(storage.getFavorites(), ["a", "b"]);
});

test("successful favorite IDs survive a module reload but checklist remains session-only", () => {
  storage.tryToggleFavorite("a");
  storage.setChecklist({ identity: true });
  const filename = require.resolve("../utils/storage");
  const cached = require.cache[filename];
  delete require.cache[filename];
  try {
    const restarted = require(filename);
    assert.deepEqual(restarted.getFavorites(), ["a"]);
    assert.deepEqual(restarted.getChecklist(), {});
  } finally { require.cache[filename] = cached; }
  assert.deepEqual(Object.keys(memory), [storage.KEYS.favorites]);
});

test("favorite write failure returns previous IDs and never reports success", () => {
  storage.trySetFavorites(["a"]);
  failWrite = true;
  const result = storage.tryToggleFavorite("b");
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.errorCode, "write_failed");
  assert.deepEqual(result.ids, ["a"]);
  assert.deepEqual(memory[storage.KEYS.favorites], ["a"]);
  assert(!storage.errorMessage(result).includes("SYNTHETIC_PRIVATE"));
});

test("compare write failure preserves stored IDs and checklist; no added flag", () => {
  storage.trySetCompare(["a"]);
  storage.setChecklist({ identity: true });
  failWrite = true;
  const result = storage.toggleCompare("b");
  assert.equal(result.ok, false);
  assert.equal(result.added, false);
  assert.deepEqual(result.ids, ["a"]);
  assert.deepEqual(storage.getChecklist(), { identity: true });
  assert.deepEqual(memory[storage.KEYS.compare], ["a"]);
});

test("successful compare mutation invalidates checklist; unchanged IDs do not", () => {
  storage.trySetCompare(["a"]);
  storage.setChecklist({ identity: true });
  const before = writes;
  assert.equal(storage.trySetCompare(["a"]).changed, false);
  assert.equal(writes, before);
  assert.deepEqual(storage.getChecklist(), { identity: true });
  assert.equal(storage.toggleCompare("b").added, true);
  assert.deepEqual(storage.getChecklist(), {});
});

test("compare removal and explicit emptying do not clear checklist on failed writes", () => {
  storage.trySetCompare(["a", "b"]);
  storage.setChecklist({ identity: true });
  failWrite = true;
  assert.equal(storage.tryRemoveCompare("a").ok, false);
  assert.equal(storage.trySetCompare([]).ok, false);
  assert.deepEqual(storage.getCompare(), ["a", "b"]);
  assert.deepEqual(storage.getChecklist(), { identity: true });
  failWrite = false;
  assert.deepEqual(storage.tryRemoveCompare("a").ids, ["b"]);
  assert.deepEqual(storage.getChecklist(), {});
});

test("four-item compare limit preserves checklist and stored records", () => {
  storage.trySetCompare(["a", "b", "c", "d"]);
  storage.setChecklist({ identity: true });
  const before = writes;
  const result = storage.toggleCompare("e");
  assert.equal(result.ok, false);
  assert.equal(result.limited, true);
  assert.equal(result.added, false);
  assert.equal(writes, before);
  assert.deepEqual(storage.getChecklist(), { identity: true });
});

test("read failure blocks all list mutations without overwriting unreadable records", () => {
  storage.trySetFavorites(["a"]);
  storage.trySetCompare(["b"]);
  const before = writes;
  failRead = true;
  [storage.tryToggleFavorite("c"), storage.trySetFavorites([]), storage.toggleCompare("c"),
    storage.trySetCompare([]), storage.tryRemoveCompare("b")].forEach((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "read_failed");
    assert(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE"));
  });
  assert.equal(writes, before);
  assert.deepEqual(memory[storage.KEYS.favorites], ["a"]);
  assert.deepEqual(memory[storage.KEYS.compare], ["b"]);
});

test("malformed stored records are unknown, not empty records to overwrite", () => {
  memory[storage.KEYS.favorites] = { legacy: "preserve" };
  memory[storage.KEYS.compare] = "invalid fixture";
  assert.equal(storage.tryToggleFavorite("a").errorCode, "invalid_records");
  assert.equal(storage.toggleCompare("a").errorCode, "invalid_records");
  assert.equal(writes, 0);
  assert.deepEqual(memory[storage.KEYS.favorites], { legacy: "preserve" });
  assert.equal(memory[storage.KEYS.compare], "invalid fixture");
  assert(storage.getPersistentState().message);
});

test("read failure has a recoverable state; manual reread restores actual IDs", () => {
  storage.trySetFavorites(["a"]);
  failRead = true;
  assert.equal(storage.getPersistentState().favoritesAvailable, false);
  failRead = false;
  const result = storage.getPersistentState();
  assert.equal(result.message, "");
  assert.deepEqual(result.favorites, ["a"]);
});

test("legacy array-returning APIs return persisted IDs on failure", () => {
  storage.setFavorites(["a"]);
  storage.setCompare(["b"]);
  failWrite = true;
  assert.deepEqual(storage.toggleFavorite("c"), ["a"]);
  assert.deepEqual(storage.setFavorites([]), ["a"]);
  assert.deepEqual(storage.setCompare([]), ["b"]);
});

test("catalog reconciliation does not claim removals that failed to persist", () => {
  storage.setFavorites(["valid", "retired"]);
  storage.setCompare(["valid", "retired"]);
  storage.setChecklist({ identity: true });
  failWrite = true;
  assert.deepEqual(storage.reconcileCatalogIds(["valid"]), {
    favorites: ["valid", "retired"], compare: ["valid", "retired"]
  });
  assert.deepEqual(storage.getChecklist(), { identity: true });
});

test("failed compare deletion retains checklist; successful deletion clears it", () => {
  storage.setCompare(["a"]);
  storage.setChecklist({ identity: true });
  failRemove = true;
  assert.equal(storage.compare.clear(), false);
  assert.deepEqual(storage.getChecklist(), { identity: true });
  failRemove = false;
  assert.equal(storage.compare.clear(), true);
  assert.deepEqual(storage.getChecklist(), {});
});

test("missing WeChat storage API cannot masquerade as successful memory persistence or deletion", () => {
  global.wx = { getStorageSync() { return ["a"]; } };
  assert.equal(storage.tryToggleFavorite("b").ok, false);
  assert.equal(storage.getPersistentState().favoritesAvailable, false);
  assert.equal(storage.compare.clear(), false);
  const result = storage.clearOwnedPersistentData();
  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
});

test("privacy summary marks unreadable counts; deletion cannot be confirmed on failed reads", () => {
  const app = { globalData: { sessionSafetyProfile: { ageGroup: "adult" } } };
  storage.setFavorites(["a"]);
  failRead = true;
  const summary = privacy.getLocalDataSummary(app);
  assert.equal(summary.favoritesAvailable, false);
  assert.equal(summary.compareAvailable, false);
  assert(summary.storageIssue);
  const result = privacy.clearAllLocalData(app);
  assert.equal(result.ok, false);
  assert.equal(result.persistentCleared, false);
  assert.equal(result.sessionCleared, true);
});

test("invalid IDs are rejected without writes or checklist changes", () => {
  storage.setChecklist({ identity: true });
  assert.equal(storage.tryToggleFavorite({}).errorCode, "invalid_id");
  assert.equal(storage.toggleCompare("").errorCode, "invalid_id");
  assert.equal(storage.tryRemoveCompare(null).errorCode, "invalid_id");
  assert.equal(storage.tryRemoveFavorite(null).errorCode, "invalid_id");
  assert.equal(writes, 0);
  assert.deepEqual(storage.getChecklist(), { identity: true });
});

test("favorite removal is idempotent and reads once without losing unrelated IDs on failure", () => {
  storage.setFavorites(["a", "b"]); writes = 0;
  const read = global.wx.getStorageSync; let reads = 0;
  global.wx.getStorageSync = (key) => { reads += 1; return read(key); };
  const result = storage.tryRemoveFavorite("a");
  assert.deepEqual(result.ids, ["b"]); assert.equal(result.changed, true);
  assert.equal(reads, 1); assert.equal(writes, 1);
  assert.equal(storage.tryRemoveFavorite("a").changed, false); assert.equal(writes, 1);
  failRead = true;
  assert.equal(storage.tryRemoveFavorite("b").ok, false); assert.equal(writes, 1);
  failRead = false; failWrite = true;
  assert.equal(storage.tryRemoveFavorite("b").ok, false);
  assert.deepEqual(storage.getFavorites(), ["b"]);
  assert.deepEqual(storage.getChecklist(), {});
});
