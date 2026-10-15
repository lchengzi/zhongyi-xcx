import assert from "node:assert/strict";
import test from "node:test";
import { createSelectionStore, selectionErrorMessage, STORE_KEYS } from "../src/index.js";
import type { StoragePort } from "../src/index.js";

function fixture() {
  const data = new Map<string, unknown>();
  const writes: { key: string; ids: readonly string[] }[] = [];
  const removals: string[] = [];
  let failRead = false;
  let failWrite = false;
  let ignoreWrite = false;
  let persistThenThrow = false;
  let failReadAfterWrite = false;
  let failRemove = false;
  let ignoreRemove = false;
  const port: StoragePort = {
    read(key) {
      if (failRead) throw new Error("simulated read failure");
      return data.get(key);
    },
    write(key, ids) {
      writes.push({ key, ids: [...ids] });
      if (failWrite) throw new Error("simulated write failure");
      if (!ignoreWrite) data.set(key, [...ids]);
      if (failReadAfterWrite) failRead = true;
      if (persistThenThrow) throw new Error("simulated ambiguous failure");
    },
    remove(key) {
      removals.push(key);
      if (failRemove) throw new Error("simulated deletion failure");
      if (!ignoreRemove) data.delete(key);
    }
  };
  return {
    data, writes, removals, port,
    setReadFailure(value: boolean) { failRead = value; },
    setWriteFailure(value: boolean) { failWrite = value; },
    ignoreWrites() { ignoreWrite = true; },
    persistThenThrow() { persistThenThrow = true; },
    failReadAfterWrite() { failReadAfterWrite = true; },
    failRemoval() { failRemove = true; },
    ignoreRemoval() { ignoreRemove = true; }
  };
}

const validIds = ["bai-he", "shan-yao", "gou-qi-zi", "mai-dong", "tian-dong"];

test("uncertain write feedback does not assert rollback or invite blindly toggling again", () => {
  assert.equal(selectionErrorMessage("write_failed"), "保存结果待核对，请查看当前记录");
  assert.doesNotMatch(selectionErrorMessage("write_failed"), /保存未完成|请重试/);
});

test("uses legacy keys, confirms successful persistence and rejects replayed events", () => {
  const memory = fixture();
  memory.data.set(STORE_KEYS.favorites, ["shan-yao"]);
  const store = createSelectionStore(memory.port, validIds);
  const before = store.read("favorites");
  assert.equal(before.status, "ready");
  assert.deepEqual(before.ids, ["shan-yao"]);
  const result = store.toggle("favorites", "bai-he", before.revision);
  assert.ok(result.ok);
  assert.deepEqual(result.state.ids, ["shan-yao", "bai-he"]);
  assert.deepEqual(memory.data.get("zhongyi_favorites_v1"), ["shan-yao", "bai-he"]);
  const duplicate = store.toggle("favorites", "bai-he", before.revision);
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.errorCode, "stale_state");
  assert.equal(memory.writes.length, 1);
});

test("read failures remain unavailable, preserve prior records and block modifications", () => {
  const memory = fixture();
  memory.data.set(STORE_KEYS.favorites, ["bai-he"]);
  const store = createSelectionStore(memory.port, validIds);
  const before = store.read("favorites");
  memory.setReadFailure(true);
  const failed = store.read("favorites");
  assert.equal(failed.status, "error");
  assert.equal(failed.ids, null);
  if (failed.status === "error") assert.deepEqual(failed.previousIds, ["bai-he"]);
  assert.equal(store.toggle("favorites", "shan-yao", before.revision).ok, false);
  assert.equal(store.clear("favorites", failed.revision).ok, false);
  assert.equal(memory.writes.length, 0);
  assert.equal(memory.removals.length, 0);
  assert.deepEqual(memory.data.get(STORE_KEYS.favorites), ["bai-he"]);
  memory.setReadFailure(false);
  assert.deepEqual(store.read("favorites").ids, ["bai-he"]);
  assert.equal(store.toggle("favorites", "shan-yao", before.revision).ok, false);
});

test("malformed records do not become empty or get silently repaired", () => {
  for (const corrupted of [{ ids: [] }, ["bai-he", 42], [" "], validIds]) {
    const memory = fixture();
    memory.data.set(STORE_KEYS.compare, corrupted);
    const store = createSelectionStore(memory.port, validIds);
    const state = store.read("compare");
    assert.equal(state.status, "error");
    assert.equal(state.ids, null);
    if (state.status === "error") assert.equal(state.errorCode, "invalid_records");
    assert.equal(store.toggle("compare", "bai-he", state.revision).ok, false);
    assert.equal(memory.writes.length, 0);
    assert.deepEqual(memory.data.get(STORE_KEYS.compare), corrupted);
  }
});

test("unlisted historical IDs survive reading and changes, and can be explicitly removed", () => {
  const memory = fixture();
  memory.data.set(STORE_KEYS.favorites, ["retired-item"]);
  const store = createSelectionStore(memory.port, validIds);
  const read = store.read("favorites");
  assert.equal(memory.writes.length, 0);
  const added = store.toggle("favorites", "bai-he", read.revision);
  assert.ok(added.ok);
  assert.deepEqual(added.state.ids, ["retired-item", "bai-he"]);
  const removed = store.remove("favorites", "retired-item", added.state.revision);
  assert.ok(removed.ok);
  assert.deepEqual(removed.state.ids, ["bai-he"]);
});

test("comparison limits reject the fifth item without truncation or writes", () => {
  const memory = fixture();
  memory.data.set(STORE_KEYS.compare, validIds.slice(0, 4));
  const store = createSelectionStore(memory.port, validIds);
  const before = store.read("compare");
  const result = store.toggle("compare", "tian-dong", before.revision);
  assert.ok(!result.ok);
  assert.equal(result.errorCode, "compare_limit");
  assert.equal(memory.writes.length, 0);
  assert.deepEqual(result.state.ids, validIds.slice(0, 4));
});

test("failed, ignored, and uncertain writes never report success", () => {
  for (const mode of ["throw", "ignored", "persist-throw", "readback-failed"]) {
    const memory = fixture();
    const store = createSelectionStore(memory.port, validIds);
    const before = store.read("favorites");
    if (mode === "throw") memory.setWriteFailure(true);
    if (mode === "ignored") memory.ignoreWrites();
    if (mode === "persist-throw") memory.persistThenThrow();
    if (mode === "readback-failed") memory.failReadAfterWrite();
    const result = store.toggle("favorites", "bai-he", before.revision);
    assert.equal(result.ok, false, mode);
    if (mode === "persist-throw") assert.deepEqual(result.state.ids, ["bai-he"]);
    if (mode === "readback-failed") assert.equal(result.state.ids, null);
    if (mode === "throw" || mode === "ignored") assert.deepEqual(result.state.ids, []);
  }
});

test("external same-count changes invalidate an old click before writing", () => {
  const memory = fixture();
  memory.data.set(STORE_KEYS.favorites, ["bai-he"]);
  const store = createSelectionStore(memory.port, validIds);
  const before = store.read("favorites");
  memory.data.set(STORE_KEYS.favorites, ["shan-yao"]);
  const result = store.toggle("favorites", "gou-qi-zi", before.revision);
  assert.ok(!result.ok);
  assert.equal(result.errorCode, "stale_state");
  assert.deepEqual(result.state.ids, ["shan-yao"]);
  assert.equal(memory.writes.length, 0);
});

test("clear only deletes the requested owned key and invalidates pre-deletion events", () => {
  const memory = fixture();
  memory.data.set("other-app-data", ["untouched"]);
  memory.data.set(STORE_KEYS.compare, ["shan-yao"]);
  const store = createSelectionStore(memory.port, validIds);
  const favorites = store.read("favorites");
  const compare = store.read("compare");
  const cleared = store.clear("favorites", favorites.revision);
  assert.ok(cleared.ok);
  assert.equal(cleared.changed, false);
  assert.notEqual(cleared.state.revision, favorites.revision);
  assert.equal(store.toggle("favorites", "bai-he", favorites.revision).ok, false);
  assert.equal(store.getSnapshot("compare").revision, compare.revision);
  assert.ok(store.clear("compare", compare.revision).ok);
  assert.deepEqual(memory.removals, ["zhongyi_favorites_v1", "zhongyi_compare_v1"]);
  assert.deepEqual(memory.data.get("other-app-data"), ["untouched"]);
  assert.equal(memory.writes.length, 0);
});

test("lifecycle invalidation rejects deferred operations even when IDs are unchanged", () => {
  const memory = fixture();
  const store = createSelectionStore(memory.port, validIds);
  const before = store.read("compare");
  store.invalidate();
  assert.equal(store.getSnapshot("compare").status, "unread");
  const result = store.toggle("compare", "bai-he", before.revision);
  assert.ok(!result.ok);
  assert.equal(result.errorCode, "stale_state");
  assert.equal(memory.writes.length, 0);
  const recovered = store.read("compare");
  assert.ok(store.toggle("compare", "bai-he", recovered.revision).ok);
});

test("deletion failure or no-op is explicit and preserves actual remaining records", () => {
  for (const mode of ["throw", "ignored"]) {
    const memory = fixture();
    memory.data.set(STORE_KEYS.favorites, ["bai-he"]);
    const store = createSelectionStore(memory.port, validIds);
    const before = store.read("favorites");
    if (mode === "throw") memory.failRemoval();
    else memory.ignoreRemoval();
    const result = store.clear("favorites", before.revision);
    assert.ok(!result.ok);
    assert.equal(result.errorCode, "write_failed");
    assert.deepEqual(result.state.ids, ["bai-he"]);
    assert.deepEqual(memory.data.get(STORE_KEYS.favorites), ["bai-he"]);
    assert.equal(store.toggle("favorites", "shan-yao", before.revision).ok, false);
  }
});
