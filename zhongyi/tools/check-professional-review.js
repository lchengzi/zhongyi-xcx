"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { verifyWorkspace, ARTIFACT_PATHS } = require("./version-core");
const {
  DEFAULT_PROFILE_KEY, ROOT, buildPacket, canonicalJson, loadPacket, loadResults, loadReviewerRegistry,
  packetBuildOptionsFromVerification, packetPaths, profileKeys, rawDigest, sha256Value, validatePacket, validateResultsEnvelope
} = require("./professional-review-core");
const { buildReviewHtml } = require("./build-professional-review");
const { reviewerRegistryTemplate, resultsTemplate } = require("./professional-review-core");

// Keep the verification contract independent from the renderer so a renderer edit cannot
// silently weaken both the generated page and its checker in the same change.
const EXPECTED_CSP_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
const STRICT_ACTIVE_HTML_PATTERN = /<(?:a|area|base|script|form|input|button|select|textarea|link|img|iframe|object|embed|audio|video|source|track|svg|math)\b|\son[a-z][\w:-]*\s*=|\s(?:href|src|srcset|action|formaction|poster|data|xlink:href)\s*=|http-equiv\s*=\s*["']?\s*refresh\b/i;

function walk(root, output) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `professional review boundary contains a link/reparse point: ${file}`);
    assert(!entry.isDirectory(), `professional review packet must not contain subdirectories: ${file}`);
    assert(entry.isFile(), `professional review packet contains a non-file: ${file}`);
    assert(!entry.name.startsWith(".packet-build.lock") && !entry.name.includes(".tmp-"),
      `professional review packet contains an unfinished writer file: ${file}`);
    output.push(file);
  }
  return output;
}

function uploadFiles() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
  const ignores = new Set(asArray(config.packOptions && config.packOptions.ignore).map((item) => String(item.value || "").replace(/\\/g, "/")));
  assert(ignores.has("content-private"), "content-private must remain excluded from upload");
  const output = [];
  function visit(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      const relative = path.relative(ROOT, file).replace(/\\/g, "/");
      const top = relative.split("/")[0];
      if (ignores.has(relative) || ignores.has(top) || top === "node_modules" || top === ".git") continue;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) output.push(file);
    }
  }
  visit(ROOT);
  return output;
}
function asArray(value) { return Array.isArray(value) ? value : []; }

function reviewCard(review, kind, taskId) {
  const marker = `<article class="card ${kind}" data-task-id="${escapeForHtml(taskId)}">`;
  const start = review.indexOf(marker);
  assert(start >= 0, `${taskId} card is missing`);
  const end = review.indexOf("</article>", start);
  assert(end > start, `${taskId} card is incomplete`);
  return review.slice(start, end + "</article>".length);
}

function reviewSection(card, sectionName) {
  const marker = `<section data-section="${escapeForHtml(sectionName)}">`;
  const start = card.indexOf(marker);
  assert(start >= 0, `${sectionName} section is missing`);
  const end = card.indexOf("</section>", start);
  assert(end > start, `${sectionName} section is incomplete`);
  return card.slice(start, end + "</section>".length);
}

function assertSectionValues(card, sectionName, values) {
  const section = reviewSection(card, sectionName);
  const expected = Array.isArray(values) ? values : [];
  assert.strictEqual((section.match(/<li>/g) || []).length, expected.length,
    `${sectionName} item count drifted`);
  expected.forEach((value) => assert(section.includes(`<li>${escapeForHtml(value)}</li>`),
    `${sectionName} item is missing: ${value}`));
  if (!expected.length) assert(section.includes('class="muted"'), `${sectionName} empty state is missing`);
  return section;
}

function checkProfile(profileKey, options) {
  const paths = packetPaths(profileKey);
  const verified = verifyWorkspace(ROOT);
  const packetOptions = { ...packetBuildOptionsFromVerification(verified), profileKey };
  const packet = validatePacket(loadPacket(profileKey), packetOptions);
  assert.strictEqual(packet.generatedFromReleaseId, verified.releaseId, "professional review packet is not bound to active verified release");
  assert.strictEqual(canonicalJson(packet), canonicalJson(buildPacket(packetOptions)), "professional review packet drifted");
  assert.strictEqual(packet.publicationEligible, false);
  assert.strictEqual(packet.materialTaskCount, packet.materialTasks.length);
  assert.strictEqual(packet.catalogMaterialTaskCount,
    packet.materialTasks.filter((task) => task.registry === "official_catalog").length);
  assert.strictEqual(packet.externalFoodTaskCount,
    packet.materialTasks.filter((task) => task.registry === "external_food").length);
  assert.strictEqual(packet.recipeTaskCount, packet.recipeTasks.length);
  assert.strictEqual(packet.reviewableMaterialTaskCount,
    packet.materialTasks.filter((task) => !task.evidenceBlockers.length).length);
  assert.strictEqual(packet.reviewableRecipeTaskCount,
    packet.recipeTasks.filter((task) => !task.blockers.length).length);

  const registry = loadReviewerRegistry(profileKey);
  const results = loadResults(profileKey);
  if (!registry.reviewers.length) assert.strictEqual(canonicalJson(registry), canonicalJson(reviewerRegistryTemplate(packet)), "empty reviewer registry template drifted");
  if (!results.submissions.length) assert.strictEqual(canonicalJson(results), canonicalJson(resultsTemplate(packet)), "empty review submissions template drifted");
  const validation = validateResultsEnvelope(results, packet, registry, options);
  assert.strictEqual(validation.schemaValid, true);
  assert.strictEqual(validation.approvalReady, false);
  assert.strictEqual(validation.publicationEligible, false);
  assert.strictEqual(validation.applicationAllowed, false);
  assert.strictEqual(validation.applied, false);
  assert.deepStrictEqual(validation.advisoryPatchPlan, []);
  if (profileKey !== DEFAULT_PROFILE_KEY) {
    assert.strictEqual(validation.globalReleaseGateSatisfied, false);
    assert.strictEqual(validation.scopedDecisionAuthority, "none");
    assert.strictEqual(validation.materialDecisionScope,
      "selected_recipe_use_context_only_no_global_material_transition");
    assert(validation.scopedNonAuthorityReason.includes("selected recipe use context"));
  }

  const privateRoot = path.resolve(ROOT, ...paths.privatePrefix.split("/").filter(Boolean));
  const expectedFiles = new Set([paths.manifestRelative, paths.reviewRelative, paths.reviewerRegistryRelative, paths.resultsRelative]);
  const actualFiles = new Set(walk(privateRoot, []).map((file) => path.relative(ROOT, file).replace(/\\/g, "/")));
  assert.deepStrictEqual([...actualFiles].sort(), [...expectedFiles].sort(), "professional review private inventory drifted");
  const review = fs.readFileSync(path.resolve(ROOT, ...paths.reviewRelative.split("/")), "utf8");
  assert.strictEqual(review, buildReviewHtml(packet, packetOptions), "professional review HTML is stale or hand-edited");
  assert.strictEqual((review.match(/class="card material"/g) || []).length, packet.materialTaskCount);
  assert.strictEqual((review.match(/class="card recipe"/g) || []).length, packet.recipeTaskCount);
  assert.strictEqual((review.match(/class="projection"/g) || []).length, packet.materialTaskCount + packet.recipeTaskCount);
  assert(review.includes(`<meta http-equiv="Content-Security-Policy" content="${EXPECTED_CSP_POLICY}">`),
    "professional review CSP drifted");
  assert(!STRICT_ACTIVE_HTML_PATTERN.test(review), "professional review HTML contains active or navigational content");
  if (packet.scopePolicy) {
    const scopeMarker = '<section class="notice" data-section="scoped-authority-boundary">';
    assert(review.includes(scopeMarker) && review.includes(escapeForHtml(JSON.stringify(packet.scopePolicy, null, 2))),
      "scoped authority boundary and digest-bound scope policy must be rendered exactly");
    assert(review.includes("共享材料不得因此被全局改为 reviewed") && review.includes("不具备正式决定、发布或数据迁移权限"),
      "scoped selected-recipe use-context warning is missing");
  }
  packet.materialTasks.forEach((task) => {
    const card = reviewCard(review, "material", task.taskId);
    assert(card.includes(task.subjectDigest) && card.includes(escapeForHtml(task.state)) &&
      card.includes(escapeForHtml(task.currentProfessionalReviewState)), `material ${task.taskId} status/digest is missing`);
    assert(reviewSection(card, "material-review-content").includes(escapeForHtml(JSON.stringify(task.reviewContent, null, 2))),
      `material ${task.taskId} review projection is missing`);
    assert(reviewSection(card, "material-source-summary").includes(escapeForHtml(JSON.stringify(task.sources, null, 2))) &&
      reviewSection(card, "material-occurrence-evidence").includes(escapeForHtml(JSON.stringify(task.occurrenceEvidence, null, 2))),
      `material ${task.taskId} source/occurrence boundary is missing`);
    assertSectionValues(card, "material-required-roles", task.requiredRoles);
    assertSectionValues(card, "material-missing-domains", task.missingDomains);
    assertSectionValues(card, "material-evidence-blockers", task.evidenceBlockers);
    assert.strictEqual(rawDigest(task.reviewContent), task.subjectDigest, `${task.taskId} digest input drifted`);
  });
  packet.recipeTasks.forEach((task) => {
    const card = reviewCard(review, "recipe", task.taskId);
    for (const value of [task.subjectDigest, task.expectedBundleDigest, task.expectedSourceTextDigest]) {
      assert(card.includes(escapeForHtml(value)), `recipe ${task.taskId} digest ${value} is missing`);
    }
    assert(reviewSection(card, "recipe-review-content").includes(escapeForHtml(JSON.stringify(task.reviewContent, null, 2))),
      `${task.taskId} review projection is missing`);
    assertSectionValues(card, "recipe-required-roles", task.requiredRoles);
    assertSectionValues(card, "recipe-prerequisites", task.prerequisiteMaterialTaskIds);
    assertSectionValues(card, "recipe-prerequisite-blockers", task.prerequisiteBlockers);
    assertSectionValues(card, "recipe-technical-findings", task.technicalFindings);
    assertSectionValues(card, "recipe-technical-blockers", task.technicalBlockers);
    assert.strictEqual(rawDigest(task.reviewContent.bundle), task.expectedBundleDigest, `${task.taskId} bundle digest input drifted`);
    assert.strictEqual(rawDigest(task.reviewContent.sourceText), task.expectedSourceTextDigest, `${task.taskId} source digest input drifted`);
    assert.strictEqual(sha256Value({ bundleDigest: task.expectedBundleDigest, sourceTextDigest: task.expectedSourceTextDigest }),
      task.subjectDigest, `${task.taskId} combined subject digest drifted`);
  });

  assert(ARTIFACT_PATHS.every((artifact) => !artifact.startsWith("content-private/")), "private review packet entered release artifacts");
  const forbidden = [paths.privatePrefix, paths.packetId, packet.packetDigest,
    ...packet.materialTasks.map((task) => task.taskId), ...packet.recipeTasks.map((task) => task.taskId)];
  let runtimeReferences = 0;
  for (const file of uploadFiles()) {
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) continue;
    const text = buffer.toString("utf8");
    forbidden.forEach((token) => { if (text.includes(token)) runtimeReferences += 1; });
  }
  assert.strictEqual(runtimeReferences, 0, "private professional review data leaked into upload files");
  console.log(JSON.stringify({
    packetId: packet.packetId,
    materialTasks: packet.materialTaskCount,
    reviewableMaterials: packet.reviewableMaterialTaskCount,
    recipeTasks: packet.recipeTaskCount,
    reviewableRecipes: packet.reviewableRecipeTaskCount,
    submissions: validation.submissionCount,
    approvalReady: false,
    publicationEligible: false,
    runtimeReferences
  }));
  return { packet, validation };
}

function main(options) {
  return profileKeys().map((profileKey) => checkProfile(profileKey, options));
}

function escapeForHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`[check-professional-review] ${error.code || "error"}: ${error.message}`); process.exitCode = 1; }
}
module.exports = { EXPECTED_CSP_POLICY, STRICT_ACTIVE_HTML_PATTERN, assertSectionValues, checkProfile, main, reviewCard, reviewSection, uploadFiles, walk };
