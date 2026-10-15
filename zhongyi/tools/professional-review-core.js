"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ingredientData = require("../data/ingredients");
const recipeData = require("../data/recipes");
const ruleSet = require("../data/rule-set");
const activeVersion = require("../data/version-active.json");
const recipeSafety = require("../utils/recipe-safety");
const {
  expectedExternalFoodSnapshotDigest,
  expectedIngredientReviewDigest,
  expectedRecipeBundleDigest,
  expectedRecipeSourceTextDigest,
  normalizedIngredientReviewContent,
  normalizedRecipeBundle,
  normalizedRecipeSourceText
} = require("./recipe-digests");

const ROOT = path.resolve(__dirname, "..");
const PACKET_ID = "p3-material-review.4";
const PRIVATE_PREFIX = `content-private/review-packets/${PACKET_ID}/`;
const MANIFEST_RELATIVE = `${PRIVATE_PREFIX}manifest.json`;
const REVIEW_RELATIVE = `${PRIVATE_PREFIX}review-index.html`;
const REVIEWER_REGISTRY_RELATIVE = `${PRIVATE_PREFIX}reviewer-registry.json`;
const RESULTS_RELATIVE = `${PRIVATE_PREFIX}review-results.json`;
const SCHEMA_VERSION = "1.1.0";
const TRUST_MODE = "schema_binding_only_no_repository_authority";
const APPLICATION_POLICY = "dry_run_no_data_writes";
const REVIEW_WINDOW_DAYS = 90;
const REQUIRED_MATERIAL_ROLES = Object.freeze(["tcm_clinician", "pharmacist", "compliance"]);
const REQUIRED_RECIPE_ROLES = Object.freeze([
  "tcm_clinician", "pharmacist", "nutrition_professional", "compliance", "release_approver"
]);
const ALL_ROLES = Object.freeze([...new Set([...REQUIRED_MATERIAL_ROLES, ...REQUIRED_RECIPE_ROLES])]);
const REVIEW_DOMAINS = Object.freeze(["identity", "regulatory", "food_use", "safety"]);
const RECOMMENDATIONS = Object.freeze(["changes_required", "reject", "ready_for_next_gate"]);
const FINDING_CODE = /^[a-z][a-z0-9_:-]{2,79}$/;
const EVIDENCE_REF = /^evidence:opaque:[a-zA-Z0-9_-]{16,128}$/;
const REVIEWER_REF = /^reviewer:opaque:[a-zA-Z0-9_-]{22,64}$/;
const SUBMISSION_ID = /^submission:[a-zA-Z0-9][a-zA-Z0-9._:-]{7,159}$/;
const DEFAULT_PROFILE_KEY = "full";
const FIRST_RELEASE_PROFILE_KEY = "first-release-black-bean";
const PROFILE_REGISTRY = Object.freeze({
  [DEFAULT_PROFILE_KEY]: Object.freeze({
    key: DEFAULT_PROFILE_KEY,
    kind: "full",
    packetId: PACKET_ID
  }),
  [FIRST_RELEASE_PROFILE_KEY]: Object.freeze({
    key: FIRST_RELEASE_PROFILE_KEY,
    kind: "single_recipe_exact_material_closure",
    packetId: "p3-first-release-black-bean-huangqi-goji-soup.1",
    selectedRecipeIds: Object.freeze(["black-bean-huangqi-goji-soup"]),
    expectedRecipeTaskCount: 1,
    expectedRecipeIngredientLineCount: 6,
    expectedMaterialTaskCount: 6
  })
});

class ProfessionalReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProfessionalReviewError";
    this.code = code;
  }
}

function fail(code, message) { throw new ProfessionalReviewError(code, message); }
function ensure(condition, code, message) { if (!condition) fail(code, message); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return [...new Set(values)]; }
function externalFoodRegistry() {
  return isObject(recipeData.externalFoods) && Array.isArray(recipeData.externalFoods.items) ? recipeData.externalFoods : {
    schemaVersion: "legacy-none",
    contentVersion: recipeData.contentVersion,
    count: 0,
    items: [],
    occurrenceEvidence: []
  };
}

function exactKeys(value, keys, label) {
  ensure(isObject(value), "shape", `${label} must be an object`);
  ensure(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort()), "shape", `${label} fields drifted`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256Value(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function profileKeys() { return Object.keys(PROFILE_REGISTRY); }
function resolveProfile(profileKey) {
  const key = profileKey === undefined ? DEFAULT_PROFILE_KEY : profileKey;
  ensure(typeof key === "string" && Object.prototype.hasOwnProperty.call(PROFILE_REGISTRY, key),
    "profile", `unknown professional review profile: ${String(key)}`);
  return PROFILE_REGISTRY[key];
}

function profileKeyForPacket(packet) {
  ensure(isObject(packet) && nonEmpty(packet.packetId), "profile", "professional review packet id is missing");
  const match = profileKeys().find((key) => PROFILE_REGISTRY[key].packetId === packet.packetId);
  ensure(Boolean(match), "profile", `unknown professional review packet id: ${packet.packetId}`);
  return match;
}

function profileFromCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  if (!args.length) return DEFAULT_PROFILE_KEY;
  ensure(args.length === 2 && args[0] === "--profile", "profile",
    "professional review CLI accepts only --profile <registered-profile>");
  return resolveProfile(args[1]).key;
}

function packetPaths(profileKey) {
  const profile = resolveProfile(profileKey);
  ensure(/^[a-z0-9][a-z0-9.-]{2,119}$/.test(profile.packetId), "profile", "registered packet id is unsafe");
  const privatePrefix = `content-private/review-packets/${profile.packetId}/`;
  return Object.freeze({
    profileKey: profile.key,
    packetId: profile.packetId,
    privatePrefix,
    manifestRelative: `${privatePrefix}manifest.json`,
    reviewRelative: `${privatePrefix}review-index.html`,
    reviewerRegistryRelative: `${privatePrefix}reviewer-registry.json`,
    resultsRelative: `${privatePrefix}review-results.json`
  });
}

function readJson(relative, label) {
  const file = path.resolve(ROOT, ...relative.split("/"));
  ensure(file.startsWith(`${ROOT}${path.sep}`), "path", `${label} escapes workspace`);
  ensure(fs.existsSync(file), "missing", `${label} is missing`);
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "path", `${label} must be a regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { fail("json", `${label} is invalid JSON: ${error.message}`); }
}

function strictDate(value, label) {
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(value || ""), "date", `${label} is invalid`);
  const parsed = new Date(`${value}T00:00:00Z`);
  ensure(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, "date", `${label} is invalid`);
  return parsed;
}

function strictTimestamp(value, label) {
  ensure(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value || ""), "date", `${label} must be an RFC3339 UTC timestamp without fractions`);
  const parsed = new Date(value);
  ensure(!Number.isNaN(parsed.getTime()) && parsed.toISOString().replace(".000Z", "Z") === value, "date", `${label} is invalid`);
  return parsed;
}

function normalizedTimestamp(value, label) {
  const parsed = new Date(value);
  ensure(!Number.isNaN(parsed.getTime()), "date", `${label} is invalid`);
  return parsed.toISOString().replace(".000Z", "Z");
}

function plusDays(value, days) {
  const parsed = new Date(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().replace(".000Z", "Z");
}

function evaluationNow(options) {
  const value = options && options.now !== undefined ? options.now : new Date();
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  ensure(!Number.isNaN(parsed.getTime()), "date", "validation clock is invalid");
  return parsed;
}

function packetBuildOptionsFromVerification(verified) {
  return verified && verified.mode === "rollback" ? {
    releaseId: verified.releaseId,
    activatedAt: verified.releaseCreatedAt
  } : {};
}

function sourceIdList(record, key) { return asArray(record && record[key] && record[key].sourceIds); }
function identitySourceIds(record, registry) {
  const direct = sourceIdList(record, "identity");
  return direct.length || registry === "external_food" ? direct : sourceIdList(record, "regulatory");
}
function sourceSummary(record) {
  return asArray(record.sources).map((source) => ({
    id: source.id || source.sourceId || source.documentNo,
    status: source.status,
    title: source.title,
    publisher: source.publisher || source.issuer,
    url: source.url,
    scope: source.scope
  }));
}

function materialUses() {
  const uses = new Map();
  for (const recipe of recipeData.recipes) {
    for (const line of asArray(recipe.bundle && recipe.bundle.ingredients)) {
      const { registry, materialId } = materialReferenceForLine(recipe, line);
      const key = `${registry}:${materialId}`;
      if (!uses.has(key)) uses.set(key, []);
      uses.get(key).push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        lineId: line.lineId,
        sourceName: line.sourceName,
        sourcePartText: line.sourcePartText,
        processingText: line.processingText,
        quantity: line.quantity
      });
    }
  }
  return uses;
}

function resolveMaterial(registry, id) {
  if (registry === "official_catalog") return ingredientData.ingredients.find((item) => item.id === id) || null;
  if (registry === "external_food") return externalFoodRegistry().items.find((item) => item.id === id) || null;
  return null;
}

function legacyMaterialFromUse(materialId, use) {
  return {
    id: materialId,
    name: use.sourceName || materialId,
    aliases: [],
    recordKind: "legacy_unregistered_material",
    contentVersion: recipeData.contentVersion,
    sourcePartText: use.sourcePartText || "",
    processingText: use.processingText || "",
    sourceIds: [],
    audit: { sourceCheckState: "pending", professionalReviewState: "pending" }
  };
}

function materialReferenceForLine(recipe, line) {
  const hasCatalogIdentity = nonEmpty(line && line.ingredientId) &&
    ingredientData.ingredients.some((item) => item.id === line.ingredientId);
  const registry = line && line.ingredientRegistry ||
    (hasCatalogIdentity ? "official_catalog" : "legacy_unregistered");
  const materialId = nonEmpty(line && line.ingredientId) ? line.ingredientId :
    `legacy-${recipe.id}-${line.lineId}`;
  return { registry, materialId };
}

function materialReviewContent(record, registry) {
  if (registry !== "external_food") return normalizedIngredientReviewContent(record);
  const directSourceIds = new Set([
    ...sourceIdList(record, "identity"), ...sourceIdList(record, "regulatory"),
    ...sourceIdList(record, "foodUse"), ...sourceIdList(record, "safety")
  ]);
  return {
    domain: "external_food_v2",
    content: {
      id: record.id, recordKind: record.recordKind, contentVersion: record.contentVersion,
      name: record.name, aliases: record.aliases, category: record.category,
      occurrenceFormText: record.occurrenceFormText, identity: record.identity,
      regulatory: record.regulatory, foodUse: record.foodUse, safety: record.safety,
      sources: asArray(record.sources).filter((source) => source && directSourceIds.has(source.id))
    }
  };
}

function rawDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function materialDigest(record, registry) {
  return registry === "external_food" ? expectedExternalFoodSnapshotDigest(record) : expectedIngredientReviewDigest(record);
}

function publishedSourceIds(record) {
  return new Set(asArray(record.sources).filter((source) => source && source.status === "published").map((source) => source.id));
}

function sourceGroupReady(record, ids) {
  const values = asArray(ids);
  const published = publishedSourceIds(record);
  return values.length > 0 && values.every((id) => published.has(id));
}

function missingEvidenceDomains(record, registry) {
  const missing = [];
  const identityIds = identitySourceIds(record, registry);
  if (!sourceGroupReady(record, identityIds) || !["source_checked", "reviewed"].includes(record.identity.partReviewState)) missing.push("identity");
  if (!sourceGroupReady(record, sourceIdList(record, "regulatory")) ||
      !["source_checked", "reviewed"].includes(record.regulatory.currentCatalogReviewState)) missing.push("regulatory");
  if (!sourceGroupReady(record, sourceIdList(record, "foodUse"))) missing.push("food_use");
  if (!sourceGroupReady(record, sourceIdList(record, "safety"))) missing.push("safety");
  return missing;
}

function materialEvidenceBlockers(record, registry) {
  return unique([
    ...(record.audit.sourceCheckState === "checked" ? [] : ["direct_source_check_pending"]),
    ...missingEvidenceDomains(record, registry).map((domain) => `${domain}_evidence_pending`)
  ]);
}

function packetDigestFor(packetWithoutDigest) {
  const core = clone(packetWithoutDigest);
  delete core.packetDigest;
  return sha256Value(core);
}

function buildPacket(options) {
  const settings = options || {};
  const profile = resolveProfile(settings.profileKey);
  const externalFoods = externalFoodRegistry();
  const uses = materialUses();
  const sourceRelease = settings.release || activeVersion;
  const generatedFromReleaseId = settings.releaseId || sourceRelease.releaseId || sourceRelease.id;
  const activationTimestamp = settings.activatedAt || sourceRelease.activatedAt || sourceRelease.createdAt;
  ensure(nonEmpty(generatedFromReleaseId), "binding", "review packet release id is missing");
  const packetIssuedAt = normalizedTimestamp(activationTimestamp, "review packet source release timestamp");
  const reviewDueAt = plusDays(packetIssuedAt, REVIEW_WINDOW_DAYS);
  const materialTasks = [...uses].map(([key, taskUses]) => {
    const split = key.indexOf(":");
    const registry = key.slice(0, split);
    const materialId = key.slice(split + 1);
    const record = registry === "legacy_unregistered" ?
      legacyMaterialFromUse(materialId, taskUses[0]) : resolveMaterial(registry, materialId);
    ensure(record, "binding", `unresolved review material ${key}`);
    const isLegacy = registry === "legacy_unregistered";
    const evidenceBlockers = isLegacy ? [
      "legacy_material_registry_missing", "identity_evidence_pending", "regulatory_evidence_pending",
      "food_use_evidence_pending", "safety_evidence_pending"
    ] : materialEvidenceBlockers(record, registry);
    const reviewContent = isLegacy ? {
      domain: "legacy_unregistered_material_v1",
      content: clone(record),
      migrationRequired: true
    } : materialReviewContent(record, registry);
    return {
      taskId: `material:${registry}:${materialId}`,
      taskType: "material_review",
      registry,
      materialId,
      name: record.name,
      state: evidenceBlockers.length ? "blocked_pending_evidence" : "awaiting_professional_review",
      publicationEligible: false,
      requiredRoles: REQUIRED_MATERIAL_ROLES.slice(),
      contentVersion: registry === "external_food" ? externalFoods.contentVersion :
        (isLegacy ? recipeData.contentVersion : ingredientData.contentVersion),
      rulesVersion: ruleSet.contentVersion,
      reviewDueAt,
      subjectDigest: isLegacy ? rawDigest(reviewContent) : materialDigest(record, registry),
      reviewDomains: REVIEW_DOMAINS.slice(),
      missingDomains: isLegacy ? REVIEW_DOMAINS.slice() : missingEvidenceDomains(record, registry),
      directSourceIds: {
        identity: isLegacy ? [] : identitySourceIds(record, registry),
        regulatory: isLegacy ? [] : sourceIdList(record, "regulatory"),
        foodUse: isLegacy ? [] : sourceIdList(record, "foodUse"),
        safety: isLegacy ? [] : sourceIdList(record, "safety")
      },
      occurrenceEvidence: registry === "external_food" ? clone(asArray(record.occurrenceEvidence)) : [],
      sources: sourceSummary(record),
      uses: clone(taskUses),
      reviewContent: clone(reviewContent),
      currentProfessionalReviewState: record.audit.professionalReviewState,
      evidenceBlockers,
      blockers: evidenceBlockers.slice()
    };
  });
  const readyMaterialIds = new Set(materialTasks.filter((task) => !task.blockers.length).map((task) => task.taskId));
  const recipeTasks = recipeData.recipes.map((recipe) => {
    const prerequisiteMaterialTaskIds = unique(asArray(recipe.bundle.ingredients)
      .map((line) => {
        const reference = materialReferenceForLine(recipe, line);
        return `material:${reference.registry}:${reference.materialId}`;
      }));
    const technicalFindings = unique(recipeSafety.recipeTechnicalChecks(
      recipe, ingredientData.ingredients, recipeData.targets, externalFoods, recipeData.sources
    ));
    const reviewOrReleaseOwnedFindings = new Set([
      "recipe_not_published", "target_not_release_ready", "recipe_review_pending",
      "recipe_safety_review_pending", "recipe_reviewer_missing", "final_approval_missing_or_expired"
    ]);
    const technicalBlockers = technicalFindings.filter((finding) => !reviewOrReleaseOwnedFindings.has(finding));
    const prerequisiteBlockers = prerequisiteMaterialTaskIds
      .filter((taskId) => !readyMaterialIds.has(taskId))
      .map((taskId) => `material_prerequisite_not_ready:${taskId}`);
    const blockers = unique([...technicalBlockers, ...prerequisiteBlockers]);
    const bundleDigest = expectedRecipeBundleDigest(recipe);
    const sourceTextDigest = expectedRecipeSourceTextDigest(recipe);
    return {
      taskId: `recipe:${recipe.id}`,
      taskType: "recipe_review",
      recipeId: recipe.id,
      name: recipe.name,
      state: prerequisiteBlockers.length ? "blocked_pending_materials" :
        (technicalBlockers.length ? "blocked_pending_recipe_fixes" : "awaiting_professional_review"),
      publicationEligible: false,
      requiredRoles: REQUIRED_RECIPE_ROLES.slice(),
      contentVersion: recipe.contentVersion,
      rulesVersion: recipe.rulesVersion,
      reviewDueAt,
      subjectDigest: sha256Value({ bundleDigest, sourceTextDigest }),
      expectedBundleDigest: bundleDigest,
      expectedSourceTextDigest: sourceTextDigest,
      currentBundleDigest: recipe.bundle.bundleDigest,
      currentSourceTextDigest: recipe.bundle.sourceTextDigest,
      sourceLocator: clone(recipe.sourceLocator),
      prerequisiteMaterialTaskIds,
      technicalFindings,
      technicalBlockers,
      prerequisiteBlockers,
      reviewContent: {
        bundle: normalizedRecipeBundle(recipe),
        sourceText: normalizedRecipeSourceText(recipe)
      },
      blockers
    };
  });
  const packetCore = {
    schemaVersion: SCHEMA_VERSION,
    packetId: PACKET_ID,
    generatedFromReleaseId,
    packetIssuedAt,
    reviewDueAt,
    reviewWindowDays: REVIEW_WINDOW_DAYS,
    scope: "private_professional_review_handoff",
    stage: "materials_before_recipes",
    trustMode: TRUST_MODE,
    applicationPolicy: APPLICATION_POLICY,
    publicationEligible: false,
    catalogContentVersion: ingredientData.contentVersion,
    recipeContentVersion: recipeData.contentVersion,
    externalFoodContentVersion: externalFoods.contentVersion,
    rulesVersion: ruleSet.contentVersion,
    requiredMaterialRoles: REQUIRED_MATERIAL_ROLES.slice(),
    requiredRecipeRoles: REQUIRED_RECIPE_ROLES.slice(),
    materialTaskCount: materialTasks.length,
    catalogMaterialTaskCount: materialTasks.filter((task) => task.registry === "official_catalog").length,
    externalFoodTaskCount: materialTasks.filter((task) => task.registry === "external_food").length,
    recipeTaskCount: recipeTasks.length,
    reviewableMaterialTaskCount: materialTasks.filter((task) => !task.evidenceBlockers.length).length,
    reviewableRecipeTaskCount: recipeTasks.filter((task) => !task.blockers.length).length,
    materialTasks,
    recipeTasks
  };
  if (profile.kind === "full") return { ...packetCore, packetDigest: sha256Value(packetCore) };

  const selectedRecipeIdSet = new Set(profile.selectedRecipeIds);
  const selectedRecipeTasks = recipeTasks.filter((task) => selectedRecipeIdSet.has(task.recipeId));
  ensure(selectedRecipeTasks.length === profile.selectedRecipeIds.length &&
    selectedRecipeTasks.every((task, index) => task.recipeId === profile.selectedRecipeIds[index]),
  "scope", "selected recipe profile no longer resolves exactly");
  const selectedRecipeLineIds = new Map(selectedRecipeTasks.map((task) => [
    task.recipeId,
    new Set(asArray(task.reviewContent && task.reviewContent.bundle && task.reviewContent.bundle.ingredients)
      .map((line) => line.lineId))
  ]));
  const ingredientLineCount = [...selectedRecipeLineIds.values()]
    .reduce((total, lineIds) => total + lineIds.size, 0);
  const materialClosureIds = unique(selectedRecipeTasks
    .flatMap((task) => task.prerequisiteMaterialTaskIds));
  const materialByTaskId = new Map(materialTasks.map((task) => [task.taskId, task]));
  const selectedMaterialTasks = materialClosureIds.map((taskId) => {
    const task = materialByTaskId.get(taskId);
    ensure(Boolean(task), "scope", `selected recipe prerequisite is unresolved: ${taskId}`);
    const projected = clone(task);
    projected.uses = task.uses.filter((use) => selectedRecipeIdSet.has(use.recipeId) &&
      selectedRecipeLineIds.get(use.recipeId).has(use.lineId));
    projected.occurrenceEvidence = task.occurrenceEvidence.filter((evidence) =>
      selectedRecipeIdSet.has(evidence.recipeId) && selectedRecipeLineIds.get(evidence.recipeId).has(evidence.lineId));
    ensure(projected.uses.length > 0, "scope", `selected material has no selected-recipe use: ${taskId}`);
    return projected;
  });
  ensure(selectedRecipeTasks.length === profile.expectedRecipeTaskCount &&
    ingredientLineCount === profile.expectedRecipeIngredientLineCount &&
    selectedMaterialTasks.length === profile.expectedMaterialTaskCount &&
    selectedMaterialTasks.reduce((total, task) => total + task.uses.length, 0) === profile.expectedRecipeIngredientLineCount,
  "scope", "selected recipe exact material closure count drifted");

  const scopePolicy = {
    mode: "single_recipe_exact_material_closure",
    selectedRecipeIds: profile.selectedRecipeIds.slice(),
    materialClosurePolicy: "derived_from_selected_recipe_prerequisite_material_task_ids_exact",
    materialUseProjectionPolicy: "selected_recipe_and_line_context_only",
    expectedCounts: {
      recipeTasks: profile.expectedRecipeTaskCount,
      recipeIngredientLines: profile.expectedRecipeIngredientLineCount,
      materialTasks: profile.expectedMaterialTaskCount
    },
    omittedRecipeDecisionPolicy: "no_inference",
    submissionReusePolicy: "packet_digest_bound_no_cross_packet_reuse",
    formalDecisionAuthority: "none",
    materialDecisionScope: "selected_recipe_use_context_only_no_global_material_transition",
    fullFormalRecipeTechnicalCheckDigest: sha256Value(recipeTasks.map((task) => ({
      recipeId: task.recipeId,
      prerequisiteMaterialTaskIds: task.prerequisiteMaterialTaskIds,
      technicalFindings: task.technicalFindings,
      technicalBlockers: task.technicalBlockers
    })))
  };
  const scopedCore = {
    ...packetCore,
    packetId: profile.packetId,
    scope: "private_professional_review_handoff_selected_recipe_use_context_only",
    materialTaskCount: selectedMaterialTasks.length,
    catalogMaterialTaskCount: selectedMaterialTasks.filter((task) => task.registry === "official_catalog").length,
    externalFoodTaskCount: selectedMaterialTasks.filter((task) => task.registry === "external_food").length,
    recipeTaskCount: selectedRecipeTasks.length,
    reviewableMaterialTaskCount: selectedMaterialTasks.filter((task) => !task.evidenceBlockers.length).length,
    reviewableRecipeTaskCount: selectedRecipeTasks.filter((task) => !task.blockers.length).length,
    scopePolicy,
    materialTasks: selectedMaterialTasks,
    recipeTasks: selectedRecipeTasks
  };
  return { ...scopedCore, packetDigest: sha256Value(scopedCore) };
}

function validatePacket(packet, options) {
  const settings = options || {};
  const expected = buildPacket({ ...settings, profileKey: settings.profileKey || profileKeyForPacket(packet) });
  ensure(canonicalJson(packet) === canonicalJson(expected), "packet_drift", "professional review packet is stale or hand-edited");
  return expected;
}

function reviewerRegistryTemplate(packet) {
  return {
    schemaVersion: SCHEMA_VERSION,
    contentVersion: "2026.08.12-reviewer-registry.2",
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    scope: "private_professional_review_routing",
    trustMode: TRUST_MODE,
    approvalAuthority: false,
    privacyNotice: "仅保存随机不可推导的审阅人引用和外部资质证据引用；不得保存姓名、证件号、执业证号原文、联系方式、签名图片或其他敏感个人信息。仓库不验证真人身份或资质。",
    reviewers: []
  };
}

function resultsTemplate(packet) {
  return {
    schemaVersion: SCHEMA_VERSION,
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    scope: "private_professional_review_submissions",
    validationMode: TRUST_MODE,
    applicationPolicy: APPLICATION_POLICY,
    submissions: []
  };
}

function validateReviewerRegistry(registry, packet, options) {
  exactKeys(registry, [
    "schemaVersion", "contentVersion", "packetId", "packetDigest", "scope", "trustMode",
    "approvalAuthority", "privacyNotice", "reviewers"
  ], "reviewer registry");
  ensure(registry.schemaVersion === SCHEMA_VERSION && nonEmpty(registry.contentVersion) &&
    registry.packetId === packet.packetId && registry.packetDigest === packet.packetDigest &&
    registry.scope === "private_professional_review_routing" && registry.trustMode === TRUST_MODE &&
    registry.approvalAuthority === false && nonEmpty(registry.privacyNotice), "reviewer_registry", "reviewer registry metadata is invalid");
  ensure(Array.isArray(registry.reviewers), "reviewer_registry", "reviewers must be an array");
  const now = evaluationNow(options);
  const ids = new Set();
  const credentialRefs = new Set();
  for (const [index, reviewer] of registry.reviewers.entries()) {
    const label = `reviewers[${index}]`;
    exactKeys(reviewer, [
      "reviewerRef", "authorizedRoles", "credentialEvidenceRef", "organizationEvidenceRef",
      "routingState", "verificationState", "credentialWindowStart", "credentialWindowEnd"
    ], label);
    ensure(REVIEWER_REF.test(reviewer.reviewerRef || "") && !ids.has(reviewer.reviewerRef), "reviewer_registry", `${label}.reviewerRef is invalid or duplicated`);
    ids.add(reviewer.reviewerRef);
    ensure(Array.isArray(reviewer.authorizedRoles) && reviewer.authorizedRoles.length &&
      reviewer.authorizedRoles.every((role) => ALL_ROLES.includes(role)) &&
      new Set(reviewer.authorizedRoles).size === reviewer.authorizedRoles.length, "reviewer_registry", `${label}.authorizedRoles is invalid`);
    ensure(EVIDENCE_REF.test(reviewer.credentialEvidenceRef || "") && EVIDENCE_REF.test(reviewer.organizationEvidenceRef || ""), "reviewer_registry", `${label} evidence references are invalid`);
    ensure(!credentialRefs.has(reviewer.credentialEvidenceRef), "reviewer_registry", `${label}.credentialEvidenceRef is reused by another reviewer reference`);
    credentialRefs.add(reviewer.credentialEvidenceRef);
    ensure(reviewer.routingState === "active" && reviewer.verificationState === "not_verified_by_repository", "reviewer_registry", `${label} cannot claim repository-verified authority`);
    if (reviewer.credentialWindowStart === null || reviewer.credentialWindowEnd === null) {
      ensure(reviewer.credentialWindowStart === null && reviewer.credentialWindowEnd === null, "reviewer_registry", `${label} credential-window dates must both be null or both be present`);
    } else {
      const windowStart = strictDate(reviewer.credentialWindowStart, `${label}.credentialWindowStart`);
      const windowEnd = strictDate(reviewer.credentialWindowEnd, `${label}.credentialWindowEnd`);
      ensure(windowStart <= now && windowEnd > windowStart, "reviewer_registry", `${label} credential-window dates are inconsistent`);
    }
  }
  return registry;
}

function latestSubmissionByTaskRole(submissions) {
  const groups = new Map();
  submissions.forEach((submission) => {
    const key = `${submission.taskId}|${submission.role}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(submission);
  });
  const latest = new Map();
  for (const [key, group] of groups) {
    group.sort((left, right) => left.reviewRound - right.reviewRound);
    group.forEach((submission, index) => {
      ensure(submission.reviewRound === index + 1, "revision", `${key} review rounds must be contiguous from 1`);
      const expectedPrevious = index === 0 ? null : group[index - 1].submissionId;
      ensure(submission.supersedesSubmissionId === expectedPrevious, "revision", `${key} supersedes chain is invalid`);
      if (index > 0) {
        ensure(new Date(submission.reviewedAt) > new Date(group[index - 1].reviewedAt), "revision", `${key} revised submission must be later than the prior round`);
      }
    });
    latest.set(key, group[group.length - 1]);
  }
  return latest;
}

function taskRecommendationReady(task, latest) {
  if (task.blockers.length) return false;
  return task.requiredRoles.every((role) => {
    const submission = latest.get(`${task.taskId}|${role}`);
    return submission && submission.recommendation === "ready_for_next_gate";
  });
}

function evaluateResultsEnvelope(envelope, packet, reviewerRegistry, options) {
  const settings = options || {};
  const packetProfileKey = profileKeyForPacket(packet);
  exactKeys(envelope, [
    "schemaVersion", "packetId", "packetDigest", "scope", "validationMode", "applicationPolicy", "submissions"
  ], "review submissions");
  ensure(envelope.schemaVersion === SCHEMA_VERSION && envelope.packetId === packet.packetId &&
    envelope.packetDigest === packet.packetDigest && envelope.scope === "private_professional_review_submissions" &&
    envelope.validationMode === TRUST_MODE && envelope.applicationPolicy === APPLICATION_POLICY &&
    Array.isArray(envelope.submissions), "results", "review submissions envelope is invalid");
  validateReviewerRegistry(reviewerRegistry, packet, options);
  const now = evaluationNow(options);
  const packetIssuedAt = strictTimestamp(packet.packetIssuedAt, "packet.packetIssuedAt");
  const reviewDueAt = strictTimestamp(packet.reviewDueAt, "packet.reviewDueAt");
  ensure(!Number.isNaN(packetIssuedAt.getTime()) && packetIssuedAt <= now, "date", "packet source activation timestamp is invalid or future-dated");
  ensure(reviewDueAt > packetIssuedAt, "date", "packet review deadline is invalid");
  const reviewerById = new Map(reviewerRegistry.reviewers.map((reviewer) => [reviewer.reviewerRef, reviewer]));
  const taskById = new Map([...packet.materialTasks, ...packet.recipeTasks].map((task) => [task.taskId, task]));
  const submissionIds = new Set();
  for (const [index, submission] of envelope.submissions.entries()) {
    const label = `submissions[${index}]`;
    exactKeys(submission, [
      "submissionId", "taskId", "reviewRound", "supersedesSubmissionId", "role", "reviewerRef",
      "recommendation", "reviewedAt", "credentialEvidenceRef", "packetDigest", "contentVersion",
      "rulesVersion", "subjectDigest", "findingCodes", "evidenceRefs", "attestationCode",
      "signatureEvidenceRef", "signatureVerificationState"
    ], label);
    const task = taskById.get(submission.taskId);
    const reviewer = reviewerById.get(submission.reviewerRef);
    ensure(task && reviewer, "results", `${label} references unknown task/reviewer`);
    ensure(SUBMISSION_ID.test(submission.submissionId || "") && !submissionIds.has(submission.submissionId), "results", `${label}.submissionId is invalid or duplicated`);
    submissionIds.add(submission.submissionId);
    ensure(Number.isInteger(submission.reviewRound) && submission.reviewRound >= 1 && submission.reviewRound <= 100, "results", `${label}.reviewRound is invalid`);
    ensure(submission.supersedesSubmissionId === null || SUBMISSION_ID.test(submission.supersedesSubmissionId || ""), "results", `${label}.supersedesSubmissionId is invalid`);
    ensure(task.requiredRoles.includes(submission.role) && reviewer.authorizedRoles.includes(submission.role), "results", `${label}.role is not authorized for routing`);
    ensure(reviewer.credentialEvidenceRef === submission.credentialEvidenceRef, "results", `${label} credential evidence reference drifted`);
    ensure(submission.packetDigest === packet.packetDigest && submission.contentVersion === task.contentVersion &&
      submission.rulesVersion === task.rulesVersion && submission.subjectDigest === task.subjectDigest, "results", `${label} packet/content/rules/subject binding drifted`);
    ensure(RECOMMENDATIONS.includes(submission.recommendation), "results", `${label}.recommendation is invalid`);
    const reviewedAt = strictTimestamp(submission.reviewedAt, `${label}.reviewedAt`);
    const taskDueAt = strictTimestamp(task.reviewDueAt, `${label}.task.reviewDueAt`);
    ensure(reviewedAt >= packetIssuedAt && reviewedAt <= now && reviewedAt < reviewDueAt && reviewedAt < taskDueAt,
      "results", `${label}.reviewedAt is outside the current packet window`);
    if (reviewer.credentialWindowStart !== null) {
      const verifiedAt = strictDate(reviewer.credentialWindowStart, `${label}.reviewer.credentialWindowStart`);
      const expiresExclusive = strictDate(reviewer.credentialWindowEnd, `${label}.reviewer.credentialWindowEnd`);
      expiresExclusive.setUTCDate(expiresExclusive.getUTCDate() + 1);
      ensure(reviewedAt >= verifiedAt && reviewedAt < expiresExclusive, "results", `${label}.reviewedAt is outside the asserted credential window`);
    }
    ensure(Array.isArray(submission.findingCodes) && submission.findingCodes.length <= 40 &&
      submission.findingCodes.every((code) => FINDING_CODE.test(code)) &&
      new Set(submission.findingCodes).size === submission.findingCodes.length, "results", `${label}.findingCodes are invalid`);
    ensure(Array.isArray(submission.evidenceRefs) && submission.evidenceRefs.length <= 40 &&
      submission.evidenceRefs.every((reference) => EVIDENCE_REF.test(reference)) &&
      new Set(submission.evidenceRefs).size === submission.evidenceRefs.length, "results", `${label}.evidenceRefs are invalid`);
    ensure(submission.attestationCode === "human_review_claim_not_verified_by_repository" &&
      submission.signatureVerificationState === "not_verified_by_repository" &&
      (submission.signatureEvidenceRef === null || EVIDENCE_REF.test(submission.signatureEvidenceRef)), "results", `${label} must remain an unverified external human-review claim`);
    if (submission.recommendation === "ready_for_next_gate") {
      ensure(task.blockers.length === 0, "task_blocked", `${label} cannot recommend readiness while the task has unresolved blockers`);
      ensure(reviewer.credentialWindowStart !== null && reviewer.credentialWindowEnd !== null,
        "reviewer_registry", `${label} readiness requires an asserted credential window`);
    }
  }

  const latest = latestSubmissionByTaskRole(envelope.submissions);
  for (const task of [...packet.materialTasks, ...packet.recipeTasks]) {
    const taskSubmissions = envelope.submissions.filter((submission) => submission.taskId === task.taskId);
    const reviewerRoles = new Map();
    for (const submission of taskSubmissions) {
      const priorRole = reviewerRoles.get(submission.reviewerRef);
      ensure(!priorRole || priorRole === submission.role, "independence",
        `${task.taskId} review history must not reuse one reviewer reference across roles`);
      reviewerRoles.set(submission.reviewerRef, submission.role);
    }
    const latestForRoles = task.requiredRoles.map((role) => latest.get(`${task.taskId}|${role}`)).filter(Boolean);
    if (latestForRoles.length) {
      ensure(new Set(latestForRoles.map((submission) => submission.reviewerRef)).size === latestForRoles.length,
        "independence", `${task.taskId} latest role submissions must use distinct reviewer references`);
    }
  }

  const materialRecommendationReady = new Set(packet.materialTasks
    .filter((task) => taskRecommendationReady(task, latest)).map((task) => task.taskId));
  const materialCompletionTime = new Map(packet.materialTasks.map((task) => {
    if (!materialRecommendationReady.has(task.taskId)) return [task.taskId, null];
    const times = task.requiredRoles.map((role) => latest.get(`${task.taskId}|${role}`))
      .map((submission) => new Date(submission.reviewedAt).getTime());
    return [task.taskId, new Date(Math.max(...times))];
  }));
  for (const task of packet.recipeTasks) {
    const recipeSubmissions = envelope.submissions.filter((submission) => submission.taskId === task.taskId);
    if (!recipeSubmissions.length) continue;
    ensure(task.prerequisiteMaterialTaskIds.every((taskId) => materialRecommendationReady.has(taskId)), "sequence", `${task.taskId} submissions cannot precede all prerequisite material recommendations`);
    if (task.prerequisiteMaterialTaskIds.length) {
      const prerequisitesCompletedAt = new Date(Math.max(...task.prerequisiteMaterialTaskIds
        .map((taskId) => materialCompletionTime.get(taskId).getTime())));
      ensure(recipeSubmissions.every((submission) => new Date(submission.reviewedAt) > prerequisitesCompletedAt),
        "sequence", `${task.taskId} submissions must be later than every prerequisite material completion`);
    }
    const releaseSubmission = latest.get(`${task.taskId}|release_approver`);
    if (releaseSubmission && releaseSubmission.recommendation === "ready_for_next_gate") {
      const priorRoles = task.requiredRoles.filter((role) => role !== "release_approver")
        .map((role) => latest.get(`${task.taskId}|${role}`));
      ensure(priorRoles.every((submission) => submission && submission.recommendation === "ready_for_next_gate"), "sequence", `${task.taskId} release recommendation requires all prior role recommendations`);
      const releaseTime = new Date(releaseSubmission.reviewedAt);
      ensure(priorRoles.every((submission) => new Date(submission.reviewedAt) < releaseTime), "sequence", `${task.taskId} release recommendation must be later than all prior role recommendations`);
    }
  }

  const recipeRecommendationReady = packet.recipeTasks.filter((task) =>
    taskRecommendationReady(task, latest) && task.prerequisiteMaterialTaskIds.every((taskId) => materialRecommendationReady.has(taskId))
  );
  const taskSummaries = [...packet.materialTasks, ...packet.recipeTasks].map((task) => {
    const latestForTask = task.requiredRoles.map((role) => latest.get(`${task.taskId}|${role}`)).filter(Boolean);
    const declaredReady = taskRecommendationReady(task, latest);
    const distinctReviewerRefs = latestForTask.length > 0 &&
      new Set(latestForTask.map((submission) => submission.reviewerRef)).size === latestForTask.length;
    return {
      taskId: task.taskId,
      blockerCount: task.blockers.length,
      currentRoleSubmissionCount: latestForTask.length,
      distinctReviewerRefs,
      declaredRecommendationComplete: declaredReady,
      workflowGateSatisfied: task.taskType === "material_review" ? materialRecommendationReady.has(task.taskId) :
        recipeRecommendationReady.some((candidate) => candidate.taskId === task.taskId)
    };
  });
  const workflowGateSatisfied = taskSummaries.length > 0 && taskSummaries.every((summary) => summary.workflowGateSatisfied) && now < reviewDueAt;
  const declaredApprovalComplete = taskSummaries.length > 0 && taskSummaries.every((summary) => summary.declaredRecommendationComplete);
  const result = {
    schemaValid: true,
    bindingValid: true,
    mode: "advisory",
    identityAssurance: "unverified",
    authorizationVerified: false,
    workflowGateSatisfied,
    declaredApprovalComplete,
    approvalReady: false,
    publicationEligible: false,
    applicationAllowed: false,
    submissionCount: envelope.submissions.length,
    materialRecommendationReadyCount: materialRecommendationReady.size,
    recipeRecommendationReadyCount: recipeRecommendationReady.length,
    approvalBlockingReasons: [
      "trusted_reviewer_identity_unavailable",
      "cryptographic_attestation_unavailable",
      ...(now >= reviewDueAt ? ["review_window_expired"] : []),
      ...(!workflowGateSatisfied ? ["workflow_gate_not_satisfied"] : [])
    ],
    taskSummaries,
    applied: false,
    advisoryPatchPlan: [],
    nonApplicationReason: "The repository validates structure and version bindings only; it cannot verify human identity, credentials or signatures."
  };
  if (packetProfileKey !== DEFAULT_PROFILE_KEY) {
    return {
      ...result,
      globalReleaseGateSatisfied: false,
      scopedDecisionAuthority: "none",
      materialDecisionScope: "selected_recipe_use_context_only_no_global_material_transition",
      scopedNonAuthorityReason: "This packet records advisory review only for the selected recipe use context; it cannot transition shared materials globally or make a formal release decision."
    };
  }
  return result;
}

function validateResultsEnvelope(envelope, packet, reviewerRegistry, options) {
  const settings = options || {};
  // Production callers cannot supply an arbitrary release clock. The packet must always
  // be derived from the release that version verification says is active (or restored).
  const { verifyWorkspace } = require("./version-core");
  const verified = verifyWorkspace(ROOT, settings.versionVerificationOptions);
  const authoritativeOptions = packetBuildOptionsFromVerification(verified);
  const verifiedPacket = validatePacket(packet, authoritativeOptions);
  return evaluateResultsEnvelope(envelope, verifiedPacket, reviewerRegistry, settings);
}

function evaluateSyntheticResultsForTest(envelope, packet, reviewerRegistry, options) {
  ensure(process.env.NODE_ENV === "test", "results", "synthetic review evaluation is test-only");
  return evaluateResultsEnvelope(envelope, packet, reviewerRegistry, options || {});
}

function loadPacket(profileKey) {
  return readJson(packetPaths(profileKey).manifestRelative, "professional review packet");
}
function loadReviewerRegistry(profileKey) {
  return readJson(packetPaths(profileKey).reviewerRegistryRelative, "professional reviewer registry");
}
function loadResults(profileKey) {
  return readJson(packetPaths(profileKey).resultsRelative, "professional review submissions");
}

module.exports = {
  APPLICATION_POLICY, DEFAULT_PROFILE_KEY, FIRST_RELEASE_PROFILE_KEY, MANIFEST_RELATIVE, PACKET_ID, PRIVATE_PREFIX, RESULTS_RELATIVE,
  REVIEWER_REGISTRY_RELATIVE, REVIEW_RELATIVE, ROOT, SCHEMA_VERSION, TRUST_MODE,
  ProfessionalReviewError, REQUIRED_MATERIAL_ROLES, REQUIRED_RECIPE_ROLES, REVIEW_WINDOW_DAYS,
  buildPacket, canonicalJson, evaluateSyntheticResultsForTest, loadPacket, loadResults, loadReviewerRegistry,
  packetBuildOptionsFromVerification, packetDigestFor, packetPaths, profileFromCli, profileKeyForPacket, profileKeys, rawDigest, readJson, resolveProfile,
  resultsTemplate, reviewerRegistryTemplate, sha256Value,
  validatePacket, validateReviewerRegistry, validateResultsEnvelope
};
