"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REVIEW_FILE = path.join(ROOT, "data", "recipes.js");
const OUTPUT_FILE = path.join(ROOT, "data", "recipes-public.js");
const {
  expectedIngredientSnapshotDigest,
  expectedRecipeIngredientSnapshotDigest,
  expectedRecipeBundleDigest,
  expectedRecipeSourceTextDigest
} = require("./recipe-digests");

function publicValue(value, type, label) {
  if (type === "string") {
    if (typeof value !== "string") throw new Error(`${label} must be a string`);
    return value;
  }
  if (type === "nullable_string") {
    if (value !== null && typeof value !== "string") throw new Error(`${label} must be a string or null`);
    return value;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
    return value;
  }
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
    return value;
  }
  if (type === "string_array") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`${label} must be an array of strings`);
    }
    return value.slice();
  }
  throw new Error(`Unsupported public projection type ${type} for ${label}`);
}

function project(value, keys, types, label) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return keys.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = publicValue(source[key], types && types[key] || "string", `${label || "public field"}.${key}`);
    }
    return result;
  }, {});
}

function sanitizeSource(source) {
  return project(source, [
    "id", "status", "type", "title", "publisher", "documentNo", "url", "publishedAt",
    "checkedAt", "scope", "sourceId", "issuer", "reviewedAt"
  ], {}, "source");
}

function sanitizeTarget(target) {
  return project(target, [
    "id", "label", "shortLabel", "availability", "sourceIds", "description", "unavailableReason"
  ], { sourceIds: "string_array" }, "target");
}

function sanitizeIngredientReview(review) {
  return project(review, [
    "reviewId", "role", "state", "reviewedAt", "contentVersion", "rulesVersion", "ingredientDigest"
  ], {}, "ingredient review");
}

function sanitizeRecipeReview(review) {
  return project(review, [
    "reviewId", "role", "state", "reviewedAt", "contentVersion", "rulesVersion", "bundleDigest", "sourceTextDigest"
  ], {}, "recipe review");
}

function sanitizeRecipeSafety(value, withheld) {
  const arrayFields = {
    sourceIds: "string_array", populationSourceIds: "string_array", allergenKeys: "string_array",
    avoidConditions: "string_array", cautionConditions: "string_array", drugInteractions: "string_array",
    medicationCautions: "string_array", preparationBlocks: "string_array", preparationWarnings: "string_array",
    allergenSourceIds: "string_array", conditionSourceIds: "string_array", interactionSourceIds: "string_array",
    preparationSourceIds: "string_array"
  };
  const safety = project(value, [
    "sourceIds", "redFlagPolicy", "pregnancy", "breastfeeding", "infantsToddlers", "children",
    "olderAdults", "populationSourceIds", "allergenKeys", "allergenKeyBasis", "avoidConditions",
    "cautionConditions", "drugInteractions", "medicationCautions", "preparationBlocks",
    "preparationWarnings", "allergenReviewState", "allergenSourceIds", "conditionReviewState",
    "conditionSourceIds", "interactionReviewState", "interactionSourceIds", "preparationReviewState",
    "preparationSourceIds"
  ], arrayFields, "recipe safety");
  if (!withheld) return safety;
  return {
    ...safety,
    allergenKeys: [],
    allergenKeyBasis: "withheld_pending_review",
    avoidConditions: [],
    cautionConditions: [],
    drugInteractions: [],
    medicationCautions: [],
    preparationBlocks: [],
    preparationWarnings: []
  };
}

function sanitizeRecipeAudit(value, withheld) {
  const audit = project(value, [
    "sourceCheckState", "sourceCheckedAt", "formulaReviewState", "medicalReviewState",
    "pharmacyReviewState", "complianceReviewState", "finalApprovedAt", "nextReviewAt",
    "releaseStage"
  ], { finalApprovedAt: "nullable_string", nextReviewAt: "nullable_string" }, "recipe audit");
  audit.reviews = withheld ? [] : ((value && value.reviews) || []).map(sanitizeRecipeReview);
  if (withheld) {
    audit.note = "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。";
  }
  return audit;
}

function sanitizeRecipeCore(recipe) {
  return {
    ...project(recipe, [
      "id", "revision", "name", "status", "contentVersion", "rulesVersion", "targetId",
      "publicVisibility", "formulaSourceId", "safetySourceIds", "sourceIds"
    ], { safetySourceIds: "string_array", sourceIds: "string_array" }, "recipe"),
    sources: ((recipe && recipe.sources) || []).map(sanitizeSource),
    sourceLocator: project(recipe && recipe.sourceLocator,
      ["documentNo", "page", "section", "recipeTitle"], {}, "recipe source locator"),
    sourceContext: project(recipe && recipe.sourceContext,
      ["text", "diagnosticUse", "targetAgeGroups"], { targetAgeGroups: "string_array" }, "recipe source context"),
    guideContext: project(recipe && recipe.guideContext,
      ["title", "edition", "section", "page", "originalTarget"], {}, "recipe guide context"),
    audience: project(recipe && recipe.audience, [
      "adultOnly", "diagnosisConfirmationRequired", "patternRequired", "patternConfirmationPolicy",
      "allowedPatterns", "allowedTargetConditions"
    ], {
      adultOnly: "boolean", diagnosisConfirmationRequired: "boolean", patternRequired: "boolean",
      allowedPatterns: "string_array", allowedTargetConditions: "string_array"
    }, "recipe audience")
  };
}

function sanitizePublishedRecipe(recipe) {
  const bundle = recipe && recipe.bundle || {};
  return {
    ...sanitizeRecipeCore(recipe),
    bundle: {
      ...project(bundle, [
        "atomic", "omissionPolicy", "substitutionPolicy", "scalingPolicy", "orderLocked",
        "servingText", "frequencyText", "courseText", "sourceTextDigest", "bundleDigest"
      ], { atomic: "boolean", orderLocked: "boolean" }, "recipe bundle"),
      ingredients: (bundle.ingredients || []).map((line) => ({
        ...project(line, [
          "lineId", "required", "ingredientRegistry", "ingredientId", "ingredientContentVersion",
          "ingredientSnapshotDigest", "sourceName", "sourcePartText", "processingText",
          "identityReviewState", "identitySourceIds", "quantitySourceIds", "useRole", "allergenKeys", "sourceIds"
        ], {
          required: "boolean", identitySourceIds: "string_array", quantitySourceIds: "string_array",
          allergenKeys: "string_array", sourceIds: "string_array"
        }, "recipe ingredient line"),
        quantity: project(line && line.quantity, ["kind", "rawText", "value", "unit"], {}, "recipe quantity")
      })),
      steps: (bundle.steps || []).map((step) => project(step,
        ["stepId", "order", "text", "sourceIds"], { order: "number", sourceIds: "string_array" }, "recipe step"))
    },
    historicNotes: publicValue(recipe && recipe.historicNotes || [], "string_array", "recipe.historicNotes"),
    currentContext: publicValue(recipe && recipe.currentContext || [], "string_array", "recipe.currentContext"),
    safety: sanitizeRecipeSafety(recipe && recipe.safety, false),
    audit: sanitizeRecipeAudit(recipe && recipe.audit, false)
  };
}

function sanitizeUnpublishedRecipe(recipe) {
  const bundle = recipe && recipe.bundle || {};
  return {
    ...sanitizeRecipeCore(recipe),
    bundle: {
      ...project(bundle, [
        "atomic", "omissionPolicy", "substitutionPolicy", "scalingPolicy", "orderLocked"
      ], { atomic: "boolean", orderLocked: "boolean" }, "withheld recipe bundle"),
      withheld: true
    },
    historicNotes: [],
    currentContext: [],
    safety: sanitizeRecipeSafety(recipe && recipe.safety, true),
    audit: {
      ...sanitizeRecipeAudit(recipe && recipe.audit, true),
      note: "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。"
    }
  };
}

function sanitizePublishedExternalFood(food, allowedEvidenceKeys) {
  const evidenceKeys = allowedEvidenceKeys instanceof Set ? allowedEvidenceKeys : new Set();
  const occurrenceEvidence = (food.occurrenceEvidence || []).filter((evidence) =>
    evidenceKeys.has(`${evidence.recipeId}/${evidence.lineId}`)
  );
  const neededSourceIds = new Set([
    ...occurrenceEvidence.map((evidence) => evidence.sourceId),
    ...((food.identity && food.identity.sourceIds) || []),
    ...((food.regulatory && food.regulatory.sourceIds) || []),
    ...((food.foodUse && food.foodUse.sourceIds) || []),
    ...((food.safety && food.safety.sourceIds) || [])
  ]);
  const identity = project(food.identity, ["ediblePart", "partReviewState", "sourceIds"], { sourceIds: "string_array" }, "external food identity");
  const regulatory = project(food.regulatory, [
    "kind", "status", "currentCatalogReviewState", "restrictionCode", "restriction", "sourceIds"
  ], { sourceIds: "string_array" }, "external food regulation");
  const foodUse = project(food.foodUse, ["commonForms", "mappingReviewState", "sourceIds"], {
    commonForms: "string_array", sourceIds: "string_array"
  }, "external food use");
  const safety = project(food.safety, [
    "sourceIds", "pregnancy", "breastfeeding", "infantsToddlers", "children", "olderAdults",
    "allergenKeys", "avoidConditions", "cautionConditions", "drugInteractions", "preparationWarnings",
    "allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"
  ], {
    sourceIds: "string_array", allergenKeys: "string_array", avoidConditions: "string_array",
    cautionConditions: "string_array", drugInteractions: "string_array", preparationWarnings: "string_array"
  }, "external food safety");
  const audit = project(food.audit, [
    "occurrenceReviewState", "sourceCheckState", "professionalReviewState", "reviewedBy",
    "reviewedAt", "ingredientDigest", "releaseStage"
  ], {
    reviewedBy: "string_array", reviewedAt: "nullable_string", ingredientDigest: "nullable_string"
  }, "external food audit");
  audit.reviews = ((food.audit && food.audit.reviews) || []).map(sanitizeIngredientReview);
  return {
    ...project(food, [
      "id", "recordKind", "contentVersion", "name", "aliases", "category", "occurrenceFormText"
    ], { aliases: "string_array" }, "external food"),
    occurrenceEvidence: occurrenceEvidence.map((evidence) => project(evidence, [
      "recipeId", "lineId", "sourceId", "claimScope"
    ], {}, "external occurrence evidence")),
    identity,
    regulatory,
    foodUse,
    safety,
    sources: (food.sources || []).filter((source) => source && neededSourceIds.has(source.id)).map(sanitizeSource),
    audit
  };
}

function buildPublicData(reviewData, catalogData) {
  if (!reviewData || reviewData.schemaVersion !== "1.1.0") {
    throw new Error(`Unsupported recipe review schema ${reviewData && reviewData.schemaVersion || "missing"}`);
  }
  if (!reviewData.externalFoods || reviewData.externalFoods.schemaVersion !== "1.0.0") {
    throw new Error(`Unsupported external-food registry schema ${reviewData.externalFoods && reviewData.externalFoods.schemaVersion || "missing"}`);
  }
  const catalog = catalogData || require(path.join(ROOT, "data", "ingredients.js"));
  const recipeSafety = require(path.join(ROOT, "utils", "recipe-safety.js"));
  const fullExternalFoods = reviewData.externalFoods && typeof reviewData.externalFoods === "object"
    ? reviewData.externalFoods
    : { schemaVersion: "1.0.0", contentVersion: reviewData.contentVersion, publishedAt: reviewData.publishedAt, items: [], count: 0 };
  const externalItems = Array.isArray(fullExternalFoods.items) ? fullExternalFoods.items : [];
  if (!recipeSafety.externalFoodRegistryValid(fullExternalFoods)) {
    throw new Error("Invalid external-food registry structure or count");
  }
  if (!recipeSafety.externalOccurrenceCoverageValid(reviewData.recipes, fullExternalFoods)) {
    throw new Error("External-food occurrence evidence does not exactly match recipe lines");
  }
  const catalogById = new Map((catalog.ingredients || []).map((ingredient) => [ingredient.id, ingredient]));
  const externalById = new Map(externalItems.map((food) => [food.id, food]));
  const publicRecipes = (reviewData.recipes || []).map((recipe) => {
    const digestReady = recipe.bundle &&
      recipe.bundle.sourceTextDigest === expectedRecipeSourceTextDigest(recipe) &&
      recipe.bundle.bundleDigest === expectedRecipeBundleDigest(recipe) &&
      (recipe.bundle.ingredients || []).every((line) => {
        const registry = line.ingredientRegistry;
        if (!['official_catalog', 'external_food'].includes(registry)) return false;
        const ingredient = registry === "external_food" ? externalById.get(line.ingredientId) : catalogById.get(line.ingredientId);
        return ingredient && line.ingredientSnapshotDigest === expectedRecipeIngredientSnapshotDigest(ingredient, registry);
      });
    const releaseReady = recipe.status === "published" && digestReady &&
      recipeSafety.isPublishableRecipe(
        recipe, catalog.ingredients || [], reviewData.targets || [], fullExternalFoods, reviewData.sources
      );
    return releaseReady ? sanitizePublishedRecipe(recipe) : sanitizeUnpublishedRecipe(recipe);
  });
  const publishedExternalIds = new Set();
  const publishedExternalEvidenceKeys = new Map();
  publicRecipes.forEach((recipe) => {
    (recipe.bundle && recipe.bundle.ingredients || []).forEach((line) => {
      if (line.ingredientRegistry === "external_food") {
        publishedExternalIds.add(line.ingredientId);
        if (!publishedExternalEvidenceKeys.has(line.ingredientId)) publishedExternalEvidenceKeys.set(line.ingredientId, new Set());
        publishedExternalEvidenceKeys.get(line.ingredientId).add(`${recipe.id}/${line.lineId}`);
      }
    });
  });
  const publicExternalItems = externalItems
    .filter((food) => publishedExternalIds.has(food.id))
    .map((food) => sanitizePublishedExternalFood(food, publishedExternalEvidenceKeys.get(food.id)));
  const publicExternalFoods = {
    ...project(fullExternalFoods, ["schemaVersion", "contentVersion", "publishedAt"], {}, "external food registry"),
    items: publicExternalItems,
    count: publicExternalItems.length
  };
  return {
    ...project(reviewData, ["schemaVersion", "contentVersion", "publishedAt"], {}, "recipe catalog"),
    sources: (reviewData.sources || []).map(sanitizeSource),
    targets: (reviewData.targets || []).map(sanitizeTarget),
    externalFoods: publicExternalFoods,
    recipes: publicRecipes,
    count: publicRecipes.length
  };
}

function renderModule(publicData) {
  return `"use strict";\n\n// 此文件由 tools/build-public-recipes.js 生成。未发布整方不包含材料、用量、步骤或食用方式。\nmodule.exports = ${JSON.stringify(publicData, null, 2)};\n`;
}

function main() {
  delete require.cache[require.resolve(REVIEW_FILE)];
  const reviewData = require(REVIEW_FILE);
  const catalogData = require(path.join(ROOT, "data", "ingredients.js"));
  fs.writeFileSync(OUTPUT_FILE, renderModule(buildPublicData(reviewData, catalogData)), "utf8");
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT_FILE), recipes: reviewData.count }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildPublicData, renderModule, sanitizePublishedExternalFood, sanitizePublishedRecipe,
  sanitizeSource, sanitizeTarget, sanitizeUnpublishedRecipe
};
