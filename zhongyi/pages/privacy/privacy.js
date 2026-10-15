"use strict";

const privacy = require("../../utils/privacy");
const publicCatalog = require("../../utils/public-catalog");

Page({
  data: {
    storageIssue: "",
    favoritesAvailable: true,
    compareAvailable: true,
    favoritesCount: 0,
    compareCount: 0,
    checklistCount: 0,
    diagnosisConfirmationCount: 0,
    hasHealthSession: false,
    hasSessionData: false,
    triageBlocked: false,
    confirming: false,
    deleting: false,
    returning: false,
    returnAvailable: false,
    deleteStatus: ""
  },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    if (this.pendingReturn && this.pendingReturn.succeeded) this.pendingReturn = null;
    this.setData({ confirming: Boolean(this.pendingDelete), returning: Boolean(this.pendingReturn) });
    this.refresh();
  },

  onHide() {
    this.pageHidden = true;
    this.cancelConfirmation();
    this.pendingReturn = null;
  },

  onUnload() { this.pageDisposed = true; this.onHide(); },

  isInteractive() { return !this.pageDisposed && !this.pageHidden; },

  cancelConfirmation() {
    if (this.pendingDelete) this.pendingDelete.context = null;
    this.pendingDelete = null;
  },

  refresh() {
    if (!this.isInteractive()) return;
    const summary = privacy.getLocalDataSummary(getApp());
    this.setData({
      favoritesCount: summary.favoritesCount,
      compareCount: summary.compareCount,
      storageIssue: summary.storageIssue,
      favoritesAvailable: summary.favoritesAvailable,
      compareAvailable: summary.compareAvailable,
      checklistCount: summary.checklistCount,
      diagnosisConfirmationCount: summary.diagnosisConfirmationCount,
      hasHealthSession: summary.hasHealthSession,
      hasSessionData: summary.hasSessionData,
      triageBlocked: summary.hasRedFlags
    });
  },

  deleteLocalData() {
    if (!this.isInteractive() || this.pendingDelete || this.pendingReturn || this.data.deleting) return;
    const operation = { context: privacy.getDeletionContext(getApp()) };
    this.pendingDelete = operation;
    this.setData({ confirming: true, deleteStatus: "", returnAvailable: false });
    const fail = () => {
      if (this.pendingDelete !== operation || !this.isInteractive()) return;
      this.cancelConfirmation();
      this.setData({ confirming: false, deleteStatus: "删除确认未能打开，请重试。" });
    };
    try { wx.showModal({
      title: "删除本机全部数据？",
      content: "将删除收藏、对照，以及本次会话中的症状/红旗、安全问项、过敏、疾病、用药、确诊确认和清单进度。操作无法撤销。",
      confirmText: "全部删除",
      confirmColor: "#9a4034",
      success: (modalResult) => {
        if (this.pendingDelete !== operation || !this.isInteractive()) return;
        const context = operation.context;
        this.cancelConfirmation();
        this.setData({ confirming: false });
        if (!modalResult || modalResult.confirm !== true) return;
        if (context !== privacy.getDeletionContext(getApp())) {
          this.refresh();
          this.setData({ deleteStatus: "本机数据状态已变化，请重新确认删除。" });
          return;
        }
        this.setData({ deleting: true, deleteStatus: "" });
        let catalogCleared = true;
        try { publicCatalog.clear(); } catch (_) { catalogCleared = false; }
        let result;
        try { result = privacy.clearAllLocalData(getApp()); }
        catch (_) { result = { ok: false, sessionCleared: false }; }
        this.refresh();
        this.setData({ deleting: false });
        if (!result.ok || !catalogCleared) {
          this.setData({ deleteStatus: "未能验证全部本地数据已删除，请重试。" });
          try { wx.showModal({
            title: "未能完全删除",
            content: (result.sessionCleared ? "会话健康信息已清空，但" : "") +
              "尚不能验证全部本机记录和资料缓存已删除。请重试；仍失败时可在微信设置中清理本小程序数据。",
            showCancel: false,
            confirmText: "知道了"
          }); } catch (_) { /* The persistent on-page failure message permits retry. */ }
          return;
        }
        this.setData({ deleteStatus: "本机数据已全部删除。" });
        try { wx.showToast({ title: "本机数据已删除", icon: "success" }); }
        catch (_) { /* Notification failure must not block page-stack reset. */ }
        this.setData({ returnAvailable: true });
        this.returnToHome();
      },
      fail
    }); } catch (_) { fail(); }
  },

  returnToHome() {
    if (!this.isInteractive() || !this.data.returnAvailable || this.pendingReturn || this.pendingDelete || this.data.deleting) return;
    const operation = {};
    this.pendingReturn = operation;
    this.setData({ returning: true });
    const attempt = (method, url, canFallback) => {
      let settled = false;
      const current = () => this.isInteractive() && this.pendingReturn === operation;
      const fail = () => {
        if (settled || !current()) return;
        settled = true;
        if (canFallback) { attempt("switchTab", "/pages/index/index", false); return; }
        this.pendingReturn = null;
        this.setData({ returning: false, deleteStatus: "本机数据已删除，但首页未能打开。可重试返回首页或手动返回；不会再次删除记录。" });
      };
      try {
        if (typeof wx[method] !== "function") { fail(); return; }
        wx[method]({
          url,
          success: () => {
            if (settled || !current()) return;
            settled = true;
            operation.succeeded = true;
          },
          fail
        });
      } catch (_) { fail(); }
    };
    attempt("reLaunch", "/pages/index/index?privacyCleared=1", true);
  },

  onShareAppMessage() {
    return { title: "中医食养筛选助手（非医疗教育）", path: "/pages/index/index" };
  }
});
