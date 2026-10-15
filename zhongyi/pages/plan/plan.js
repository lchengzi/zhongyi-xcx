const catalogData = require("../../data/ingredients");
const storage = require("../../utils/storage");
const safety = require("../../utils/safety");
const format = require("../../utils/format");
const sessionProfileUtils = require("../../utils/session-profile");
const navigation = require("../../utils/navigation");
const clipboard = require("../../utils/clipboard");

const CHECKS = [
  { key: "identity", label: "已记录规范名称、物种和允许食用部位的待核对信息" },
  { key: "catalog", label: "已记录目录来源日期、现行状态和用途限制的待核对问题" },
  { key: "allergy", label: "已准备说明过敏史；不清楚的保留未知" },
  { key: "life_stage", label: "已准备说明年龄、孕期或哺乳期情况" },
  { key: "conditions", label: "已准备说明基础疾病及肝肾功能情况" },
  { key: "medications", label: "已准备说明全部在用药品和保健品" },
  { key: "unknowns", label: "已记录页面中的待审校和未知信息，不视为已确认安全" },
  { key: "no_combination", label: "已知晓资料对照不代表可以自行组合或煎煮" }
];

const AGE_LABELS = {
  infant_toddler: "婴幼儿",
  child: "儿童或青少年",
  adult: "成年人",
  older_adult: "老年人"
};

function profileSummary(profile) {
  if (profile.redFlags.length) return {
    title: "已触发安全分流",
    text: "当前选择包含需优先就医的紧急情况，本工具不会继续提供候选。"
  };
  // Present only canonical statuses, never raw health names or arbitrary flags.
  const answers = [
    ["孕期", profile.pregnancy], ["哺乳期", profile.breastfeeding],
    ["过敏史", profile.allergyStatus], ["基础疾病或肝肾问题", profile.conditionStatus],
    ["在用药品或保健品", profile.medicationStatus]
  ];
  const ageLabel = AGE_LABELS[profile.ageGroup];
  const answeredCount = (ageLabel ? 1 : 0) + answers.filter(([, status]) => status !== "unknown").length;
  const labels = [`年龄阶段：${ageLabel || "未填写或未知"}`].concat(answers.map(([label, status]) =>
    `${label}：${status === "yes" ? "本人填写为是" : status === "no" ? "本人填写为否" : "未填写或未知"}`
  ));
  return {
    title: answeredCount === 6 ? "核心安全问项已填写" : "核心安全信息仍有未知",
    text: [`已填写 ${answeredCount}/6 项。`, ...labels,
      "本人填写不等于专业确认；问项已填写或未命中阻止项，都不代表适合食用。"
    ].join("\n")
  };
}

function profileForSession() {
  return sessionProfileUtils.fromSession(getApp().globalData.sessionSafetyProfile || {});
}

Page({
  data: {
    storageIssue: "",
    shortlist: [],
    excludedItems: [],
    favoritesCount: 0,
    checks: [],
    checkedCount: 0,
    inquiryText: "",
    triageBlocked: false,
    profileSummaryTitle: "尚未进行本次安全检查",
    profileSummaryText: "返回食养目录完成安全检查后，这里会显示本次会话摘要。"
  },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    navigation.resume(this);
    this.refresh();
  },

  onHide() { this.pageHidden = true; this.pendingClear = null; clipboard.reset(this); },

  onUnload() { this.pageDisposed = true; this.onHide(); navigation.reset(this); },

  prepareAction(readFailureTitle = "本机记录读取失败，未执行修改") {
    if (this.pageDisposed || this.pageHidden) return false;
    this.refresh();
    if (this.data.triageBlocked) return false;
    if (this.data.storageIssue) {
      wx.showToast({ title: readFailureTitle, icon: "none" });
      return false;
    }
    return true;
  },

  refresh() {
    if (this.pageDisposed) return;
    const state = storage.getPersistentState();
    const recordsAvailable = state.favoritesAvailable && state.compareAvailable;
    const compareIds = state.compare;
    const favorites = state.favorites;
    const savedChecks = storage.getChecklist();
    const profile = profileForSession();
    this.actionContext = JSON.stringify([getApp().globalData.sessionDataRevision || 0, compareIds, profile]);
    const triageBlocked = profile.redFlags.length > 0;
    const rawItems = (triageBlocked || !recordsAvailable ? [] : compareIds)
      .map((id) => (catalogData.ingredients || []).find((item) => item.id === id))
      .filter(Boolean);
    const evaluations = safety.evaluateCatalog(rawItems, profile);
    const evaluationById = {};
    evaluations.forEach((item) => { evaluationById[item.ingredientId] = item; });
    const evaluatedItems = rawItems.map((item) => {
      const view = format.cardView(item, favorites, compareIds, evaluationById[item.id]);
      return {
        id: item.id,
        nameCn: item.name,
        categoryText: view.regulatoryText,
        partText: item.identity && item.identity.ediblePart || "部位待确认",
        safetyLabel: view.safetyLabel,
        reasonText: view.reasonText,
        warningText: view.warningText,
        blocked: Boolean(evaluationById[item.id] && evaluationById[item.id].blocked)
      };
    });
    const shortlist = evaluatedItems.filter((item) => !item.blocked);
    const excludedItems = evaluatedItems.filter((item) => item.blocked);
    // Hide incomplete consultation context, but retain the session checklist so a
    // successful explicit read can restore it without writes or fabricated zeros.
    const checks = recordsAvailable ? CHECKS.map((item) => ({ ...item, checked: Boolean(savedChecks[item.key]) })) : [];
    const summary = profileSummary(profile);
    const profileSummaryTitle = summary.title;
    const profileSummaryText = summary.text;
    const inquiryText = triageBlocked
      ? "本次安全检查含需要优先处理的紧急情况，食养筛选已停止。请立即联系急救或前往正规医疗机构；中国大陆可拨打 120。"
      : recordsAvailable ? this.buildInquiry(shortlist, excludedItems, checks, profileSummaryTitle, profileSummaryText) : "";
    this.setData({
      shortlist,
      storageIssue: state.message,
      excludedItems,
      favoritesCount: recordsAvailable ? favorites.length : null,
      checks,
      checkedCount: checks.filter((item) => item.checked).length,
      inquiryText,
      triageBlocked,
      profileSummaryTitle,
      profileSummaryText
    });
  },

  buildInquiry(shortlist, excludedItems, checks, profileTitle, profileText) {
    const names = shortlist.length ? shortlist.map((item) => item.nameCn).join("、") : "尚未选择";
    const excludedNames = excludedItems.length ? excludedItems.map((item) => item.nameCn).join("、") : "无";
    const pending = checks.filter((item) => !item.checked).map((item) => item.label);
    return [
      "中医食养资料咨询准备",
      `希望进一步核对：${names}`,
      `已由安全规则排除、不作为候选：${excludedNames}`,
      `本次安全问项：${profileTitle}\n${profileText}`,
      `本人准备标记：${checks.filter((item) => item.checked).length}/${checks.length}；不代表专业审校完成，不会补全未知信息。`,
      `尚未标记准备：${pending.length ? pending.join("；") : "本人已标记全部准备事项"}`,
      "无论勾选多少项，仍需专业人员核对资料、未知信息及个体适用性。",
      "请结合年龄、孕哺情况、过敏史、基础疾病、肝肾功能以及全部在用药品，由医生、药师或营养专业人员判断。",
      "这些候选来自资料对照，不代表可以共同食用；本清单不包含处方、剂量或疗程。"
    ].join("\n");
  },

  onChecklistChange(event) {
    const context = this.actionContext;
    if (!this.prepareAction() || context !== this.actionContext) return;
    const selected = event && event.detail && event.detail.value;
    if (!Array.isArray(selected)) return;
    const value = {};
    CHECKS.forEach((item) => { value[item.key] = selected.includes(item.key); });
    storage.setChecklist(value);
    this.refresh();
  },

  openDetail(event) {
    if (!this.prepareAction()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    if (this.data.shortlist.concat(this.data.excludedItems).some((item) => item.id === id)) navigation.openIngredient(this, id);
  },

  goCatalog() {
    navigation.switchTab(this, "index");
  },

  goCompare() {
    if (!this.prepareAction()) return;
    navigation.switchTab(this, "compare");
  },

  goPrivacy() {
    navigation.openPrivacy(this);
  },

  copyInquiry() {
    if (!this.prepareAction("请先重试读取本机记录")) return;
    clipboard.writeText(this, this.data.inquiryText);
  },

  clearPlan() {
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
        title: "重新整理安全清单？",
        content: "将清空资料对照和清单进度；收藏及本次安全检查会保留。",
        success: (result) => {
          if (this.pendingClear !== operation) return;
          this.pendingClear = null;
          if (!result || result.confirm !== true || !this.prepareAction()) return;
          if (this.actionContext !== operation.context) {
            wx.showToast({ title: "资料状态已变化，请重新确认", icon: "none" });
            return;
          }
          const saved = storage.trySetCompare([]);
          if (saved.ok) storage.setChecklist({});
          else wx.showToast({ title: storage.errorMessage(saved), icon: "none" });
          this.refresh();
        },
        fail
      });
    } catch (_) { fail(); }
  },

  onShareAppMessage() {
    return { title: "食养安全核对清单", path: "/pages/index/index" };
  }
});
