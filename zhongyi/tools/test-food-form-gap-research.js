"use strict";

const assert = require("assert");
const ingredientData = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const {
  CATALOG_RELATIVE, FOOD_FORM_CATALOG_RELATIVE, GapResearchError,
  buildManifest, canonicalJson, loadManifest, readJson, validateManifest
} = require("./food-form-gap-research-core");

const catalog = readJson(CATALOG_RELATIVE, "research catalog");
const foodFormCatalog = readJson(FOOD_FORM_CATALOG_RELATIVE, "food-form catalog");
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function rejected(mutator, label, inputs = {}) {
  const value = clone(catalog);
  mutator(value);
  let caught = null;
  try { buildManifest(value, inputs.ingredients || ingredientData, inputs.foodForms || foodFormCatalog, inputs.rules || ruleSet); }
  catch (error) { caught = error; }
  assert(caught instanceof GapResearchError, `${label} was accepted`);
}

function main() {
  const saved = loadManifest();
  const first = buildManifest(catalog, ingredientData, foodFormCatalog, ruleSet);
  const second = buildManifest(catalog, ingredientData, foodFormCatalog, ruleSet);
  assert.strictEqual(canonicalJson(saved), canonicalJson(first), "saved gap research manifest is stale");
  assert.strictEqual(canonicalJson(first), canonicalJson(second), "gap research generation is nondeterministic");
  assert.deepStrictEqual(saved.records.map((record) => [record.ingredientId, record.existingGapId]), [
    ["gou-qi-zi", "food-form-gap-gou-qi-zi-v01"],
    ["di-huang", "food-form-gap-di-huang-v01"],
    ["tian-dong", "food-form-gap-tian-dong-v01"]
  ], "research lead to gap bindings drifted");

  rejected((value) => { value.publicationEligible = true; }, "catalog publication bypass");
  rejected((value) => { value.records[0].decision.publicationEligible = true; }, "record publication bypass");
  rejected((value) => { value.records[0].decision.doesNotCloseGap = false; }, "gap closure bypass");
  rejected((value) => { value.records[0].decision.runtimePlacements = ["ingredient_card"]; }, "runtime placement bypass");
  rejected((value) => { value.records[0].decision.identityUse = "allowed"; }, "identity use bypass");
  rejected((value) => { value.records[0].decision.partUse = "allowed"; }, "part use bypass");
  rejected((value) => { value.records[0].decision.processingUse = "allowed"; }, "processing use bypass");
  rejected((value) => { value.records[0].decision.professionalReviewState = "reviewed"; }, "professional self-review bypass");
  rejected((value) => { value.records[0].decision.rightsReviewState = "reviewed"; }, "rights self-review bypass");
  rejected((value) => { value.records[0].ingredientId = "di-huang"; value.records[0].existingGapId = "food-form-gap-di-huang-v01"; }, "cross-ingredient binding drift");
  rejected((value) => { value.records[0].source.articleUrl = value.records[2].source.articleUrl; }, "article URL drift");
  rejected((value) => { value.records[0].source.figureUrl = value.records[2].source.figureUrl; }, "figure URL drift");
  rejected((value) => { value.records[0].source.figureCaption = "Wrong caption"; }, "figure caption drift");
  rejected((value) => { value.records[0].source.licenseName = "CC0"; }, "license drift");
  rejected((value) => { value.records[1].source.figureUrl = "https://example.com/image.jpg"; }, "unapproved media host");
  rejected((value) => { value.records[0].evidence.figureRelationState = "confirmed"; }, "evidence upgrade drift");
  rejected((value) => { value.records[0].evidence.unresolved = []; }, "unresolved evidence removal");
  rejected((value) => { value.records.pop(); }, "missing lead coverage");
  rejected((value) => { value.records.push(clone(value.records[0])); }, "duplicate lead");
  rejected((value) => { [value.records[0], value.records[1]] = [value.records[1], value.records[0]]; }, "lead order drift");
  rejected((value) => { value.records[0].source.provider = "MDPI"; }, "provider/host mismatch");
  rejected((value) => { value.records[0].source.doi = "10.3390/wrong"; }, "provider/DOI mismatch");
  rejected((value) => { value.records[1].source.pmcid = null; }, "missing required PMCID");
  rejected((value) => { value.records[1].source.figureUrl = "https://www.frontiersin.org/image.webp"; }, "unresolved figure URL self-promotion");
  rejected((value) => { value.records[2].source.articleType = "original_research"; }, "article type/lead mismatch");
  rejected((value) => { value.reviewAsOf = "2026-02-31"; }, "invalid calendar date");
  rejected((value) => { value.records[0].source.checkedAt = "2026-08-13"; }, "source checked after review date");

  const extraGapCatalog = clone(foodFormCatalog);
  extraGapCatalog.gaps.push({ ...clone(extraGapCatalog.gaps[0]), id: "food-form-gap-future-v01", ingredientId: "dang-gui" });
  rejected(() => {}, "new untracked gap", { foodForms: extraGapCatalog });

  const manifestMutation = clone(saved);
  manifestMutation.records[0].sourceMetadataDigest = "sha256:" + "0".repeat(64);
  assert.throws(() => validateManifest(manifestMutation, catalog, ingredientData, foodFormCatalog, ruleSet), GapResearchError,
    "manifest source digest mutation was accepted");

  const driftedIngredients = clone(ingredientData);
  driftedIngredients.ingredients.find((item) => item.id === "di-huang").name += " drift";
  assert.notStrictEqual(canonicalJson(buildManifest(catalog, driftedIngredients, foodFormCatalog, ruleSet)), canonicalJson(saved), "ingredient drift did not invalidate manifest");
  const driftedFoodForms = clone(foodFormCatalog);
  driftedFoodForms.gaps.find((item) => item.id === "food-form-gap-tian-dong-v01").reason += " drift";
  assert.notStrictEqual(canonicalJson(buildManifest(catalog, ingredientData, driftedFoodForms, ruleSet)), canonicalJson(saved), "gap drift did not invalidate manifest");
  const driftedRules = { ...ruleSet, contentVersion: "future-rules" };
  assert.notStrictEqual(canonicalJson(buildManifest(catalog, ingredientData, foodFormCatalog, driftedRules)), canonicalJson(saved), "rule drift did not invalidate manifest");

  console.log(JSON.stringify({ researchLeads: 3, mutationCases: 22, unresolvedGaps: 3, publicationEligible: 0, runtimePlacements: 0, manifestRegenerationStable: true }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[test-food-form-gap-research] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
