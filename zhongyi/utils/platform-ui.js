"use strict";

// Cosmetic native UI is best-effort. Its failure must not interrupt content,
// red-flag clearing or privacy reset. No OS detection, logging or auto-retry.
function invoke(method, options) {
  try {
    if (typeof wx === "undefined" || !wx || typeof wx[method] !== "function") return false;
    wx[method]({ ...options, fail() {} });
    return true; // Invocation only, not proof of an actual native UI update.
  } catch (_) { return false; }
}

function setTitle(title) {
  if (typeof title !== "string" || !title.trim()) return false;
  return invoke("setNavigationBarTitle", { title });
}

function setTabBarVisible(visible) {
  if (typeof visible !== "boolean") return false;
  return invoke(visible ? "showTabBar" : "hideTabBar", { animation: true });
}

module.exports = { setTitle, setTabBarVisible };
