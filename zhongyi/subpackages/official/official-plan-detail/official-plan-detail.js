const recipeData = require("../../../data/recipes-public");
const recipeSafety = require("../../../utils/recipe-safety");
const sessionProfile = require("../../../utils/session-profile");
const navigation = require("../../../utils/navigation");
const clipboard = require("../../../utils/clipboard");
const platformUi = require("../../../utils/platform-ui");

Page({
  data: {
    recipe: null,
    target: null,
    evaluation: null,
    sourceRows: [],
    ingredientRows: [],
    stepRows: [],
    triageBlocked: false,
    notFound: false,
    unavailable: false,
    unavailableTitle: "",
    unavailableMessage: "",
    contentHidden: true,
    contentVersion: recipeData.contentVersion || "待确认"
  },

  onLoad(options) {
    this.pageHidden = false;
    this.id = options && typeof options.id === "string" ? options.id.slice(0, 100) : "";
    this.refresh();
  },

  onShow() {
    if (this.pageDisposed) return;
    this.pageHidden = false;
    navigation.resume(this);
    this.refresh();
  },

  onHide() { this.pageHidden = true; clipboard.reset(this); },

  onUnload() { this.pageDisposed = true; this.onHide(); navigation.reset(this); },

  clearView(patch, title = "方案审校状态") {
    this.sourceById = {};
    this.setData({
      recipe: null, target: null, evaluation: null, sourceRows: [], ingredientRows: [], stepRows: [],
      triageBlocked: false, notFound: false, unavailable: false, contentHidden: true,
      unavailableTitle: "", unavailableMessage: "", ...patch
    });
    platformUi.setTitle(title);
    return false;
  },

  refresh() {
    if (this.pageDisposed || this.pageHidden) return false;
    const profile = sessionProfile.fromSession(getApp().globalData.sessionSafetyProfile || {});
    if (profile.redFlags.length) {
      return this.clearView({ triageBlocked: true });
    }
    const recipe = (recipeData.recipes || []).find((item) => item.id === this.id);
    if (!recipe) {
      return this.clearView({ notFound: true });
    }
    if (["withdrawn", "superseded"].includes(recipe.status)) {
      const withdrawn = recipe.status === "withdrawn";
      return this.clearView({
        unavailable: true,
        unavailableTitle: withdrawn ? "该资料已撤回" : "该资料已被新版替代",
        unavailableMessage: withdrawn ? "为避免继续传播失效内容，本页不再显示原材料、用量或做法。" : "请返回方案目录查找已经完成发布门禁的当前版本。"
      }, withdrawn ? "方案已撤回" : "方案已替代");
    }
    const target = (recipeData.targets || []).find((item) => item.id === recipe.targetId) || null;
    const acknowledged = Boolean((getApp().globalData.sessionRecipeAcknowledgements || {})[recipe.targetId]);
    const evaluation = recipeSafety.evaluateRecipe(recipe, profile, {
      diagnosisConfirmed: acknowledged, targets: recipeData.targets || [], externalFoods: recipeData.externalFoods,
      sources: recipeData.sources || []
    });
    const contentHidden = evaluation.status === "triage_blocked" || evaluation.status === "documentation_only" || evaluation.status === "blocked";
    const sourceRows = (recipe.sources || []).map((source) => ({
      ...source,
      locator: source.id === recipe.formulaSourceId ? `${recipe.sourceLocator.section} · ${recipe.sourceLocator.page}` : source.scope
    }));
    this.sourceById = {};
    sourceRows.forEach((source) => { this.sourceById[source.id] = source; });
    platformUi.setTitle(contentHidden ? "方案审校状态" : recipe.name);
    this.setData({
      recipe: {
        id: recipe.id,
        name: recipe.name,
        revision: recipe.revision,
        statusText: recipe.status === "published" ? "已发布" : recipe.status === "reviewed" ? "已审校，待发布" : "开发草稿",
        sourceText: `${recipe.guideContext.title} · ${recipe.guideContext.section} · ${recipe.guideContext.page}`,
        servingText: recipe.bundle && recipe.bundle.servingText,
        historicNotes: recipe.historicNotes || [],
        currentContext: recipe.currentContext || []
      },
      target,
      evaluation,
      sourceRows,
      ingredientRows: contentHidden ? [] : (recipe.bundle && recipe.bundle.ingredients || []).map((line) => ({
        id: line.lineId, name: line.sourceName, part: line.sourcePartText, amount: line.quantity && line.quantity.rawText, processing: line.processingText
      })),
      stepRows: contentHidden ? [] : (recipe.bundle && recipe.bundle.steps || []),
      triageBlocked: false,
      notFound: false,
      unavailable: false,
      unavailableTitle: "", unavailableMessage: "",
      contentHidden
    });
    return true;
  },

  copySource(event) {
    if (!this.refresh()) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const source = this.sourceById && this.sourceById[id];
    if (!source) return;
    clipboard.writeText(this, source.url);
  },

  goDirectory() {
    if (this.pageDisposed || this.pageHidden) return;
    navigation.backToOfficialDirectory(this);
  },

  goSafetyCheck() {
    if (this.pageDisposed || this.pageHidden) return;
    navigation.switchTab(this, "index");
  },

  onShareAppMessage() {
    const profile = sessionProfile.fromSession(getApp().globalData.sessionSafetyProfile || {});
    const recipe = (recipeData.recipes || []).find((item) => item.id === this.id);
    const evaluation = recipe && recipeSafety.evaluateRecipe(recipe, profile, {
      diagnosisConfirmed: Boolean((getApp().globalData.sessionRecipeAcknowledgements || {})[recipe.targetId]),
      targets: recipeData.targets || [], externalFoods: recipeData.externalFoods, sources: recipeData.sources || []
    });
    const publishable = !this.pageDisposed && !this.pageHidden && this.data.recipe && this.data.recipe.id === this.id &&
      !profile.redFlags.length && evaluation && ["viewable", "caution"].includes(evaluation.status) &&
      recipeSafety.isPublishableRecipe(recipe, undefined, recipeData.targets || [], recipeData.externalFoods, recipeData.sources || []);
    return publishable
      ? { title: `${this.data.recipe.name}｜官方完整食养资料`, path: `/subpackages/official/official-plan-detail/official-plan-detail?id=${this.id}` }
      : { title: "官方完整食养方案资料库｜非诊疗", path: "/subpackages/official/official-plans/official-plans" };
  }
});
