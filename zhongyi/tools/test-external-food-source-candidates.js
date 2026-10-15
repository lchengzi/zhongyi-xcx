"use strict";

const assert = require("assert");
const recipeData = require("../data/recipes");
const ruleSet = require("../data/rule-set");
const {
  CATALOG_RELATIVE, buildManifest, canonicalJson, loadManifest, readJson
} = require("./external-food-source-candidate-core");
const { countForbiddenReferences, privateSourceFingerprints } = require("./check-external-food-source-candidates");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function rejected(mutator, message) {
  const value = clone(catalog);
  mutator(value);
  assert.throws(() => buildManifest(value, recipeData, ruleSet), undefined, message);
}

const catalog = readJson(CATALOG_RELATIVE, "source catalog");
const saved = loadManifest();
const first = buildManifest(catalog, recipeData, ruleSet);
const second = buildManifest(catalog, recipeData, ruleSet);
assert.strictEqual(canonicalJson(saved), canonicalJson(first), "saved source candidate manifest is stale");
assert.strictEqual(canonicalJson(first), canonicalJson(second), "source candidate manifest generation is not deterministic");

rejected((value) => { value.publicationEligible = true; }, "catalog publication eligibility bypassed");
rejected((value) => { value.candidates[0].publicationEligible = true; }, "candidate publication eligibility bypassed");
rejected((value) => { value.candidates[0].runtimePlacements = ["ingredient_card"]; }, "runtime placement bypassed");
rejected((value) => { value.candidates[0].directClaimUse = "allowed"; }, "direct-claim prohibition bypassed");
rejected((value) => { value.candidates[0].mappingState = "reviewed"; }, "mapping self-review bypassed");
rejected((value) => { value.candidates[0].professionalReviewState = "reviewed"; }, "professional review self-promotion bypassed");
rejected((value) => { value.candidates[0].targetFoodIds[0] = "external-food-salt"; }, "approved food binding drifted");
rejected((value) => { value.candidates[0].source.url = value.candidates[2].source.url; }, "approved source URL drifted");
rejected((value) => { value.candidates[0].source.status = "withdrawn"; }, "withdrawn source remained usable");
rejected((value) => { value.candidates[0].source.unreviewedField = true; }, "unknown source metadata was accepted");
rejected((value) => { value.candidates[0].source.title += " drift"; }, "legacy candidate source semantics drifted");
rejected((value) => { value.candidates[0].notes[0] += " drift"; }, "legacy candidate limitation semantics drifted");
rejected((value) => { value.gaps.pop(); }, "missing external-food coverage was accepted");
rejected((value) => { value.gaps[0].foodId = value.candidates[0].targetFoodIds[0]; }, "candidate/gap overlap was accepted");
rejected((value) => { value.gaps[0].gapCode = "weakened_gap"; }, "gap semantics drifted without an approved binding");
rejected((value) => { value.evidenceItems[0].domain = "safety"; }, "approved evidence domain drifted");
rejected((value) => { value.evidenceItems[0].targetFoodIds.push("external-food-salt"); }, "approved multi-target evidence binding drifted");
rejected((value) => { value.evidenceItems[0].supportLevel = "partial"; }, "approved support level drifted");
rejected((value) => { value.evidenceItems[0].claimLocator = []; }, "empty evidence locator was accepted");
rejected((value) => { value.evidenceItems[0].preciseClaims[0] += " drift"; }, "evidence claim drift was accepted");
rejected((value) => { value.evidenceItems[0].limitations[0] += " drift"; }, "evidence limitation drift was accepted");
rejected((value) => { value.evidenceItems[0].source.status = "withdrawn"; }, "withdrawn evidence source was accepted");
rejected((value) => { value.evidenceItems[0].mappingState = "reviewed"; }, "evidence mapping self-promotion was accepted");
rejected((value) => { value.evidenceItems[0].professionalReviewState = "reviewed"; }, "evidence professional self-promotion was accepted");
rejected((value) => { value.evidenceItems[0].publicationEligible = true; }, "evidence publication bypass was accepted");
rejected((value) => { value.evidenceItems[0].runtimePlacements = ["card"]; }, "evidence runtime placement was accepted");
rejected((value) => { value.evidenceItems[0].directClaimUse = "allowed"; }, "evidence direct claim bypass was accepted");
rejected((value) => { value.evidenceItems[0].source.effectiveState = "withdrawn"; }, "invalid source lifecycle was accepted");
rejected((value) => { value.evidenceItems[0].source.unreviewed = true; }, "unknown evidence source field was accepted");
rejected((value) => { value.evidenceItems[0].source.checkedAt = "2026-08-14"; }, "future evidence check date was accepted");
rejected((value) => { value.evidenceItems[0].source.url = "https://evilnhc.gov.cn/evidence"; }, "lookalike official hostname was accepted");
rejected((value) => { value.targetCoverage[0].domains.identity.ready = true; }, "candidate evidence was promoted to ready");
rejected((value) => { value.targetCoverage[0].domains.identity.residualGapCodes = []; }, "residual evidence gaps were removed");
rejected((value) => { value.targetCoverage[0].domains.identity.residualGapCodes = ["invented_gap"]; }, "unknown residual evidence gap was accepted");
rejected((value) => { value.targetCoverage[0].domains.identity.candidateIds = []; }, "approved evidence was orphaned");
rejected((value) => { value.targetCoverage[1].domains.identity.candidateIds = [value.evidenceItems[0].id]; }, "cross-target evidence binding was accepted");
rejected((value) => { value.targetCoverage[0].domains.identity.candidateIds.push(value.targetCoverage[0].domains.identity.candidateIds[0]); }, "duplicate coverage reference was accepted");
rejected((value) => {
  const evidence = value.evidenceItems.find((item) => item.supportLevel === "boundary_only");
  const slot = value.targetCoverage.find((item) => item.foodId === evidence.targetFoodIds[0]).domains[evidence.domain];
  slot.residualGapCodes = slot.residualGapCodes.filter((code) => code !== "direct_source_missing");
}, "boundary-only evidence lost its direct-source gap");
rejected((value) => {
  const legacyId = value.candidates[0].id;
  const targetId = value.candidates[0].targetFoodIds[0];
  const slot = value.targetCoverage.find((item) => item.foodId === targetId).domains.regulatory;
  assert(slot.candidateIds.includes(legacyId), "legacy mutation fixture is invalid");
  slot.residualGapCodes = slot.residualGapCodes.filter((code) => code !== "scope_incomplete");
}, "legacy category lead lost its scope gap");
rejected((value) => {
  const evidence = value.evidenceItems.find((item) => item.id === "evidence-scallion-chopped-nhc-2026-food-use");
  evidence.targetFoodIds.pop();
}, "multi-target food-use evidence lost a declared target");
rejected((value) => {
  const slot = value.targetCoverage.find((item) => item.foodId === "external-food-japonica-rice-flour").domains.identity;
  slot.residualGapCodes = ["professional_review_pending"];
}, "generic rice-flour boundary was promoted into a direct japonica-rice-flour mapping");
rejected((value) => {
  const slot = value.targetCoverage.find((item) => item.foodId === "external-food-goji-leaf").domains.food_use;
  slot.ready = true;
}, "goji-leaf recipe occurrence was promoted into a ready food-use domain");
rejected((value) => {
  const evidence = value.evidenceItems.find((item) => item.id === "evidence-salt-water-nhc-2026-food-use");
  evidence.targetFoodIds.pop();
}, "salt/water multi-target food-use evidence lost a declared target");
rejected((value) => {
  const slot = value.targetCoverage.find((item) => item.foodId === "external-food-salt").domains.safety;
  slot.ready = true;
}, "partial salt-intake safety evidence was promoted into a ready safety domain");
rejected((value) => {
  const evidence = value.evidenceItems.find((item) => item.id === "evidence-water-chinacdc-2025-boiling-safety");
  evidence.source.url = "https://chinacdc.cn.evidence.example/jkkp/water";
}, "China CDC lookalike hostname was accepted");
rejected((value) => {
  const evidence = value.evidenceItems.find((item) => item.id === "evidence-water-chinacdc-2025-boiling-safety");
  evidence.preciseClaims[0] = "本项目原方清水必须煮沸1—3分钟。";
}, "China CDC boiling duration was promoted into a project recipe instruction");

const fingerprints = privateSourceFingerprints(saved);
const privateClaim = saved.evidenceItems[0].preciseClaims[0];
const privateUrl = saved.evidenceItems[0].source.url;
assert(!privateClaim.includes(saved.evidenceItems[0].id), "claim-only leak fixture unexpectedly contains an evidence ID");
assert(countForbiddenReferences(`const copy = ${JSON.stringify(privateClaim)};`, fingerprints) > 0, "claim-only runtime leak was not detected");
assert(countForbiddenReferences(`const source = ${JSON.stringify(privateUrl)};`, fingerprints) > 0, "URL-only runtime leak was not detected");

const driftedRecipeData = clone(recipeData);
driftedRecipeData.externalFoods.items[0].name += " drifted";
const driftedManifest = buildManifest(catalog, driftedRecipeData, ruleSet);
assert.notStrictEqual(canonicalJson(driftedManifest), canonicalJson(saved), "external-food content drift did not invalidate candidate bindings");
const driftedRuleSet = { ...ruleSet, contentVersion: "future-rule-version" };
assert.notStrictEqual(canonicalJson(buildManifest(catalog, recipeData, driftedRuleSet)), canonicalJson(saved), "rule drift did not invalidate candidate bindings");

console.log(JSON.stringify({
  sourceCandidates: saved.candidateCount,
  candidateTargets: saved.targetCount,
  explicitGaps: saved.gapCount,
  evidenceItems: saved.evidenceCount,
  domainSlots: saved.domainSlotCount,
  readyDomainSlots: saved.readyDomainSlotCount,
  mutationCases: 50,
  regenerationStable: true,
  publicationEligible: saved.publicationEligibleCount,
  runtimePlacements: saved.runtimePlacementCount
}));
