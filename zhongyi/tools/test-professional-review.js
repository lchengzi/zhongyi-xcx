"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildPacket, canonicalJson, evaluateSyntheticResultsForTest, rawDigest, resultsTemplate, reviewerRegistryTemplate,
  validatePacket, validateReviewerRegistry, validateResultsEnvelope
} = require("./professional-review-core");
const { buildReviewHtml, escapeHtml } = require("./build-professional-review");
const {
  acquireLock, hasHumanEntries, recognizedEmptyRegistry, recognizedEmptyResults, writeNewJson
} = require("./build-professional-review-packet");

const NOW = "2026-08-13T13:00:00Z";
const TEST_EXPECTED_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
const TEST_ACTIVE_HTML_PATTERN = /<(?:a|area|base|script|form|input|button|select|textarea|link|img|iframe|object|embed|audio|video|source|track|svg|math)\b|\son[a-z][\w:-]*\s*=|\s(?:href|src|srcset|action|formaction|poster|data|xlink:href)\s*=|http-equiv\s*=\s*["']?\s*refresh\b/i;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function expectReject(code, action) {
  assert.throws(action, (error) => Boolean(error && error.code === code), `expected ${code}`);
}
function opaque(character) { return `reviewer:opaque:${character.repeat(32)}`; }
function evidence(value) {
  const token = Buffer.from(String(value), "utf8").toString("base64url").padEnd(16, "x").slice(0, 128);
  return `evidence:opaque:${token}`;
}

function reviewer(ref, roles, credential) {
  return {
    reviewerRef: ref,
    authorizedRoles: roles,
    credentialEvidenceRef: evidence(credential),
    organizationEvidenceRef: evidence(`organization-${credential}`),
    routingState: "active",
    verificationState: "not_verified_by_repository",
    credentialWindowStart: "2026-01-01",
    credentialWindowEnd: "2026-12-31"
  };
}

function submission(packet, task, role, reviewerValue, credential, round, prior, time, recommendation) {
  return {
    submissionId: `submission:${task.taskId.replace(/[^a-zA-Z0-9]/g, "-")}-${role}-${round}`,
    taskId: task.taskId,
    reviewRound: round,
    supersedesSubmissionId: prior,
    role,
    reviewerRef: reviewerValue,
    recommendation,
    reviewedAt: time,
    credentialEvidenceRef: evidence(credential),
    packetDigest: packet.packetDigest,
    contentVersion: task.contentVersion,
    rulesVersion: task.rulesVersion,
    subjectDigest: task.subjectDigest,
    findingCodes: recommendation === "ready_for_next_gate" ? [] : ["content_change_required"],
    evidenceRefs: [evidence(`review-${credential}`)],
    attestationCode: "human_review_claim_not_verified_by_repository",
    signatureEvidenceRef: null,
    signatureVerificationState: "not_verified_by_repository"
  };
}

const packet = buildPacket();
assert.deepStrictEqual(buildPacket(), packet, "packet generation must be deterministic");
const rollbackPacket = buildPacket({ releaseId: "fixture-rollback-release", activatedAt: "2026-08-10T01:00:00Z" });
assert.strictEqual(rollbackPacket.generatedFromReleaseId, "fixture-rollback-release");
assert.strictEqual(rollbackPacket.packetIssuedAt, "2026-08-10T01:00:00Z");
assert.notStrictEqual(rollbackPacket.packetDigest, packet.packetDigest);
assert.strictEqual(canonicalJson(validatePacket(packet)), canonicalJson(packet));
assert.strictEqual(packet.materialTaskCount, 24);
assert.strictEqual(packet.recipeTaskCount, 5);
assert.strictEqual(packet.reviewableMaterialTaskCount, 2);
assert.strictEqual(packet.reviewableRecipeTaskCount, 0);
packet.materialTasks.forEach((task) => assert.strictEqual(rawDigest(task.reviewContent), task.subjectDigest));
packet.recipeTasks.forEach((task) => {
  assert.strictEqual(rawDigest(task.reviewContent.bundle), task.expectedBundleDigest);
  assert.strictEqual(rawDigest(task.reviewContent.sourceText), task.expectedSourceTextDigest);
});
assert.strictEqual(packet.recipeTasks.filter((task) => task.technicalFindings.includes("pattern_gate_unsupported")).length, 3);
assert.strictEqual(packet.recipeTasks.filter((task) => task.technicalFindings.includes("regulatory_usage_conflict:line-angelica")).length, 2);

const emptyRegistry = reviewerRegistryTemplate(packet);
const emptyResults = resultsTemplate(packet);
validateReviewerRegistry(emptyRegistry, packet, { now: NOW });
const emptyValidation = validateResultsEnvelope(emptyResults, packet, emptyRegistry, { now: NOW });
assert.deepStrictEqual({
  schemaValid: emptyValidation.schemaValid,
  mode: emptyValidation.mode,
  identityAssurance: emptyValidation.identityAssurance,
  approvalReady: emptyValidation.approvalReady,
  applied: emptyValidation.applied,
  patch: emptyValidation.advisoryPatchPlan
}, { schemaValid: true, mode: "advisory", identityAssurance: "unverified", approvalReady: false, applied: false, patch: [] });

const mutationCases = [];
function mutation(name, code, mutate, target) {
  const value = clone(target || packet);
  mutate(value);
  expectReject(code, () => target ? validateResultsEnvelope(value, packet, emptyRegistry, { now: NOW }) : validatePacket(value));
  mutationCases.push(name);
}
mutation("packet publication eligibility", "packet_drift", (value) => { value.publicationEligible = true; });
mutation("packet release binding", "packet_drift", (value) => { value.generatedFromReleaseId = "release-drift"; });
mutation("material digest", "packet_drift", (value) => { value.materialTasks[0].subjectDigest = `sha256:${"0".repeat(64)}`; });
mutation("material review content", "packet_drift", (value) => { value.materialTasks[0].reviewContent.name = "drift"; });
mutation("direct source", "packet_drift", (value) => { value.materialTasks[0].directSourceIds.regulatory = []; });
mutation("material use", "packet_drift", (value) => { value.materialTasks[0].uses.pop(); });
mutation("recipe technical findings", "packet_drift", (value) => { value.recipeTasks[2].technicalFindings = []; });
mutation("recipe prerequisite", "packet_drift", (value) => { value.recipeTasks[0].prerequisiteMaterialTaskIds.pop(); });
mutation("review due", "packet_drift", (value) => { value.reviewDueAt = "2027-01-01T00:00:00Z"; });

const task = packet.materialTasks.find((item) => item.taskId === "material:official_catalog:huang-qi");
assert(task && !task.blockers.length);
const refs = [opaque("a"), opaque("b"), opaque("c")];
const credentials = ["tcm-credential", "pharmacy-credential", "compliance-credential"];
const registry = reviewerRegistryTemplate(packet);
registry.reviewers = task.requiredRoles.map((role, index) => reviewer(refs[index], [role], credentials[index]));
const declared = resultsTemplate(packet);
declared.submissions = task.requiredRoles.map((role, index) => submission(
  packet, task, role, refs[index], credentials[index], 1, null, `2026-08-13T0${index + 1}:00:00Z`, "ready_for_next_gate"
));
const declaredValidation = validateResultsEnvelope(declared, packet, registry, { now: NOW });
assert.strictEqual(declaredValidation.materialRecommendationReadyCount, 1);
assert.strictEqual(declaredValidation.approvalReady, false);
assert.strictEqual(declaredValidation.authorizationVerified, false);
assert.deepStrictEqual(declaredValidation.advisoryPatchPlan, []);

function resultsMutation(name, code, mutate, base, registryInput, now) {
  const value = clone(base);
  expectReject(code, () => validateResultsEnvelope(value, packet, clone(registryInput || registry), { now: now || NOW }));
  mutationCases.push(name);
}
let value;
value = clone(declared); value.packetDigest = `sha256:${"f".repeat(64)}`;
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("envelope digest drift");
value = clone(declared); value.submissions[0].subjectDigest = `sha256:${"1".repeat(64)}`;
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("subject digest drift");
value = clone(declared); value.submissions[0].reviewedAt = "2027-01-01T00:00:00Z";
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("future submission");
value = clone(declared); value.submissions[0].reviewedAt = "2026-08-11T16:00:00Z";
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("pre-packet submission");
value = clone(declared); value.submissions[1].reviewerRef = refs[0]; value.submissions[1].credentialEvidenceRef = credentials[0];
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("role routing mismatch");
value = clone(declared); value.submissions[1].reviewerRef = refs[0]; value.submissions[1].credentialEvidenceRef = evidence(credentials[0]);
const multiRoleRegistry = clone(registry); multiRoleRegistry.reviewers[0].authorizedRoles.push("pharmacist"); multiRoleRegistry.reviewers[1].routingState = "inactive";
expectReject("reviewer_registry", () => validateResultsEnvelope(value, packet, multiRoleRegistry, { now: NOW })); mutationCases.push("inactive reviewer");
value = clone(declared); value.submissions[1].reviewerRef = refs[0]; value.submissions[1].credentialEvidenceRef = evidence(credentials[0]);
const reusedReviewerRegistry = clone(registry); reusedReviewerRegistry.reviewers[0].authorizedRoles.push("pharmacist");
expectReject("independence", () => validateResultsEnvelope(value, packet, reusedReviewerRegistry, { now: NOW })); mutationCases.push("same reviewer ref multiple roles");
value = clone(declared); value.submissions[0].signatureVerificationState = "verified";
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("repository signature claim");
value = clone(declared); value.submissions[0].attestationCode = "approved";
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("freeform approval attestation");
value = clone(declared); value.submissions[0].findingCodes = ["contains email@example.com"];
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("free text finding");
value = clone(declared); value.submissions[0].reviewRound = 2; value.submissions[0].supersedesSubmissionId = null;
expectReject("revision", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("broken revision chain");
value = clone(declared); value.submissions[0].recommendation = "approved";
expectReject("results", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("approval vocabulary prohibited");

const blockedTask = packet.materialTasks.find((item) => item.blockers.length);
value = resultsTemplate(packet);
value.submissions = [submission(packet, blockedTask, blockedTask.requiredRoles[0], refs[0], credentials[0], 1, null, "2026-08-13T01:00:00Z", "ready_for_next_gate")];
expectReject("task_blocked", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("blocked task readiness");

const recipeTask = packet.recipeTasks[0];
value = resultsTemplate(packet);
value.submissions = [submission(packet, recipeTask, recipeTask.requiredRoles[0], refs[0], credentials[0], 1, null, "2026-08-13T01:00:00Z", "changes_required")];
expectReject("sequence", () => validateResultsEnvelope(value, packet, registry, { now: NOW })); mutationCases.push("recipe before material prerequisites");

// Exercise the recipe-role independence and release-order evaluator with a
// synthetic blocker-free task. This does not alter or validate the real packet,
// whose five recipe tasks intentionally remain blocked.
const workflowPacket = clone(packet);
const workflowTask = workflowPacket.recipeTasks[0];
workflowTask.blockers = [];
workflowTask.technicalBlockers = [];
workflowTask.prerequisiteBlockers = [];
workflowTask.prerequisiteMaterialTaskIds = [];
const workflowRefs = [opaque("d"), opaque("e"), opaque("f"), opaque("g"), opaque("h")];
const workflowCredentials = ["recipe-tcm", "recipe-pharmacy", "recipe-nutrition", "recipe-compliance", "recipe-release"];
const workflowRegistry = reviewerRegistryTemplate(workflowPacket);
workflowRegistry.reviewers = workflowTask.requiredRoles.map((role, index) =>
  reviewer(workflowRefs[index], [role], workflowCredentials[index]));
const workflowResults = resultsTemplate(workflowPacket);
workflowResults.submissions = workflowTask.requiredRoles.map((role, index) => submission(
  workflowPacket, workflowTask, role, workflowRefs[index], workflowCredentials[index], 1, null,
  `2026-08-13T0${index + 4}:00:00Z`, "ready_for_next_gate"
));
process.env.NODE_ENV = "test";
const workflowValidation = evaluateSyntheticResultsForTest(workflowResults, workflowPacket, workflowRegistry, { now: NOW });
assert.strictEqual(workflowValidation.recipeRecommendationReadyCount, 1);
assert.strictEqual(workflowValidation.approvalReady, false);

value = clone(workflowResults);
value.submissions[1].reviewerRef = workflowRefs[0];
value.submissions[1].credentialEvidenceRef = evidence(workflowCredentials[0]);
const recipeReusedRegistry = clone(workflowRegistry);
recipeReusedRegistry.reviewers[0].authorizedRoles.push(workflowTask.requiredRoles[1]);
expectReject("independence", () => evaluateSyntheticResultsForTest(value, workflowPacket, recipeReusedRegistry, { now: NOW }));
mutationCases.push("recipe roles reuse reviewer ref");

value = clone(workflowResults);
value.submissions[0].recommendation = "changes_required";
value.submissions[1].recommendation = "changes_required";
value.submissions[1].reviewerRef = workflowRefs[0];
value.submissions[1].credentialEvidenceRef = evidence(workflowCredentials[0]);
expectReject("independence", () => evaluateSyntheticResultsForTest(value, workflowPacket, recipeReusedRegistry, { now: NOW }));
mutationCases.push("non-ready recipe history reuses reviewer ref across roles");

value = clone(workflowResults);
value.submissions[value.submissions.length - 1].reviewedAt = value.submissions[value.submissions.length - 2].reviewedAt;
expectReject("sequence", () => evaluateSyntheticResultsForTest(value, workflowPacket, workflowRegistry, { now: NOW }));
mutationCases.push("release recommendation not later");

value = clone(workflowResults);
value.submissions = value.submissions.filter((item) => item.role === "release_approver");
expectReject("sequence", () => evaluateSyntheticResultsForTest(value, workflowPacket, workflowRegistry, { now: NOW }));
mutationCases.push("release recommendation missing prior roles");

const stagedPacket = clone(workflowPacket);
const stagedMaterial = clone(task);
stagedMaterial.blockers = [];
stagedMaterial.evidenceBlockers = [];
stagedPacket.materialTasks = [stagedMaterial];
stagedPacket.recipeTasks = [clone(workflowTask)];
stagedPacket.recipeTasks[0].prerequisiteMaterialTaskIds = [stagedMaterial.taskId];
stagedPacket.recipeTasks[0].prerequisiteBlockers = [];
stagedPacket.recipeTasks[0].blockers = [];
const stagedRoles = [...stagedMaterial.requiredRoles.map((role) => ({ role, task: stagedMaterial, prefix: "material" })),
  ...stagedPacket.recipeTasks[0].requiredRoles.map((role) => ({ role, task: stagedPacket.recipeTasks[0], prefix: "recipe" }))];
const stagedRegistry = reviewerRegistryTemplate(stagedPacket);
stagedRegistry.reviewers = stagedRoles.map((entry, index) =>
  reviewer(opaque(String.fromCharCode(106 + index)), [entry.role], `${entry.prefix}-${entry.role}-${index}`));
const stagedResults = resultsTemplate(stagedPacket);
stagedResults.submissions = stagedRoles.map((entry, index) => submission(
  stagedPacket, entry.task, entry.role, stagedRegistry.reviewers[index].reviewerRef,
  `${entry.prefix}-${entry.role}-${index}`, 1, null,
  `2026-08-13T${String(index + 1).padStart(2, "0")}:00:00Z`, "ready_for_next_gate"
));
assert.strictEqual(evaluateSyntheticResultsForTest(stagedResults, stagedPacket, stagedRegistry, { now: NOW }).recipeRecommendationReadyCount, 1);
value = clone(stagedResults);
const firstRecipeSubmission = value.submissions.find((item) => item.taskId === stagedPacket.recipeTasks[0].taskId);
firstRecipeSubmission.reviewedAt = "2026-08-13T02:30:00Z";
expectReject("sequence", () => evaluateSyntheticResultsForTest(value, stagedPacket, stagedRegistry, { now: NOW }));
mutationCases.push("recipe submission predates material completion");

value = clone(stagedResults);
const stagedRecipeFirst = value.submissions.find((item) => item.taskId === stagedPacket.recipeTasks[0].taskId);
stagedRecipeFirst.recommendation = "changes_required";
stagedRecipeFirst.reviewedAt = "2026-08-13T02:30:00Z";
const revisedRecipeSubmission = clone(stagedRecipeFirst);
revisedRecipeSubmission.submissionId = `${stagedRecipeFirst.submissionId}-round-2`;
revisedRecipeSubmission.reviewRound = 2;
revisedRecipeSubmission.supersedesSubmissionId = stagedRecipeFirst.submissionId;
revisedRecipeSubmission.recommendation = "ready_for_next_gate";
revisedRecipeSubmission.reviewedAt = "2026-08-13T09:30:00Z";
value.submissions.push(revisedRecipeSubmission);
expectReject("sequence", () => evaluateSyntheticResultsForTest(value, stagedPacket, stagedRegistry, { now: NOW }));
mutationCases.push("superseded recipe round predates material completion");

const noWindowRegistry = clone(registry);
noWindowRegistry.reviewers.forEach((item) => { item.credentialWindowStart = null; item.credentialWindowEnd = null; });
expectReject("reviewer_registry", () => validateResultsEnvelope(declared, packet, noWindowRegistry, { now: NOW }));
mutationCases.push("readiness without credential window");

const html = buildReviewHtml(packet);
assert.strictEqual(html, buildReviewHtml(packet), "review HTML must be deterministic");
assert.strictEqual((html.match(/class="card material"/g) || []).length, 24);
assert.strictEqual((html.match(/class="card recipe"/g) || []).length, 5);
assert(html.includes(`<meta http-equiv="Content-Security-Policy" content="${TEST_EXPECTED_CSP}">`));
assert(!TEST_ACTIVE_HTML_PATTERN.test(html));
for (const unsafe of ["<script>", "<a href=/>", "<meta http-equiv = refresh>", "<img src=x>", "<div onclick=x>"]) {
  assert(TEST_ACTIVE_HTML_PATTERN.test(unsafe), `independent active-content contract missed ${unsafe}`);
}
assert.strictEqual(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
const escapedPacket = clone(packet); escapedPacket.materialTasks[0].name = "<script>alert(1)</script>";
expectReject("packet_drift", () => buildReviewHtml(escapedPacket)); mutationCases.push("HTML input must be current packet");
const rollbackHtmlOptions = { releaseId: packet.generatedFromReleaseId, activatedAt: "2026-08-10T00:00:00Z" };
const rollbackHtmlPacket = buildPacket(rollbackHtmlOptions);
assert.strictEqual(buildReviewHtml(rollbackHtmlPacket, rollbackHtmlOptions), buildReviewHtml(rollbackHtmlPacket, rollbackHtmlOptions));
expectReject("packet_drift", () => buildReviewHtml(rollbackHtmlPacket));
mutationCases.push("rollback HTML must retain the target release clock");
const callerSelectedPacket = buildPacket({ releaseId: "unverified-caller-selected-release", activatedAt: packet.packetIssuedAt });
expectReject("packet_drift", () => validateResultsEnvelope(resultsTemplate(callerSelectedPacket), callerSelectedPacket,
  reviewerRegistryTemplate(callerSelectedPacket), { now: NOW, packetBuildOptions: { releaseId: callerSelectedPacket.generatedFromReleaseId, activatedAt: callerSelectedPacket.packetIssuedAt } }));
mutationCases.push("public validator rejects caller-selected release clocks");

assert.strictEqual(hasHumanEntries({ reviewers: [{}] }, { submissions: [] }), true);
assert.strictEqual(hasHumanEntries({ reviewers: [] }, { submissions: [{}] }), true);
assert.strictEqual(hasHumanEntries({ reviewers: [] }, { results: [{}] }), true);
assert.strictEqual(hasHumanEntries({ reviewers: [] }, { submissions: [] }), false);
assert.strictEqual(recognizedEmptyRegistry(emptyRegistry, packet), true);
assert.strictEqual(recognizedEmptyResults(emptyResults, packet), true);
assert.strictEqual(recognizedEmptyRegistry({ reviewers: [] }, packet), false);
assert.strictEqual(recognizedEmptyResults({ results: [] }, packet), false);

const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-review-lock-test-"));
try {
  const firstLock = acquireLock(lockRoot);
  try { assert.throws(() => acquireLock(lockRoot), /locked by another writer/); }
  finally { firstLock.release(); }
  const immutableFile = path.join(lockRoot, "review-results.json");
  writeNewJson(immutableFile, resultsTemplate(packet));
  assert.throws(() => writeNewJson(immutableFile, { submissions: [{ human: true }] }),
    (error) => Boolean(error && error.code === "EEXIST"));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(immutableFile, "utf8")), resultsTemplate(packet));
} finally {
  fs.rmSync(lockRoot, { recursive: true });
}

console.log(JSON.stringify({
  packetId: packet.packetId,
  materialTasks: packet.materialTaskCount,
  recipeTasks: packet.recipeTaskCount,
  mutationCases: mutationCases.length,
  declaredMaterialRecommendations: declaredValidation.materialRecommendationReadyCount,
  identityAssurance: declaredValidation.identityAssurance,
  approvalReady: false,
  applied: false,
  deterministic: canonicalJson(buildPacket()) === canonicalJson(packet)
}));
