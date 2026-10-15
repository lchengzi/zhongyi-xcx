const catalogData = require("../../../data/ingredients");
const storage = require("../../../utils/storage");
const safety = require("../../../utils/safety");
const format = require("../../../utils/format");
const { PART_LABEL, PART_SCOPE_NOTICE, foodIdentityDisplay } = require("../../../utils/food-display");
const { sourceDisplay, sourceRecordText } = require("../../../utils/source-display");
const sessionProfileUtils = require("../../../utils/session-profile");
const publicCatalog = require("../../../utils/public-catalog");
const navigation = require("../../../utils/navigation");
const clipboard = require("../../../utils/clipboard");
const platformUi = require("../../../utils/platform-ui");

// Page-owned targets only: dataset values never become arbitrary selectors.
const SECTION_TARGETS = Object.freeze({
  safety: "#detail-safety", identity: "#detail-identity", regulatory: "#detail-regulatory",
  food: "#detail-food", risks: "#detail-risks", sources: "#detail-sources", top: "#detail-top"
});

function sessionProfile() {
  return sessionProfileUtils.fromSession(getApp().globalData.sessionSafetyProfile || {});
}

function mapped(values, dictionary) {
  return (Array.isArray(values) ? values : []).map((value) => dictionary[value] || value);
}

function nonEmptyRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.value);
}

function emptyDetailData() {
  return {
    network: publicCatalog.getState(),
    ingredient: null,
    identityFacts: [],
    partScopeNotice: "",
    regulatoryFacts: [],
    traditionalFacts: [],
    goalRows: [],
    foodForms: [],
    photoNotice: null,
    foodUseReviewText: "食用形态映射待逐项复核",
    preparationNotes: [],
    safetyGroups: [],
    safetySourceText: "待确认",
    sourceRows: [],
    sectionNotice: "",
    triageBlocked: false,
    notFound: false
  };
}

Page({
  data: {
    ...emptyDetailData(),
    sectionLinks: [
      { key: "safety", label: "本次安全" }, { key: "identity", label: "规范身份" },
      { key: "regulatory", label: "目录状态" }, { key: "food", label: "食用加工" },
      { key: "risks", label: "禁忌提醒" }, { key: "sources", label: "来源审校" }
    ],
    storageIssue: "",
    favoritesAvailable: false,
    compareAvailable: false,
    contentVersion: catalogData.contentVersion || "待确认"
  },

  onLoad(options) {
    this.sectionScrollSequence = 0;
    this.pageDisposed = false;
    this.pageHidden = false;
    this.id = options && typeof options.id === "string" ? options.id : "";
    this.loadIngredient();
  },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    this.sectionScrollSequence += 1;
    this.setData({ sectionNotice: "" });
    navigation.resume(this);
    this.loadIngredient();
  },

  onHide() {
    this.pageHidden = true;
    this.sectionScrollSequence += 1;
    clipboard.reset(this);
  },

  onUnload() {
    this.pageDisposed = true;
    this.onHide();
    this.sourceById = {};
    navigation.reset(this);
  },

  clearIngredient(triageBlocked) {
    this.sectionScrollSequence += 1;
    this.sourceById = {};
    this.setData({ ...emptyDetailData(), triageBlocked, notFound: !triageBlocked });
    platformUi.setTitle(triageBlocked ? "安全分流" : "食养资料");
    return false;
  },

  loadIngredient() {
    if (this.pageDisposed || this.pageHidden) return false;
    const state = storage.getPersistentState();
    this.setData({ storageIssue: state.message, favoritesAvailable: state.favoritesAvailable, compareAvailable: state.compareAvailable });
    const profile = sessionProfile();
    if (profile.redFlags.length) {
      return this.clearIngredient(true);
    }
    const source = (publicCatalog.getCatalog() || catalogData.ingredients || []).find((item) => item.id === this.id);
    if (!source) {
      return this.clearIngredient(false);
    }
    const evaluation = safety.evaluateIngredient(source, profile);
    const view = format.detailView(source, state.favorites, state.compare, evaluation);
    const regulatory = source.regulatory || {};
    const traditional = source.traditional || {};
    const safetyData = source.safety || {};
    const audit = source.audit || {};
    const ingredient = {
      // Only fields consumed by this page cross the setData boundary.
      // format.detailView also retains source fields for other callers.
      id: source.id,
      pinyin: source.pinyin || "",
      nameCn: source.name,
      latinName: source.identity && source.identity.latinName,
      categoryText: view.regulatoryText,
      auditText: view.auditText,
      safetyLabel: view.safetyLabel,
      isFavorite: state.favoritesAvailable ? view.isFavorite : null,
      inCompare: state.compareAvailable ? view.inCompare : null,
      blocked: evaluation.blocked,
      warningCount: evaluation.warnings.length,
      blockedReason: view.reasonText,
      warningText: view.warningText,
      auditDetail: audit.note || "审校状态待确认",
      sourceCheckedAt: audit.sourceCheckedAt || "待确认",
      professionalReviewedAt: audit.reviewedAt || "待完成"
    };
    const partDisplay = foodIdentityDisplay(source);
    const identityFacts = [
      { label: "规范名称", value: source.name },
      { label: "拼音", value: source.pinyin || "待确认" },
      { label: "常用别名", value: format.arrayText(source.aliases, "暂无别名") }
    ].concat((view.identityRows || []).map(row => row.label === "可食部位"
      ? { label: PART_LABEL, value: partDisplay.partText } : row),
    [{ label: "部位资料复核", value: partDisplay.partReviewText }]);
    const regulatoryFacts = (view.regulatoryRows || []).concat([
      { label: "公告或目录编号", value: regulatory.noticeNo || regulatory.catalogRef || "见来源记录" },
      { label: PART_LABEL, value: partDisplay.partText }
    ]);
    const traditionalFacts = traditional.reviewState === "reviewed"
      ? nonEmptyRows(view.traditionalRows)
      : [{ label: "当前状态", value: "传统属性尚未完成专业逐字段审校，暂不展示推断内容" }];
    const preparationNotes = [];
    if (source.foodUse && source.foodUse.note) preparationNotes.push(source.foodUse.note);
    (safetyData.preparationWarnings || []).forEach((item) => preparationNotes.push(item));
    const safetyGroups = [
      { title: "生命阶段与特殊人群", items: (view.safetyRows || []).slice(0, 5).map((item) => `${item.label}：${item.value}`) },
      { title: "已录入的基础疾病禁忌", items: safetyData.avoidConditions || [] },
      { title: "已录入的药物相互作用", items: safetyData.drugInteractions || [] },
      { title: "过敏匹配范围", items: safetyData.allergenKeys || [] },
      { title: "加工与其他注意事项", items: preparationNotes }
    ];
    // The versioned formatter omits publication date/type. Read those fields
    // from the same validated ingredient, not another source or today's clock.
    const sourceRows = (Array.isArray(source.sources) ? source.sources : [])
      .map(sourceDisplay).filter(item => item.id);
    const safetySourceIds = new Set(safetyData.sourceIds || []);
    const safetySourceText = sourceRows
      .filter((item) => safetySourceIds.has(item.id))
      .map((item) => item.title)
      .join("；") || "当前没有字段级安全来源绑定";
    platformUi.setTitle(source.name);
    this.sourceById = {};
    sourceRows.forEach((item) => { this.sourceById[item.id] = item; });
    this.setData({
      network: publicCatalog.getState(),
      ingredient,
      identityFacts,
      partScopeNotice: PART_SCOPE_NOTICE,
      regulatoryFacts,
      traditionalFacts,
      goalRows: mapped(source.goals, format.GOAL_TEXT),
      foodForms: mapped(source.usageTypes, format.USAGE_TEXT),
      // No public photo contract exists yet. Private candidate flags and URLs
      // cannot turn this explanatory text into an image or trigger a request.
      photoNotice: {
        state: "unavailable",
        title: "实物图片暂未提供",
        message: "当前版本没有可展示的实物照片。请结合下方文字核对部位与加工资料；本页不用于采集、鉴别或判断能否食用。"
      },
      preparationNotes,
      foodUseReviewText: source.foodUse && source.foodUse.mappingReviewState === "reviewed" ? "食用形态映射已复核" : "食用形态映射待逐项复核",
      safetyGroups,
      safetySourceText,
      sourceRows,
      triageBlocked: false,
      notFound: false
    });
    return true;
  },

  jumpToSection(event) {
    if (!this.loadIngredient()) return false;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    const section = dataset && dataset.section;
    if (!dataset || dataset.id !== this.id || typeof section !== "string" ||
      !Object.prototype.hasOwnProperty.call(SECTION_TARGETS, section)) return false;
    const itemId = this.id;
    const sequence = ++this.sectionScrollSequence;
    let settled = false;
    this.setData({ sectionNotice: "" });
    const settle = (failed) => {
      if (settled) return;
      settled = true;
      if (this.pageDisposed || this.pageHidden || sequence !== this.sectionScrollSequence ||
        this.id !== itemId || !this.data.ingredient || this.data.ingredient.id !== itemId ||
        this.data.triageBlocked || sessionProfile().redFlags.length) return;
      this.setData({ sectionNotice: failed ? "快捷定位暂不可用，请向下滑动阅读完整资料。" : "" });
    };
    try {
      if (typeof wx === "undefined" || !wx || typeof wx.pageScrollTo !== "function") {
        settle(true); return false;
      }
      // No animation keeps an old native scroll from continuing after a new
      // safety state or navigation. This never hides or collapses the content.
      wx.pageScrollTo({ selector: SECTION_TARGETS[section], duration: 0,
        success: () => settle(false), fail: () => settle(true) });
      return true; // Invocation, not proof that the device reached the section.
    } catch (_) { settle(true); return false; }
  },

  toggleFavorite() {
    if (!this.loadIngredient()) return;
    if (!this.data.favoritesAvailable) {
      wx.showToast({ title: storage.errorMessage({ errorCode: "read_failed" }), icon: "none" }); return;
    }
    if (this.data.ingredient && this.data.ingredient.blocked && !this.data.ingredient.isFavorite) return;
    const result = storage.tryToggleFavorite(this.id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.loadIngredient();
  },

  toggleCompare() {
    if (!this.loadIngredient()) return;
    if (!this.data.compareAvailable) {
      wx.showToast({ title: storage.errorMessage({ errorCode: "read_failed" }), icon: "none" }); return;
    }
    if (this.data.ingredient && this.data.ingredient.blocked && !this.data.ingredient.inCompare) return;
    const result = storage.toggleCompare(this.id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    else wx.showToast({ title: result.added ? "已加入资料对照" : "已移出资料对照", icon: "none" });
    this.loadIngredient();
  },

  copySource(event) {
    return this.copySourceData(event, false);
  },

  copySourceRecord(event) {
    return this.copySourceData(event, true);
  },

  copySourceData(event, includeRecord) {
    if (!this.loadIngredient()) return;
    const sourceId = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const source = typeof sourceId === "string" && this.sourceById &&
      Object.prototype.hasOwnProperty.call(this.sourceById, sourceId) && this.sourceById[sourceId];
    if (!source || !source.url) {
      try { wx.showToast({ title: "来源链接待补充", icon: "none" }); }
      catch (_) { /* A failed notice cannot turn missing evidence into a copy. */ }
      return;
    }
    const text = includeRecord === true ? sourceRecordText({ name: this.data.ingredient.nameCn,
      contentVersion: this.data.contentVersion, sourceAsOf: this.data.network.sourceAsOf }, source) : source.url;
    return clipboard.writeText(this, text);
  },

  copySafetySummary() {
    if (!this.loadIngredient()) return;
    const item = this.data.ingredient;
    const text = [
      `${item.nameCn}｜食养资料安全摘要`,
      `法规状态：${item.categoryText}`,
      `本次状态：${item.safetyLabel}`,
      item.blockedReason ? `阻止原因：${item.blockedReason}` : `提醒：${item.warningText || "仍需结合个体情况确认"}`,
      `内容版本：${this.data.contentVersion}`,
      "本摘要不构成诊断、处方、剂量或配伍建议。"
    ].join("\n");
    clipboard.writeText(this, text);
  },

  goCatalog() {
    if (this.pageDisposed || this.pageHidden) return;
    navigation.switchTab(this, "index");
  },

  onShareAppMessage() {
    const item = this.data.ingredient;
    const canShare = !this.pageDisposed && !this.pageHidden && !this.data.triageBlocked && !sessionProfile().redFlags.length &&
      item && item.id === this.id && !this.data.notFound;
    return {
      title: canShare ? `${item.nameCn}｜食养资料` : "中医食养筛选助手",
      path: canShare ? `/subpackages/catalog/detail/detail?id=${encodeURIComponent(item.id)}` : "/pages/index/index"
    };
  }
});
