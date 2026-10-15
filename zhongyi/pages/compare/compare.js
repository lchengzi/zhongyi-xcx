const catalogData = require("../../data/ingredients");
const storage = require("../../utils/storage");
const safety = require("../../utils/safety");
const format = require("../../utils/format");
const { PART_SCOPE_NOTICE, foodIdentityDisplay } = require("../../utils/food-display");
const { buildCompareGroups } = require("../../utils/compare");
const sessionProfileUtils = require("../../utils/session-profile");
const navigation = require("../../utils/navigation");

function sessionProfile() {
  return sessionProfileUtils.fromSession(getApp().globalData.sessionSafetyProfile || {});
}

Page({
  data: {
    storageIssue: "",
    partScopeNotice: PART_SCOPE_NOTICE,
    ingredients: [],
    groups: [],
    readingMode: "stacked",
    displayVersion: 0,
    differencesOnly: false,
    visibleRows: 0,
    tableWidth: 800,
    gridTemplate: "200rpx repeat(2, 300rpx)",
    triageBlocked: false
  },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    navigation.resume(this);
    this.refresh();
  },

  onHide() {
    this.pageHidden = true; this.pendingClear = null;
    if (!this.pageDisposed) this.setData({ displayVersion: this.data.displayVersion + 1 });
  },

  onUnload() { this.pageDisposed = true; this.onHide(); navigation.reset(this); },

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
    const ids = state.compare;
    this.actionContext = JSON.stringify([getApp().globalData.sessionDataRevision || 0, ids]);
    const favoriteIds = state.favorites;
    this.setData({ storageIssue: state.message });
    const profile = sessionProfile();
    const revision = Number.isSafeInteger(getApp().globalData.sessionDataRevision) ? getApp().globalData.sessionDataRevision : 0;
    const deleted = this.sessionDataRevision !== undefined && this.sessionDataRevision !== revision;
    const context = JSON.stringify([revision, ids, profile, state.favoritesAvailable, state.compareAvailable]);
    if (this.displayContext !== undefined && context !== this.displayContext) {
      this.setData({ displayVersion: this.data.displayVersion + 1, readingMode: deleted ? "stacked" : this.data.readingMode });
    }
    this.sessionDataRevision = revision;
    this.displayContext = context;
    const triageBlocked = profile.redFlags.length > 0;
    if (triageBlocked || !state.favoritesAvailable || !state.compareAvailable) {
      this.rawItems = [];
      this.setData({
        ingredients: [], groups: [], visibleRows: 0, triageBlocked,
        tableWidth: 800, gridTemplate: "200rpx repeat(2, 300rpx)"
      });
      return;
    }
    const rawItems = ids
      .map((id) => (catalogData.ingredients || []).find((item) => item.id === id))
      .filter(Boolean);
    const evaluations = safety.evaluateCatalog(rawItems, profile);
    const evaluationById = {};
    evaluations.forEach((item) => { evaluationById[item.ingredientId] = item; });
    const ingredients = rawItems.map((item) => {
      const evaluation = evaluationById[item.id];
      const view = format.cardView(item, favoriteIds, ids, evaluation);
      return {
        ...view,
        nameCn: item.name,
        ...foodIdentityDisplay(item),
        categoryText: view.regulatoryText,
        blocked: evaluation.blocked
      };
    });
    const groups = buildCompareGroups(rawItems, this.data.differencesOnly, evaluations);
    this.rawItems = rawItems;
    this.setData({
      ingredients,
      groups,
      visibleRows: groups.reduce((sum, group) => sum + group.rows.length, 0),
      tableWidth: 200 + rawItems.length * 300,
      gridTemplate: `200rpx repeat(${Math.max(rawItems.length, 2)}, 300rpx)`,
      triageBlocked: false
    });
  },

  setDifferenceMode(event) {
    if (!this.prepareAction() || this.data.ingredients.length < 2) return;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    const value = event && event.detail && event.detail.value;
    if (!dataset || dataset.version !== this.data.displayVersion || typeof value !== "boolean") return;
    this.setData({ differencesOnly: value, displayVersion: this.data.displayVersion + 1 });
    this.refresh();
  },

  setReadingMode(event) {
    if (!this.prepareAction() || this.data.ingredients.length < 2) return;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    if (!dataset || dataset.version !== this.data.displayVersion || !["stacked", "table"].includes(dataset.mode)) return;
    this.setData({ readingMode: dataset.mode });
  },

  removeIngredient(event) {
    if (!this.prepareAction()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    if (!this.data.ingredients.some((item) => item.id === id)) return;
    const result = storage.tryRemoveCompare(id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.refresh();
  },

  clearCompare() {
    if (!this.prepareAction() || this.pendingClear) return;
    const operation = { context: this.actionContext };
    this.pendingClear = operation;
    const fail = () => {
      if (this.pendingClear !== operation) return;
      this.pendingClear = null;
      if (this.pageDisposed || this.pageHidden) return;
      try { wx.showToast({ title: "确认窗口未完成，请再次点击重试", icon: "none" }); }
      catch (_) { /* A failed notice does not retain the confirmation state. */ }
    };
    try {
      wx.showModal({
        title: "清空资料对照？",
        content: "只会清空对照列表，不会删除收藏，也不会改变本次安全检查。",
        success: (result) => {
          if (this.pendingClear !== operation) return;
          this.pendingClear = null;
          if (!result || result.confirm !== true || !this.prepareAction()) return;
          if (this.actionContext !== operation.context) {
            wx.showToast({ title: "资料状态已变化，请重新确认", icon: "none" });
            return;
          }
          const saved = storage.trySetCompare([]);
          if (!saved.ok) wx.showToast({ title: storage.errorMessage(saved), icon: "none" });
          this.refresh();
        },
        fail
      });
    } catch (_) { fail(); }
  },

  goCatalog() {
    navigation.switchTab(this, "index");
  },

  openDetail(event) {
    if (!this.prepareAction()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    if (this.data.ingredients.some((item) => item.id === id)) navigation.openIngredient(this, id);
  },

  toggleFavorite(event) {
    if (!this.prepareAction()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const item = this.data.ingredients.find((candidate) => candidate.id === id);
    if (!item || (item.blocked && !item.isFavorite)) return;
    const result = storage.tryToggleFavorite(id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.refresh();
  },

  onShareAppMessage() {
    return { title: "食养资料对照（不代表可以共同食用）", path: "/pages/index/index" };
  }
});
