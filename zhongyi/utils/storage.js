"use strict";

const KEYS = Object.freeze({
  favorites: "zhongyi_favorites_v1",
  compare: "zhongyi_compare_v1"
});
const OWNED_KEY_PREFIX = "zhongyi_";

const memoryStorage = Object.create(null);
let memoryChecklist = {};

function wxStorage() {
  return typeof wx !== "undefined" && wx &&
    typeof wx.getStorageSync === "function" &&
    typeof wx.setStorageSync === "function" ? wx : null;
}

function clone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function readIds(key, limit) {
  try {
    const api = wxStorage();
    if (typeof wx !== "undefined" && wx && !api) throw new Error("storage unavailable");
    const value = api ? api.getStorageSync(key) : memoryStorage[key];
    if (value === "" || value == null) return { ok: true, ids: [], errorCode: "" };
    if (!Array.isArray(value)) return { ok: false, ids: [], errorCode: "invalid_records" };
    return { ok: true, ids: uniqueIds(value, limit), errorCode: "" };
  } catch (_) {
    return { ok: false, ids: [], errorCode: "read_failed" };
  }
}

function write(key, value) {
  try {
    const safeValue = clone(value, value);
    const api = wxStorage();
    if (typeof wx !== "undefined" && wx && !api) return false;
    if (api) api.setStorageSync(key, safeValue);
    else memoryStorage[key] = safeValue;
    return true;
  } catch (_) {
    return false;
  }
}

function remove(key) {
  try {
    const api = wxStorage();
    if (typeof wx !== "undefined" && wx && !api) return false;
    if (api) {
      if (typeof api.removeStorageSync !== "function") return false;
      api.removeStorageSync(key);
    } else delete memoryStorage[key];
    return true;
  } catch (_) {
    return false;
  }
}

function ownedPersistentState() {
  const api = wxStorage();
  if (!api) {
    if (typeof wx !== "undefined" && wx) return { keys: Object.values(KEYS), complete: false };
    return {
      keys: Object.keys(memoryStorage).filter((key) => key.startsWith(OWNED_KEY_PREFIX)),
      complete: true
    };
  }
  if (typeof api.getStorageInfoSync !== "function") {
    const keys = Object.values(KEYS).filter((key) => {
      try {
        const value = api.getStorageSync(key);
        return value !== "" && value != null;
      } catch (_) {
        return true;
      }
    });
    return { keys, complete: false };
  }
  try {
    const info = api.getStorageInfoSync() || {};
    return {
      keys: (Array.isArray(info.keys) ? info.keys : []).filter((key) => (
        typeof key === "string" && key.startsWith(OWNED_KEY_PREFIX)
      )),
      complete: Array.isArray(info.keys)
    };
  } catch (_) {
    return { keys: Object.values(KEYS), complete: false };
  }
}

function clearOwnedPersistentData() {
  const before = ownedPersistentState();
  const candidates = [...new Set(Object.values(KEYS).concat(before.keys))];
  const failedKeys = [];
  candidates.forEach((key) => {
    if (!remove(key)) failedKeys.push(key);
  });
  const after = ownedPersistentState();
  return {
    ok: before.complete && after.complete && failedKeys.length === 0 && after.keys.length === 0,
    removedKeys: candidates.filter((key) => !failedKeys.includes(key)),
    failedKeys,
    remainingKeys: after.keys,
    verified: before.complete && after.complete
  };
}

// Private, short-lived confirmation context, never a view model or network DTO.
// Include raw owned records so equal counts and corrupt/legacy value changes
// cannot make an old destructive confirmation appear current. Unknown reads
// remain explicit; they do not prevent a user from requesting deletion.
function getOwnedPersistentContext() {
  const state = ownedPersistentState();
  const api = wxStorage();
  const keys = [...new Set(Object.values(KEYS).concat(state.keys))].sort();
  return [state.complete, keys.map((key) => {
    try {
      if (typeof wx !== "undefined" && wx && !api) throw new Error("storage unavailable");
      const value = api ? api.getStorageSync(key) : memoryStorage[key];
      return [key, true, JSON.stringify(value == null || value === "" ? null : value)];
    } catch (_) {
      return [key, false];
    }
  })];
}

function cleanId(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, 80);
}

function uniqueIds(value, limit) {
  const seen = Object.create(null);
  const result = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    const id = cleanId(item);
    if (!id || seen[id] || result.length >= (limit || 500)) return;
    seen[id] = true;
    result.push(id);
  });
  return result;
}

function getFavorites() {
  return readIds(KEYS.favorites).ids;
}

function commitIds(key, ids, current, limit) {
  if (!current.ok) return { ...current, changed: false };
  const next = uniqueIds(ids, limit);
  if (JSON.stringify(current.ids) === JSON.stringify(next)) return { ok: true, ids: next, changed: false, errorCode: "" };
  if (!write(key, next)) return { ok: false, ids: current.ids, changed: false, errorCode: "write_failed" };
  if (key === KEYS.compare) memoryChecklist = {};
  return { ok: true, ids: next, changed: true, errorCode: "" };
}

function trySetFavorites(ids) {
  return commitIds(KEYS.favorites, ids, readIds(KEYS.favorites));
}

function setFavorites(ids) {
  return trySetFavorites(ids).ids;
}

function tryToggleFavorite(id) {
  const clean = cleanId(id);
  const current = readIds(KEYS.favorites);
  if (!current.ok) return { ...current, changed: false };
  if (!clean) return { ...current, ok: false, changed: false, errorCode: "invalid_id" };
  return commitIds(KEYS.favorites, current.ids.includes(clean) ? current.ids.filter((item) => item !== clean) : current.ids.concat(clean), current);
}

function toggleFavorite(id) {
  return tryToggleFavorite(id).ids;
}

function tryRemoveFavorite(id) {
  const clean = cleanId(id);
  const current = readIds(KEYS.favorites);
  if (!current.ok) return { ...current, changed: false };
  if (!clean) return { ...current, ok: false, changed: false, errorCode: "invalid_id" };
  return commitIds(KEYS.favorites, current.ids.filter((item) => item !== clean), current);
}

function getCompare() {
  return readIds(KEYS.compare, 4).ids;
}

function trySetCompare(ids) {
  return commitIds(KEYS.compare, ids, readIds(KEYS.compare, 4), 4);
}

function setCompare(ids) {
  return trySetCompare(ids).ids;
}

function tryRemoveCompare(id) {
  const clean = cleanId(id);
  const current = readIds(KEYS.compare, 4);
  if (!current.ok) return { ...current, changed: false };
  if (!clean) return { ...current, ok: false, changed: false, errorCode: "invalid_id" };
  return commitIds(KEYS.compare, current.ids.filter((item) => item !== clean), current, 4);
}

function toggleCompare(id) {
  const clean = cleanId(id);
  const current = readIds(KEYS.compare, 4);
  const unchanged = { ...current, changed: false, added: false, limited: false };
  if (!current.ok) return unchanged;
  if (!clean) return { ...unchanged, ok: false, errorCode: "invalid_id" };
  if (current.ids.includes(clean)) {
    return { ...commitIds(KEYS.compare, current.ids.filter((item) => item !== clean), current, 4), added: false, limited: false };
  }
  if (current.ids.length >= 4) return { ...unchanged, ok: false, limited: true, errorCode: "compare_limit" };
  const result = commitIds(KEYS.compare, current.ids.concat(clean), current, 4);
  return { ...result, added: result.ok, limited: false };
}

function getPersistentState() {
  const favorites = readIds(KEYS.favorites);
  const compare = readIds(KEYS.compare, 4);
  return {
    favorites: favorites.ids, compare: compare.ids,
    favoritesAvailable: favorites.ok, compareAvailable: compare.ok,
    message: favorites.ok && compare.ok ? "" : "本机收藏或对照暂时无法读取，当前数量和空列表不能代表原记录。请重试读取；不会自动清空记录。"
  };
}

function errorMessage(result) {
  if (result && result.errorCode === "compare_limit") return "最多对照 4 项资料";
  if (result && result.errorCode === "write_failed") return "本机保存失败，请检查后重试";
  if (result && result.errorCode === "invalid_id") return "条目无效，未修改记录";
  return "本机记录读取失败，未执行修改";
}

function reconcileCatalogIds(validIds) {
  const valid = new Set(uniqueIds(validIds));
  const currentFavorites = getFavorites();
  const currentCompare = getCompare();
  const nextFavorites = currentFavorites.filter((id) => valid.has(id));
  const nextCompare = currentCompare.filter((id) => valid.has(id));
  const favorites = nextFavorites.length !== currentFavorites.length ? setFavorites(nextFavorites) : currentFavorites;
  const compare = nextCompare.length !== currentCompare.length ? setCompare(nextCompare) : currentCompare;
  return { favorites, compare };
}

function normalizeChecklist(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const items = source.items && typeof source.items === "object" && !Array.isArray(source.items) ? source.items : source;
  const result = {};
  Object.keys(items).slice(0, 100).forEach((key) => {
    const id = cleanId(key);
    if (id) result[id] = items[key] === true;
  });
  return result;
}

function getChecklist() {
  return clone(memoryChecklist, {});
}

function setChecklist(value) {
  const next = normalizeChecklist(value);
  memoryChecklist = clone(next, {});
  return clone(memoryChecklist, {});
}

function toggleChecklist(id, checked) {
  const clean = cleanId(id);
  const current = getChecklist();
  if (!clean) return current;
  current[clean] = typeof checked === "boolean" ? checked : !current[clean];
  return setChecklist(current);
}

const favorites = {
  get: getFavorites,
  set: setFavorites,
  trySet: trySetFavorites,
  tryToggle: tryToggleFavorite,
  toggle: toggleFavorite,
  has: (id) => getFavorites().includes(cleanId(id)),
  clear: () => remove(KEYS.favorites)
};

const compare = {
  max: 4,
  get: getCompare,
  set: setCompare,
  trySet: trySetCompare,
  tryRemove: tryRemoveCompare,
  toggle: toggleCompare,
  clear: () => { const ok = remove(KEYS.compare); if (ok) memoryChecklist = {}; return ok; }
};

const checklist = {
  get: getChecklist,
  set: setChecklist,
  toggle: toggleChecklist,
  clear: () => {
    memoryChecklist = {};
    return true;
  }
};

module.exports = {
  KEYS,
  OWNED_KEY_PREFIX,
  favorites,
  compare,
  checklist,
  getFavorites,
  setFavorites,
  toggleFavorite,
  trySetFavorites,
  tryToggleFavorite,
  tryRemoveFavorite,
  getCompare,
  setCompare,
  toggleCompare,
  trySetCompare,
  tryRemoveCompare,
  getPersistentState,
  errorMessage,
  reconcileCatalogIds,
  getChecklist,
  setChecklist,
  toggleChecklist,
  clearOwnedPersistentData,
  getOwnedPersistentContext
};
