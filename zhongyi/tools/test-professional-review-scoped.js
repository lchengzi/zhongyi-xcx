"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ingredientData = require("../data/ingredients");
const recipeData = require("../data/recipes");
const ruleSet = require("../data/rule-set");
const {
  FIRST_RELEASE_PROFILE_KEY, ROOT, buildPacket, canonicalJson, evaluateSyntheticResultsForTest,
  packetPaths, profileFromCli, profileKeys, resultsTemplate, reviewerRegistryTemplate,
  validatePacket, validateResultsEnvelope
} = require("./professional-review-core");
const { uploadFiles } = require("./check-professional-review");

const NOW = "2026-08-13T13:00:00Z";
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function digestFile(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function expectCode(code, action) {
  assert.throws(action, (error) => Boolean(error && error.code === code), `expected ${code}`);
}
function opaque(prefix, index) {
  return `${prefix}:opaque:${crypto.createHash("sha256").update(`${prefix}-${index}`).digest("base64url").slice(0, 32)}`;
}
function evidence(index) { return opaque("evidence", index); }
function reviewer(index, role) {
  return {
    reviewerRef: opaque("reviewer", index),
    authorizedRoles: [role],
    credentialEvidenceRef: evidence(`credential-${index}`),
    organizationEvidenceRef: evidence(`organization-${index}`),
    routingState: "active",
    verificationState: "not_verified_by_repository",
    credentialWindowStart: "2026-01-01",
    credentialWindowEnd: "2026-12-31"
  };
}
function submission(packet, task, role, reviewerValue, index, hour) {
  return {
    submissionId: `submission:scoped-${String(index).padStart(3, "0")}-${role}`,
    taskId: task.taskId,
    reviewRound: 1,
    supersedesSubmissionId: null,
    role,
    reviewerRef: reviewerValue.reviewerRef,
    recommendation: "ready_for_next_gate",
    reviewedAt: `2026-08-13T${String(hour).padStart(2, "0")}:00:00Z`,
    credentialEvidenceRef: reviewerValue.credentialEvidenceRef,
    packetDigest: packet.packetDigest,
    contentVersion: task.contentVersion,
    rulesVersion: task.rulesVersion,
    subjectDigest: task.subjectDigest,
    findingCodes: [],
    evidenceRefs: [evidence(`submission-${index}`)],
    attestationCode: "human_review_claim_not_verified_by_repository",
    signatureEvidenceRef: null,
    signatureVerificationState: "not_verified_by_repository"
  };
}

const formalBefore = canonicalJson({ ingredientData, recipeData, ruleSet });
const full = buildPacket();
const scoped = buildPacket({ profileKey: FIRST_RELEASE_PROFILE_KEY });
assert.deepStrictEqual(profileKeys(), ["full", FIRST_RELEASE_PROFILE_KEY]);
assert.strictEqual(profileFromCli([]), "full");
assert.strictEqual(profileFromCli(["--profile", FIRST_RELEASE_PROFILE_KEY]), FIRST_RELEASE_PROFILE_KEY);
expectCode("profile", () => profileFromCli(["--profile", "unregistered-profile"]));
expectCode("profile", () => profileFromCli(["--profile", FIRST_RELEASE_PROFILE_KEY, "extra"]));

assert.strictEqual(scoped.packetId, "p3-first-release-black-bean-huangqi-goji-soup.1");
assert.strictEqual(scoped.generatedFromReleaseId, "release-2026.08.13-complete-public-projection.10");
assert.strictEqual(scoped.recipeContentVersion, "2026.08-official-recipe.8");
assert.strictEqual(scoped.rulesVersion, "1.6.0");
assert.strictEqual(scoped.recipeTaskCount, 1);
assert.strictEqual(scoped.recipeTasks[0].recipeId, "black-bean-huangqi-goji-soup");
assert.strictEqual(scoped.recipeTasks[0].reviewContent.bundle.ingredients.length, 6);
assert.strictEqual(scoped.materialTaskCount, 6);
assert.deepStrictEqual(scoped.materialTasks.map((task) => task.taskId),
  scoped.recipeTasks[0].prerequisiteMaterialTaskIds);
assert.strictEqual(scoped.materialTasks.reduce((total, task) => total + task.uses.length, 0), 6);
assert(scoped.materialTasks.every((task) => task.uses.every((use) =>
  use.recipeId === "black-bean-huangqi-goji-soup")));
assert(scoped.materialTasks.every((task) => task.occurrenceEvidence.every((evidenceValue) =>
  evidenceValue.recipeId === "black-bean-huangqi-goji-soup")));
assert.deepStrictEqual(scoped.scopePolicy.expectedCounts,
  { recipeTasks: 1, recipeIngredientLines: 6, materialTasks: 6 });
assert.strictEqual(scoped.scopePolicy.mode, "single_recipe_exact_material_closure");
assert.strictEqual(scoped.scopePolicy.omittedRecipeDecisionPolicy, "no_inference");
assert.strictEqual(scoped.scopePolicy.formalDecisionAuthority, "none");
assert.strictEqual(scoped.scopePolicy.materialDecisionScope,
  "selected_recipe_use_context_only_no_global_material_transition");

const fullMaterialById = new Map(full.materialTasks.map((task) => [task.taskId, task]));
scoped.materialTasks.forEach((task) => {
  const formal = fullMaterialById.get(task.taskId);
  assert(formal, `${task.taskId} is absent from full packet`);
  assert.strictEqual(task.subjectDigest, formal.subjectDigest);
  assert.strictEqual(canonicalJson(task.reviewContent), canonicalJson(formal.reviewContent));
});
const fullRecipe = full.recipeTasks.find((task) => task.recipeId === scoped.recipeTasks[0].recipeId);
assert.strictEqual(canonicalJson(scoped.recipeTasks[0].technicalFindings), canonicalJson(fullRecipe.technicalFindings));
assert.strictEqual(canonicalJson(scoped.recipeTasks[0].technicalBlockers), canonicalJson(fullRecipe.technicalBlockers));
assert.strictEqual(canonicalJson(scoped.recipeTasks[0].prerequisiteMaterialTaskIds),
  canonicalJson(fullRecipe.prerequisiteMaterialTaskIds));
assert.strictEqual(canonicalJson(validatePacket(scoped)), canonicalJson(scoped));

const mutationCases = [];
function packetMutation(name, mutate) {
  const value = clone(scoped);
  mutate(value);
  expectCode("packet_drift", () => validatePacket(value));
  mutationCases.push(name);
}
packetMutation("scope policy drift", (value) => { value.scopePolicy.omittedRecipeDecisionPolicy = "infer"; });
packetMutation("second recipe inserted", (value) => { value.recipeTasks.push(clone(full.recipeTasks[1])); value.recipeTaskCount += 1; });
packetMutation("material removed", (value) => { value.materialTasks.pop(); value.materialTaskCount -= 1; });
packetMutation("material inserted", (value) => { value.materialTasks.push(clone(full.materialTasks.find((task) =>
  !scoped.materialTasks.some((candidate) => candidate.taskId === task.taskId)))); value.materialTaskCount += 1; });
packetMutation("technical finding removed", (value) => { value.recipeTasks[0].technicalFindings.pop(); });
packetMutation("prerequisite closure drift", (value) => { value.recipeTasks[0].prerequisiteMaterialTaskIds.pop(); });
packetMutation("use projection drift", (value) => { value.materialTasks[0].uses.push(clone(fullMaterialById.get(value.materialTasks[0].taskId).uses[0])); });

const emptyRegistry = reviewerRegistryTemplate(scoped);
const crossPacket = resultsTemplate(scoped);
crossPacket.packetDigest = full.packetDigest;
expectCode("results", () => validateResultsEnvelope(crossPacket, scoped, emptyRegistry, { now: NOW }));
mutationCases.push("cross packet envelope digest");

const advisoryPacket = clone(scoped);
advisoryPacket.materialTasks.forEach((task) => { task.blockers = []; task.evidenceBlockers = []; });
advisoryPacket.recipeTasks.forEach((task) => {
  task.blockers = []; task.technicalBlockers = []; task.prerequisiteBlockers = [];
});
const advisoryRegistry = reviewerRegistryTemplate(advisoryPacket);
const advisoryResults = resultsTemplate(advisoryPacket);
let index = 0;
for (const task of advisoryPacket.materialTasks) {
  for (let roleIndex = 0; roleIndex < task.requiredRoles.length; roleIndex += 1) {
    const role = task.requiredRoles[roleIndex];
    const reviewerValue = reviewer(index, role);
    advisoryRegistry.reviewers.push(reviewerValue);
    advisoryResults.submissions.push(submission(advisoryPacket, task, role, reviewerValue, index, roleIndex + 1));
    index += 1;
  }
}
for (let roleIndex = 0; roleIndex < advisoryPacket.recipeTasks[0].requiredRoles.length; roleIndex += 1) {
  const role = advisoryPacket.recipeTasks[0].requiredRoles[roleIndex];
  const reviewerValue = reviewer(index, role);
  advisoryRegistry.reviewers.push(reviewerValue);
  advisoryResults.submissions.push(submission(advisoryPacket, advisoryPacket.recipeTasks[0],
    role, reviewerValue, index, roleIndex + 5));
  index += 1;
}
process.env.NODE_ENV = "test";
const advisory = evaluateSyntheticResultsForTest(advisoryResults, advisoryPacket, advisoryRegistry, { now: NOW });
assert.strictEqual(advisory.workflowGateSatisfied, true);
assert.strictEqual(advisory.declaredApprovalComplete, true);
assert.strictEqual(advisory.globalReleaseGateSatisfied, false);
assert.strictEqual(advisory.scopedDecisionAuthority, "none");
assert.strictEqual(advisory.approvalReady, false);
assert.strictEqual(advisory.publicationEligible, false);
assert.strictEqual(advisory.applicationAllowed, false);
assert.strictEqual(advisory.applied, false);
assert.deepStrictEqual(advisory.advisoryPatchPlan, []);

for (const profileKey of ["full", FIRST_RELEASE_PROFILE_KEY]) {
  const paths = packetPaths(profileKey);
  const root = path.resolve(ROOT, ...paths.privatePrefix.split("/").filter(Boolean));
  assert.deepStrictEqual(fs.readdirSync(root).sort(),
    ["manifest.json", "review-index.html", "review-results.json", "reviewer-registry.json"]);
}
const scopedPaths = packetPaths(FIRST_RELEASE_PROFILE_KEY);
const immutableFiles = [scopedPaths.manifestRelative, scopedPaths.reviewRelative,
  scopedPaths.reviewerRegistryRelative, scopedPaths.resultsRelative].map((relative) => path.resolve(ROOT, ...relative.split("/")));
const beforeRebuild = immutableFiles.map((file) => ({ digest: digestFile(file), mtime: fs.statSync(file).mtimeMs }));
execFileSync(process.execPath, [path.join(ROOT, "tools/build-professional-review-packet.js"),
  "--profile", FIRST_RELEASE_PROFILE_KEY], { cwd: ROOT, stdio: "pipe" });
execFileSync(process.execPath, [path.join(ROOT, "tools/build-professional-review.js"),
  "--profile", FIRST_RELEASE_PROFILE_KEY], { cwd: ROOT, stdio: "pipe" });
const afterRebuild = immutableFiles.map((file) => ({ digest: digestFile(file), mtime: fs.statSync(file).mtimeMs }));
assert.deepStrictEqual(afterRebuild, beforeRebuild, "initialized scoped packet files must only be verified, never overwritten");

const privateTokens = [scopedPaths.packetId, scoped.packetDigest, scopedPaths.privatePrefix];
let runtimeReferences = 0;
for (const file of uploadFiles()) {
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  privateTokens.forEach((token) => { if (text.includes(token)) runtimeReferences += 1; });
}
assert.strictEqual(runtimeReferences, 0);
assert.strictEqual(canonicalJson({ ingredientData, recipeData, ruleSet }), formalBefore,
  "scoped packet operations must not mutate formal data modules");

console.log(JSON.stringify({
  packetId: scoped.packetId,
  packetDigest: scoped.packetDigest,
  recipes: scoped.recipeTaskCount,
  ingredientLines: scoped.recipeTasks[0].reviewContent.bundle.ingredients.length,
  materials: scoped.materialTaskCount,
  mutationCases: mutationCases.length,
  advisorySubmissions: advisory.submissionCount,
  globalReleaseGateSatisfied: false,
  approvalReady: false,
  runtimeReferences
}));
