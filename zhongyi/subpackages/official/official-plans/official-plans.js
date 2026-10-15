const recipeData = require("../../../data/recipes-public");
const recipeSafety = require("../../../utils/recipe-safety");
const sessionProfile = require("../../../utils/session-profile");
const navigation = require("../../../utils/navigation");
const clipboard = require("../../../utils/clipboard");

function sourceById(id) {
  return (recipeData.sources || []).find((source) => source.id === id);
}

function evaluationCardState(evaluation) {
  if (!evaluation) return { statusText: "状态无法确认", blocked: true, needsSafety: true, reasonText: "请返回安全检查后重试。" };
  if (evaluation.status === "viewable") return { statusText: "完整官方资料可查阅", blocked: false, needsSafety: false, reasonText: "" };
  if (evaluation.status === "caution") return {
    statusText: "可查看，但有注意事项", blocked: false, needsSafety: false,
    reasonText: (evaluation.warnings || [])[0] || "请逐项查看注意事项。"
  };
  const reasonText = (evaluation.reasons || [])[0] || "当前未满足查看门禁。";
  const needsSafety = (evaluation.reasonCodes || []).some((code) => code !== "diagnosis_ack_required");
  return {
    statusText: evaluation.status === "documentation_only" ? "需先完成核心安全问项" : "当前安全规则阻止查看",
    blocked: true,
    needsSafety,
    reasonText
  };
}

function sessionProfileSummary(profile) {
  const missing = [];
  if (profile.ageGroup === "unknown") missing.push("年龄阶段");
  if (profile.pregnancy === "unknown") missing.push("孕期状态");
  if (profile.breastfeeding === "unknown") missing.push("哺乳期状态");
  if (profile.allergyStatus === "unknown") missing.push("过敏情况");
  if (profile.conditionStatus === "unknown") missing.push("基础疾病情况");
  if (profile.medicationStatus === "unknown") missing.push("用药情况");
  if (missing.length) return `尚未确认：${missing.join("、")}。完整方案不会据此放行。`;
  const missingDetails = [];
  if (profile.allergyStatus === "yes" && !profile.allergies.length) missingDetails.push("具体过敏物");
  if (profile.conditionStatus === "yes" && !profile.conditions.length) missingDetails.push("具体基础疾病或特殊情况");
  if (profile.medicationStatus === "yes" && !profile.medications.length) missingDetails.push("具体在用药品或材料");
  if (missingDetails.length) return `仍需填写：${missingDetails.join("、")}。`;
  return `核心问项已明确；年龄阶段：${{ infant_toddler: "婴幼儿", child: "儿童或青少年", adult: "成年人", older_adult: "老年人" }[profile.ageGroup]}。安全画像仅保存在当前进程。`;
}

Page({
  data: {
    targets: [],
    selectedTargetId: "",
    selectedTarget: null,
    publishedCards: [],
    pendingCards: [],
    unavailableCards: [],
    diagnosisConfirmed: false,
    triageBlocked: false,
    profileSummary: "尚未读取本次安全检查",
    publishableCount: 0,
    pendingCount: 0,
    unavailableCount: 0,
    contentVersion: recipeData.contentVersion || "待确认"
  },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    navigation.resume(this);
    this.refresh();
  },

  onHide() { this.pageHidden = true; clipboard.reset(this); },

  onUnload() { this.pageDisposed = true; this.onHide(); navigation.reset(this); },

  prepareAction() {
    if (this.pageDisposed || this.pageHidden) return false;
    const revision = this.sessionDataRevision;
    this.refresh();
    return !this.data.triageBlocked && revision === this.sessionDataRevision;
  },

  refresh() {
    if (this.pageDisposed || this.pageHidden) return;
    const revision = getApp().globalData.sessionDataRevision || 0;
    if (this.sessionDataRevision !== undefined && this.sessionDataRevision !== revision) this.setData({ selectedTargetId: "" });
    this.sessionDataRevision = revision;
    const profile = sessionProfile.fromSession(getApp().globalData.sessionSafetyProfile || {});
    this.actionContext = JSON.stringify([revision, this.data.selectedTargetId, profile]);
    if (profile.redFlags.length) {
      this.setData({
        targets: [], selectedTargetId: "", selectedTarget: null, publishedCards: [], pendingCards: [],
        unavailableCards: [], diagnosisConfirmed: false, profileSummary: "当前含需优先就医的紧急情况，停止方案查阅。",
        triageBlocked: true, publishableCount: 0, pendingCount: 0, unavailableCount: 0
      });
      return;
    }
    const publishable = recipeSafety.getPublishableRecipes(
      recipeData.recipes || [], undefined, recipeData.targets || [], recipeData.externalFoods, recipeData.sources || []
    );
    const acknowledgements = getApp().globalData.sessionRecipeAcknowledgements || {};
    const selectedTarget = (recipeData.targets || []).find((item) => item.id === this.data.selectedTargetId) || null;
    const targets = (recipeData.targets || []).map((target) => {
      const targetRecipes = (recipeData.recipes || []).filter((recipe) => recipe.targetId === target.id);
      const publishedCount = publishable.filter((recipe) => recipe.targetId === target.id).length;
      const pendingCount = targetRecipes.filter((recipe) => !["published", "withdrawn", "superseded"].includes(recipe.status)).length;
      const unavailableCount = targetRecipes.filter((recipe) => ["withdrawn", "superseded"].includes(recipe.status)).length;
      return {
        ...target,
        selected: target.id === this.data.selectedTargetId,
        publishedCount,
        pendingCount,
        unavailableCount,
        statusText: publishedCount ? `${publishedCount}项已完成发布门禁`
          : pendingCount ? "暂无完成发布门禁的方案" : unavailableCount ? "相关资料已撤回或被替代" : "暂无完整方案资料"
      };
    });
    const targetRecipes = selectedTarget
      ? (recipeData.recipes || []).filter((recipe) => recipe.targetId === selectedTarget.id)
      : [];
    const diagnosisConfirmed = Boolean(selectedTarget && acknowledgements[selectedTarget.id]);
    const evaluations = targetRecipes.map((recipe) => recipeSafety.evaluateRecipe(recipe, profile, {
      diagnosisConfirmed, targets: recipeData.targets || [], externalFoods: recipeData.externalFoods,
      sources: recipeData.sources || []
    }));
    const publishedCards = targetRecipes.filter((recipe) => publishable.some((item) => item.id === recipe.id)).map((recipe) => {
      const evaluation = evaluations.find((item) => item.recipeId === recipe.id);
      return {
        id: recipe.id,
        name: recipe.name,
        targetText: selectedTarget && selectedTarget.shortLabel,
        sourceText: recipe.guideContext && `${recipe.guideContext.title} · ${recipe.guideContext.page}`,
        ...evaluationCardState(evaluation)
      };
    });
    const pendingCards = targetRecipes.filter((recipe) => !["published", "withdrawn", "superseded"].includes(recipe.status)).map((recipe) => {
      const technicalFailures = recipeSafety.recipeTechnicalChecks(
        recipe, undefined, recipeData.targets || [], recipeData.externalFoods, recipeData.sources || []
      );
      return {
        id: recipe.id,
        name: recipe.name,
        patternText: recipe.audience && recipe.audience.patternRequired
          ? `证型限定：${(recipe.audience.allowedPatterns || []).join("、")}（须由专业人员确认）`
          : "",
        sourceText: recipe.guideContext && `${recipe.guideContext.title} · ${recipe.guideContext.section} · ${recipe.guideContext.page}`,
        lifecycleText: recipe.status === "reviewed" ? "已完成内容审校，等待其余发布门禁" : "开发草稿",
        statusText: "未发布，不展示材料、用量和做法",
        pendingChecks: technicalFailures.length
      };
    });
    const unavailableCards = targetRecipes.filter((recipe) => ["withdrawn", "superseded"].includes(recipe.status)).map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      statusText: recipe.status === "withdrawn" ? "已撤回，不再提供" : "已被新版资料替代",
      sourceText: recipe.guideContext && `${recipe.guideContext.title} · ${recipe.guideContext.page}`
    }));
    const profileSummary = sessionProfileSummary(profile);
    this.setData({
      targets,
      selectedTarget,
      publishedCards,
      pendingCards,
      unavailableCards,
      diagnosisConfirmed,
      triageBlocked: false,
      profileSummary,
      publishableCount: publishable.length,
      pendingCount: (recipeData.recipes || []).filter((recipe) => !["published", "withdrawn", "superseded"].includes(recipe.status)).length,
      unavailableCount: (recipeData.recipes || []).filter((recipe) => ["withdrawn", "superseded"].includes(recipe.status)).length
    });
  },

  selectTarget(event) {
    if (!this.prepareAction()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    if (!(recipeData.targets || []).some((item) => item.id === id)) return;
    this.setData({ selectedTargetId: id });
    this.refresh();
  },

  onDiagnosisChange(event) {
    const context = this.actionContext;
    if (!this.prepareAction() || context !== this.actionContext || !this.data.publishedCards.length) return;
    const target = this.data.selectedTarget;
    if (!target) return;
    const values = event && event.detail && event.detail.value;
    if (!Array.isArray(values)) return;
    const confirmed = values.includes("confirmed");
    const acknowledgements = { ...(getApp().globalData.sessionRecipeAcknowledgements || {}) };
    if (confirmed) acknowledgements[target.id] = true;
    else delete acknowledgements[target.id];
    getApp().globalData.sessionRecipeAcknowledgements = acknowledgements;
    this.refresh();
  },

  openDetail(event) {
    if (!this.prepareAction()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const card = this.data.publishedCards.find((item) => item.id === id);
    if (!card || card.blocked) return;
    navigation.openOfficialDetail(this, id);
  },

  copyTargetSource() {
    if (!this.prepareAction()) return;
    const target = this.data.selectedTarget;
    if (!target) return;
    const source = sourceById((target.sourceIds || [])[1] || (target.sourceIds || [])[0]);
    if (!source) return;
    clipboard.writeText(this, source.url);
  },

  goSafetyCheck() {
    if (this.pageDisposed || this.pageHidden) return;
    navigation.switchTab(this, "index");
  },

  onShareAppMessage() {
    return { title: "官方完整食养方案资料库｜非诊疗", path: "/subpackages/official/official-plans/official-plans" };
  }
});
