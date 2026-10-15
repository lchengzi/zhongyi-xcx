"use strict";

// User-initiated writes only. Never read the clipboard, log copied text or
// retry a system write automatically. Already-issued writes cannot be revoked.
const latest = new WeakMap();
const FAILURE_NOTICE = "复制未完成，请再次点击重试";

function active(page) {
  return page && typeof page === "object" && !page.pageHidden && !page.pageDisposed;
}

function revision() {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    const value = app && app.globalData && app.globalData.sessionDataRevision;
    return Number.isSafeInteger(value) ? value : 0;
  } catch (_) { return null; }
}

function reset(page) { latest.delete(page); }

function writeText(page, text) {
  if (!active(page) || typeof text !== "string" || !text.trim()) return false;
  const operation = { settled: false, revision: revision() };
  latest.set(page, operation);
  function settle(failed) {
    if (operation.settled) return;
    operation.settled = true;
    const current = latest.get(page) === operation;
    if (current) latest.delete(page);
    if (!failed || !current || !active(page) || revision() !== operation.revision) return;
    try {
      if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
        wx.showToast({ title: FAILURE_NOTICE, icon: "none" });
      }
    } catch (_) { /* A failed notice must not trigger another clipboard write. */ }
  }
  try {
    if (typeof wx === "undefined" || typeof wx.setClipboardData !== "function") {
      settle(true); return false;
    }
    wx.setClipboardData({ data: text, success: () => settle(false), fail: () => settle(true) });
    return true; // Accepted for invocation, not proof that copying completed.
  } catch (_) {
    settle(true); return false;
  }
}

module.exports = { writeText, reset };
