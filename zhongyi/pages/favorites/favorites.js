const catalogData = require("../../data/ingredients");
const storage = require("../../utils/storage");
const safety = require("../../utils/safety");
const format = require("../../utils/format");
const { foodIdentityDisplay } = require("../../utils/food-display");
const sessionProfileUtils = require("../../utils/session-profile");
const navigation = require("../../utils/navigation");
const { filterCatalogText, searchMatchDisplay } = require("../../utils/catalog-search");

function sessionProfile() {
  return sessionProfileUtils.fromSession(getApp().globalData.sessionSafetyProfile || {});
}

function card(item, favoriteIds, compareIds, evaluation, query) {
  const view = format.cardView(item, favoriteIds, compareIds, evaluation);
  return {
    ...view,
    nameCn: item.name,
    categoryText: view.regulatoryText,
    ...foodIdentityDisplay(item),
    ...searchMatchDisplay(item, query),
    summary: item.audit && item.audit.note,
    matchReasons: [],
    blocked: evaluation.blocked,
    warningCount: evaluation.warnings.length,
    blockedReason: view.reasonText,
    warningText: view.warningText
  };
}

Page({
  data: { rows: [], favoriteCount: 0, query: "", searchVersion: 0, compareCount: 0, triageBlocked: false, storageIssue: "" },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    navigation.resume(this);
    this.refresh();
  },

  onHide() { this.pageHidden = true; this.setData({ searchVersion: this.data.searchVersion + 1 }); },

  onUnload() { this.pageDisposed = true; this.pageHidden = true; navigation.reset(this); },

  prepareAction() {
    if (this.pageDisposed || this.pageHidden) return false;
    this.refresh();
    if (this.data.triageBlocked) return false;
    if (this.data.storageIssue) {
      wx.showToast({ title: "本机记录读取失败，未执行修改", icon: "none" });
      return false;
    }
    return true;
  },

  refresh() {
    if (this.pageDisposed) return;
    const state = storage.getPersistentState();
    const favoriteIds = state.favorites;
    const compareIds = state.compare;
    const profile = sessionProfile();
    const revision = Number.isSafeInteger(getApp().globalData.sessionDataRevision) ? getApp().globalData.sessionDataRevision : 0;
    const deleted = this.sessionDataRevision !== undefined && this.sessionDataRevision !== revision;
    const context = JSON.stringify([revision, profile, state.favoritesAvailable, state.compareAvailable]);
    if (this.searchContext !== undefined && context !== this.searchContext) {
      this.setData({ searchVersion: this.data.searchVersion + 1, query: deleted ? "" : this.data.query });
    }
    this.sessionDataRevision = revision;
    this.searchContext = context;
    const triageBlocked = profile.redFlags.length > 0;
    const recordsAvailable = state.favoritesAvailable && state.compareAvailable;
    const savedItems = (triageBlocked || !recordsAvailable ? [] : favoriteIds)
      .map((id) => (catalogData.ingredients || []).find((item) => item.id === id))
      .filter(Boolean);
    const rows = filterCatalogText(savedItems, this.data.query)
      .map((item) => card(item, favoriteIds, compareIds, safety.evaluateIngredient(item, profile), this.data.query));
    this.setData({ rows, favoriteCount: recordsAvailable && !triageBlocked ? savedItems.length : null,
      compareCount: recordsAvailable ? compareIds.length : null, triageBlocked, storageIssue: state.message });
  },

  prepareSearch(event) {
    if (this.pageDisposed || this.pageHidden) return false;
    this.refresh();
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    return !this.data.triageBlocked && !this.data.storageIssue && Boolean(dataset && dataset.version === this.data.searchVersion);
  },

  onSearchInput(event) {
    if (!this.prepareSearch(event)) return;
    const value = event && event.detail && event.detail.value;
    if (typeof value !== "string") return;
    this.setData({ query: value.slice(0, 60) });
    this.refresh();
  },

  onSearchConfirm(event) {
    if (!this.prepareSearch(event)) return;
    const value = event && event.detail && event.detail.value;
    if (typeof value !== "string") return;
    this.setData({ query: value.slice(0, 60), searchVersion: this.data.searchVersion + 1 });
    this.refresh();
  },

  clearSearch(event) {
    if (!this.prepareSearch(event)) return;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    if (dataset.query !== this.data.query) return;
    this.setData({ query: "", searchVersion: this.data.searchVersion + 1 });
    this.refresh();
  },

  goCatalog() {
    navigation.switchTab(this, "index");
  },

  openDetail(event) {
    if (!this.prepareAction()) return;
    const id = event && event.detail && event.detail.id;
    if (this.data.rows.some((item) => item.id === id)) navigation.openIngredient(this, id);
  },

  removeFavorite(event) {
    if (!this.prepareAction()) return;
    const id = event && event.detail && event.detail.id;
    if (!this.data.rows.some((item) => item.id === id)) return;
    const result = storage.tryRemoveFavorite(id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.refresh();
  },

  toggleCompare(event) {
    if (!this.prepareAction()) return;
    const id = event && event.detail && event.detail.id;
    const item = this.data.rows.find((candidate) => candidate.id === id);
    if (!item || (item.blocked && !item.inCompare)) return;
    const result = storage.toggleCompare(id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.refresh();
  },

  openCompare() {
    if (!this.prepareAction()) return;
    navigation.switchTab(this, "compare");
  },

  onShareAppMessage() {
    return { title: "我的食养资料收藏", path: "/pages/index/index" };
  }
});
