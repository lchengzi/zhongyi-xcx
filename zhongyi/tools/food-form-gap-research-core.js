"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { expectedIngredientReviewDigest } = require("./recipe-digests");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_RELATIVE = "content-private/media-candidates/food-form-gap-upgrades/research-catalog.json";
const MANIFEST_RELATIVE = "content-private/media-candidates/food-form-gap-upgrades/manifest.json";
const REVIEW_RELATIVE = "content-private/media-candidates/food-form-gap-upgrades/review-index.html";
const FOOD_FORM_CATALOG_RELATIVE = "content-private/media-candidates/food-forms/food-form-catalog.json";
const SCHEMA_VERSION = "1.0.0";

const APPROVED_RECORD_DIGESTS = Object.freeze({
  "gap-research-gou-qi-zi-frontiers-figure5-v01": "sha256:49434b1cc0c5f6b1ae673cf2a9bb93794db68219736a008d3dd6fd98d5a4961c",
  "gap-research-di-huang-mdpi-figure1-v01": "sha256:3236130abd9204355ae225152037e3fbed45e82af96618c0d9edf903978f470b",
  "gap-research-tian-dong-frontiers-figure1-v01": "sha256:12c19d87120ba8524352425afc2311ed6518707448a4dc8036227ce487562560"
});
const EXPECTED_RECORD_IDS = Object.freeze(Object.keys(APPROVED_RECORD_DIGESTS));
const SOURCE_CONTRACTS = Object.freeze({
  "gap-research-gou-qi-zi-frontiers-figure5-v01": {
    provider: "Frontiers Media SA", articleHost: "www.frontiersin.org", doiPrefix: "10.3389/",
    pmcid: "PMC5834758", articleType: "original_research", figureHost: "www.frontiersin.org",
    leadState: "reviewed_unresolved_exact_sample"
  },
  "gap-research-di-huang-mdpi-figure1-v01": {
    provider: "MDPI", articleHost: "www.mdpi.com", doiPrefix: "10.3390/",
    pmcid: "PMC9394425", articleType: "original_research", figureHost: null,
    leadState: "candidate_fresh_tuber_context_pending_voucher"
  },
  "gap-research-tian-dong-frontiers-figure1-v01": {
    provider: "Frontiers Media SA", articleHost: "www.frontiersin.org", doiPrefix: "10.3389/",
    pmcid: "PMC9748433", articleType: "review", figureHost: "www.frontiersin.org",
    leadState: "candidate_review_figure_pending_original_source"
  }
});

class GapResearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GapResearchError";
    this.code = code;
  }
}

function fail(code, message) { throw new GapResearchError(code, message); }
function ensure(condition, code, message) { if (!condition) fail(code, message); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }

function exactKeys(value, keys, label) {
  ensure(isObject(value), "shape", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  ensure(JSON.stringify(actual) === JSON.stringify(expected), "shape", `${label} fields drifted`);
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

function readJson(relative, label) {
  const file = path.resolve(ROOT, ...relative.split("/"));
  ensure(file.startsWith(`${ROOT}${path.sep}`), "path", `${label} escapes the workspace`);
  ensure(fs.existsSync(file), "missing", `${label} is missing`);
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "path", `${label} must be a regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { fail("json", `${label} is invalid JSON: ${error.message}`); }
}

function checkDate(value, label) {
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(value || ""), "date", `${label} is invalid`);
  const date = new Date(`${value}T00:00:00Z`);
  ensure(!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value, "date", `${label} is invalid`);
}

function checkHttps(value, hosts, label) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { fail("source", `${label} is invalid`); }
  ensure(parsed.protocol === "https:" && hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)), "source", `${label} is outside the approved hosts`);
}

function parsedHttps(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { fail("source", `${label} is invalid`); }
  ensure(parsed.protocol === "https:", "source", `${label} must use HTTPS`);
  return parsed;
}

function validateSource(source, record, label) {
  exactKeys(source, [
    "provider", "articleTitle", "articleUrl", "doi", "pmcid", "articleType", "figureLabel",
    "figureCaption", "figureUrl", "authors", "copyright", "licenseName", "licenseUrl", "status", "checkedAt"
  ], label);
  ["provider", "articleTitle", "articleUrl", "doi", "articleType", "figureLabel", "figureCaption", "copyright", "licenseName", "licenseUrl", "status"].forEach((key) =>
    ensure(nonEmpty(source[key]), "source", `${label}.${key} is required`));
  ensure(source.pmcid === null || /^PMC\d+$/.test(source.pmcid), "source", `${label}.pmcid is invalid`);
  ensure(["original_research", "review"].includes(source.articleType), "source", `${label}.articleType is invalid`);
  ensure(Array.isArray(source.authors) && source.authors.length >= 2 && source.authors.every(nonEmpty), "source", `${label}.authors is invalid`);
  ensure(new Set(source.authors).size === source.authors.length, "source", `${label}.authors contains duplicates`);
  checkHttps(source.articleUrl, ["frontiersin.org", "mdpi.com"], `${label}.articleUrl`);
  if (source.figureUrl !== null) checkHttps(source.figureUrl, ["frontiersin.org"], `${label}.figureUrl`);
  ensure(source.licenseName === "CC BY 4.0" && source.licenseUrl === "https://creativecommons.org/licenses/by/4.0/", "rights", `${label} license drifted`);
  ensure(source.status === "published", "source", `${label}.status must remain published`);
  checkDate(source.checkedAt, `${label}.checkedAt`);
  const contract = SOURCE_CONTRACTS[record.id];
  ensure(contract && source.provider === contract.provider && source.articleType === contract.articleType &&
    record.leadState === contract.leadState && source.doi.startsWith(contract.doiPrefix) &&
    source.pmcid === contract.pmcid, "source_contract", `${label} provider/article/lead contract drifted`);
  ensure(parsedHttps(source.articleUrl, `${label}.articleUrl`).hostname === contract.articleHost,
    "source_contract", `${label}.articleUrl host drifted`);
  if (contract.figureHost === null) {
    ensure(source.figureUrl === null, "source_contract", `${label}.figureUrl must remain unresolved`);
  } else {
    ensure(nonEmpty(source.figureUrl) && parsedHttps(source.figureUrl, `${label}.figureUrl`).hostname === contract.figureHost,
      "source_contract", `${label}.figureUrl host drifted`);
  }
}

function validateCatalog(catalog, ingredientData, foodFormCatalog, ruleSet) {
  exactKeys(catalog, ["schemaVersion", "contentVersion", "reviewAsOf", "scope", "publicationEligible", "records"], "research catalog");
  ensure(catalog.schemaVersion === SCHEMA_VERSION && nonEmpty(catalog.contentVersion), "version", "research catalog version is unsupported");
  checkDate(catalog.reviewAsOf, "research catalog.reviewAsOf");
  ensure(catalog.scope === "private_research_only" && catalog.publicationEligible === false, "scope", "research catalog must remain private and ineligible");
  ensure(ingredientData && Array.isArray(ingredientData.ingredients), "binding", "ingredient catalog is unavailable");
  ensure(foodFormCatalog && Array.isArray(foodFormCatalog.gaps), "binding", "food-form gap catalog is unavailable");
  ensure(ruleSet && nonEmpty(ruleSet.contentVersion), "binding", "rule set is unavailable");
  ensure(Array.isArray(catalog.records) && catalog.records.length === Object.keys(APPROVED_RECORD_DIGESTS).length, "coverage", "research lead count drifted");
  const ingredientById = new Map(ingredientData.ingredients.map((item) => [item.id, item]));
  const gapById = new Map(foodFormCatalog.gaps.map((item) => [item.id, item]));
  const ids = new Set();
  const ingredients = new Set();

  ensure(JSON.stringify(catalog.records.map((record) => record.id)) === JSON.stringify(EXPECTED_RECORD_IDS),
    "coverage", "research lead set or order drifted");
  ensure(JSON.stringify(foodFormCatalog.gaps.map((gap) => gap.id)) === JSON.stringify(catalog.records.map((record) => record.existingGapId)),
    "coverage", "research leads must exactly and in order cover every current food-form gap");
  catalog.records.forEach((record, index) => {
    const label = `records[${index}]`;
    exactKeys(record, ["id", "ingredientId", "existingGapId", "leadState", "source", "evidence", "decision", "nextActions"], label);
    ensure(nonEmpty(record.id) && !ids.has(record.id), "binding", `${label}.id is invalid or duplicated`);
    ensure(APPROVED_RECORD_DIGESTS[record.id] === sha256Value(record), "approved_binding", `${label} differs from its independently approved research snapshot`);
    ids.add(record.id);
    ensure(!ingredients.has(record.ingredientId), "coverage", `${label}.ingredientId is duplicated`);
    ingredients.add(record.ingredientId);
    const ingredient = ingredientById.get(record.ingredientId);
    const gap = gapById.get(record.existingGapId);
    ensure(ingredient, "binding", `${label} targets an unknown ingredient`);
    ensure(gap && gap.ingredientId === record.ingredientId, "binding", `${label} does not match the existing gap`);
    ensure([
      "reviewed_unresolved_exact_sample",
      "candidate_fresh_tuber_context_pending_voucher",
      "candidate_review_figure_pending_original_source"
    ].includes(record.leadState), "shape", `${label}.leadState is invalid`);
    validateSource(record.source, record, `${label}.source`);
    ensure(record.source.checkedAt <= catalog.reviewAsOf, "date", `${label}.source.checkedAt is later than reviewAsOf`);
    exactKeys(record.evidence, ["sourceTaxonLabels", "materialContext", "processingContext", "provenanceStrength", "figureRelationState", "unresolved"], `${label}.evidence`);
    ensure(Array.isArray(record.evidence.sourceTaxonLabels) && record.evidence.sourceTaxonLabels.length && record.evidence.sourceTaxonLabels.every(nonEmpty), "shape", `${label}.sourceTaxonLabels is invalid`);
    ensure(nonEmpty(record.evidence.materialContext) && nonEmpty(record.evidence.processingContext) && nonEmpty(record.evidence.provenanceStrength) && nonEmpty(record.evidence.figureRelationState), "shape", `${label}.evidence is incomplete`);
    ensure(Array.isArray(record.evidence.unresolved) && record.evidence.unresolved.length >= 2 && record.evidence.unresolved.every(nonEmpty), "shape", `${label}.unresolved is incomplete`);
    exactKeys(record.decision, ["doesNotCloseGap", "identityUse", "partUse", "processingUse", "publicationEligible", "runtimePlacements", "rightsReviewState", "professionalReviewState"], `${label}.decision`);
    ensure(record.decision.doesNotCloseGap === true && record.decision.publicationEligible === false, "scope", `${label} cannot close the gap or become publishable`);
    ensure(record.decision.identityUse === "prohibited" && record.decision.partUse === "prohibited" && record.decision.processingUse === "prohibited", "scope", `${label} gained a prohibited use`);
    ensure(Array.isArray(record.decision.runtimePlacements) && record.decision.runtimePlacements.length === 0, "scope", `${label} gained a runtime placement`);
    ensure(record.decision.rightsReviewState === "pending" && record.decision.professionalReviewState === "pending", "review", `${label} bypassed review`);
    ensure(Array.isArray(record.nextActions) && record.nextActions.length >= 1 && record.nextActions.every(nonEmpty), "shape", `${label}.nextActions is invalid`);
  });
  ensure(ids.size === Object.keys(APPROVED_RECORD_DIGESTS).length, "coverage", "approved research lead set is incomplete");
  return { ingredientById, gapById };
}

function buildManifest(catalogInput, ingredientInput, foodFormInput, ruleInput) {
  const catalog = catalogInput || readJson(CATALOG_RELATIVE, "research catalog");
  const ingredientData = ingredientInput || require("../data/ingredients");
  const foodFormCatalog = foodFormInput || readJson(FOOD_FORM_CATALOG_RELATIVE, "food-form catalog");
  const ruleSet = ruleInput || require("../data/rule-set");
  const checked = validateCatalog(catalog, ingredientData, foodFormCatalog, ruleSet);
  const records = catalog.records.map((record) => {
    const ingredient = checked.ingredientById.get(record.ingredientId);
    const gap = checked.gapById.get(record.existingGapId);
    return {
      ...JSON.parse(JSON.stringify(record)),
      recordDigest: sha256Value(record),
      sourceMetadataDigest: sha256Value(record.source),
      evidenceDigest: sha256Value(record.evidence),
      ingredientBinding: {
        catalogContentVersion: ingredientData.contentVersion,
        rulesVersion: ruleSet.contentVersion,
        ingredientId: ingredient.id,
        ingredientDigest: expectedIngredientReviewDigest(ingredient)
      },
      gapBinding: {
        foodFormContentVersion: foodFormCatalog.contentVersion,
        gapId: gap.id,
        gapDigest: sha256Value(gap)
      }
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    contentVersion: catalog.contentVersion,
    reviewAsOf: catalog.reviewAsOf,
    scope: catalog.scope,
    sourceCatalogDigest: sha256Value(catalog),
    ingredientCatalogContentVersion: ingredientData.contentVersion,
    rulesVersion: ruleSet.contentVersion,
    foodFormContentVersion: foodFormCatalog.contentVersion,
    recordCount: records.length,
    unresolvedCount: records.filter((record) => record.decision.doesNotCloseGap).length,
    publicationEligibleCount: 0,
    runtimePlacementCount: 0,
    records
  };
}

function loadManifest() { return readJson(MANIFEST_RELATIVE, "gap research manifest"); }

function validateManifest(manifest, catalogInput, ingredientInput, foodFormInput, ruleInput) {
  const expected = buildManifest(catalogInput, ingredientInput, foodFormInput, ruleInput);
  ensure(canonicalJson(manifest) === canonicalJson(expected), "manifest_drift", "gap research manifest is stale or hand-edited");
  return expected;
}

function loadAndValidate() {
  const manifest = loadManifest();
  validateManifest(manifest);
  return manifest;
}

module.exports = {
  APPROVED_RECORD_DIGESTS,
  CATALOG_RELATIVE,
  FOOD_FORM_CATALOG_RELATIVE,
  MANIFEST_RELATIVE,
  REVIEW_RELATIVE,
  ROOT,
  SCHEMA_VERSION,
  GapResearchError,
  EXPECTED_RECORD_IDS,
  SOURCE_CONTRACTS,
  buildManifest,
  canonicalJson,
  loadManifest,
  loadAndValidate,
  readJson,
  sha256Value,
  validateCatalog,
  validateManifest
};
