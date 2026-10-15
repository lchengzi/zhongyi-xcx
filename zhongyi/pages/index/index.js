const catalogData = require("../../data/ingredients");
const optionData = require("../../data/options");
const storage = require("../../utils/storage");
const filterUtils = require("../../utils/filter");
const catalogSearch = require("../../utils/catalog-search");
const safety = require("../../utils/safety");
const format = require("../../utils/format");
const { foodIdentityDisplay } = require("../../utils/food-display");
const publicCatalog = require("../../utils/public-catalog");
const navigation = require("../../utils/navigation");
const { setTabBarVisible } = require("../../utils/platform-ui");

const RISK_FLAG_OPTIONS = [
  { value: "pregnancy", label: "处于孕期" },
  { value: "breastfeeding", label: "处于哺乳期" },
  { value: "known_allergy", label: "有已知过敏史，但尚未逐项填写" },
  { value: "chronic_condition", label: "有基础疾病或肝肾功能问题" },
  { value: "medication", label: "正在服药或同时使用多种药物" }
];

const AGE_GROUP_VALUES = ["unknown", "infant_toddler", "child", "adult", "older_adult"];

function cleanAgeGroup(value, legacyFlags) {
  if (AGE_GROUP_VALUES.includes(value)) return value;
  const flags = unique(legacyFlags);
  return ["infant_toddler", "child", "older_adult"].find((item) => flags.includes(item)) || "unknown";
}

function cleanTriState(value, legacyYes) {
  if (value === "yes" || value === "no") return value;
  if (value === "unknown" && !legacyYes) return value;
  return legacyYes ? "yes" : "unknown";
}

function triStateOptions(value) {
  return [
    { value: "unknown", label: "未确认" },
    { value: "yes", label: "是" },
    { value: "no", label: "否" }
  ].map((item) => ({ ...item, checked: item.value === value }));
}

function riskFlagsForStatuses(details) {
  const source = details || {};
  return [
    source.pregnancyStatus === "yes" && "pregnancy",
    source.breastfeedingStatus === "yes" && "breastfeeding",
    source.allergyStatus === "yes" && "known_allergy",
    source.conditionStatus === "yes" && "chronic_condition",
    source.medicationStatus === "yes" && "medication"
  ].filter(Boolean);
}

const OPTION_GROUPS = {
  goals: optionData.GOAL_OPTIONS || [],
  categories: optionData.CATEGORY_OPTIONS || [],
  usageTypes: optionData.USAGE_TYPE_OPTIONS || [],
  tastes: optionData.TASTE_OPTIONS || []
};

function unique(value) {
  return [...new Set(Array.isArray(value) ? value.filter(Boolean) : [])];
}

function parseList(value) {
  return unique(String(value || "").split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean)).slice(0, 20);
}

function profileFromFlags(ageGroup, riskFlags, redFlags, details) {
  const flags = unique(riskFlags);
  const detail = details || {};
  const allergies = parseList(detail.allergyText);
  const conditions = parseList(detail.conditionText);
  const medications = parseList(detail.medicationText);
  const pregnancyStatus = cleanTriState(detail.pregnancyStatus, flags.includes("pregnancy"));
  const breastfeedingStatus = cleanTriState(detail.breastfeedingStatus, flags.includes("breastfeeding"));
  const allergyStatus = cleanTriState(detail.allergyStatus, flags.includes("known_allergy") || allergies.length > 0);
  const conditionStatus = cleanTriState(detail.conditionStatus, flags.includes("chronic_condition") || conditions.length > 0);
  const medicationStatus = cleanTriState(detail.medicationStatus, flags.includes("medication") || medications.length > 0);
  return safety.normalizeProfile({
    ageGroup: cleanAgeGroup(ageGroup, flags),
    pregnancy: pregnancyStatus,
    breastfeeding: breastfeedingStatus,
    allergies,
    allergyStatus,
    conditions,
    conditionStatus,
    medications,
    medicationStatus,
    redFlags: unique(redFlags)
  });
}

function optionLookup() {
  const result = {};
  Object.keys(OPTION_GROUPS).forEach((key) => {
    OPTION_GROUPS[key].forEach((item) => { result[`${key}:${item.value}`] = item.label; });
  });
  return result;
}

const FILTER_LABELS = optionLookup();

function sessionIdentity() {
  const data = getApp().globalData || {};
  return JSON.stringify([data.sessionDataRevision || 0, data.sessionSafetyProfile || {}]);
}

function decorateCard(ingredient, favoriteIds, compareIds, evaluation, filters, records) {
  const view = format.cardView(ingredient, favoriteIds, compareIds, evaluation);
  const selectedGoals = (filters.goals || []).filter((value) => (ingredient.goals || []).includes(value));
  const matchReasons = selectedGoals.map((value) => `符合“${FILTER_LABELS[`goals:${value}`] || value}”资料主题`);
  if (!matchReasons.length) matchReasons.push("位于当前食药物质资料目录");
  return {
    ...view,
    isFavorite: records.favoritesAvailable ? view.isFavorite : null,
    inCompare: records.compareAvailable ? view.inCompare : null,
    nameCn: ingredient.name,
    categoryText: view.regulatoryText,
    ...foodIdentityDisplay(ingredient),
    ...catalogSearch.searchMatchDisplay(ingredient, filters.query),
    natureText: "",
    summary: ingredient.audit && ingredient.audit.note,
    matchReasons,
    blocked: Boolean(evaluation && evaluation.blocked),
    warningCount: (evaluation && evaluation.warnings || []).length,
    blockedReason: view.reasonText,
    warningText: view.warningText
  };
}

Page({
  data: {
    interactionVersion: 0,
    usageGuideOpen: false,
    storageIssue: "",
    network: publicCatalog.getState(),
    query: "",
    filters: filterUtils.cleanFilters({}),
    rows: [],
    resultCount: 0,
    visibleCount: 0,
    hasMore: false,
    filterOpen: false,
    safetyOpen: false,
    chips: [],
    activeCount: 0,
    favoritesAvailable: false,
    compareAvailable: false,
    favoriteCount: null,
    compareCount: null,
    goalOptions: [],
    categoryOptions: [],
    usageTypeOptions: [],
    tasteOptions: [],
    pregnancyOptions: [],
    breastfeedingOptions: [],
    allergyStatusOptions: [],
    conditionStatusOptions: [],
    medicationStatusOptions: [],
    ageGroupOptions: [],
    redFlagOptions: [],
    riskFlags: [],
    ageGroup: "unknown",
    pregnancyStatus: "unknown",
    breastfeedingStatus: "unknown",
    allergyStatus: "unknown",
    conditionStatus: "unknown",
    medicationStatus: "unknown",
    redFlags: [],
    allergyText: "",
    conditionText: "",
    medicationText: "",
    draftTriageBlocked: false,
    triageBlocked: false,
    triageMessage: "",
    profileSummaryTitle: "尚未进行本次安全检查",
    profileSummaryText: "未填写个体信息时，只能浏览目录，不能判断是否适合个人。",
    contentVersion: catalogData.contentVersion || "待确认"
  },

  onLoad() {
    this.pageActive = true;
    this.recordsObserved = false;
    this.pageHidden = false;
    this.sessionContext = sessionIdentity();
    this.allIngredients = publicCatalog.getCatalog() || catalogData.ingredients.slice();
    this.setData({ network: publicCatalog.getState() });
    this.filtered = [];
    this.evaluations = {};
    this.limit = 12;
    const globalData = getApp().globalData || {};
    const session = globalData.sessionSafetyProfile || {};
    this.sessionDataRevision = Number.isSafeInteger(globalData.sessionDataRevision) ? globalData.sessionDataRevision : 0;
    const sessionFlags = unique(session.riskFlags);
    const ageGroup = cleanAgeGroup(session.ageGroup, sessionFlags);
    this.setData({
      filters: filterUtils.cleanFilters({}),
      ageGroup,
      pregnancyStatus: cleanTriState(session.pregnancyStatus, sessionFlags.includes("pregnancy")),
      breastfeedingStatus: cleanTriState(session.breastfeedingStatus, sessionFlags.includes("breastfeeding")),
      allergyStatus: cleanTriState(session.allergyStatus, sessionFlags.includes("known_allergy") || unique(session.allergies).length > 0),
      conditionStatus: cleanTriState(session.conditionStatus, sessionFlags.includes("chronic_condition") || unique(session.conditions).length > 0),
      medicationStatus: cleanTriState(session.medicationStatus, sessionFlags.includes("medication") || unique(session.medications).length > 0),
      riskFlags: sessionFlags.filter((item) => !["infant_toddler", "child", "older_adult"].includes(item)),
      redFlags: unique(session.redFlags),
      draftTriageBlocked: unique(session.redFlags).length > 0,
      allergyText: unique(session.allergies).join("、"),
      conditionText: unique(session.conditions).join("、"),
      medicationText: unique(session.medications).join("、")
    });
    this.syncOptionState();
    this.syncSafetyOptionState();
    this.applyFilters();
  },

  onShow() {
    if (!this.pageActive) return;
    this.pageHidden = false;
    navigation.resume(this);
    this.refreshSessionState();
    const pendingRead = publicCatalog.getPendingRead();
    if (pendingRead) this.observeCatalogRead(pendingRead);
  },

  isInteractive() { return this.pageActive && !this.pageHidden; },

  refreshSessionState(refreshView = true) {
    if (!this.isInteractive() || !this.allIngredients) return { changed: false, deleted: false };
    this.allIngredients = publicCatalog.getCatalog() || catalogData.ingredients.slice();
    this.setData({ network: publicCatalog.getState() });
    const globalData = getApp().globalData || {};
    const revision = Number.isSafeInteger(globalData.sessionDataRevision) ? globalData.sessionDataRevision : 0;
    const deleted = revision !== this.sessionDataRevision;
    const context = sessionIdentity();
    if (deleted || context !== this.sessionContext) {
      const session = globalData.sessionSafetyProfile || {};
      const sessionFlags = unique(session.riskFlags);
      this.sessionDataRevision = revision;
      this.sessionContext = context;
      this.advanceInteraction();
      this.safetyDraftSnapshot = null;
      this.catalogReadToken = null;
      setTabBarVisible(true);
      this.setData({
        query: deleted ? "" : this.data.query,
        usageGuideOpen: deleted ? false : this.data.usageGuideOpen,
        filters: deleted ? filterUtils.cleanFilters({}) : this.data.filters,
        filterOpen: false,
        safetyOpen: false,
        ageGroup: cleanAgeGroup(session.ageGroup, sessionFlags),
        pregnancyStatus: cleanTriState(session.pregnancyStatus, sessionFlags.includes("pregnancy")),
        breastfeedingStatus: cleanTriState(session.breastfeedingStatus, sessionFlags.includes("breastfeeding")),
        allergyStatus: cleanTriState(session.allergyStatus, sessionFlags.includes("known_allergy") || unique(session.allergies).length > 0),
        conditionStatus: cleanTriState(session.conditionStatus, sessionFlags.includes("chronic_condition") || unique(session.conditions).length > 0),
        medicationStatus: cleanTriState(session.medicationStatus, sessionFlags.includes("medication") || unique(session.medications).length > 0),
        riskFlags: sessionFlags.filter((item) => !["infant_toddler", "child", "older_adult"].includes(item)),
        redFlags: unique(session.redFlags),
        draftTriageBlocked: unique(session.redFlags).length > 0,
        allergyText: unique(session.allergies).join("、"),
        conditionText: unique(session.conditions).join("、"),
        medicationText: unique(session.medications).join("、")
      });
      this.syncSafetyOptionState();
      this.applyFilters();
      // Rebind observation, not transport, when a changed session invalidates
      // the previous observer while its public read is still in flight.
      const pendingRead = publicCatalog.getPendingRead();
      if (pendingRead) this.observeCatalogRead(pendingRead);
      return { changed: true, deleted };
    }
    if (refreshView) {
      setTabBarVisible(!this.data.safetyOpen && !this.data.filterOpen);
      this.applyFilters(true);
    }
    return { changed: false, deleted: false };
  },

  prepareCatalogAction(allowFilter = false) {
    if (!this.isInteractive()) return false;
    const state = this.refreshSessionState();
    return !state.deleted && !this.data.safetyOpen && (allowFilter === true || !this.data.filterOpen) &&
      !this.data.triageBlocked && !this.data.draftTriageBlocked;
  },

  prepareFilterAction(event) {
    if (!this.prepareCatalogAction(true) || !this.data.filterOpen) return false;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    return Boolean(dataset && dataset.version === this.data.interactionVersion);
  },

  prepareSafetyAction() {
    if (!this.isInteractive()) return false;
    this.refreshSessionState(false);
    return this.data.safetyOpen;
  },

  advanceInteraction() {
    this.cancelPendingSearch();
    this.setData({ interactionVersion: this.data.interactionVersion + 1 });
  },

  cancelPendingSearch() {
    this.searchToken = null;
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  currentCard(event) {
    if (!this.prepareCatalogAction()) return null;
    const detail = event && event.detail;
    if (!detail || detail.interactionVersion !== this.data.interactionVersion) return null;
    return this.data.rows.find((item) => item.id === detail.id) || null;
  },

  onHide() {
    if (!this.isInteractive()) return;
    if (this.data.filterOpen) this.closeFilters();
    if (this.data.safetyOpen) this.closeSafety();
    else setTabBarVisible(true);
    this.advanceInteraction();
    this.pageHidden = true;
    this.catalogReadToken = null;
    this.cancelPendingSearch();
  },

  onUnload() {
    if (!this.pageActive) return;
    if (this.data.filterOpen) this.closeFilters();
    if (this.data.safetyOpen) this.closeSafety();
    navigation.reset(this);
    this.pageActive = false;
    this.pageHidden = true;
    this.catalogReadToken = null;
    this.cancelPendingSearch();
    setTabBarVisible(true);
  },

  prepareVersionedCatalogAction(event) {
    if (!this.prepareCatalogAction()) return false;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    return Boolean(dataset && dataset.version === this.data.interactionVersion);
  },

  toggleUsageGuide(event) {
    if (!this.prepareVersionedCatalogAction(event)) return;
    this.advanceInteraction();
    this.setData({ usageGuideOpen: !this.data.usageGuideOpen });
  },

  openUsagePrivacy(event) {
    if (!this.prepareVersionedCatalogAction(event) || !this.data.usageGuideOpen) return;
    navigation.openPrivacy(this);
  },

  readServiceCatalog(event) {
    if (!this.prepareVersionedCatalogAction(event)) return;
    if (this.currentProfile().redFlags.length || this.data.draftTriageBlocked || this.data.network.mode === "loading") return;
    this.advanceInteraction();
    const operation = publicCatalog.load();
    this.setData({ network: publicCatalog.getState() });
    this.observeCatalogRead(operation);
  },

  observeCatalogRead(operation) {
    const revision = (getApp().globalData || {}).sessionDataRevision || 0;
    const token = { context: sessionIdentity() };
    this.catalogReadToken = token;
    operation.then(() => {
      if (!this.isInteractive() || this.catalogReadToken !== token || revision !== ((getApp().globalData || {}).sessionDataRevision || 0)) return;
      if (token.context !== sessionIdentity()) { this.refreshSessionState(); return; }
      this.catalogReadToken = null;
      this.advanceInteraction();
      this.allIngredients = publicCatalog.getCatalog() || catalogData.ingredients.slice();
      this.setData({ network: publicCatalog.getState() });
      this.applyFilters(true);
    });
  },

  useLocalCatalog(event) {
    if (!this.prepareVersionedCatalogAction(event) || this.data.network.mode === "offline") return;
    this.catalogReadToken = null;
    this.advanceInteraction();
    publicCatalog.clear();
    this.allIngredients = catalogData.ingredients.slice();
    this.setData({ network: publicCatalog.getState() });
    this.applyFilters(true);
  },

  onShareAppMessage() {
    return { title: "中医食养资料目录（非医疗教育）", path: "/pages/index/index" };
  },

  currentProfile() {
    return profileFromFlags(this.data.ageGroup, this.data.riskFlags, this.data.redFlags, this.data);
  },

  optionState(key) {
    const selected = this.data.filters[key] || [];
    const available = new Set();
    (this.allIngredients || []).forEach((item) => {
      if (key === "categories") available.add(item.category);
      else if (key === "tastes") (item.sensory && item.sensory.tastes || []).forEach((value) => available.add(value));
      else (item[key] || []).forEach((value) => available.add(value));
    });
    return (OPTION_GROUPS[key] || [])
      .filter((item) => available.has(item.value))
      .map((item) => ({ ...item, checked: selected.includes(item.value) }));
  },

  syncOptionState() {
    this.setData({
      goalOptions: this.optionState("goals"),
      categoryOptions: this.optionState("categories"),
      usageTypeOptions: this.optionState("usageTypes"),
      tasteOptions: this.optionState("tastes")
    });
  },

  syncSafetyOptionState() {
    this.setData({
      pregnancyOptions: triStateOptions(this.data.pregnancyStatus),
      breastfeedingOptions: triStateOptions(this.data.breastfeedingStatus),
      allergyStatusOptions: triStateOptions(this.data.allergyStatus),
      conditionStatusOptions: triStateOptions(this.data.conditionStatus),
      medicationStatusOptions: triStateOptions(this.data.medicationStatus),
      ageGroupOptions: (optionData.AGE_GROUP_OPTIONS || []).map((item) => ({ ...item, checked: this.data.ageGroup === item.value })),
      redFlagOptions: (optionData.RED_FLAG_OPTIONS || []).map((item) => ({ ...item, checked: this.data.redFlags.includes(item.value) }))
    });
  },

  buildChips(filters) {
    const chips = [];
    Object.keys(OPTION_GROUPS).forEach((key) => {
      (filters[key] || []).forEach((value) => chips.push({
        id: `${key}:${value}`,
        key,
        value,
        label: FILTER_LABELS[`${key}:${value}`] || value
      }));
    });
    if (filters.onlySourceChecked) chips.push({ id: "flag:onlySourceChecked", key: "onlySourceChecked", value: true, label: "仅看来源已核对" });
    return chips;
  },

  profileSummary(profile) {
    if (profile.redFlags.length) {
      return {
        title: "已触发安全分流",
        text: "检测到需要优先处理的紧急情况，本工具已停止食材筛选。"
      };
    }
    const labels = RISK_FLAG_OPTIONS.filter((item) => this.data.riskFlags.includes(item.value)).map((item) => item.label);
    const ageOption = (optionData.AGE_GROUP_OPTIONS || []).find((item) => item.value === profile.ageGroup);
    if (ageOption && profile.ageGroup !== "unknown") labels.unshift(`年龄阶段：${ageOption.label}`);
    const detailLabels = [];
    if (profile.allergies.length) detailLabels.push("已填写过敏信息");
    if (profile.conditions.length) detailLabels.push("已填写基础疾病或特殊情况");
    if (profile.medications.length || profile.medicationStatus === "yes") detailLabels.push("已填写用药信息");
    const allCoreQuestionsAnswered = profile.ageGroup !== "unknown" && [
      profile.pregnancy, profile.breastfeeding, profile.allergyStatus, profile.conditionStatus, profile.medicationStatus
    ].every((value) => value !== "unknown");
    if (!labels.length && !detailLabels.length && !allCoreQuestionsAnswered) {
      return {
        title: "尚未填写高风险情况",
        text: "这不代表没有风险；如有孕哺、儿童、慢病、过敏或用药情况，请先完成安全检查。"
      };
    }
    return labels.length || detailLabels.length
      ? { title: "已应用保守安全限制", text: unique(labels.concat(detailLabels)).join("、") }
      : { title: "核心安全问项已明确", text: "未填写风险名称；未知资料和条目级待审校状态仍会保留。" };
  },

  applyFilters(preserveLimit) {
    if (!this.isInteractive()) return;
    this.cancelPendingSearch();
    const filters = filterUtils.cleanFilters({ ...this.data.filters, query: this.data.query });
    const profile = this.currentProfile();
    const triageBlocked = profile.redFlags.length > 0;
    const source = triageBlocked ? [] : catalogSearch.searchCatalog(this.allIngredients, filters, profile);
    const evaluations = safety.evaluateCatalog(source, profile);
    this.evaluations = {};
    evaluations.forEach((item) => { this.evaluations[item.ingredientId] = item; });
    this.filtered = source;
    this.limit = preserveLimit === true && Number.isSafeInteger(this.limit) && this.limit >= 12 ? this.limit : 12;
    const chips = this.buildChips(filters);
    const summary = this.profileSummary(profile);
    this.setData({
      filters,
      chips,
      activeCount: chips.length,
      resultCount: source.length,
      triageBlocked,
      usageGuideOpen: triageBlocked ? false : this.data.usageGuideOpen,
      triageMessage: triageBlocked ? "你选择了需要立即由医疗人员评估的情况。食养筛选不能用于延误诊疗。" : "",
      profileSummaryTitle: summary.title,
      profileSummaryText: summary.text
    });
    this.syncOptionState();
    this.refreshCards();
  },

  refreshCards() {
    if (!this.isInteractive()) return;
    const state = storage.getPersistentState();
    if (this.recordsObserved && (this.data.favoritesAvailable !== state.favoritesAvailable ||
        this.data.compareAvailable !== state.compareAvailable)) this.advanceInteraction();
    this.recordsObserved = true;
    const favorites = state.favorites;
    const compare = state.compare;
    const visibleIngredients = this.filtered.slice(0, this.limit);
    const rows = visibleIngredients.map((ingredient) => decorateCard(
      ingredient,
      favorites,
      compare,
      this.evaluations[ingredient.id],
      this.data.filters,
      state
    ));
    this.setData({
      rows,
      storageIssue: state.message,
      visibleCount: rows.length,
      hasMore: rows.length < this.filtered.length,
      favoritesAvailable: state.favoritesAvailable,
      compareAvailable: state.compareAvailable,
      favoriteCount: state.favoritesAvailable ? favorites.length : null,
      compareCount: state.compareAvailable ? compare.length : null
    });
  },

  onSearchInput(event) {
    if (!this.prepareVersionedCatalogAction(event)) return;
    const value = event && event.detail && event.detail.value;
    if (typeof value !== "string") return;
    this.cancelPendingSearch();
    this.setData({ query: value.slice(0, 60) });
    const context = this.sessionContext;
    const token = {};
    this.searchToken = token;
    this.searchTimer = setTimeout(() => {
      if (!this.isInteractive() || this.searchToken !== token) return;
      this.searchToken = null;
      this.searchTimer = null;
      const state = this.refreshSessionState(false);
      if (!state.deleted && context === this.sessionContext) this.applyFilters();
    }, 160);
  },

  onSearchConfirm(event) {
    if (!this.prepareVersionedCatalogAction(event)) return;
    const value = event && event.detail && event.detail.value;
    if (typeof value !== "string") return;
    this.advanceInteraction();
    this.setData({ query: value.slice(0, 60) });
    this.applyFilters();
  },

  prepareSearchClear(event) {
    if (!this.prepareVersionedCatalogAction(event)) return false;
    return event.currentTarget.dataset.query === this.data.query;
  },

  clearSearch(event) {
    if (!this.prepareSearchClear(event)) return;
    this.advanceInteraction();
    this.setData({ query: "" });
    this.applyFilters();
  },

  openFilters() {
    if (!this.prepareCatalogAction()) return;
    this.syncOptionState();
    this.advanceInteraction();
    this.setData({ filterOpen: true });
    setTabBarVisible(false);
  },

  closeFilters(event) {
    if (!this.isInteractive() || !this.data.filterOpen) return;
    // Lifecycle calls have no event. Rendered controls must belong to this
    // overlay, so a queued close cannot dismiss a newer drawer.
    if (event !== undefined) {
      const dataset = event && event.currentTarget && event.currentTarget.dataset;
      if (!dataset || dataset.version !== this.data.interactionVersion) return;
    }
    this.advanceInteraction();
    this.setData({ filterOpen: false });
    setTabBarVisible(!this.data.safetyOpen);
  },

  clearDrawerFilters(event) {
    if (!this.prepareFilterAction(event)) return;
    this.setData({ filters: filterUtils.cleanFilters({}) });
    this.applyFilters();
  },

  openSafety() {
    if (!this.isInteractive()) return;
    this.refreshSessionState();
    if (this.data.safetyOpen) return;
    this.safetyDraftSnapshot = {
      ageGroup: this.data.ageGroup,
      pregnancyStatus: this.data.pregnancyStatus,
      breastfeedingStatus: this.data.breastfeedingStatus,
      allergyStatus: this.data.allergyStatus,
      conditionStatus: this.data.conditionStatus,
      medicationStatus: this.data.medicationStatus,
      riskFlags: unique(this.data.riskFlags),
      redFlags: unique(this.data.redFlags),
      allergyText: this.data.allergyText,
      conditionText: this.data.conditionText,
      medicationText: this.data.medicationText
    };
    this.syncSafetyOptionState();
    setTabBarVisible(false);
    this.advanceInteraction();
    this.setData({ safetyOpen: true, filterOpen: false });
  },

  closeSafety() {
    if (!this.prepareSafetyAction()) return;
    if (this.data.draftTriageBlocked) {
      const snapshot = this.safetyDraftSnapshot;
      const redFlags = unique(this.data.redFlags);
      this.commitRedFlagsOnly(redFlags);
      this.safetyDraftSnapshot = null;
      this.setData(snapshot
        ? { ...snapshot, redFlags, draftTriageBlocked: true, safetyOpen: false }
        : { redFlags, draftTriageBlocked: true, safetyOpen: false });
      this.syncSafetyOptionState();
      setTabBarVisible(true);
      this.applyFilters();
      return;
    }
    const snapshot = this.safetyDraftSnapshot;
    this.safetyDraftSnapshot = null;
    this.setData(snapshot ? { ...snapshot, draftTriageBlocked: snapshot.redFlags.length > 0, safetyOpen: false } : { safetyOpen: false });
    this.syncSafetyOptionState();
    setTabBarVisible(true);
    this.applyFilters(true);
  },

  stopTap() {},

  onGroupChange(event) {
    if (!this.prepareFilterAction(event)) return;
    const key = event.currentTarget.dataset.key;
    if (!Object.prototype.hasOwnProperty.call(OPTION_GROUPS, key)) return;
    const values = event.detail && event.detail.value;
    const allowed = new Set(this.optionState(key).map((item) => item.value));
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !allowed.has(value))) return;
    const filters = { ...this.data.filters, [key]: values };
    this.setData({ filters });
    this.syncOptionState();
    this.applyFilters();
  },

  onToggleFilter(event) {
    if (!this.prepareFilterAction(event)) return;
    const key = event.currentTarget.dataset.key;
    if (key !== "onlySourceChecked" || !event.detail || typeof event.detail.value !== "boolean") return;
    this.setData({ filters: { ...this.data.filters, [key]: event.detail.value } });
    this.applyFilters();
  },

  onSafetyStatusChange(event) {
    if (!this.prepareSafetyAction()) return;
    const key = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.key;
    if (!["pregnancyStatus", "breastfeedingStatus", "allergyStatus", "conditionStatus", "medicationStatus"].includes(key)) return;
    const value = cleanTriState(event.detail.value, false);
    const patch = { [key]: value };
    if (key === "allergyStatus" && value !== "yes") patch.allergyText = "";
    if (key === "conditionStatus" && value !== "yes") patch.conditionText = "";
    if (key === "medicationStatus" && value !== "yes") patch.medicationText = "";
    const nextState = { ...this.data, ...patch };
    patch.riskFlags = riskFlagsForStatuses(nextState);
    this.setData(patch);
    this.syncSafetyOptionState();
  },

  onAgeGroupChange(event) {
    if (!this.prepareSafetyAction()) return;
    this.setData({ ageGroup: cleanAgeGroup(event.detail.value, []) });
    this.syncSafetyOptionState();
  },

  onRedFlagChange(event) {
    if (!this.prepareSafetyAction()) return;
    const redFlags = unique(event && event.detail && event.detail.value);
    this.setData({ redFlags, draftTriageBlocked: redFlags.length > 0 });
    this.syncSafetyOptionState();
  },

  onSafetyTextInput(event) {
    if (!this.prepareSafetyAction()) return;
    const key = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.key;
    if (!["allergyText", "conditionText", "medicationText"].includes(key)) return;
    const value = String(event.detail.value || "").slice(0, 300);
    const statusKey = { allergyText: "allergyStatus", conditionText: "conditionStatus", medicationText: "medicationStatus" }[key];
    const patch = { [key]: value };
    if (value.trim()) patch[statusKey] = "yes";
    const nextState = { ...this.data, ...patch };
    patch.riskFlags = riskFlagsForStatuses(nextState);
    this.setData(patch);
    this.syncSafetyOptionState();
  },

  applySafetyAndClose() {
    if (!this.prepareSafetyAction()) return;
    this.commitSafetyProfile();
    this.safetyDraftSnapshot = null;
    this.setData({ safetyOpen: false });
    setTabBarVisible(true);
    this.applyFilters();
  },

  commitSafetyProfile() {
    if (!this.isInteractive()) return false;
    if (this.sessionContext !== sessionIdentity()) { this.refreshSessionState(); return false; }
    const pregnancyStatus = cleanTriState(this.data.pregnancyStatus, this.data.riskFlags.includes("pregnancy"));
    const breastfeedingStatus = cleanTriState(this.data.breastfeedingStatus, this.data.riskFlags.includes("breastfeeding"));
    const allergyStatus = cleanTriState(this.data.allergyStatus, this.data.riskFlags.includes("known_allergy") || parseList(this.data.allergyText).length > 0);
    const conditionStatus = cleanTriState(this.data.conditionStatus, this.data.riskFlags.includes("chronic_condition") || parseList(this.data.conditionText).length > 0);
    const medicationStatus = cleanTriState(this.data.medicationStatus, this.data.riskFlags.includes("medication") || parseList(this.data.medicationText).length > 0);
    const statuses = { pregnancyStatus, breastfeedingStatus, allergyStatus, conditionStatus, medicationStatus };
    const next = {
      ageGroup: cleanAgeGroup(this.data.ageGroup, []),
      ...statuses,
      riskFlags: riskFlagsForStatuses(statuses),
      redFlags: unique(this.data.redFlags),
      allergies: allergyStatus === "yes" ? parseList(this.data.allergyText) : [],
      conditions: conditionStatus === "yes" ? parseList(this.data.conditionText) : [],
      medications: medicationStatus === "yes" ? parseList(this.data.medicationText) : []
    };
    const previous = getApp().globalData.sessionSafetyProfile || {};
    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    getApp().globalData.sessionSafetyProfile = next;
    this.sessionContext = sessionIdentity();
    // 只有安全画像实际改变时，旧的专业确认进度才失效。
    if (changed) {
      this.advanceInteraction();
      storage.setChecklist({});
      getApp().globalData.sessionRecipeAcknowledgements = {};
    }
    return changed;
  },

  commitRedFlagsOnly(redFlags) {
    if (!this.isInteractive()) return false;
    if (this.sessionContext !== sessionIdentity()) { this.refreshSessionState(); return false; }
    const previous = getApp().globalData.sessionSafetyProfile || {};
    const nextRedFlags = unique(redFlags);
    const changed = JSON.stringify(unique(previous.redFlags)) !== JSON.stringify(nextRedFlags);
    getApp().globalData.sessionSafetyProfile = { ...previous, redFlags: nextRedFlags };
    this.sessionContext = sessionIdentity();
    if (changed) {
      this.advanceInteraction();
      storage.setChecklist({});
      getApp().globalData.sessionRecipeAcknowledgements = {};
    }
    return changed;
  },

  clearSafetyProfile() {
    if (!this.prepareSafetyAction()) return;
    this.setData({
      ageGroup: "unknown", pregnancyStatus: "unknown", breastfeedingStatus: "unknown", allergyStatus: "unknown",
      conditionStatus: "unknown", medicationStatus: "unknown", riskFlags: [], redFlags: [],
      allergyText: "", conditionText: "", medicationText: "", draftTriageBlocked: false
    });
    this.syncSafetyOptionState();
  },

  removeChip(event) {
    if (!this.prepareVersionedCatalogAction(event)) return;
    const { key, value } = event.currentTarget.dataset;
    if (!this.data.chips.some((chip) => chip.key === key && chip.value === value)) return;
    const nextValue = Array.isArray(this.data.filters[key])
      ? this.data.filters[key].filter((item) => item !== value)
      : false;
    this.advanceInteraction();
    this.setData({ filters: { ...this.data.filters, [key]: nextValue } });
    this.applyFilters();
  },

  clearFilters(event) {
    if (!this.prepareVersionedCatalogAction(event)) return;
    this.advanceInteraction();
    this.setData({ filters: filterUtils.cleanFilters({}) });
    this.applyFilters();
  },

  clearFiltersAndSearch(event) {
    if (!this.prepareSearchClear(event)) return;
    this.advanceInteraction();
    this.setData({ query: "", filters: filterUtils.cleanFilters({}) });
    this.applyFilters();
  },

  loadMore() {
    if (!this.prepareCatalogAction()) return;
    this.limit += 12;
    this.refreshCards();
  },

  openDetail(event) {
    const item = this.currentCard(event);
    if (item) navigation.openIngredient(this, item.id);
  },

  openOfficialPlans() {
    if (!this.prepareCatalogAction()) return;
    navigation.openOfficialDirectory(this);
  },

  toggleFavorite(event) {
    const item = this.currentCard(event);
    if (!item || (item.blocked && !item.isFavorite)) return;
    if (!this.data.favoritesAvailable) {
      wx.showToast({ title: storage.errorMessage({ errorCode: "read_failed" }), icon: "none" }); return;
    }
    const result = storage.tryToggleFavorite(item.id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.refreshCards();
  },

  toggleCompare(event) {
    const item = this.currentCard(event);
    if (!item || (item.blocked && !item.inCompare)) return;
    if (!this.data.compareAvailable) {
      wx.showToast({ title: storage.errorMessage({ errorCode: "read_failed" }), icon: "none" }); return;
    }
    const result = storage.toggleCompare(item.id);
    if (!result.ok) wx.showToast({ title: storage.errorMessage(result), icon: "none" });
    this.refreshCards();
  }
});
