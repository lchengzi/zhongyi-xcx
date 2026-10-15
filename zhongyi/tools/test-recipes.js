"use strict";

const assert = require("assert");
const recipeData = require("../data/recipes");
const publicRecipeData = require("../data/recipes-public");
const catalogData = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const recipeSafety = require("../utils/recipe-safety");
const sessionProfile = require("../utils/session-profile");
const publicRecipeBuilder = require("./build-public-recipes");
const {
  expectedExternalFoodSnapshotDigest,
  expectedIngredientSnapshotDigest,
  expectedRecipeBundleDigest,
  expectedRecipeSourceTextDigest
} = require("./recipe-digests");

const VALID_DIGEST = `sha256:${"a".repeat(64)}`;
const REVIEW_ROLES = ["tcm_clinician", "pharmacist", "nutrition_professional", "compliance", "release_approver"];
const INGREDIENT_REVIEW_ROLES = ["tcm_clinician", "pharmacist", "compliance"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reviewedIngredient(base, id, name) {
  const ingredient = base ? clone(base) : {
    id, name, sources: [{
      id: "fixture-source", title: "Fixture source", publisher: "Fixture issuer",
      url: "https://example.test/source", status: "published", publishedAt: "2026-08-01", checkedAt: "2026-08-09"
    }],
    identity: { ediblePart: "测试部位" },
    regulatory: { status: "ordinary_food", restrictionCode: "" },
    foodUse: {}, safety: {}, audit: {}
  };
  ingredient.id = id;
  ingredient.name = name;
  ingredient.sources = ingredient.sources && ingredient.sources.length ? ingredient.sources : [{
    id: "fixture-source", title: "Fixture source", publisher: "Fixture issuer",
    url: "https://example.test/source", status: "published", publishedAt: "2026-08-01", checkedAt: "2026-08-09"
  }];
  const fixtureSourceId = ingredient.sources.find((source) => source && source.status === "published").id;
  ingredient.identity = { ...(ingredient.identity || {}), partReviewState: "reviewed" };
  ingredient.regulatory = {
    ...(ingredient.regulatory || {}), status: ingredient.regulatory && ingredient.regulatory.status === "listed" ? "listed" : "ordinary_food",
    currentCatalogReviewState: "reviewed", restrictionCode: "", sourceIds: [fixtureSourceId]
  };
  ingredient.foodUse = { ...(ingredient.foodUse || {}), mappingReviewState: "reviewed", sourceIds: [fixtureSourceId] };
  ingredient.safety = {
    ...(ingredient.safety || {}),
    allergenReviewState: "reviewed", conditionReviewState: "reviewed",
    interactionReviewState: "reviewed", preparationReviewState: "reviewed", sourceIds: [fixtureSourceId]
  };
  ingredient.audit = {
    ...(ingredient.audit || {}),
    sourceCheckState: "checked",
    professionalReviewState: "reviewed",
    reviewedBy: INGREDIENT_REVIEW_ROLES.slice(),
    reviewedAt: "2026-08-09",
    ingredientDigest: VALID_DIGEST,
    reviews: INGREDIENT_REVIEW_ROLES.map((role) => ({
      reviewId: `fixture-ingredient-${id}-${role}`,
      role,
      state: "reviewed",
      reviewedAt: "2026-08-09",
      contentVersion: catalogData.contentVersion,
      rulesVersion: ruleSet.contentVersion,
      ingredientDigest: VALID_DIGEST
    }))
  };
  return ingredient;
}

function releaseReadyFixture(sourceRecipe) {
  const recipe = clone(sourceRecipe);
  recipe.status = "published";
  recipe.publicVisibility = "published";
  recipe.bundle.bundleDigest = VALID_DIGEST;
  recipe.bundle.sourceTextDigest = VALID_DIGEST;
  const catalog = [];
  recipe.bundle.ingredients.forEach((line) => {
    if (line.ingredientRegistry === "external_food" || !line.ingredientId) line.ingredientId = `fixture-${line.lineId}`;
    line.ingredientRegistry = "official_catalog";
    line.ingredientContentVersion = catalogData.contentVersion;
    line.ingredientSnapshotDigest = VALID_DIGEST;
    line.identityReviewState = "reviewed";
    if (!line.identitySourceIds.length) line.identitySourceIds = [recipe.formulaSourceId];
    const base = catalogData.ingredients.find((ingredient) => ingredient.id === line.ingredientId);
    catalog.push(reviewedIngredient(base, line.ingredientId, line.sourceName));
  });
  for (const field of ["allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"]) {
    recipe.safety[field] = "reviewed";
  }
  for (const field of [
    "sourceIds", "populationSourceIds", "allergenSourceIds", "conditionSourceIds", "interactionSourceIds", "preparationSourceIds"
  ]) {
    if (!recipe.safety[field].length) recipe.safety[field] = [recipe.formulaSourceId];
  }
  recipe.audit = {
    ...recipe.audit,
    sourceCheckState: "checked",
    formulaReviewState: "reviewed", medicalReviewState: "reviewed",
    pharmacyReviewState: "reviewed", complianceReviewState: "reviewed",
    finalApprovedAt: "2026-08-09", nextReviewAt: "2099-01-01",
    reviews: REVIEW_ROLES.map((role) => ({
      reviewId: `fixture-${role}`, role, state: "reviewed", reviewedAt: "2026-08-09",
      contentVersion: recipe.contentVersion, rulesVersion: recipe.rulesVersion,
      bundleDigest: VALID_DIGEST, sourceTextDigest: VALID_DIGEST
    }))
  };
  return { recipe, catalog };
}

const byId = new Map(recipeData.recipes.map((recipe) => [recipe.id, recipe]));
const diabetesTarget = recipeData.targets.find((target) => target.id === "adult_diabetes");
const hyperlipidemiaTarget = recipeData.targets.find((target) => target.id === "adult_hyperlipidemia");
const hypertensionTarget = recipeData.targets.find((target) => target.id === "adult_hypertension");

assert.strictEqual(recipeData.count, 5, "P3 must contain two diabetes drafts and three pattern-specific official drafts");
assert.strictEqual(recipeSafety.rulesVersion, ruleSet.contentVersion, "whole-recipe runtime is not bound to the active rule set");
assert(recipeData.recipes.every((recipe) => recipe.rulesVersion === ruleSet.contentVersion), "recipe data contains an unsupported rulesVersion");
assert.strictEqual(publicRecipeData.count, recipeData.count, "public recipe index lost a review record");
assert.strictEqual(recipeData.externalFoods.count, 18, "private external-food registry count drifted");
assert.strictEqual(publicRecipeData.externalFoods.count, 0, "pending external foods leaked into the public package");
assert.strictEqual(catalogData.count, 106, "external foods changed the official food-medicine catalog count");
const allRecipeLines = recipeData.recipes.flatMap((recipe) => recipe.bundle.ingredients);
assert.strictEqual(allRecipeLines.length, 36, "recipe material-line inventory drifted");
assert.strictEqual(allRecipeLines.filter((line) => line.ingredientRegistry === "external_food").length, 24, "external-food line bindings drifted");
assert(allRecipeLines.every((line) => line.ingredientId && ["official_catalog", "external_food"].includes(line.ingredientRegistry)), "a recipe material remains unresolved or has no registry binding");
const externalLineEvidenceKeys = allRecipeLines
  .filter((line) => line.ingredientRegistry === "external_food")
  .map((line) => {
    const recipe = recipeData.recipes.find((item) => item.bundle.ingredients.includes(line));
    assert(line.sourceIds.includes(recipe.formulaSourceId) && line.quantitySourceIds.includes(recipe.formulaSourceId),
      `${recipe.id}/${line.lineId} lost its formula and quantity source binding`);
    return `${line.ingredientId}|${recipe.id}|${line.lineId}`;
  }).sort();
const externalOccurrenceEvidenceKeys = recipeData.externalFoods.items.flatMap((food) =>
  food.occurrenceEvidence.map((evidence) => {
    const recipe = recipeData.recipes.find((item) => item.id === evidence.recipeId);
    assert(recipe && evidence.sourceId === recipe.formulaSourceId,
      `${food.id}/${evidence.lineId} occurrence evidence is not bound to the formula source`);
    return `${food.id}|${evidence.recipeId}|${evidence.lineId}`;
  })
).sort();
assert.deepStrictEqual(externalOccurrenceEvidenceKeys, externalLineEvidenceKeys,
  "external-food occurrence evidence must cover every external recipe line exactly once");
assert.strictEqual(new Set(externalOccurrenceEvidenceKeys).size, externalOccurrenceEvidenceKeys.length,
  "external-food occurrence evidence contains a duplicate recipe-line binding");
for (const recipe of publicRecipeData.recipes) {
  assert(!recipe.bundle.ingredients, `${recipe.id} leaked draft materials into the public package`);
  assert(!recipe.bundle.steps, `${recipe.id} leaked draft steps into the public package`);
  assert(!JSON.stringify(recipe).includes('"quantity"'), `${recipe.id} leaked draft quantities into the public package`);
}
const mislabeledReviewData = clone(recipeData);
mislabeledReviewData.recipes[0].status = "published";
mislabeledReviewData.recipes[0].publicVisibility = "published";
const failClosedPublic = publicRecipeBuilder.buildPublicData(mislabeledReviewData, catalogData);
assert(!failClosedPublic.recipes[0].bundle.ingredients, "public builder trusted a mislabeled but non-release-ready recipe");
const privateUnpublishedRecipeData = clone(recipeData);
privateUnpublishedRecipeData.recipes[0].privateUnpublishedEvidence = { secret: "LEAK_SENTINEL" };
privateUnpublishedRecipeData.recipes[0].sourceLocator.privateLocator = "LEAK_SENTINEL";
privateUnpublishedRecipeData.recipes[0].safety.privateSafety = { secret: "LEAK_SENTINEL" };
privateUnpublishedRecipeData.recipes[0].audit.privateUnpublishedEvidence = { secret: "LEAK_SENTINEL" };
privateUnpublishedRecipeData.recipes[0].audit.reviews = [{ privateReviewer: "LEAK_SENTINEL" }];
privateUnpublishedRecipeData.recipes[0].sources[0].privateSource = "LEAK_SENTINEL";
const privateUnpublishedPublic = publicRecipeBuilder.buildPublicData(privateUnpublishedRecipeData, catalogData);
assert(!JSON.stringify(privateUnpublishedPublic).includes("LEAK_SENTINEL"),
  "unpublished recipe public projection leaked unknown private or human-review fields");
assert.deepStrictEqual(privateUnpublishedPublic.recipes[0].audit.reviews, [],
  "unpublished recipe public projection retained human-review records");
const privateCatalogProjectionData = clone(recipeData);
privateCatalogProjectionData.privateCatalogEvidence = "LEAK_SENTINEL";
privateCatalogProjectionData.sources[0].privateSource = "LEAK_SENTINEL";
privateCatalogProjectionData.targets[0].privateTarget = "LEAK_SENTINEL";
privateCatalogProjectionData.recipes[0].privateRecipe = "LEAK_SENTINEL";
const privateCatalogProjectionPublic = publicRecipeBuilder.buildPublicData(privateCatalogProjectionData, catalogData);
assert(!JSON.stringify(privateCatalogProjectionPublic).includes("LEAK_SENTINEL"),
  "strict public catalog projection leaked an unknown root, source, target or recipe field");
for (const mutate of [
  (value) => { value.sources[0].scope = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.targets[0].sourceIds = ["nhc-food-guides-notice-2023", { secret: "LEAK_SENTINEL" }]; },
  (value) => { value.recipes[0].sourceLocator.documentNo = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.recipes[0].sourceContext.text = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.recipes[0].audience.allowedTargetConditions = [{ secret: "LEAK_SENTINEL" }]; },
  (value) => { value.recipes[0].bundle.omissionPolicy = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.recipes[0].bundle.substitutionPolicy = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.recipes[0].bundle.scalingPolicy = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.recipes[0].safety.redFlagPolicy = { secret: "LEAK_SENTINEL" }; },
  (value) => { value.recipes[0].audit.releaseStage = { secret: "LEAK_SENTINEL" }; }
]) {
  const invalidPublicShape = clone(recipeData);
  mutate(invalidPublicShape);
  assert.throws(() => publicRecipeBuilder.buildPublicData(invalidPublicShape, catalogData), /must be/,
    "public projection accepted an object or non-string array element in an allowed field");
}
const projectionLeafPaths = [];
(function collectProjectionLeaves(value, path) {
  if (value === null || typeof value !== "object") {
    projectionLeafPaths.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectProjectionLeaves(item, path.concat(index)));
    return;
  }
  Object.keys(value).forEach((key) => collectProjectionLeaves(value[key], path.concat(key)));
})(recipeData, []);
let projectionObjectRejections = 0;
let projectionObjectOmissions = 0;
for (const path of projectionLeafPaths) {
  const objectMutation = clone(recipeData);
  let parent = objectMutation;
  for (let index = 0; index < path.length - 1; index += 1) parent = parent[path[index]];
  parent[path[path.length - 1]] = { __PUBLIC_PROJECTION_PROBE__: path.join(".") };
  try {
    const projected = publicRecipeBuilder.buildPublicData(objectMutation, catalogData);
    assert(!JSON.stringify(projected).includes("__PUBLIC_PROJECTION_PROBE__"),
      `object-valued private field leaked through public projection: ${path.join(".")}`);
    projectionObjectOmissions += 1;
  } catch (_error) {
    projectionObjectRejections += 1;
  }
}
assert.strictEqual(projectionObjectRejections + projectionObjectOmissions, projectionLeafPaths.length,
  "systematic public projection mutation coverage drifted");
const unsupportedBuilderRecipeSchema = clone(recipeData);
unsupportedBuilderRecipeSchema.schemaVersion = "999.0.0";
assert.throws(() => publicRecipeBuilder.buildPublicData(unsupportedBuilderRecipeSchema, catalogData), /Unsupported recipe review schema/,
  "public builder accepted an unknown recipe schema");
const unsupportedBuilderExternalSchema = clone(recipeData);
unsupportedBuilderExternalSchema.externalFoods.schemaVersion = "999.0.0";
assert.throws(() => publicRecipeBuilder.buildPublicData(unsupportedBuilderExternalSchema, catalogData), /Unsupported external-food registry schema/,
  "public builder accepted an unknown external-food registry schema");
const mislabeledPatternData = clone(recipeData);
const mislabeledPatternIndex = mislabeledPatternData.recipes.findIndex((recipe) => recipe.audience.patternRequired === true);
mislabeledPatternData.recipes[mislabeledPatternIndex].status = "published";
mislabeledPatternData.recipes[mislabeledPatternIndex].publicVisibility = "published";
const failClosedPatternPublic = publicRecipeBuilder.buildPublicData(mislabeledPatternData, catalogData);
assert(!failClosedPatternPublic.recipes[mislabeledPatternIndex].bundle.ingredients, "public builder released a pattern-specific draft through status relabeling");
assert.strictEqual(recipeSafety.getPublishableRecipes(
  recipeData.recipes, catalogData.ingredients, recipeData.targets, recipeData.externalFoods, recipeData.sources
).length, 0, "unreviewed P3 drafts must not become publishable");
assert.strictEqual(diabetesTarget.availability, "draft_under_review", "type 2 diabetes target must remain under review");
assert.strictEqual(hyperlipidemiaTarget.availability, "withheld_pattern_required", "pattern-specific hyperlipidemia plans must remain withheld");
assert.strictEqual(hypertensionTarget.availability, "withheld_pattern_required", "pattern-specific hypertension plans must remain withheld");

const blackBeanSoup = byId.get("black-bean-huangqi-goji-soup");
assert(blackBeanSoup, "black bean, Huangqi and goji soup draft is missing");
assert.strictEqual(blackBeanSoup.sourceLocator.page, "第59页（PDF物理页第61页）", "black bean soup page locator drifted");
assert.deepStrictEqual(
  blackBeanSoup.bundle.ingredients.map((line) => `${line.sourceName}:${line.quantity.rawText}`),
  ["黄芪:10g", "黑豆:10g", "枸杞子:10g", "生姜:3g", "清水:原文未给量", "食盐:适量"],
  "black bean soup source quantities drifted"
);
assert.strictEqual(blackBeanSoup.bundle.steps.length, 1, "black bean soup must not invent extra timings or water amounts");
assert(!blackBeanSoup.bundle.steps[0].text.includes("分钟"), "black bean soup invented a cooking duration");
assert(blackBeanSoup.historicNotes.some((note) => note.includes("历史备注")), "historical Huangqi note was lost");
assert(blackBeanSoup.guideContext.originalTarget.includes("其他类型"), "guide source scope was narrowed to the product entry target");
assert.deepStrictEqual(blackBeanSoup.bundle.ingredients[0].identitySourceIds, ["nhc-announcement-2023-9"], "Huangqi identity source was not separated from its quantity source");
assert.strictEqual(blackBeanSoup.bundle.ingredients[2].identityReviewState, "pending", "goji part must remain unresolved until an identity source is reviewed");

const stewedHen = byId.get("angelica-codonopsis-stewed-hen");
assert(stewedHen, "Angelica and Codonopsis stewed hen draft is missing");
assert.deepStrictEqual(
  stewedHen.bundle.ingredients.slice(0, 3).map((line) => `${line.sourceName}:${line.quantity.rawText}`),
  ["当归:12g", "党参:20g", "母鸡:1只"],
  "stewed hen source quantities drifted"
);
assert(stewedHen.sourceLocator.page.includes("PDF物理页第61页"), "stewed hen PDF locator is missing");
assert(stewedHen.sourceIds.includes("nhc-announcement-2019-8"), "Angelica restriction source was not attached to the whole-recipe review record");
assert(recipeSafety.recipeTechnicalChecks(stewedHen).some((code) => code.startsWith("regulatory_usage_conflict:line-angelica")), "Angelica seasoning-only conflict must keep the whole recipe withheld");

const patternDrafts = recipeData.recipes.filter((recipe) => recipe.audience.patternRequired === true);
assert.strictEqual(patternDrafts.length, 3, "exactly three source-entered recipes must remain behind professional pattern confirmation");
assert(patternDrafts.every((recipe) => recipe.audience.patternConfirmationPolicy === "professional_confirmation_required"), "pattern-specific drafts lost their professional confirmation policy");
assert(patternDrafts.every((recipe) => recipeSafety.recipeTechnicalChecks(recipe).includes("pattern_gate_unsupported")), "a pattern-specific draft bypassed the unsupported pattern gate");

const angelicaHuangqiSoup = byId.get("angelica-huangqi-chicken-soup");
assert(angelicaHuangqiSoup, "Angelica and Huangqi chicken soup draft is missing");
assert.deepStrictEqual(angelicaHuangqiSoup.audience.allowedPatterns, ["气虚血瘀型"], "Angelica and Huangqi chicken soup pattern drifted");
assert.strictEqual(angelicaHuangqiSoup.sourceLocator.page, "第37–38页（PDF物理页第39–40页）", "Angelica and Huangqi chicken soup locator drifted");
assert.deepStrictEqual(
  angelicaHuangqiSoup.bundle.ingredients.map((line) => `${line.sourceName}:${line.quantity.rawText}`),
  ["当归:10g", "黄芪:6g", "生姜:2片", "鸡肉:50g", "水:适量", "食盐:略微加盐"],
  "Angelica and Huangqi chicken soup source quantities drifted"
);
assert.strictEqual(angelicaHuangqiSoup.bundle.frequencyText, "", "Angelica and Huangqi chicken soup invented a daily frequency");
assert.strictEqual(angelicaHuangqiSoup.bundle.courseText, "可食用7～10天。", "Angelica and Huangqi chicken soup course drifted");
assert(angelicaHuangqiSoup.historicNotes.some((note) => note.includes("山药10g或人参（人工种植≤5年）3g")), "source-authorized Huangqi substitution note drifted");
assert(angelicaHuangqiSoup.safety.cautionConditions.includes("气火亢盛所致面赤眼干等症状"), "source caution was lost or changed into a hard prohibition");
assert.deepStrictEqual(angelicaHuangqiSoup.safety.avoidConditions, [], "source caution was incorrectly promoted to an absolute prohibition");
const changedPatternRecipe = clone(angelicaHuangqiSoup);
changedPatternRecipe.audience.allowedPatterns = ["肝肾阴虚型"];
assert.notStrictEqual(expectedRecipeBundleDigest(changedPatternRecipe), expectedRecipeBundleDigest(angelicaHuangqiSoup), "pattern boundary was not bound into the recipe digest");

const gojiSesameCake = byId.get("goji-sesame-vegetable-cake");
assert(gojiSesameCake, "goji sesame vegetable cake draft is missing");
assert.deepStrictEqual(gojiSesameCake.audience.allowedPatterns, ["肝肾阴虚型"], "goji sesame vegetable cake pattern drifted");
assert.strictEqual(gojiSesameCake.sourceLocator.page, "第38–39页（PDF物理页第40–41页）", "goji sesame vegetable cake locator drifted");
assert.deepStrictEqual(
  gojiSesameCake.bundle.ingredients.slice(0, 6).map((line) => `${line.sourceName}:${line.quantity.rawText}`),
  ["枸杞子:5g", "黑芝麻:2g", "枸杞叶:10g", "糯米粉:50g", "粳米粉:50g", "鸡蛋液:20g"],
  "goji sesame vegetable cake main source quantities drifted"
);
assert(gojiSesameCake.bundle.ingredients.slice(6).every((line) => line.quantity.rawText === "原文未给量"), "unquantified supporting ingredients were assigned invented amounts");
assert.strictEqual(gojiSesameCake.bundle.frequencyText, "", "goji sesame vegetable cake invented a daily frequency");
assert.strictEqual(gojiSesameCake.bundle.courseText, "可食用7～10天。", "goji sesame vegetable cake course drifted");
assert(gojiSesameCake.historicNotes.some((note) => note.includes("枸杞叶用其他绿色蔬菜代替")), "the only source-authorized substitution note was lost");
assert.deepStrictEqual(gojiSesameCake.safety.cautionConditions, ["脾虚厌食", "腹胀消化不良"], "goji sesame vegetable cake cautions drifted");

const celeryCongee = byId.get("hypertension-liver-fire-appendix-celery-congee");
assert(celeryCongee, "hypertension appendix celery congee draft is missing");
assert.deepStrictEqual(celeryCongee.audience.allowedPatterns, ["肝火上炎证"], "hypertension appendix celery congee pattern drifted");
assert.strictEqual(celeryCongee.sourceLocator.page, "第51页（PDF物理页第53页）", "hypertension appendix celery congee locator drifted");
assert.deepStrictEqual(
  celeryCongee.bundle.ingredients.map((line) => `${line.sourceName}:${line.quantity.rawText}`),
  ["芹菜:50g", "粳米:50g", "枸杞子:10g", "猪瘦肉:20g"],
  "hypertension appendix celery congee was mixed with the same-name regional menu item"
);
assert.strictEqual(celeryCongee.bundle.steps.length, 1, "hypertension appendix celery congee invented extra cooking steps");
assert(!celeryCongee.bundle.steps[0].text.includes("适量水"), "hypertension appendix celery congee invented a water amount");
assert.strictEqual(celeryCongee.bundle.frequencyText, "", "hypertension appendix celery congee invented a frequency");
assert.strictEqual(celeryCongee.bundle.courseText, "", "hypertension appendix celery congee invented a course");
assert(celeryCongee.historicNotes.some((note) => note.includes("粳米40g") && note.includes("不含枸杞子")), "same-name regional menu isolation note was lost");

for (const recipe of recipeData.recipes) {
  assert.strictEqual(recipe.status, "draft", `${recipe.id} must remain draft before human review`);
  assert.strictEqual(recipe.publicVisibility, "withheld", `${recipe.id} draft leaked into public visibility`);
  assert.strictEqual(recipe.bundle.atomic, true, `${recipe.id} is not atomic`);
  assert.strictEqual(recipe.bundle.omissionPolicy, "forbidden", `${recipe.id} allows omissions`);
  assert.strictEqual(recipe.bundle.substitutionPolicy, "forbidden", `${recipe.id} allows substitutions`);
  assert.strictEqual(recipe.bundle.scalingPolicy, "forbidden", `${recipe.id} allows scaling`);
  assert(recipe.bundle.ingredients.every((line) => line.required === true), `${recipe.id} has an optional recipe line`);
  assert(recipeSafety.recipeTechnicalChecks(recipe).length > 0, `${recipe.id} unexpectedly passed release gates`);
}

const blackBeanExternalFailures = recipeSafety.recipeTechnicalChecks(
  blackBeanSoup, catalogData.ingredients, recipeData.targets, recipeData.externalFoods
);
assert(blackBeanExternalFailures.includes("external_food_not_reviewed:line-black-bean"), "pending black-bean external food did not block the recipe");
const missingExternalRegistry = clone(recipeData.externalFoods);
missingExternalRegistry.items = missingExternalRegistry.items.filter((food) => food.id !== "external-food-black-bean");
missingExternalRegistry.count = missingExternalRegistry.items.length;
assert(recipeSafety.recipeTechnicalChecks(blackBeanSoup, catalogData.ingredients, recipeData.targets, missingExternalRegistry)
  .includes("external_food_missing:line-black-bean"), "missing external food did not fail closed");
const collisionCatalog = catalogData.ingredients.concat([{ ...clone(recipeData.externalFoods.items[0]), recordKind: undefined }]);
assert(recipeSafety.recipeTechnicalChecks(blackBeanSoup, collisionCatalog, recipeData.targets, recipeData.externalFoods)
  .includes("ingredient_identity_ambiguous:line-black-bean"), "cross-registry ID collision did not fail closed");
const staleExternalVersionRecipe = clone(blackBeanSoup);
staleExternalVersionRecipe.bundle.ingredients.find((line) => line.lineId === "line-black-bean").ingredientContentVersion = "stale-external-food-version";
assert(recipeSafety.recipeTechnicalChecks(staleExternalVersionRecipe, catalogData.ingredients, recipeData.targets, recipeData.externalFoods)
  .includes("external_food_version_mismatch:line-black-bean"), "stale external-food content version did not fail closed");
const driftedExternalRegistry = clone(recipeData.externalFoods);
driftedExternalRegistry.items.find((food) => food.id === "external-food-black-bean").contentVersion = "self-declared-drifted-version";
assert(recipeSafety.recipeTechnicalChecks(blackBeanSoup, catalogData.ingredients, recipeData.targets, driftedExternalRegistry)
  .includes("ingredient_registry_invalid:line-black-bean"), "external record self-declared a version different from its registry and passed");

const blankEvaluation = recipeSafety.evaluateRecipe(blackBeanSoup, {}, { diagnosisConfirmed: true });
assert.strictEqual(blankEvaluation.status, "documentation_only", "draft recipe must be documentation-only");
assert.strictEqual(blankEvaluation.lineResults.length, 0, "draft recipe must not enter line-level execution");
const pregnancyEvaluation = recipeSafety.evaluateRecipe(blackBeanSoup, {
  ageGroup: "adult", pregnancy: "yes", breastfeeding: "no",
  allergyStatus: "no", conditionStatus: "no", medicationStatus: "no"
}, { diagnosisConfirmed: true });
assert.strictEqual(pregnancyEvaluation.status, "blocked", "a known whole-recipe population stop must outrank draft documentation status");
assert(pregnancyEvaluation.reasonCodes.includes("pregnancy_not_suitable"), "whole-recipe pregnancy stop lost its explanation");
const interactionEvaluation = recipeSafety.evaluateRecipe(stewedHen, {
  ageGroup: "adult", pregnancy: "no", breastfeeding: "no",
  allergyStatus: "no", conditionStatus: "no", medicationStatus: "yes", medications: ["藜芦"]
}, { diagnosisConfirmed: true });
assert.strictEqual(interactionEvaluation.status, "blocked", "a direct whole-recipe interaction must outrank draft documentation status");
assert(interactionEvaluation.reasonCodes.includes("recipe_interaction_match"), "whole-recipe interaction stop lost its explanation");
const missingAllergyDetailsProfile = sessionProfile.fromSession({
  ageGroup: "adult", pregnancyStatus: "no", breastfeedingStatus: "no",
  allergyStatus: "yes", conditionStatus: "no", medicationStatus: "no",
  riskFlags: ["known_allergy"], allergies: [], conditions: [], medications: []
});
assert.deepStrictEqual(missingAllergyDetailsProfile.allergies, [], "missing allergy details must not be replaced by a matchable placeholder");
assert.strictEqual(missingAllergyDetailsProfile.conditionStatus, "no", "an allergy flag must not rewrite an explicit condition=no answer");
const missingAllergyEvaluation = recipeSafety.evaluateRecipe(blackBeanSoup, missingAllergyDetailsProfile, { diagnosisConfirmed: true });
assert.strictEqual(missingAllergyEvaluation.status, "blocked", "known allergy without details must outrank draft documentation status");
assert(missingAllergyEvaluation.reasonCodes.includes("allergy_details_required"), "missing allergy detail stop lost its explanation");

const fixture = releaseReadyFixture(blackBeanSoup);
const fixtureTargets = [{ id: fixture.recipe.targetId, availability: "reference_available" }];
assert.deepStrictEqual(recipeSafety.recipeTechnicalChecks(fixture.recipe, fixture.catalog, fixtureTargets), [], "release-ready fixture did not pass runtime technical gates");
const missingIngredientReviewerCatalog = clone(fixture.catalog);
missingIngredientReviewerCatalog[0].audit.reviews = missingIngredientReviewerCatalog[0].audit.reviews.filter((review) => review.role !== "pharmacist");
assert(recipeSafety.recipeTechnicalChecks(fixture.recipe, missingIngredientReviewerCatalog, fixtureTargets)
  .some((failure) => failure.startsWith("ingredient_not_reviewed:")), "ingredient review passed without the pharmacist record");
const duplicateIngredientReviewCatalog = clone(fixture.catalog);
duplicateIngredientReviewCatalog[0].audit.reviews[1].reviewId = duplicateIngredientReviewCatalog[0].audit.reviews[0].reviewId;
assert(recipeSafety.recipeTechnicalChecks(fixture.recipe, duplicateIngredientReviewCatalog, fixtureTargets)
  .some((failure) => failure.startsWith("ingredient_not_reviewed:")), "ingredient review passed with duplicate professional record IDs");
const staleIngredientRuleCatalog = clone(fixture.catalog);
staleIngredientRuleCatalog[0].audit.reviews[0].rulesVersion = "0.9.0";
assert(recipeSafety.recipeTechnicalChecks(fixture.recipe, staleIngredientRuleCatalog, fixtureTargets)
  .some((failure) => failure.startsWith("ingredient_not_reviewed:")), "ingredient review bound to a stale rule version passed runtime gates");
const withdrawnIngredientSourceCatalog = clone(fixture.catalog);
const withdrawnIngredientSourceId = withdrawnIngredientSourceCatalog[0].safety.sourceIds[0];
withdrawnIngredientSourceCatalog[0].sources.find((source) => source.id === withdrawnIngredientSourceId).status = "withdrawn";
assert(recipeSafety.recipeTechnicalChecks(fixture.recipe, withdrawnIngredientSourceCatalog, fixtureTargets)
  .some((failure) => failure.startsWith("ingredient_not_reviewed:")), "ingredient review citing a withdrawn source passed runtime gates");
const runtimeOnlyFixtureData = {
  schemaVersion: recipeData.schemaVersion, contentVersion: recipeData.contentVersion,
  publishedAt: recipeData.publishedAt, sources: fixture.recipe.sources,
  targets: fixtureTargets, recipes: [fixture.recipe], count: 1,
  externalFoods: {
    schemaVersion: recipeData.externalFoods.schemaVersion,
    contentVersion: recipeData.externalFoods.contentVersion,
    publishedAt: recipeData.externalFoods.publishedAt,
    items: [], count: 0
  }
};
const digestMismatchPublic = publicRecipeBuilder.buildPublicData(runtimeOnlyFixtureData, { ingredients: fixture.catalog });
assert(!digestMismatchPublic.recipes[0].bundle.ingredients, "public builder released a runtime-valid recipe whose digests did not match actual content");
const signedRecipe = clone(fixture.recipe);
const signedCatalog = clone(fixture.catalog);
signedRecipe.bundle.ingredients.forEach((line) => {
  const ingredient = signedCatalog.find((item) => item.id === line.ingredientId);
  const digest = expectedIngredientSnapshotDigest(ingredient);
  ingredient.audit.ingredientDigest = digest;
  ingredient.audit.reviews.forEach((review) => { review.ingredientDigest = digest; });
  line.ingredientSnapshotDigest = digest;
});
signedRecipe.bundle.sourceTextDigest = expectedRecipeSourceTextDigest(signedRecipe);
signedRecipe.bundle.bundleDigest = expectedRecipeBundleDigest(signedRecipe);
signedRecipe.audit.reviews.forEach((review) => {
  review.bundleDigest = signedRecipe.bundle.bundleDigest;
  review.sourceTextDigest = signedRecipe.bundle.sourceTextDigest;
});
const signedFixtureData = {
  ...runtimeOnlyFixtureData,
  recipes: [signedRecipe]
};
assert.deepStrictEqual(recipeSafety.recipeTechnicalChecks(signedRecipe, signedCatalog, fixtureTargets), [], "digest-bound professional fixture did not pass runtime gates");
const signedPublic = publicRecipeBuilder.buildPublicData(signedFixtureData, { ingredients: signedCatalog });
assert(Array.isArray(signedPublic.recipes[0].bundle.ingredients), "fully signed and digest-bound fixture was not released by the public builder");
const privateSignedFixtureData = clone(signedFixtureData);
privateSignedFixtureData.privateCatalogEvidence = "LEAK_SENTINEL";
privateSignedFixtureData.targets[0].privateTarget = "LEAK_SENTINEL";
privateSignedFixtureData.recipes[0].privateRecipe = "LEAK_SENTINEL";
const privateSignedPublic = publicRecipeBuilder.buildPublicData(privateSignedFixtureData, { ingredients: signedCatalog });
assert(!JSON.stringify(privateSignedPublic).includes("LEAK_SENTINEL") &&
  Array.isArray(privateSignedPublic.recipes[0].bundle.ingredients),
"strict projection lost a release-ready recipe or leaked an unknown signed-fixture field");
assert.strictEqual(privateSignedPublic.recipes[0].bundle.bundleDigest, signedPublic.recipes[0].bundle.bundleDigest,
  "strict signed-recipe projection drifted the bundle digest");
assert.strictEqual(privateSignedPublic.recipes[0].bundle.sourceTextDigest, signedPublic.recipes[0].bundle.sourceTextDigest,
  "strict signed-recipe projection drifted the source-text digest");
const externalRecipe = clone(signedRecipe);
const externalCatalog = clone(signedCatalog);
const externalLine = externalRecipe.bundle.ingredients[0];
const originalExternalizedId = externalLine.ingredientId;
const externalRecordIndex = externalCatalog.findIndex((ingredient) => ingredient.id === originalExternalizedId);
const externalRecord = externalCatalog.splice(externalRecordIndex, 1)[0];
externalRecord.id = "external-food-fixture-reviewed";
externalRecord.recordKind = "external_food";
externalRecord.contentVersion = recipeData.externalFoods.contentVersion;
externalRecord.category = "ordinary_food_candidate";
["order", "pinyin", "batch", "tags", "goals", "usageTypes", "sensory", "traditional"].forEach((field) => delete externalRecord[field]);
externalRecord.regulatory.kind = "ordinary_food";
externalRecord.regulatory.status = "ordinary_food";
externalRecord.identity = {
  ediblePart: externalRecord.identity.ediblePart || "Fixture edible form",
  partReviewState: "reviewed",
  sourceIds: []
};
externalRecord.regulatory = {
  kind: "ordinary_food",
  status: "ordinary_food",
  currentCatalogReviewState: "reviewed",
  restrictionCode: "",
  restriction: "",
  sourceIds: []
};
externalRecord.foodUse = {
  commonForms: [],
  mappingReviewState: "reviewed",
  sourceIds: []
};
externalRecord.safety = {
  sourceIds: [],
  pregnancy: externalRecord.safety.pregnancy || "unknown",
  breastfeeding: externalRecord.safety.breastfeeding || "unknown",
  infantsToddlers: externalRecord.safety.infantsToddlers || "unknown",
  children: externalRecord.safety.children || "unknown",
  olderAdults: externalRecord.safety.olderAdults || "unknown",
  allergenKeys: externalRecord.safety.allergenKeys || [],
  avoidConditions: externalRecord.safety.avoidConditions || [],
  cautionConditions: externalRecord.safety.cautionConditions || [],
  drugInteractions: externalRecord.safety.drugInteractions || [],
  preparationWarnings: externalRecord.safety.preparationWarnings || [],
  allergenReviewState: "reviewed",
  conditionReviewState: "reviewed",
  interactionReviewState: "reviewed",
  preparationReviewState: "reviewed"
};
externalRecord.audit = {
  occurrenceReviewState: "source_checked",
  sourceCheckState: "checked",
  professionalReviewState: "reviewed",
  reviewedBy: INGREDIENT_REVIEW_ROLES.slice(),
  reviewedAt: "2026-08-09",
  ingredientDigest: VALID_DIGEST,
  reviews: externalRecord.audit.reviews,
  releaseStage: "reviewed_fixture",
  note: "Private fixture note"
};
const externalDirectSource = {
  id: "fixture-external-direct-source",
  status: "published",
  type: "fixture_direct_evidence",
  title: "Fixture ordinary-food identity, regulation, use and safety source",
  publisher: "Fixture standards issuer",
  url: "https://example.test/external-food-direct-evidence",
  publishedAt: "2026-08-01",
  checkedAt: "2026-08-09"
};
const occurrenceSource = clone(externalRecipe.sources.find((source) => source.id === externalRecipe.formulaSourceId));
externalRecord.sources = [occurrenceSource, externalDirectSource];
externalRecipe.sources = externalRecipe.sources.filter((source) => source.id !== externalDirectSource.id).concat([externalDirectSource]);
externalRecord.occurrenceFormText = "Fixture formula occurrence form";
externalRecord.occurrenceEvidence = [{
  recipeId: externalRecipe.id,
  lineId: externalLine.lineId,
  sourceId: externalRecipe.formulaSourceId,
  claimScope: "formula_occurrence_and_quantity_only"
}];
externalRecord.identity.sourceIds = [externalDirectSource.id];
externalRecord.regulatory.sourceIds = [externalDirectSource.id];
externalRecord.foodUse.sourceIds = [externalDirectSource.id];
externalRecord.safety.sourceIds = [externalDirectSource.id];
externalRecord.audit.occurrenceReviewState = "source_checked";
externalRecord.audit.reviews.forEach((review) => { review.contentVersion = recipeData.externalFoods.contentVersion; });
externalLine.ingredientRegistry = "external_food";
externalLine.ingredientId = externalRecord.id;
externalLine.ingredientContentVersion = recipeData.externalFoods.contentVersion;
externalLine.identitySourceIds = [externalDirectSource.id];
externalRecord.audit.ingredientDigest = expectedExternalFoodSnapshotDigest(externalRecord);
externalRecord.audit.reviews.forEach((review) => { review.ingredientDigest = externalRecord.audit.ingredientDigest; });
externalLine.ingredientSnapshotDigest = externalRecord.audit.ingredientDigest;
externalRecipe.bundle.bundleDigest = expectedRecipeBundleDigest(externalRecipe);
externalRecipe.bundle.sourceTextDigest = expectedRecipeSourceTextDigest(externalRecipe);
externalRecipe.audit.reviews.forEach((review) => {
  review.bundleDigest = externalRecipe.bundle.bundleDigest;
  review.sourceTextDigest = externalRecipe.bundle.sourceTextDigest;
});
const reviewedExternalRegistry = {
  schemaVersion: recipeData.externalFoods.schemaVersion,
  contentVersion: recipeData.externalFoods.contentVersion,
  publishedAt: recipeData.externalFoods.publishedAt,
  items: [externalRecord],
  count: 1
};
assert.deepStrictEqual(recipeSafety.recipeTechnicalChecks(externalRecipe, externalCatalog, fixtureTargets, reviewedExternalRegistry), [],
  "reviewed external food did not pass the unified runtime material gate");
const externalFixtureData = {
  ...runtimeOnlyFixtureData,
  sources: externalRecipe.sources,
  externalFoods: reviewedExternalRegistry,
  recipes: [externalRecipe]
};
const externalPublic = publicRecipeBuilder.buildPublicData(externalFixtureData, { ingredients: externalCatalog });
assert(Array.isArray(externalPublic.recipes[0].bundle.ingredients), "fully reviewed external food did not allow its signed fixture recipe");
assert.strictEqual(externalPublic.externalFoods.count, 1, "public builder did not include exactly the external food referenced by a released recipe");
assert(Array.isArray(externalPublic.externalFoods.items[0].occurrenceEvidence) && !externalPublic.externalFoods.items[0].audit.note,
  "public builder lost digest-bound occurrence provenance or leaked a private reviewer note");
assert.strictEqual(expectedExternalFoodSnapshotDigest(externalPublic.externalFoods.items[0]), externalPublic.externalFoods.items[0].audit.ingredientDigest,
  "public external-food trimming invalidated the signed material digest");
const privateExternalHeaderFixtureData = clone(externalFixtureData);
privateExternalHeaderFixtureData.externalFoods.privateHeader = "LEAK_SENTINEL";
assert(!JSON.stringify(publicRecipeBuilder.buildPublicData(privateExternalHeaderFixtureData, { ingredients: externalCatalog }))
  .includes("LEAK_SENTINEL"), "unknown external-food registry header leaked into the public artifact");
for (const field of ["contentVersion", "publishedAt"]) {
  const malformedExternalHeaderFixtureData = clone(externalFixtureData);
  malformedExternalHeaderFixtureData.externalFoods[field] = { secret: "LEAK_SENTINEL" };
  assert.throws(() => publicRecipeBuilder.buildPublicData(malformedExternalHeaderFixtureData, { ingredients: externalCatalog }),
    /Invalid external-food registry structure|must be/, `object-valued external-food ${field} passed the public builder`);
}
const driftedDirectRecipe = clone(externalRecipe);
driftedDirectRecipe.sources.find((source) => source.id === externalDirectSource.id).title += " drifted";
assert(recipeSafety.recipeTechnicalChecks(
  driftedDirectRecipe, externalCatalog, fixtureTargets, reviewedExternalRegistry, externalFixtureData.sources
).includes("source_registry_invalid"), "same-ID direct-source metadata drift passed the runtime canonical registry gate");
const driftedDirectFixtureData = clone(externalFixtureData);
driftedDirectFixtureData.recipes = [driftedDirectRecipe];
const driftedDirectPublic = publicRecipeBuilder.buildPublicData(driftedDirectFixtureData, { ingredients: externalCatalog });
assert(!driftedDirectPublic.recipes[0].bundle.ingredients && driftedDirectPublic.externalFoods.count === 0,
  "same-ID direct-source metadata drift passed the public builder");
const linePromotedOccurrenceRecipe = clone(externalRecipe);
linePromotedOccurrenceRecipe.bundle.ingredients[0].identitySourceIds = [externalRecipe.formulaSourceId];
linePromotedOccurrenceRecipe.bundle.bundleDigest = expectedRecipeBundleDigest(linePromotedOccurrenceRecipe);
linePromotedOccurrenceRecipe.audit.reviews.forEach((review) => {
  review.bundleDigest = linePromotedOccurrenceRecipe.bundle.bundleDigest;
});
assert(recipeSafety.recipeTechnicalChecks(
  linePromotedOccurrenceRecipe, externalCatalog, fixtureTargets, reviewedExternalRegistry, externalFixtureData.sources
).includes(`external_food_identity_binding_invalid:${externalLine.lineId}`),
"a formula occurrence-only source was accepted as line-level external-food identity evidence");
const privateAuditFixtureData = clone(externalFixtureData);
privateAuditFixtureData.externalFoods.items[0].audit.privateUnpublishedEvidence = { secret: "must-not-ship" };
assert.throws(() => publicRecipeBuilder.buildPublicData(privateAuditFixtureData, { ingredients: externalCatalog }),
  /Invalid external-food registry structure/, "unknown private audit data entered the public builder");
const defenseProjectedFood = publicRecipeBuilder.sanitizePublishedExternalFood(
  privateAuditFixtureData.externalFoods.items[0], new Set([`${externalRecipe.id}/${externalLine.lineId}`])
);
assert(!Object.prototype.hasOwnProperty.call(defenseProjectedFood.audit, "privateUnpublishedEvidence"),
  "external-food public projection copied an unknown private audit field");
const duplicateRecipeSource = clone(externalRecipe);
duplicateRecipeSource.sources.push(clone(duplicateRecipeSource.sources[0]));
assert(recipeSafety.recipeTechnicalChecks(
  duplicateRecipeSource, externalCatalog, fixtureTargets, reviewedExternalRegistry, externalFixtureData.sources
).includes("source_registry_invalid"), "duplicate recipe source IDs passed the runtime gate");
const missingRegistryRecipe = clone(externalRecipe);
delete missingRegistryRecipe.bundle.ingredients[0].ingredientRegistry;
missingRegistryRecipe.bundle.bundleDigest = expectedRecipeBundleDigest(missingRegistryRecipe);
missingRegistryRecipe.audit.reviews.forEach((review) => { review.bundleDigest = missingRegistryRecipe.bundle.bundleDigest; });
const missingRegistryData = clone(externalFixtureData);
missingRegistryData.recipes = [missingRegistryRecipe];
assert.throws(() => publicRecipeBuilder.buildPublicData(missingRegistryData, { ingredients: externalCatalog }),
  /occurrence evidence does not exactly match/, "schema 1.1 recipe line without ingredientRegistry passed the public builder");
const invalidCategoryData = clone(externalFixtureData);
invalidCategoryData.externalFoods.items[0].category = "ordinary_food";
assert.throws(() => publicRecipeBuilder.buildPublicData(invalidCategoryData, { ingredients: externalCatalog }),
  /Invalid external-food registry structure/, "invalid external-food category passed the public builder");
const countDriftData = clone(externalFixtureData);
countDriftData.externalFoods.count = 2;
assert.throws(() => publicRecipeBuilder.buildPublicData(countDriftData, { ingredients: externalCatalog }),
  /Invalid external-food registry structure/, "external-food registry count drift passed the public builder");
const unknownSourceFieldData = clone(externalFixtureData);
unknownSourceFieldData.externalFoods.items[0].sources[0].unreviewedExtra = "not signed";
assert.throws(() => publicRecipeBuilder.buildPublicData(unknownSourceFieldData, { ingredients: externalCatalog }),
  /Invalid external-food registry structure/, "unknown source metadata passed the public builder");
const promotedOccurrenceRegistry = clone(reviewedExternalRegistry);
const promotedOccurrenceRecord = promotedOccurrenceRegistry.items[0];
for (const group of [promotedOccurrenceRecord.identity, promotedOccurrenceRecord.regulatory, promotedOccurrenceRecord.foodUse, promotedOccurrenceRecord.safety]) {
  group.sourceIds = [externalRecipe.formulaSourceId];
}
promotedOccurrenceRecord.audit.ingredientDigest = expectedExternalFoodSnapshotDigest(promotedOccurrenceRecord);
promotedOccurrenceRecord.audit.reviews.forEach((review) => { review.ingredientDigest = promotedOccurrenceRecord.audit.ingredientDigest; });
const promotedOccurrenceRecipe = clone(externalRecipe);
promotedOccurrenceRecipe.bundle.ingredients[0].identitySourceIds = [externalRecipe.formulaSourceId];
promotedOccurrenceRecipe.bundle.ingredients[0].ingredientSnapshotDigest = promotedOccurrenceRecord.audit.ingredientDigest;
promotedOccurrenceRecipe.bundle.bundleDigest = expectedRecipeBundleDigest(promotedOccurrenceRecipe);
promotedOccurrenceRecipe.audit.reviews.forEach((review) => { review.bundleDigest = promotedOccurrenceRecipe.bundle.bundleDigest; });
assert(recipeSafety.recipeTechnicalChecks(promotedOccurrenceRecipe, externalCatalog, fixtureTargets, promotedOccurrenceRegistry)
  .includes(`external_food_not_reviewed:${externalLine.lineId}`),
"a formula occurrence source was promoted into direct identity/regulatory/use/safety evidence");
const wrongOccurrenceRegistry = clone(reviewedExternalRegistry);
wrongOccurrenceRegistry.items[0].occurrenceEvidence[0].lineId = "different-line";
assert(recipeSafety.recipeTechnicalChecks(externalRecipe, externalCatalog, fixtureTargets, wrongOccurrenceRegistry)
  .includes(`external_food_occurrence_binding_invalid:${externalLine.lineId}`),
"an external food occurrence bound to a different recipe line passed runtime gates");
const driftedOccurrenceSourceRegistry = clone(reviewedExternalRegistry);
driftedOccurrenceSourceRegistry.items[0].sources.find((source) => source.id === externalRecipe.formulaSourceId).url = "https://example.test/different-formula-source";
assert(recipeSafety.recipeTechnicalChecks(externalRecipe, externalCatalog, fixtureTargets, driftedOccurrenceSourceRegistry)
  .includes(`external_food_occurrence_binding_invalid:${externalLine.lineId}`),
"an external occurrence source with a reused ID but different canonical metadata passed runtime gates");
const unsupportedRuntimeExternalSchema = clone(reviewedExternalRegistry);
unsupportedRuntimeExternalSchema.schemaVersion = "999.0.0";
assert(recipeSafety.recipeTechnicalChecks(externalRecipe, externalCatalog, fixtureTargets, unsupportedRuntimeExternalSchema)
  .includes(`ingredient_registry_invalid:${externalLine.lineId}`),
"runtime accepted an unknown external-food registry schema");
const unrelatedExternal = clone(externalRecord);
unrelatedExternal.id = "external-food-unreferenced-reviewed";
unrelatedExternal.audit.ingredientDigest = expectedExternalFoodSnapshotDigest(unrelatedExternal);
unrelatedExternal.audit.reviews.forEach((review) => { review.ingredientDigest = unrelatedExternal.audit.ingredientDigest; });
const extraExternalFixtureData = clone(externalFixtureData);
extraExternalFixtureData.externalFoods.items.push(unrelatedExternal);
extraExternalFixtureData.externalFoods.count = 2;
assert.throws(() => publicRecipeBuilder.buildPublicData(extraExternalFixtureData, { ingredients: externalCatalog }),
  /occurrence evidence does not exactly match/, "public builder accepted an unreferenced external-food evidence record");
const changedExternalFixtureData = clone(externalFixtureData);
changedExternalFixtureData.externalFoods.items[0].name = `${changedExternalFixtureData.externalFoods.items[0].name}-changed-after-review`;
const changedExternalPublic = publicRecipeBuilder.buildPublicData(changedExternalFixtureData, { ingredients: externalCatalog });
assert(!changedExternalPublic.recipes[0].bundle.ingredients && changedExternalPublic.externalFoods.count === 0,
  "external-food content drift retained a released recipe or public registry row");
const changedIngredientCatalog = clone(signedCatalog);
changedIngredientCatalog[0].name = `${changedIngredientCatalog[0].name}-changed-after-review`;
const contentDriftPublic = publicRecipeBuilder.buildPublicData(signedFixtureData, { ingredients: changedIngredientCatalog });
assert(!contentDriftPublic.recipes[0].bundle.ingredients, "ingredient content changed after review but retained public recipe access");
const completeAdultProfile = {
  ageGroup: "adult", pregnancy: "no", breastfeeding: "no",
  allergyStatus: "no", conditionStatus: "no", medicationStatus: "no"
};
const readyEvaluation = recipeSafety.evaluateRecipe(fixture.recipe, completeAdultProfile, {
  diagnosisConfirmed: true, catalog: fixture.catalog, targets: fixtureTargets
});
assert.strictEqual(readyEvaluation.status, "viewable", "release-ready fixture was not viewable after all confirmations");
const missingDiagnosisRecipe = clone(fixture.recipe);
delete missingDiagnosisRecipe.audience;
assert(recipeSafety.recipeTechnicalChecks(missingDiagnosisRecipe, fixture.catalog, fixtureTargets).includes("audience_gate_missing"), "missing audience gate did not stop publication");
const missingDiagnosisEvaluation = recipeSafety.evaluateRecipe(missingDiagnosisRecipe, completeAdultProfile, {
  diagnosisConfirmed: false, catalog: fixture.catalog, targets: fixtureTargets
});
assert.notStrictEqual(missingDiagnosisEvaluation.status, "viewable", "missing audience metadata bypassed diagnosis confirmation");
const olderAdultRecipe = clone(fixture.recipe);
olderAdultRecipe.sourceContext.targetAgeGroups = ["older_adult"];
olderAdultRecipe.safety.olderAdults = "no";
const olderAdultEvaluation = recipeSafety.evaluateRecipe(olderAdultRecipe, {
  ...completeAdultProfile, ageGroup: "older_adult"
}, { diagnosisConfirmed: true, catalog: fixture.catalog, targets: fixtureTargets });
assert.strictEqual(olderAdultEvaluation.status, "blocked", "whole-recipe older-adult=no rule was bypassed");
assert(olderAdultEvaluation.reasonCodes.includes("older_adult_not_suitable"), "older-adult stop lost its explanation");
const childAudienceRecipe = clone(fixture.recipe);
childAudienceRecipe.audience.adultOnly = false;
childAudienceRecipe.sourceContext.targetAgeGroups = ["child"];
childAudienceRecipe.safety.children = "yes";
assert(recipeSafety.recipeTechnicalChecks(childAudienceRecipe, fixture.catalog, fixtureTargets).includes("audience_gate_missing"), "non-adult whole-recipe audience bypassed the P3 contract");
const childAudienceEvaluation = recipeSafety.evaluateRecipe(childAudienceRecipe, {
  ...completeAdultProfile, ageGroup: "child"
}, { diagnosisConfirmed: true, catalog: fixture.catalog, targets: fixtureTargets });
assert.notStrictEqual(childAudienceEvaluation.status, "viewable", "child profile became viewable through an adult-only P3 route");
const expiredRecipe = clone(fixture.recipe);
expiredRecipe.audit.nextReviewAt = "2000-01-02";
assert(recipeSafety.recipeTechnicalChecks(expiredRecipe, fixture.catalog, fixtureTargets).includes("final_approval_missing_or_expired"), "expired whole-recipe review passed runtime gates");
const unboundReviewRecipe = clone(fixture.recipe);
unboundReviewRecipe.audit.reviews[0].bundleDigest = `sha256:${"b".repeat(64)}`;
assert(recipeSafety.recipeTechnicalChecks(unboundReviewRecipe, fixture.catalog, fixtureTargets).includes("recipe_reviewer_missing"), "review record not bound to the bundle passed runtime gates");
const staleRulesReviewRecipe = clone(fixture.recipe);
staleRulesReviewRecipe.rulesVersion = "2.0.0";
staleRulesReviewRecipe.audit.reviews.forEach((review) => { review.rulesVersion = "2.0.0"; });
const staleRuleFailures = recipeSafety.recipeTechnicalChecks(staleRulesReviewRecipe, fixture.catalog, fixtureTargets);
assert(staleRuleFailures.includes("rules_version_unsupported"), "an unregistered rules version passed the active runtime");
assert(!staleRuleFailures.includes("recipe_reviewer_missing"), "rules-version fixture did not isolate the runtime support gate");
const missingSafetySourceRecipe = clone(fixture.recipe);
missingSafetySourceRecipe.safety.conditionSourceIds = [];
assert(recipeSafety.recipeTechnicalChecks(missingSafetySourceRecipe, fixture.catalog, fixtureTargets).includes("recipe_safety_source_missing"), "a reviewed safety domain without sources passed runtime gates");
const withdrawnSourceRecipe = clone(fixture.recipe);
withdrawnSourceRecipe.sources.find((source) => source.id === withdrawnSourceRecipe.formulaSourceId).status = "withdrawn";
assert(recipeSafety.recipeTechnicalChecks(withdrawnSourceRecipe, fixture.catalog, fixtureTargets).includes("formula_source_unavailable"), "withdrawn formula source passed runtime gates");
assert(recipeSafety.recipeTechnicalChecks(fixture.recipe, fixture.catalog, [{ id: fixture.recipe.targetId, availability: "draft_under_review" }])
  .includes("target_not_release_ready"), "a non-release-ready target passed runtime gates");
const triageEvaluation = recipeSafety.evaluateRecipe(blackBeanSoup, { redFlags: ["sudden_severe_chest_pain"] }, { diagnosisConfirmed: true });
assert.strictEqual(triageEvaluation.status, "triage_blocked", "red flag must outrank recipe draft status");
assert(triageEvaluation.reasonCodes.includes("red_flag"), "recipe triage must explain its red flag stop");

const fsForRecipeChecker = require("fs");
const pathForRecipeChecker = require("path");
const vmForRecipeChecker = require("vm");
const projectRecipeChecks = require("./check-project");
const checkerExternalTarget = clone(recipeData.targets.find((target) => target.id === externalRecipe.targetId));
checkerExternalTarget.availability = "reference_available";
delete checkerExternalTarget.unavailableReason;
const checkerExternalFixtureData = {
  ...externalFixtureData,
  targets: [checkerExternalTarget],
  count: 1
};
const checkerExternalCatalogData = {
  ...catalogData,
  ingredients: externalCatalog,
  count: externalCatalog.length
};
assert.doesNotThrow(() => projectRecipeChecks.checkRecipeData(checkerExternalFixtureData, checkerExternalCatalogData, ruleSet),
  "the shared reviewed external-food fixture passed runtime/build but failed the static checker");
const checkerDirectSourceDrift = clone(checkerExternalFixtureData);
checkerDirectSourceDrift.recipes[0].sources.find((source) => source.id === externalDirectSource.id).title += " drifted";
assert.throws(() => projectRecipeChecks.checkRecipeData(checkerDirectSourceDrift, checkerExternalCatalogData, ruleSet),
  /canonical top-level source object/, "same-ID direct-source drift passed the static checker");
const checkerIdentityPromotion = clone(checkerExternalFixtureData);
checkerIdentityPromotion.recipes[0].bundle.ingredients[0].identitySourceIds = [externalRecipe.formulaSourceId];
assert.throws(() => projectRecipeChecks.checkRecipeData(checkerIdentityPromotion, checkerExternalCatalogData, ruleSet),
  /direct identity evidence/, "formula occurrence evidence passed the static line identity-source gate");
const checkerDuplicateRecipeSource = clone(checkerExternalFixtureData);
checkerDuplicateRecipeSource.recipes[0].sources.push(clone(checkerDuplicateRecipeSource.recipes[0].sources[0]));
assert.throws(() => projectRecipeChecks.checkRecipeData(checkerDuplicateRecipeSource, checkerExternalCatalogData, ruleSet),
  /duplicate source IDs/, "duplicate embedded recipe source passed the static checker");
const checkerPrivateAuditField = clone(checkerExternalFixtureData);
checkerPrivateAuditField.externalFoods.items[0].audit.privateUnpublishedEvidence = { secret: "must-not-ship" };
assert.throws(() => projectRecipeChecks.checkRecipeData(checkerPrivateAuditField, checkerExternalCatalogData, ruleSet),
  /unsupported field|malformed record/, "unknown private external-food audit data passed the static checker");
const legacySnapshotPath = pathForRecipeChecker.join(__dirname, "version-snapshots", "release-2026.08.11-pattern-recipe-drafts.5.json");
const legacySnapshot = JSON.parse(fsForRecipeChecker.readFileSync(legacySnapshotPath, "utf8"));
function loadLegacySnapshotModule(artifactPath) {
  const artifact = legacySnapshot.artifacts.find((item) => item.path === artifactPath);
  assert(artifact && artifact.contentBase64, `legacy snapshot is missing ${artifactPath}`);
  const snapshotModule = { exports: {} };
  vmForRecipeChecker.runInNewContext(Buffer.from(artifact.contentBase64, "base64").toString("utf8"), {
    module: snapshotModule,
    exports: snapshotModule.exports,
    require
  }, { filename: artifactPath });
  return snapshotModule.exports;
}
const legacyRecipeData = loadLegacySnapshotModule("data/recipes.js");
const legacyPublicRecipeData = loadLegacySnapshotModule("data/recipes-public.js");
const legacyCatalogData = loadLegacySnapshotModule("data/ingredients.js");
const legacyRuleSet = loadLegacySnapshotModule("data/rule-set.js");
assert.doesNotThrow(() => projectRecipeChecks.checkRecipeData(legacyRecipeData, legacyCatalogData, legacyRuleSet),
  "registered schema 1.0.0 release .5 no longer passes the legacy fail-closed checker");
assert.doesNotThrow(() => projectRecipeChecks.checkPublicRecipeData(legacyPublicRecipeData, legacyRecipeData, legacyCatalogData),
  "registered schema 1.0.0 public release .5 no longer passes the legacy fail-closed checker");
const legacyPublishedMutation = clone(legacyRecipeData);
legacyPublishedMutation.recipes[0].status = "published";
legacyPublishedMutation.recipes[0].publicVisibility = "published";
assert.throws(() => projectRecipeChecks.checkRecipeData(legacyPublishedMutation, legacyCatalogData, legacyRuleSet),
  /zero published recipes/, "legacy schema allowed a published recipe");
const legacyUnlockedMutation = clone(legacyRecipeData);
legacyUnlockedMutation.recipes[0].bundle.atomic = false;
assert.throws(() => projectRecipeChecks.checkRecipeData(legacyUnlockedMutation, legacyCatalogData, legacyRuleSet),
  /bundle must be atomic and locked/, "legacy schema allowed an unlocked bundle");
const unknownRecipeSchema = clone(recipeData);
unknownRecipeSchema.schemaVersion = "9.9.9";
assert.throws(() => projectRecipeChecks.checkRecipeData(unknownRecipeSchema, catalogData, ruleSet),
  /Unsupported recipe schemaVersion/, "unknown recipe schemaVersion passed the checker");
const unknownExternalSchema = clone(recipeData);
unknownExternalSchema.externalFoods.schemaVersion = "9.9.9";
assert.throws(() => projectRecipeChecks.checkRecipeData(unknownExternalSchema, catalogData, ruleSet),
  /Unsupported externalFoods schemaVersion/, "unknown externalFoods schemaVersion passed the checker");
const driftedOccurrenceSourceData = clone(recipeData);
const driftedOccurrenceFood = driftedOccurrenceSourceData.externalFoods.items[0];
const driftedOccurrenceSourceId = driftedOccurrenceFood.occurrenceEvidence[0].sourceId;
driftedOccurrenceFood.sources.find((source) => source.id === driftedOccurrenceSourceId).title += " (drifted copy)";
assert.throws(() => projectRecipeChecks.checkRecipeData(driftedOccurrenceSourceData, catalogData, ruleSet),
  /canonical recipe source object/, "same-ID occurrence source object drift passed the checker");

console.log(JSON.stringify({
  recipes: recipeData.count,
  publishableRecipes: recipeSafety.getPublishableRecipes(
    recipeData.recipes, catalogData.ingredients, recipeData.targets, recipeData.externalFoods, recipeData.sources
  ).length,
  diabetesDrafts: recipeData.recipes.filter((recipe) => recipe.targetId === "adult_diabetes").length,
  patternDrafts: patternDrafts.length,
  patternTargetsWithheld: [hyperlipidemiaTarget, hypertensionTarget].filter((target) => target.availability === "withheld_pattern_required").length,
  projectionLeafMutations: projectionLeafPaths.length,
  projectionObjectRejections,
  projectionObjectOmissions,
  assertions: "passed"
}, null, 2));
