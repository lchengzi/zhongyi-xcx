"use strict";

const catalogData = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const safety = require("./safety");

const REQUIRED_RECIPE_REVIEWS = [
  "formulaReviewState", "medicalReviewState", "pharmacyReviewState", "complianceReviewState"
];
const REQUIRED_INGREDIENT_REVIEWS = [
  "allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"
];
const REQUIRED_RECIPE_REVIEW_ROLES = [
  "tcm_clinician", "pharmacist", "nutrition_professional", "compliance", "release_approver"
];
const PROFILE_UNKNOWN = "unknown";
const SOURCE_KEYS = new Set([
  "id", "sourceId", "documentNo", "status", "type", "title", "publisher", "issuer",
  "url", "publishedAt", "checkedAt", "reviewedAt", "scope"
]);
const EXTERNAL_FOOD_KEYS = new Set([
  "id", "recordKind", "contentVersion", "name", "aliases", "category",
  "occurrenceFormText", "occurrenceEvidence", "identity", "regulatory", "foodUse",
  "safety", "sources", "audit"
]);
const EXTERNAL_IDENTITY_KEYS = new Set(["ediblePart", "partReviewState", "sourceIds"]);
const EXTERNAL_REGULATORY_KEYS = new Set([
  "kind", "status", "currentCatalogReviewState", "restrictionCode", "restriction", "sourceIds"
]);
const EXTERNAL_FOOD_USE_KEYS = new Set(["commonForms", "mappingReviewState", "sourceIds"]);
const EXTERNAL_SAFETY_KEYS = new Set([
  "sourceIds", "pregnancy", "breastfeeding", "infantsToddlers", "children", "olderAdults",
  "allergenKeys", "avoidConditions", "cautionConditions", "drugInteractions", "preparationWarnings",
  "allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"
]);
const EXTERNAL_AUDIT_KEYS = new Set([
  "occurrenceReviewState", "sourceCheckState", "professionalReviewState", "reviewedBy",
  "reviewedAt", "ingredientDigest", "reviews", "releaseStage", "note"
]);
const INGREDIENT_REVIEW_KEYS = new Set([
  "reviewId", "role", "state", "reviewedAt", "contentVersion", "rulesVersion", "ingredientDigest"
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sourceObjectValid(source) {
  if (!hasOnlyKeys(source, SOURCE_KEYS)) return false;
  const id = String(source.id || source.sourceId || source.documentNo || "").trim();
  const publisher = String(source.publisher || source.issuer || "").trim();
  return Boolean(id && source.status && source.title && publisher &&
    /^https:\/\//i.test(String(source.url || "")) && source.publishedAt && source.checkedAt);
}

function sourceMap(sources) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const result = new Map();
  for (const source of sources) {
    if (!sourceObjectValid(source)) return null;
    const id = String(source.id || source.sourceId || source.documentNo).trim();
    if (result.has(id)) return null;
    result.set(id, source);
  }
  return result;
}

function sourceMapsAgree(embedded, canonical) {
  if (!(embedded instanceof Map) || !(canonical instanceof Map)) return false;
  return [...embedded].every(([id, source]) => canonical.has(id) &&
    canonicalJson(source) === canonicalJson(canonical.get(id)));
}

function externalFoodShapeValid(food) {
  return hasOnlyKeys(food, EXTERNAL_FOOD_KEYS) && food.recordKind === "external_food" &&
    typeof food.id === "string" && food.id.startsWith("external-food-") &&
    typeof food.contentVersion === "string" && food.contentVersion.length > 0 &&
    typeof food.name === "string" && food.name.length > 0 && Array.isArray(food.aliases) &&
    food.category === "ordinary_food_candidate" && typeof food.occurrenceFormText === "string" &&
    food.occurrenceFormText.length > 0 && Array.isArray(food.occurrenceEvidence) &&
    hasOnlyKeys(food.identity, EXTERNAL_IDENTITY_KEYS) &&
    hasOnlyKeys(food.regulatory, EXTERNAL_REGULATORY_KEYS) &&
    hasOnlyKeys(food.foodUse, EXTERNAL_FOOD_USE_KEYS) &&
    hasOnlyKeys(food.safety, EXTERNAL_SAFETY_KEYS) &&
    hasOnlyKeys(food.audit, EXTERNAL_AUDIT_KEYS) &&
    asArray(food.audit.reviews).every((review) => hasOnlyKeys(review, INGREDIENT_REVIEW_KEYS)) &&
    sourceMap(food.sources) instanceof Map;
}

function externalFoodRegistryValid(externalFoods) {
  if (!isObject(externalFoods) || externalFoods.schemaVersion !== "1.0.0" ||
      typeof externalFoods.contentVersion !== "string" || !externalFoods.contentVersion ||
      typeof externalFoods.publishedAt !== "string" || !Array.isArray(externalFoods.items) ||
      !Number.isInteger(externalFoods.count) || externalFoods.count !== externalFoods.items.length) return false;
  const ids = new Set();
  return externalFoods.items.every((food) => {
    if (!externalFoodShapeValid(food) || food.contentVersion !== externalFoods.contentVersion || ids.has(food.id)) return false;
    ids.add(food.id);
    return true;
  });
}

function externalOccurrenceCoverageValid(recipes, externalFoods) {
  if (!externalFoodRegistryValid(externalFoods)) return false;
  const expected = [];
  for (const recipe of asArray(recipes)) {
    for (const line of asArray(recipe && recipe.bundle && recipe.bundle.ingredients)) {
      if (line && line.ingredientRegistry === "external_food") {
        expected.push({
          key: `${line.ingredientId}|${recipe.id}|${line.lineId}`,
          sourceId: recipe.formulaSourceId,
          sourceIds: asArray(line.sourceIds),
          quantitySourceIds: asArray(line.quantitySourceIds)
        });
      }
    }
  }
  const actual = [];
  for (const food of externalFoods.items) {
    for (const evidence of asArray(food.occurrenceEvidence)) {
      actual.push({
        key: `${food.id}|${evidence && evidence.recipeId}|${evidence && evidence.lineId}`,
        sourceId: evidence && evidence.sourceId
      });
    }
  }
  if (new Set(expected.map((item) => item.key)).size !== expected.length ||
      new Set(actual.map((item) => item.key)).size !== actual.length || expected.length !== actual.length) return false;
  const expectedByKey = new Map(expected.map((item) => [item.key, item]));
  return actual.every((item) => {
    const reference = expectedByKey.get(item.key);
    return reference && item.sourceId === reference.sourceId &&
      reference.sourceIds.includes(item.sourceId) && reference.quantitySourceIds.includes(item.sourceId);
  });
}

function normalizedToken(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/[\s·•、，,;；()（）]/g, "");
}

function tokensMatch(left, right) {
  const a = normalizedToken(left);
  const b = normalizedToken(right);
  if (!a || !b) return false;
  return a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)));
}

function externalFoodItems(externalFoods) {
  if (Array.isArray(externalFoods)) return externalFoods;
  return asArray(externalFoods && externalFoods.items);
}

function sourceBindingSignature(source) {
  return sourceObjectValid(source) ? canonicalJson(source) : "";
}

function resolveRecipeIngredient(line, catalog, externalFoods) {
  const id = line && line.ingredientId;
  const registry = line && line.ingredientRegistry;
  if (!id || !["official_catalog", "external_food"].includes(registry)) {
    return { error: "ingredient_registry_invalid", registry, record: null, contentVersion: "" };
  }
  const catalogMatches = asArray(catalog).filter((item) => item && item.id === id);
  if (registry === "external_food" && !externalFoodRegistryValid(externalFoods)) {
    return { error: "ingredient_registry_invalid", registry, record: null, contentVersion: "" };
  }
  const externalMatches = externalFoodItems(externalFoods).filter((item) => item && item.id === id);
  if (catalogMatches.length + externalMatches.length > 1) {
    return { error: "ingredient_identity_ambiguous", registry, record: null, contentVersion: "" };
  }
  const matches = registry === "external_food" ? externalMatches : catalogMatches;
  if (matches.length !== 1) {
    return {
      error: registry === "external_food" ? "external_food_missing" : "ingredient_identity_unresolved",
      registry, record: null, contentVersion: ""
    };
  }
  const record = matches[0];
  if ((registry === "external_food") !== (record.recordKind === "external_food")) {
    return { error: "ingredient_registry_invalid", registry, record: null, contentVersion: "" };
  }
  const externalContentVersion = !Array.isArray(externalFoods) && externalFoods && externalFoods.contentVersion
    ? String(externalFoods.contentVersion)
    : String(record.contentVersion || "");
  if (registry === "external_food" && (!externalContentVersion || record.contentVersion !== externalContentVersion)) {
    return { error: "ingredient_registry_invalid", registry, record: null, contentVersion: "" };
  }
  return {
    error: "",
    registry,
    record,
    contentVersion: registry === "external_food" ? externalContentVersion : catalogData.contentVersion
  };
}

function externalFoodReadyForRecipe(food, canonicalSources) {
  if (!externalFoodShapeValid(food) || food.audit.occurrenceReviewState !== "source_checked") return false;
  const sources = asArray(food.sources);
  const materialSourceMap = sourceMap(sources);
  if (!(materialSourceMap instanceof Map) || !(canonicalSources instanceof Map) ||
      !sourceMapsAgree(materialSourceMap, canonicalSources)) return false;
  const published = new Set(sources.filter((source) => source.status === "published").map((source) => source.id));
  const occurrenceEvidence = asArray(food.occurrenceEvidence);
  if (!occurrenceEvidence.length || occurrenceEvidence.some((evidence) =>
    !evidence || !evidence.recipeId || !evidence.lineId || evidence.claimScope !== "formula_occurrence_and_quantity_only" || !published.has(evidence.sourceId))) return false;
  const occurrenceSourceIds = new Set(occurrenceEvidence.map((evidence) => evidence.sourceId));
  const directSourceGroups = [
    food.identity && food.identity.sourceIds,
    food.regulatory && food.regulatory.sourceIds,
    food.foodUse && food.foodUse.sourceIds,
    food.safety && food.safety.sourceIds
  ];
  return directSourceGroups.every((ids) => asArray(ids).length > 0 &&
    asArray(ids).every((id) => published.has(id) && !occurrenceSourceIds.has(id)));
}

function ingredientReadyForRecipe(ingredient, expectedContentVersion, canonicalSources) {
  if (!ingredient || !ingredient.identity || !ingredient.regulatory || !ingredient.foodUse || !ingredient.safety || !ingredient.audit) return false;
  const audit = ingredient.audit;
  return (ingredient.recordKind !== "external_food" ||
      (ingredient.regulatory.kind === "ordinary_food" && externalFoodReadyForRecipe(ingredient, canonicalSources))) &&
    ["listed", "ordinary_food"].includes(ingredient.regulatory.status) &&
    ingredient.regulatory.currentCatalogReviewState === "reviewed" &&
    ingredient.identity.partReviewState === "reviewed" &&
    ingredient.foodUse.mappingReviewState === "reviewed" &&
    audit.sourceCheckState === "checked" &&
    audit.professionalReviewState === "reviewed" &&
    safety.ingredientReviewSourcesReady(ingredient) &&
    safety.ingredientProfessionalReviewReady(ingredient, expectedContentVersion) &&
    REQUIRED_INGREDIENT_REVIEWS.every((field) => ingredient.safety[field] === "reviewed");
}

function recipeTechnicalChecks(recipe, catalog, targets, externalFoods, canonicalSources) {
  const activeCatalog = catalog || catalogData.ingredients;
  const failures = [];
  const audit = recipe && recipe.audit || {};
  const bundle = recipe && recipe.bundle || {};
  const recipeSafety = recipe && recipe.safety || {};
  const embeddedSources = asArray(recipe && recipe.sources);
  const embeddedSourceMap = sourceMap(embeddedSources);
  const canonicalSourceMap = canonicalSources === undefined ? embeddedSourceMap : sourceMap(canonicalSources);
  const sourceRegistryReady = embeddedSourceMap instanceof Map && canonicalSourceMap instanceof Map &&
    sourceMapsAgree(embeddedSourceMap, canonicalSourceMap);
  const embeddedSourceIds = new Set(sourceRegistryReady ?
    embeddedSources.filter((source) => source.status === "published").map((source) => source.id) : []);

  if (!recipe || typeof recipe !== "object") return ["invalid_recipe"];
  if (!sourceRegistryReady) failures.push("source_registry_invalid");
  if (recipe.status !== "published" || recipe.publicVisibility !== "published") failures.push("recipe_not_published");
  if (!recipe.rulesVersion || recipe.rulesVersion !== ruleSet.contentVersion || safety.rulesVersion !== ruleSet.contentVersion) {
    failures.push("rules_version_unsupported");
  }
  const target = asArray(targets).find((item) => item && item.id === recipe.targetId);
  if (!target || target.availability !== "reference_available") failures.push("target_not_release_ready");
  if (!recipe.targetId || !recipe.audience || recipe.audience.adultOnly !== true ||
      recipe.audience.diagnosisConfirmationRequired !== true ||
      !asArray(recipe.audience.allowedTargetConditions).length || !recipe.sourceContext ||
      recipe.sourceContext.diagnosticUse !== "forbidden" ||
      JSON.stringify(recipe.sourceContext.targetAgeGroups) !== JSON.stringify(["adult"])) {
    failures.push("audience_gate_missing");
  }
  if (recipe.audience && recipe.audience.patternRequired !== false) failures.push("pattern_gate_unsupported");
  if (!recipe.formulaSourceId || !embeddedSourceIds.has(recipe.formulaSourceId)) failures.push("formula_source_unavailable");
  if (asArray(recipe.sourceIds).some((id) => !embeddedSourceIds.has(id))) failures.push("source_reference_unresolved");
  if (asArray(recipe.safetySourceIds).some((id) => !embeddedSourceIds.has(id))) failures.push("safety_source_unresolved");
  if (!bundle.atomic || bundle.omissionPolicy !== "forbidden" || bundle.substitutionPolicy !== "forbidden" ||
      bundle.scalingPolicy !== "forbidden" || bundle.orderLocked !== true) failures.push("bundle_not_locked");
  if (!/^sha256:[a-f0-9]{64}$/.test(bundle.bundleDigest || "") || !/^sha256:[a-f0-9]{64}$/.test(bundle.sourceTextDigest || "")) {
    failures.push("bundle_digest_pending");
  }
  if (!asArray(bundle.ingredients).length || !asArray(bundle.steps).length) failures.push("bundle_incomplete");
  if (audit.sourceCheckState !== "checked" || REQUIRED_RECIPE_REVIEWS.some((field) => audit[field] !== "reviewed")) {
    failures.push("recipe_review_pending");
  }
  if (REQUIRED_INGREDIENT_REVIEWS.some((field) => recipeSafety[field] !== "reviewed")) {
    failures.push("recipe_safety_review_pending");
  }
  if ([
    recipeSafety.sourceIds, recipeSafety.populationSourceIds, recipeSafety.allergenSourceIds,
    recipeSafety.conditionSourceIds, recipeSafety.interactionSourceIds, recipeSafety.preparationSourceIds
  ].some((ids) => !asArray(ids).length)) failures.push("recipe_safety_source_missing");
  const finalApprovedAt = Date.parse(audit.finalApprovedAt || "");
  const nextReviewAt = Date.parse(audit.nextReviewAt || "");
  const now = Date.now();
  const completedReviews = asArray(audit.reviews).filter((review) => {
    const reviewedAt = Date.parse(review && review.reviewedAt || "");
    return review && review.state === "reviewed" && review.reviewId && Number.isFinite(reviewedAt) &&
      Number.isFinite(finalApprovedAt) && reviewedAt <= finalApprovedAt && reviewedAt <= now &&
      review.rulesVersion === recipe.rulesVersion;
  });
  const requiredRoleReviews = REQUIRED_RECIPE_REVIEW_ROLES.map((role) => completedReviews.find((review) =>
    review.role === role && review.contentVersion === recipe.contentVersion &&
    review.bundleDigest === bundle.bundleDigest && review.sourceTextDigest === bundle.sourceTextDigest
  ));
  if (requiredRoleReviews.some((review) => !review) ||
      new Set(requiredRoleReviews.filter(Boolean).map((review) => review.reviewId)).size !== REQUIRED_RECIPE_REVIEW_ROLES.length) {
    failures.push("recipe_reviewer_missing");
  }
  if (!Number.isFinite(finalApprovedAt) || !Number.isFinite(nextReviewAt) ||
      finalApprovedAt > now || nextReviewAt <= finalApprovedAt || nextReviewAt <= now) failures.push("final_approval_missing_or_expired");

  const citedSourceGroups = [
    recipeSafety.sourceIds, recipeSafety.populationSourceIds, recipeSafety.allergenSourceIds,
    recipeSafety.conditionSourceIds, recipeSafety.interactionSourceIds, recipeSafety.preparationSourceIds
  ];
  asArray(bundle.ingredients).forEach((line) => {
    citedSourceGroups.push(line && line.sourceIds, line && line.identitySourceIds, line && line.quantitySourceIds);
  });
  asArray(bundle.steps).forEach((step) => citedSourceGroups.push(step && step.sourceIds));
  if (citedSourceGroups.some((ids) => asArray(ids).some((id) => !embeddedSourceIds.has(id)))) {
    failures.push("field_source_unavailable");
  }

  asArray(bundle.ingredients).forEach((line) => {
    if (!line || line.required !== true || !line.ingredientId) {
      failures.push("ingredient_identity_unresolved");
      return;
    }
    const resolution = resolveRecipeIngredient(line, activeCatalog, externalFoods);
    const ingredient = resolution.record;
    if (resolution.error) failures.push(`${resolution.error}:${line.lineId || line.ingredientId}`);
    if (ingredient && resolution.registry === "external_food") {
      const matchingEvidence = asArray(ingredient.occurrenceEvidence).filter((evidence) =>
        evidence && evidence.recipeId === recipe.id && evidence.lineId === line.lineId
      );
      const occurrenceSource = matchingEvidence.length === 1
        ? asArray(ingredient.sources).find((source) => source && source.id === matchingEvidence[0].sourceId)
        : null;
      const recipeFormulaSource = embeddedSources.find((source) => source && source.id === recipe.formulaSourceId);
      if (matchingEvidence.length !== 1 || matchingEvidence[0].sourceId !== recipe.formulaSourceId ||
          !asArray(line.sourceIds).includes(recipe.formulaSourceId) ||
          !asArray(line.quantitySourceIds).includes(recipe.formulaSourceId) ||
          !sourceBindingSignature(occurrenceSource) ||
          sourceBindingSignature(occurrenceSource) !== sourceBindingSignature(recipeFormulaSource)) {
        failures.push(`external_food_occurrence_binding_invalid:${line.lineId || line.ingredientId}`);
      }
      const occurrenceSourceIds = new Set(asArray(ingredient.occurrenceEvidence).map((evidence) => evidence && evidence.sourceId));
      const directIdentityIds = new Set(asArray(ingredient.identity && ingredient.identity.sourceIds));
      if (!asArray(line.identitySourceIds).length || asArray(line.identitySourceIds).some((id) =>
        occurrenceSourceIds.has(id) || !directIdentityIds.has(id))) {
        failures.push(`external_food_identity_binding_invalid:${line.lineId || line.ingredientId}`);
      }
    }
    if (ingredient && !ingredientReadyForRecipe(ingredient, resolution.contentVersion, canonicalSourceMap)) {
      failures.push(`${resolution.registry === "external_food" ? "external_food_not_reviewed" : "ingredient_not_reviewed"}:${line.lineId || line.ingredientId}`);
    }
    if (ingredient && line.ingredientContentVersion !== resolution.contentVersion) {
      failures.push(`${resolution.registry === "external_food" ? "external_food_version_mismatch" : "ingredient_version_mismatch"}:${line.lineId || line.ingredientId}`);
    }
    if (ingredient && ingredient.regulatory && ingredient.regulatory.restrictionCode === "seasoning_only" && line.useRole !== "seasoning") {
      failures.push(`regulatory_usage_conflict:${line.lineId || line.ingredientId}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(line.ingredientSnapshotDigest || "")) {
      failures.push(`ingredient_digest_pending:${line.lineId || line.ingredientId}`);
    } else if (ingredient && line.ingredientSnapshotDigest !== ingredient.audit.ingredientDigest) {
      failures.push(`${resolution.registry === "external_food" ? "external_food_digest_mismatch" : "ingredient_digest_mismatch"}:${line.lineId || line.ingredientId}`);
    }
    if (line.identityReviewState !== "reviewed" || !asArray(line.identitySourceIds).length || !asArray(line.quantitySourceIds).length) {
      failures.push(`line_source_review_pending:${line.lineId || line.ingredientId}`);
    }
  });
  return [...new Set(failures)];
}

function isPublishableRecipe(recipe, catalog, targets, externalFoods, canonicalSources) {
  return recipeTechnicalChecks(recipe, catalog || catalogData.ingredients, targets, externalFoods, canonicalSources).length === 0;
}

function missingProfileDimensions(profile) {
  const missing = [];
  if (profile.ageGroup === PROFILE_UNKNOWN) missing.push("年龄阶段");
  if (profile.pregnancy === PROFILE_UNKNOWN) missing.push("孕期状态");
  if (profile.breastfeeding === PROFILE_UNKNOWN) missing.push("哺乳期状态");
  if (profile.allergyStatus === PROFILE_UNKNOWN) missing.push("过敏情况");
  if (profile.conditionStatus === PROFILE_UNKNOWN) missing.push("基础疾病情况");
  if (profile.medicationStatus === PROFILE_UNKNOWN) missing.push("用药情况");
  return missing;
}

function evaluateRecipe(recipe, inputProfile, context) {
  const profile = safety.normalizeProfile(inputProfile);
  const options = context && typeof context === "object" ? context : {};
  const reasons = [];
  const warnings = [];
  const reasonCodes = [];
  const warningCodes = [];
  const lineResults = [];

  function add(targetCodes, targetMessages, code, message) {
    if (!targetCodes.includes(code)) targetCodes.push(code);
    if (!targetMessages.includes(message)) targetMessages.push(message);
  }
  function block(code, message) { add(reasonCodes, reasons, code, message); }
  function warn(code, message) { add(warningCodes, warnings, code, message); }

  if (profile.redFlags.length) {
    block("red_flag", "当前填写内容含需优先处理的紧急情况，本工具停止展示所有食养方案。请及时联系急救或就近就医。 ");
    return {
      recipeId: recipe && recipe.id || "", blocked: true, documentationOnly: false, status: "triage_blocked",
      reasons, warnings, reasonCodes, warningCodes, lineResults, technicalFailures: [], profile
    };
  }

  const activeCatalog = options.catalog || catalogData.ingredients;
  const technicalFailures = recipeTechnicalChecks(recipe, activeCatalog, options.targets, options.externalFoods, options.sources);
  const recipeSafety = recipe && recipe.safety || {};
  const targetAges = asArray(recipe && recipe.sourceContext && recipe.sourceContext.targetAgeGroups);
  if (profile.ageGroup !== PROFILE_UNKNOWN && targetAges.length && !targetAges.includes(profile.ageGroup)) {
    block("age_scope_mismatch", "当前年龄阶段不在该官方方案的目标范围内。 ");
  }
  if (profile.pregnancy === "yes" && safety.safetyRuleState(recipeSafety.pregnancy) !== "yes") {
    block("pregnancy_not_suitable", "该整方或其中材料未确认适用于孕期。 ");
  }
  if (profile.breastfeeding === "yes" && safety.safetyRuleState(recipeSafety.breastfeeding) !== "yes") {
    block("breastfeeding_not_suitable", "该整方或其中材料未确认适用于哺乳期。 ");
  }
  if (profile.ageGroup === "infant_toddler" && safety.safetyRuleState(recipeSafety.infantsToddlers) !== "yes") {
    block("infants_toddlers_not_suitable", "该整方或其中材料未确认适用于婴幼儿。 ");
  }
  if (profile.ageGroup === "child" && safety.safetyRuleState(recipeSafety.children) !== "yes") {
    block("children_not_suitable", "该整方或其中材料未确认适用于儿童或青少年。 ");
  }
  if (profile.ageGroup === "older_adult" && safety.safetyRuleState(recipeSafety.olderAdults) !== "yes") {
    block("older_adult_not_suitable", "该整方或其中材料未确认适用于老年人。 ");
  }
  if (profile.allergyStatus === "yes" && !profile.allergies.length) block("allergy_details_required", "已确认有过敏史，但未填写具体过敏物。 ");
  if (profile.conditionStatus === "yes" && !profile.conditions.length) block("condition_details_required", "已确认有基础疾病，但未填写具体情况。 ");
  if (profile.medicationStatus === "yes" && !profile.medications.length) block("medication_details_required", "已确认正在用药，但未填写具体药品。 ");

  const allergyMatches = profile.allergies.filter((allergy) =>
    asArray(recipeSafety.allergenKeys).some((key) => tokensMatch(allergy, key))
  );
  if (allergyMatches.length) block("recipe_allergy_match", `已填写的过敏信息与整方材料匹配：${[...new Set(allergyMatches)].join("、")}。`);
  const avoidMatches = profile.conditions.filter((condition) =>
    asArray(recipeSafety.avoidConditions).some((key) => tokensMatch(condition, key))
  );
  if (avoidMatches.length) block("recipe_condition_match", `已填写的基础情况命中整方禁用规则：${[...new Set(avoidMatches)].join("、")}。`);
  const cautionMatches = profile.conditions.filter((condition) =>
    asArray(recipeSafety.cautionConditions).some((key) => tokensMatch(condition, key))
  );
  if (cautionMatches.length) warn("recipe_condition_caution", `已填写的基础情况命中整方慎用规则：${[...new Set(cautionMatches)].join("、")}。`);
  const interactionMatches = profile.medications.filter((medication) =>
    asArray(recipeSafety.drugInteractions).some((key) => tokensMatch(medication, key))
  );
  if (interactionMatches.length) block("recipe_interaction_match", `已填写的用药信息命中整方相互作用规则：${[...new Set(interactionMatches)].join("、")}。`);
  const medicationCautionMatches = profile.medications.filter((medication) =>
    asArray(recipeSafety.medicationCautions).some((key) => tokensMatch(medication, key))
  );
  if (medicationCautionMatches.length) warn("recipe_medication_caution", `已填写的用药信息命中需专业确认的整方规则：${[...new Set(medicationCautionMatches)].join("、")}。`);
  asArray(recipeSafety.preparationBlocks).forEach((message) => block("preparation_block", message));
  asArray(recipeSafety.preparationWarnings).forEach((message) => warn("preparation_warning", message));

  if (reasons.length) {
    return {
      recipeId: recipe && recipe.id || "", blocked: true, documentationOnly: false, status: "blocked",
      reasons, warnings, reasonCodes, warningCodes, lineResults, technicalFailures, profile
    };
  }
  if (technicalFailures.length) {
    block("recipe_not_release_ready", "该完整方案尚未完成材料身份、来源、整方安全及专业审校，因此不展示材料、用量和做法。 ");
    return {
      recipeId: recipe && recipe.id || "", blocked: false, documentationOnly: true, status: "documentation_only",
      reasons, warnings, reasonCodes, warningCodes, lineResults, technicalFailures, profile
    };
  }

  if (options.diagnosisConfirmed !== true) {
    block("diagnosis_ack_required", "请先确认这是已由正规医疗机构确诊的成人目标，并且仅查看官方资料。 ");
  }

  const missing = missingProfileDimensions(profile);
  if (missing.length) {
    block("profile_incomplete", `个人安全信息仍未明确（${missing.join("、")}），当前只能查看来源与审校状态。`);
    return {
      recipeId: recipe.id, blocked: false, documentationOnly: true, status: "documentation_only",
      reasons, warnings, reasonCodes, warningCodes, lineResults, technicalFailures, profile
    };
  }

  if (profile.allergyStatus === "yes" && recipeSafety.allergenReviewState !== "reviewed") block("allergen_review_pending", "整方过敏资料尚未完成专业审校。 ");
  if (profile.conditionStatus === "yes" && recipeSafety.conditionReviewState !== "reviewed") block("condition_review_pending", "整方基础疾病禁忌尚未完成专业审校。 ");
  if (profile.medicationStatus === "yes" && recipeSafety.interactionReviewState !== "reviewed") block("interaction_review_pending", "整方药物相互作用尚未完成专业审校。 ");

  asArray(recipe.bundle && recipe.bundle.ingredients).forEach((line) => {
    const ingredient = resolveRecipeIngredient(line, activeCatalog, options.externalFoods).record;
    const result = safety.evaluateIngredient(ingredient, profile);
    lineResults.push({ lineId: line.lineId, ingredientId: line.ingredientId, result });
    if (result.blocked) block(`ingredient_blocked:${line.lineId}`, `${line.sourceName} 触发材料级安全阻断，整方不可拆除该材料后继续。`);
    const strictWarnings = result.warningCodes.filter((code) => [
      "profile_incomplete", "pregnancy_unknown", "breastfeeding_unknown", "infants_toddlers_unknown",
      "children_unknown", "older_adult_unknown", "allergen_data_limited", "condition_data_pending",
      "interaction_data_pending", "preparation_data_pending", "food_use_mapping_pending",
      "catalog_refresh_pending", "professional_review_pending"
    ].includes(code));
    if (strictWarnings.length) block(`ingredient_review_pending:${line.lineId}`, `${line.sourceName} 仍有材料级未知或待审校信息。`);
    result.warnings.forEach((message, index) => warn(`ingredient_caution:${line.lineId}:${index}`, `${line.sourceName}：${message}`));
  });

  const blocked = reasons.length > 0;
  return {
    recipeId: recipe.id,
    blocked,
    documentationOnly: false,
    status: blocked ? "blocked" : (warnings.length ? "caution" : "viewable"),
    reasons,
    warnings,
    reasonCodes,
    warningCodes,
    lineResults,
    technicalFailures,
    profile
  };
}

function evaluateRecipes(recipes, profile, confirmations, context) {
  const acknowledgedTargets = confirmations && typeof confirmations === "object" ? confirmations : {};
  const options = context && typeof context === "object" ? context : {};
  return asArray(recipes).map((recipe) => evaluateRecipe(recipe, profile, {
    diagnosisConfirmed: acknowledgedTargets[recipe.targetId] === true,
    catalog: options.catalog,
    targets: options.targets,
    externalFoods: options.externalFoods,
    sources: options.sources
  }));
}

function getPublishableRecipes(recipes, catalog, targets, externalFoods, canonicalSources) {
  if (externalFoods && !externalOccurrenceCoverageValid(recipes, externalFoods)) return [];
  return asArray(recipes).filter((recipe) => isPublishableRecipe(
    recipe, catalog || catalogData.ingredients, targets, externalFoods, canonicalSources
  ));
}

module.exports = {
  rulesVersion: ruleSet.contentVersion,
  evaluateRecipe,
  evaluateRecipes,
  getPublishableRecipes,
  externalOccurrenceCoverageValid,
  externalFoodRegistryValid,
  externalFoodReadyForRecipe,
  ingredientReadyForRecipe,
  isPublishableRecipe,
  recipeTechnicalChecks,
  resolveRecipeIngredient,
  sourceBindingSignature,
  sourceMap
};
