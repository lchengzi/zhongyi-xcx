"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const recipeData = require("../data/recipes-public");
const storage = require("../utils/storage");
const sessionProfileUtils = require("../utils/session-profile");

const ROOT = path.resolve(__dirname, "..");
const memory = Object.create(null);
const pageDefinitions = [];
let appInstance = null;
let tabBarHidden = false;
let redirectedTo = "";
let navigatedTo = "";
let relaunchedTo = "";
let modalShouldConfirm = false;
let failStorageRead = false;
let failStorageWrite = false;
let storageWriteAttempts = 0;
let clipboardWrites = 0;
const toastTitles = [];
const navigationCalls = [];
let holdNavigationCallbacks = false;

function recordNavigation(method, options) {
  navigationCalls.push({ method, options });
  if (!holdNavigationCallbacks && options && options.success) options.success({});
}

global.wx = {
  getStorageSync(key) {
    if (failStorageRead) throw new Error("synthetic storage read failure");
    return memory[key] == null ? "" : memory[key];
  },
  setStorageSync(key, value) {
    storageWriteAttempts += 1;
    if (failStorageWrite) throw new Error("synthetic storage write failure");
    memory[key] = value;
  },
  removeStorageSync(key) { delete memory[key]; },
  getStorageInfoSync() { return { keys: Object.keys(memory) }; },
  showToast(options) { toastTitles.push(options.title); },
  showModal(options) {
    if (options && options.success) options.success({ confirm: modalShouldConfirm, cancel: !modalShouldConfirm });
  },
  navigateTo(options) { navigatedTo = options && options.url || ""; recordNavigation("navigateTo", options); },
  navigateBack(options) { recordNavigation("navigateBack", options); },
  redirectTo(options) { redirectedTo = options && options.url || ""; recordNavigation("redirectTo", options); },
  reLaunch(options) { relaunchedTo = options && options.url || ""; },
  switchTab(options) { recordNavigation("switchTab", options); },
  setNavigationBarTitle() {},
  setClipboardData() { clipboardWrites += 1; },
  hideTabBar() { tabBarHidden = true; },
  showTabBar() { tabBarHidden = false; }
};

global.App = function App(definition) {
  appInstance = definition;
};
global.getApp = function getApp() {
  return appInstance;
};
global.Page = function Page(definition) {
  pageDefinitions.push(definition);
};
global.Component = function Component() {};

require(path.join(ROOT, "app.js"));
assert(appInstance && appInstance.globalData, "App registration failed");
appInstance.onLaunch();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPage(definition) {
  const page = Object.assign({}, definition);
  page.data = clone(definition.data || {});
  page.setData = function setData(patch) {
    Object.keys(patch || {}).forEach((key) => { this.data[key] = patch[key]; });
  };
  return page;
}

const routes = [
  "pages/index/index.js",
  "pages/favorites/favorites.js",
  "pages/compare/compare.js",
  "pages/plan/plan.js",
  "subpackages/catalog/detail/detail.js",
  "subpackages/official/official-plans/official-plans.js",
  "subpackages/official/official-plan-detail/official-plan-detail.js",
  "pages/privacy/privacy.js"
];

routes.forEach((route) => require(path.join(ROOT, route)));
assert.strictEqual(pageDefinitions.length, routes.length, "not all pages registered");

const indexPage = createPage(pageDefinitions[0]);
indexPage.onLoad();
assert.strictEqual(indexPage.data.resultCount, catalog.count, "catalog page did not load all seed records");
assert(indexPage.data.rows.length > 0, "catalog page did not create cards");
const initialCatalogRows = indexPage.data.rows.length;
indexPage.loadMore();
const expandedCatalogRows = indexPage.data.rows.length;
assert(expandedCatalogRows > initialCatalogRows, "load more must expand the catalog");
indexPage.onShow();
assert.strictEqual(indexPage.data.rows.length, expandedCatalogRows, "returning to catalog must preserve loaded rows");
indexPage.applyFilters();
indexPage.openSafety();
indexPage.onAgeGroupChange({ detail: { value: "infant_toddler" } });
assert(tabBarHidden, "opening the safety drawer must hide the native tab bar");
indexPage.closeSafety();
assert.strictEqual(indexPage.data.ageGroup, "unknown", "closing the safety drawer must discard its draft");
assert(!tabBarHidden, "closing the safety drawer must restore the native tab bar");
indexPage.openSafety();
indexPage.onAgeGroupChange({ detail: { value: "adult" } });
for (const key of ["pregnancyStatus", "breastfeedingStatus", "allergyStatus", "conditionStatus", "medicationStatus"]) {
  indexPage.onSafetyStatusChange({ currentTarget: { dataset: { key } }, detail: { value: "no" } });
}
indexPage.applySafetyAndClose();
const explicitNoProfile = sessionProfileUtils.fromSession(appInstance.globalData.sessionSafetyProfile);
assert.strictEqual(explicitNoProfile.ageGroup, "adult", "explicit adult age did not reach the shared session profile");
assert.strictEqual(explicitNoProfile.pregnancy, "no", "explicit pregnancy=no was lost");
assert.strictEqual(explicitNoProfile.breastfeeding, "no", "explicit breastfeeding=no was lost");
assert.strictEqual(explicitNoProfile.allergyStatus, "no", "explicit allergy=no was lost");
assert.strictEqual(explicitNoProfile.conditionStatus, "no", "explicit condition=no was lost");
assert.strictEqual(explicitNoProfile.medicationStatus, "no", "explicit medication=no was lost");
appInstance.globalData.sessionRecipeAcknowledgements = { adult_diabetes: true };
indexPage.setData({ conditionStatus: "unknown" });
indexPage.commitSafetyProfile();
assert.deepStrictEqual(appInstance.globalData.sessionRecipeAcknowledgements, {}, "a changed safety profile must invalidate recipe acknowledgements");
indexPage.setData({ conditionStatus: "no" });
indexPage.commitSafetyProfile();
indexPage.setData({ safetyOpen: true });
indexPage.onShow();
assert(tabBarHidden, "returning to an open safety drawer must keep the native tab bar hidden");
indexPage.setData({ safetyOpen: false });
indexPage.onShow();
assert(!tabBarHidden, "a closed safety drawer must not leave the native tab bar hidden");
indexPage.setData({
  ageGroup: "adult", medicationStatus: "yes", medicationText: "既有用药",
  riskFlags: ["medication"], redFlags: []
});
indexPage.commitSafetyProfile();
const profileBeforeRedFlagDraft = clone(appInstance.globalData.sessionSafetyProfile);
indexPage.openSafety();
indexPage.onAgeGroupChange({ detail: { value: "child" } });
indexPage.onSafetyStatusChange({ currentTarget: { dataset: { key: "medicationStatus" } }, detail: { value: "no" } });
indexPage.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } });
assert(indexPage.data.draftTriageBlocked, "a red-flag option must show the immediate emergency state");
indexPage.closeSafety();
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.redFlags.length, 1, "closing a red-flag drawer must preserve the triage stop");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.ageGroup, profileBeforeRedFlagDraft.ageGroup, "red-flag close must not commit a draft age change");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.medicationStatus, profileBeforeRedFlagDraft.medicationStatus, "red-flag close must not erase a previously committed medication status");
assert.deepStrictEqual(appInstance.globalData.sessionSafetyProfile.medications, profileBeforeRedFlagDraft.medications, "red-flag close must not erase previously committed medication details");
assert(indexPage.data.triageBlocked, "closing a red-flag drawer must stop the catalog");
indexPage.openSafety();
indexPage.onRedFlagChange({ detail: { value: [] } });
indexPage.applySafetyAndClose();
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.redFlags.length, 0, "only an explicit red-flag cancellation may clear the triage stop");
indexPage.openSafety();
indexPage.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } });
indexPage.onHide();
assert(appInstance.globalData.sessionSafetyProfile.redFlags.length === 1, "leaving the page must conservatively commit a red-flag draft");
assert(indexPage.data.triageBlocked, "the onHide red-flag fallback did not stop the index catalog");
indexPage.onShow(); // Return before the explicit interaction; hidden pages cannot commit.
indexPage.setData({ redFlags: [], draftTriageBlocked: false });
indexPage.commitSafetyProfile();
indexPage.applyFilters();
storage.setChecklist({ identity: true });
indexPage.commitSafetyProfile();
assert(storage.getChecklist().identity, "reapplying an unchanged safety profile must not clear checklist progress");
indexPage.toggleFavorite({ detail: { id: catalog.ingredients[0].id, interactionVersion: indexPage.data.interactionVersion } });
indexPage.toggleCompare({ detail: { id: catalog.ingredients[0].id, interactionVersion: indexPage.data.interactionVersion } });
indexPage.toggleCompare({ detail: { id: catalog.ingredients[1].id, interactionVersion: indexPage.data.interactionVersion } });

const favoritePage = createPage(pageDefinitions[1]);
favoritePage.onShow();
assert.strictEqual(favoritePage.data.rows.length, 1, "favorites page failed to restore an ID");
const initialFavoriteRows = favoritePage.data.rows.length;

const comparePage = createPage(pageDefinitions[2]);
comparePage.onShow();
assert.strictEqual(comparePage.data.ingredients.length, 2, "compare page failed to restore candidates");
assert(comparePage.data.groups.length > 0, "compare page did not build groups");
const initialCompareItems = comparePage.data.ingredients.length;

const planPage = createPage(pageDefinitions[3]);
planPage.onShow();
assert.strictEqual(planPage.data.shortlist.length, 2, "safety plan failed to restore candidates");
assert(planPage.data.inquiryText.includes("不包含处方"), "consultation copy lost its boundary statement");
planPage.goPrivacy();
assert.strictEqual(navigatedTo, "/pages/privacy/privacy", "safety page did not expose the privacy and deletion entry");

const detailPage = createPage(pageDefinitions[4]);
detailPage.onLoad({ id: catalog.ingredients[0].id });
assert(detailPage.data.ingredient, "detail page failed to load a valid record");
assert(detailPage.data.sourceRows.length > 0, "detail page omitted sources");
assert(detailPage.data.ingredient.sourceCheckedAt, "detail page omitted the source review date");
assert(detailPage.data.foodUseReviewText, "detail page omitted the food-use mapping review state");

const officialPlansPage = createPage(pageDefinitions[5]);
officialPlansPage.onShow();
assert.strictEqual(officialPlansPage.data.targets.length, 3, "official plan directory lost a controlled diagnosis target");
assert.strictEqual(officialPlansPage.data.publishableCount, 0, "unreviewed recipe drafts leaked into published cards");
assert.strictEqual(officialPlansPage.data.pendingCount, recipeData.count, "official plan directory omitted draft review progress");
officialPlansPage.selectTarget({ currentTarget: { dataset: { id: "adult_diabetes" } } });
assert.strictEqual(officialPlansPage.data.pendingCards.length, 2, "adult type 2 diabetes drafts were not grouped under their target");
assert.strictEqual(officialPlansPage.data.publishedCards.length, 0, "draft recipe created an actionable detail button");
officialPlansPage.selectTarget({ currentTarget: { dataset: { id: "adult_hyperlipidemia" } } });
assert.strictEqual(officialPlansPage.data.pendingCards.length, 2, "pattern-specific hyperlipidemia drafts were not grouped under their target");
assert(officialPlansPage.data.pendingCards.every((card) => card.patternText && card.patternText.includes("须由专业人员确认")), "pattern-specific draft cards lost their professional confirmation warning");
officialPlansPage.selectTarget({ currentTarget: { dataset: { id: "adult_hypertension" } } });
assert.strictEqual(officialPlansPage.data.pendingCards.length, 1, "pattern-specific hypertension draft was not grouped under its target");
assert(officialPlansPage.data.pendingCards[0].patternText.includes("肝火上炎证"), "hypertension draft card lost its exact pattern boundary");
officialPlansPage.selectTarget({ currentTarget: { dataset: { id: "adult_diabetes" } } });

const officialPlanDetailPage = createPage(pageDefinitions[6]);
officialPlanDetailPage.onLoad({ id: "black-bean-huangqi-goji-soup" });
assert(officialPlanDetailPage.data.recipe, "official plan detail did not load draft metadata");
assert(officialPlanDetailPage.data.contentHidden, "draft recipe exposed complete materials or preparation");
assert(!recipeData.recipes[0].bundle.ingredients && !recipeData.recipes[0].bundle.steps, "public runtime data contains a withheld recipe bundle");
assert.strictEqual(officialPlanDetailPage.data.ingredientRows.length, 0, "draft recipe leaked ingredient quantities");
assert.strictEqual(officialPlanDetailPage.data.stepRows.length, 0, "draft recipe leaked preparation steps");
officialPlanDetailPage.goDirectory();
assert.strictEqual(redirectedTo, "/subpackages/official/official-plans/official-plans", "a cold-start detail page must route to the official-plan directory");
const withdrawnFixture = { ...clone(recipeData.recipes[0]), id: "withdrawn-fixture", status: "withdrawn" };
recipeData.recipes.push(withdrawnFixture);
officialPlanDetailPage.id = withdrawnFixture.id;
officialPlanDetailPage.refresh();
assert(officialPlanDetailPage.data.unavailable && !officialPlanDetailPage.data.recipe, "a withdrawn direct link did not enter the unavailable state");
officialPlansPage.refresh();
assert.strictEqual(officialPlansPage.data.unavailableCards.length, 1, "withdrawn recipe was mislabeled as an active draft");
recipeData.recipes.pop();
officialPlanDetailPage.id = "invalid-recipe-id";
officialPlanDetailPage.refresh();
assert(officialPlanDetailPage.data.notFound, "invalid recipe ID did not enter the safe empty state");
officialPlanDetailPage.id = "black-bean-huangqi-goji-soup";
officialPlanDetailPage.refresh();
indexPage.setData({ ageGroup: "infant_toddler", riskFlags: [], redFlags: [], allergyText: "", conditionText: "", medicationText: "" });
indexPage.commitSafetyProfile();
const compareBeforeAgeGate = storage.getCompare();
storage.setCompare(["dang-shen"]);
planPage.onShow();
assert.strictEqual(planPage.data.shortlist.length, 0, "a hard-blocked item remained an active plan candidate");
assert.strictEqual(planPage.data.excludedItems.length, 1, "the plan did not explain its age-based exclusion");
storage.setCompare(compareBeforeAgeGate);
detailPage.id = "dang-shen";
detailPage.loadIngredient();
officialPlansPage.onShow();
officialPlanDetailPage.refresh();
assert(detailPage.data.ingredient.blocked, "the committed age group did not reach the detail safety evaluation");
indexPage.setData({ ageGroup: "unknown" });
indexPage.commitSafetyProfile();
detailPage.id = catalog.ingredients[0].id;
detailPage.loadIngredient();

indexPage.setData({
  riskFlags: ["known_allergy", "medication"],
  allergyStatus: "yes",
  conditionStatus: "yes",
  medicationStatus: "yes",
  redFlags: [],
  allergyText: "天麻",
  conditionText: "测试用基础情况",
  medicationText: "藜芦"
});
indexPage.commitSafetyProfile();
assert(appInstance.globalData.sessionSafetyProfile.allergies.includes("天麻"), "session safety input was not applied");
assert(!JSON.stringify(memory).includes("天麻"), "allergy input must not be written to persistent storage");
assert(!JSON.stringify(memory).includes("藜芦"), "medication input must not be written to persistent storage");

catalog.ingredients.slice(2, 5).forEach((item) => storage.toggleCompare(item.id));
assert.strictEqual(storage.getCompare().length, 4, "compare storage must enforce the four-item limit");
const compareLimit = storage.getCompare().length;
storage.setCompare(["retired-id", catalog.ingredients[0].id]);
storage.setFavorites(["retired-id", catalog.ingredients[0].id]);
storage.reconcileCatalogIds(catalog.ingredients.map((item) => item.id));
assert.deepStrictEqual(storage.getCompare(), [catalog.ingredients[0].id], "retired compare IDs must be reconciled");
assert.deepStrictEqual(storage.getFavorites(), [catalog.ingredients[0].id], "retired favorite IDs must be reconciled");

indexPage.setData({ redFlags: ["sudden_severe_chest_pain"] });
indexPage.commitSafetyProfile();
indexPage.applyFilters();
assert(indexPage.data.triageBlocked, "red-flag selection did not enter triage stop mode");
assert.strictEqual(indexPage.data.resultCount, 0, "triage stop mode must not expose catalog candidates");
favoritePage.onShow();
comparePage.onShow();
planPage.onShow();
detailPage.loadIngredient();
officialPlansPage.onShow();
officialPlanDetailPage.refresh();
assert(favoritePage.data.triageBlocked && favoritePage.data.rows.length === 0, "favorites page bypassed red-flag triage");
assert(comparePage.data.triageBlocked && comparePage.data.ingredients.length === 0, "compare page bypassed red-flag triage");
assert(planPage.data.triageBlocked && planPage.data.shortlist.length === 0, "plan page bypassed red-flag triage");
assert(detailPage.data.triageBlocked && !detailPage.data.ingredient, "detail page bypassed red-flag triage");
assert(officialPlansPage.data.triageBlocked && officialPlansPage.data.publishedCards.length === 0, "official plan directory bypassed red-flag triage");
assert(officialPlanDetailPage.data.triageBlocked && !officialPlanDetailPage.data.recipe, "official plan detail bypassed red-flag triage");
const triageCatalogRowsBeforeDeletion = indexPage.data.resultCount;

storage.setChecklist({ identity: true, medications: true });
appInstance.globalData.sessionRecipeAcknowledgements = { adult_diabetes: true };
memory.zhongyi_legacy_health_v0 = { synthetic: true };
memory.unrelated_runtime_key = "keep";
const privacyPage = createPage(pageDefinitions[7]);
privacyPage.onShow();
assert(privacyPage.data.triageBlocked, "privacy page did not retain the emergency warning before deletion");
assert.strictEqual(privacyPage.data.favoritesCount, 1, "privacy page lost the persisted favorite count");
assert.strictEqual(privacyPage.data.compareCount, 1, "privacy page lost the persisted compare count");
assert.strictEqual(privacyPage.data.checklistCount, 2, "privacy page lost the session checklist count");
assert.strictEqual(privacyPage.data.diagnosisConfirmationCount, 1, "privacy page lost diagnosis-confirmation count");
privacyPage.deleteLocalData();
assert.strictEqual(storage.getFavorites().length, 1, "cancelling the deletion confirmation removed favorites");
assert(appInstance.globalData.sessionSafetyProfile.redFlags.length > 0, "cancelling the deletion confirmation cleared the health session");
modalShouldConfirm = true;
privacyPage.deleteLocalData();
assert.strictEqual(Object.keys(memory).filter((key) => key.startsWith("zhongyi_")).length, 0, "one-click deletion left app-owned persistent keys");
assert.strictEqual(memory.unrelated_runtime_key, "keep", "one-click deletion crossed the app-owned storage namespace");
assert.deepStrictEqual(storage.getChecklist(), {}, "one-click deletion left checklist state");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.ageGroup, "unknown", "one-click deletion left the age group");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.redFlags.length, 0, "one-click deletion left red flags");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.allergies.length, 0, "one-click deletion left allergy details");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.conditions.length, 0, "one-click deletion left condition details");
assert.strictEqual(appInstance.globalData.sessionSafetyProfile.medications.length, 0, "one-click deletion left medication details");
assert.deepStrictEqual(appInstance.globalData.sessionRecipeAcknowledgements, {}, "one-click deletion left diagnosis confirmations");
assert(!privacyPage.data.hasSessionData && !privacyPage.data.triageBlocked, "privacy summary did not refresh after deletion");
assert.strictEqual(relaunchedTo, "/pages/index/index?privacyCleared=1", "successful deletion did not reset the cached page stack");
indexPage.onShow();
assert.strictEqual(indexPage.data.ageGroup, "unknown", "a cached catalog page revived the deleted age group");
assert.strictEqual(indexPage.data.redFlags.length, 0, "a cached catalog page revived deleted red flags");
assert.strictEqual(indexPage.data.allergyText, "", "a cached catalog page revived deleted allergy details");
assert.strictEqual(indexPage.data.conditionText, "", "a cached catalog page revived deleted condition details");
assert.strictEqual(indexPage.data.medicationText, "", "a cached catalog page revived deleted medication details");
detailPage.onShow();
assert(detailPage.data.ingredient, "a previously triage-blocked detail did not recover after the actual privacy deletion flow");
assert.strictEqual(detailPage.data.triageBlocked, false, "deleted red flags still blocked the cached detail");
assert.strictEqual(detailPage.data.ingredient.id, detailPage.id, "detail recovery restored another ingredient");
assert.strictEqual(detailPage.data.ingredient.isFavorite, false, "cached detail revived a deleted favorite");
assert.strictEqual(detailPage.data.ingredient.inCompare, false, "cached detail revived a deleted compare ID");
assert.deepStrictEqual(Object.keys(detailPage.sourceById).sort(), detailPage.data.sourceRows.map((source) => source.id).sort(),
  "recovered detail source lookup does not match the current visible sources");
const restartedIndexPage = createPage(pageDefinitions[0]);
restartedIndexPage.onLoad({ privacyCleared: "1" });
assert.strictEqual(restartedIndexPage.data.ageGroup, "unknown", "a fresh catalog page revived the deleted health session");
assert.strictEqual(restartedIndexPage.data.redFlags.length, 0, "a fresh catalog page revived deleted red flags");
assert.strictEqual(restartedIndexPage.data.resultCount, catalog.count, "catalog did not recover after deleting the health session");

// Real registered page handlers, with deterministic WeChat API fault injection.
// This is Node simulation, not WeChat developer-tool or physical-device evidence.
const faultId = catalog.ingredients[0].id;
const secondFaultId = catalog.ingredients[1].id;
storage.setFavorites([faultId]);
storage.setCompare([faultId, secondFaultId]);
storage.setChecklist({ identity: true });
detailPage.id = faultId;
const refreshStoragePages = [
  () => indexPage.refreshCards(), () => favoritePage.refresh(), () => comparePage.refresh(),
  () => detailPage.loadIngredient(), () => planPage.refresh(), () => privacyPage.refresh()
];
const storagePages = [indexPage, favoritePage, comparePage, detailPage, planPage, privacyPage];
refreshStoragePages.forEach((refresh) => refresh());
const faultActions = [
  () => indexPage.toggleFavorite({ detail: { id: faultId, interactionVersion: indexPage.data.interactionVersion } }),
  () => indexPage.toggleCompare({ detail: { id: faultId, interactionVersion: indexPage.data.interactionVersion } }),
  () => favoritePage.removeFavorite({ detail: { id: faultId } }),
  () => favoritePage.toggleCompare({ detail: { id: faultId } }),
  () => comparePage.toggleFavorite({ currentTarget: { dataset: { id: faultId } } }),
  () => comparePage.removeIngredient({ currentTarget: { dataset: { id: faultId } } }),
  () => comparePage.clearCompare(),
  () => detailPage.toggleFavorite(), () => detailPage.toggleCompare(), () => planPage.clearPlan()
];
const persistentBeforeFaults = clone(memory);
failStorageWrite = true;
faultActions.forEach((action) => {
  const beforeToast = toastTitles.length;
  action();
  assert.strictEqual(toastTitles.length, beforeToast + 1, "a failed page write must produce one failure notice");
  assert.strictEqual(toastTitles[beforeToast], "本机保存失败，请检查后重试", "failed page write reported success");
  assert.deepStrictEqual(clone(memory), persistentBeforeFaults, "failed page write changed stored IDs");
  assert.deepStrictEqual(storage.getChecklist(), { identity: true }, "failed page write discarded checklist progress");
});
assert(detailPage.data.ingredient.isFavorite && detailPage.data.ingredient.inCompare, "failed writes changed detail button states");
assert.strictEqual(comparePage.data.ingredients.length, 2, "failed removal changed comparison cards");
assert.strictEqual(planPage.data.checkedCount, 1, "failed plan reset changed checkbox state");

failStorageWrite = false;
failStorageRead = true;
refreshStoragePages.forEach((refresh) => refresh());
storagePages.forEach((page) => assert(page.data.storageIssue, "an unreadable page must show a retry notice"));
assert.strictEqual(privacyPage.data.favoritesAvailable, false, "privacy favorite count was shown as confirmed empty");
assert.strictEqual(privacyPage.data.compareAvailable, false, "privacy compare count was shown as confirmed empty");
const attemptsBeforeReadFaults = storageWriteAttempts;
faultActions.forEach((action) => {
  const beforeToast = toastTitles.length;
  action();
  assert.strictEqual(toastTitles.length, beforeToast + 1, "a blocked mutation must produce one read failure notice");
  assert.strictEqual(toastTitles[beforeToast], "本机记录读取失败，未执行修改", "unreadable IDs were treated as an editable empty list");
});
assert.strictEqual(storageWriteAttempts, attemptsBeforeReadFaults, "a read fault attempted to overwrite unreadable IDs");
assert.deepStrictEqual(clone(memory), persistentBeforeFaults, "read faults overwrote records");
assert.deepStrictEqual(storage.getChecklist(), { identity: true }, "read faults discarded checklist progress");
const copiedBeforeReadFault = clipboardWrites;
planPage.copyInquiry();
assert.strictEqual(clipboardWrites, copiedBeforeReadFault, "unreadable candidate lists produced misleading consultation copy");
assert.strictEqual(toastTitles[toastTitles.length - 1], "请先重试读取本机记录");

failStorageRead = false;
refreshStoragePages.forEach((refresh) => refresh());
storagePages.forEach((page) => assert.strictEqual(page.data.storageIssue, "", "manual reread did not dismiss the notice"));
assert.strictEqual(favoritePage.data.rows.length, 1, "manual reread lost stored favorites");
assert.strictEqual(comparePage.data.ingredients.length, 2, "manual reread lost stored compare IDs");
assert.strictEqual(privacyPage.data.favoritesCount, 1, "privacy counts did not recover");
assert.strictEqual(privacyPage.data.favoritesAvailable, true);
const retryBindings = [
  ["pages/index/index", "refreshCards"], ["pages/favorites/favorites", "refresh"],
  ["pages/compare/compare", "refresh"], ["subpackages/catalog/detail/detail", "loadIngredient"],
  ["pages/plan/plan", "refresh"], ["pages/privacy/privacy", "refresh"]
];
retryBindings.forEach(([route, method]) => {
  const wxml = fs.readFileSync(path.join(ROOT, `${route}.wxml`), "utf8");
  const script = fs.readFileSync(path.join(ROOT, `${route}.js`), "utf8");
  assert(wxml.includes('wx:if="{{storageIssue}}"') && wxml.includes(`bindtap="${method}"`), "a read-error notice has no template retry binding");
  assert(!/storage\.(toggleFavorite|setCompare)\(/.test(script), "a page bypassed persistence error feedback");
});
const privacyTemplate = fs.readFileSync(path.join(ROOT, "pages/privacy/privacy.wxml"), "utf8");
assert(privacyTemplate.includes("favoritesAvailable ? favoritesCount : '未知'"));
assert(privacyTemplate.includes("compareAvailable ? compareCount : '未知'"));
planPage.clearPlan();
assert.deepStrictEqual(storage.getCompare(), [], "successful retry did not clear compare IDs");
assert.deepStrictEqual(storage.getChecklist(), {}, "successful retry did not clear checklist progress");
storage.setFavorites([]);

// Candidate navigation must still stop under the real shared red-flag flow.
indexPage.openSafety();
indexPage.onRedFlagChange({ detail: { value: ["sudden_severe_chest_pain"] } });
indexPage.closeSafety();
[favoritePage, comparePage, planPage, officialPlansPage].forEach((page) => page.onShow());
const beforeBlockedNavigation = navigationCalls.length;
[
  () => indexPage.openDetail({ detail: { id: faultId, interactionVersion: indexPage.data.interactionVersion } }),
  () => indexPage.openOfficialPlans(),
  () => favoritePage.openDetail({ detail: { id: faultId } }),
  () => comparePage.openDetail({ currentTarget: { dataset: { id: faultId } } }),
  () => planPage.openDetail({ currentTarget: { dataset: { id: faultId } } }),
  () => officialPlansPage.openDetail({ currentTarget: { dataset: { id: "black-bean-huangqi-goji-soup" } } })
].forEach((action) => action());
assert.strictEqual(navigationCalls.length, beforeBlockedNavigation, "candidate navigation bypassed red-flag stop");
indexPage.openSafety();
indexPage.onRedFlagChange({ detail: { value: [] } });
indexPage.applySafetyAndClose();

// Navigation originates from current visible rows, not deleted cached IDs.
storage.setFavorites([faultId]);
storage.setCompare([faultId]);
const navigationCases = [
  { page: indexPage, action: () => indexPage.openDetail({ detail: { id: faultId, interactionVersion: indexPage.data.interactionVersion } }), method: "navigateTo", url: `/subpackages/catalog/detail/detail?id=${faultId}` },
  { page: favoritePage, action: () => favoritePage.openDetail({ detail: { id: faultId } }), method: "navigateTo", url: `/subpackages/catalog/detail/detail?id=${faultId}` },
  { page: comparePage, action: () => comparePage.openDetail({ currentTarget: { dataset: { id: faultId } } }), method: "navigateTo", url: `/subpackages/catalog/detail/detail?id=${faultId}` },
  { page: planPage, action: () => planPage.openDetail({ currentTarget: { dataset: { id: faultId } } }), method: "navigateTo", url: `/subpackages/catalog/detail/detail?id=${faultId}` },
  { page: detailPage, action: () => detailPage.goCatalog(), method: "switchTab", url: "/pages/index/index" },
  { page: officialPlansPage, action: () => officialPlansPage.goSafetyCheck(), method: "switchTab", url: "/pages/index/index" },
  { page: officialPlanDetailPage, action: () => officialPlanDetailPage.goDirectory(), method: "redirectTo", url: "/subpackages/official/official-plans/official-plans" }
];
holdNavigationCallbacks = true;
navigationCases.forEach(({ page, action, method, url }) => {
  page.onShow();
  const before = navigationCalls.length;
  const beforeNotices = toastTitles.length;
  action();
  action();
  assert.strictEqual(navigationCalls.length, before + 1, "rapid page clicks pushed duplicate destinations");
  const first = navigationCalls[before];
  assert.strictEqual(first.method, method);
  assert.strictEqual(first.options.url, url);
  page.onShow();
  action();
  assert.strictEqual(navigationCalls.length, before + 1, "foregrounding the app unlocked an unsettled navigation");
  first.options.fail({ errMsg: "synthetic navigation failure" });
  assert.strictEqual(toastTitles.length, beforeNotices + 1, "failed page navigation had no feedback");
  assert.strictEqual(toastTitles[beforeNotices], "页面打开失败，请稍后重试");
  action();
  assert.strictEqual(navigationCalls.length, before + 2, "explicit page retry remained locked after failure");
  const retry = navigationCalls[before + 1];
  retry.options.success({});
  action();
  assert.strictEqual(navigationCalls.length, before + 2, "successful navigation unlocked before source returned");
  page.onShow();
  action();
  assert.strictEqual(navigationCalls.length, before + 3, "returning to the source page left navigation locked");
  retry.options.fail({});
  assert.strictEqual(toastTitles.length, beforeNotices + 1, "late callback interfered with the new page operation");
  page.onUnload();
  navigationCalls[before + 2].options.fail({});
  assert.strictEqual(toastTitles.length, beforeNotices + 1, "unloaded source page emitted a stale failure notice");
});
holdNavigationCallbacks = false;

console.log(JSON.stringify({
  pagesLoaded: pageDefinitions.length,
  catalogRows: initialCatalogRows,
  favoriteRows: initialFavoriteRows,
  compareItems: initialCompareItems,
  detailSources: detailPage.data.sourceRows.length,
  persistentHealthText: false,
  compareLimit,
  persistedItemsAfterDeletion: storage.getCompare().length + storage.getFavorites().length,
  triageCatalogRowsBeforeDeletion,
  officialPlanDrafts: recipeData.count,
  publishableRecipes: 0,
  triagePagesBlocked: 7,
  deletionResetPageStack: true,
  detailRecoveryAfterPrivacyDeletion: true,
  storageFaultPageMutations: faultActions.length * 2,
  storageReadNoticePages: storagePages.length,
  storageRecoveryVerified: true,
  protectedNavigationSourcePages: navigationCases.length,
  navigationFailureRetryVerified: true,
  navigationRedFlagStopVerified: true,
  assertions: "passed"
}, null, 2));
