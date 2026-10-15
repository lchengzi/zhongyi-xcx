"use strict";

const ROUTES = Object.freeze({
  index: "/pages/index/index",
  favorites: "/pages/favorites/favorites",
  compare: "/pages/compare/compare",
  plan: "/pages/plan/plan",
  privacy: "/pages/privacy/privacy",
  ingredient: "/subpackages/catalog/detail/detail",
  officialDirectory: "/subpackages/official/official-plans/official-plans",
  officialDetail: "/subpackages/official/official-plan-detail/official-plan-detail"
});
const TAB_KEYS = ["index", "favorites", "compare", "plan"];
const pending = new WeakMap();

function isActive(page) {
  return page && typeof page === "object" && !page.pageHidden && !page.pageDisposed;
}

function reset(page) {
  pending.delete(page);
}

function resume(page) {
  if (!isActive(page)) return;
  const operation = pending.get(page);
  // Foregrounding the app can call onShow while a download is still pending.
  // Only an observed successful transition proves it is safe to navigate again.
  if (operation && operation.succeeded) pending.delete(page);
}

function notifyFailure() {
  try {
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "页面打开失败，请稍后重试", icon: "none" });
    }
  } catch (_) { /* A failed notification must not retain the navigation lock. */ }
}

// Keep successful navigation locked until the source page's next onShow.
// A timeout cannot cancel WeChat navigation, so it must not launch a second copy.
function start(page, method, options, fallback) {
  if (!isActive(page) || pending.has(page)) return false;
  const operation = {};
  pending.set(page, operation);
  function attempt(nextMethod, nextOptions, canFallback) {
    let settled = false;
    function fail() {
      if (settled || pending.get(page) !== operation) return;
      settled = true;
      // An explicit failure releases the old lock, but a page the user has
      // left must not redirect or display a stale application notification.
      if (!isActive(page)) { pending.delete(page); return; }
      if (canFallback && fallback) {
        attempt(fallback.method, fallback.options, false);
        return;
      }
      pending.delete(page);
      notifyFailure();
    }
    function success() {
      if (settled || pending.get(page) !== operation) return;
      settled = true;
      operation.succeeded = true;
    }
    try {
      if (typeof wx === "undefined" || typeof wx[nextMethod] !== "function") { fail(); return; }
      wx[nextMethod]({ ...nextOptions, success, fail });
    } catch (_) { fail(); }
  }
  attempt(method, options, Boolean(fallback));
  return true;
}

function idUrl(route, id) {
  if (typeof id !== "string" || !id || id.length > 100 || id.trim() !== id) return "";
  try { return `${route}?id=${encodeURIComponent(id)}`; }
  catch (_) { return ""; }
}

function openIngredient(page, id) {
  const url = idUrl(ROUTES.ingredient, id);
  return Boolean(url) && start(page, "navigateTo", { url });
}

function openOfficialDetail(page, id) {
  const url = idUrl(ROUTES.officialDetail, id);
  return Boolean(url) && start(page, "navigateTo", { url });
}

function openOfficialDirectory(page) {
  return start(page, "navigateTo", { url: ROUTES.officialDirectory });
}

function openPrivacy(page) {
  return start(page, "navigateTo", { url: ROUTES.privacy });
}

function switchTab(page, key) {
  if (!TAB_KEYS.includes(key)) return false;
  return start(page, "switchTab", { url: ROUTES[key] });
}

function backToOfficialDirectory(page) {
  let previous = null;
  try {
    const stack = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    previous = stack.length > 1 ? stack[stack.length - 2] : null;
  } catch (_) { /* A direct link has no dependable previous page. */ }
  const fallback = { method: "redirectTo", options: { url: ROUTES.officialDirectory } };
  if (previous && previous.route === ROUTES.officialDirectory.slice(1)) {
    return start(page, "navigateBack", { delta: 1 }, fallback);
  }
  return start(page, fallback.method, fallback.options);
}

module.exports = {
  reset, resume, openIngredient, openOfficialDetail, openOfficialDirectory,
  openPrivacy, switchTab, backToOfficialDirectory
};
