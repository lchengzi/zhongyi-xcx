"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  CATALOG_RELATIVE, MANIFEST_RELATIVE, REVIEW_RELATIVE, ROOT,
  buildManifest, canonicalJson, loadManifest, readJson
} = require("./external-food-source-candidate-core");
const { buildReviewHtml } = require("./build-external-food-source-review");

const EXPECTED_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
const ACTIVE_HTML = /<(?:script|img|iframe|frame|object|embed|form|input|button|textarea|select|link|a|area|base|svg|math|audio|video|source|track)\b|\s(?:href|src|srcset|action|formaction|poster|data|xlink:href)\s*=|http-equiv\s*=\s*["']?refresh\b|\son[a-z]+\s*=/i;

function walk(root, output) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `source-candidate boundary contains a symbolic link: ${file}`);
    if (entry.isDirectory()) walk(file, output);
    else if (entry.isFile()) output.push(file);
  }
  return output;
}

function uploadFiles() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
  const ignores = new Set((config.packOptions && config.packOptions.ignore || []).map((item) => item.value.replace(/\\/g, "/")));
  return walk(ROOT, []).filter((file) => {
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    const top = relative.split("/")[0];
    return !ignores.has(relative) && !ignores.has(top) && top !== "node_modules" && top !== ".git";
  });
}

function privateSourceFingerprints(manifest) {
  const tokens = ["content-private/source-candidates"];
  manifest.candidates.forEach((candidate) => {
    tokens.push(candidate.id, candidate.source.url, candidate.source.title, candidate.sourceMetadataDigest, candidate.candidateSemanticDigest);
    tokens.push(...candidate.source.standardIds, ...candidate.notes);
  });
  manifest.evidenceItems.forEach((item) => {
    tokens.push(item.id, item.source.url, item.source.title, item.sourceMetadataDigest, item.evidenceSemanticDigest);
    tokens.push(...item.source.documentIds, ...item.claimLocator, ...item.preciseClaims, ...item.limitations);
  });
  manifest.gaps.forEach((gap) => {
    tokens.push(gap.gapCode, gap.reason, gap.nextSearch, gap.gapSemanticDigest);
  });
  return [...new Set(tokens.filter((token) => typeof token === "string" && token.trim().length >= 8))];
}

function countForbiddenReferences(text, fingerprints) {
  return fingerprints.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
}

function main() {
  const catalog = readJson(CATALOG_RELATIVE, "source catalog");
  const manifest = loadManifest();
  const expected = buildManifest(catalog);
  assert.strictEqual(canonicalJson(manifest), canonicalJson(expected), "external-food source manifest is stale or was edited by hand");
  assert.strictEqual(manifest.publicationEligibleCount, 0, "source candidates became publication eligible");
  assert.strictEqual(manifest.runtimePlacementCount, 0, "source candidates gained runtime placements");
  assert.strictEqual(manifest.targetCount, 18, "external-food target accounting drifted");
  assert.strictEqual(manifest.evidenceCount, 30, "claim-level evidence count drifted");
  assert.strictEqual(manifest.domainSlotCount, 72, "four-domain coverage accounting drifted");
  assert.strictEqual(manifest.readyDomainSlotCount, 0, "a private candidate domain became ready");
  assert(manifest.targetCoverage.every((item) => Object.values(item.domains).every((slot) => slot.ready === false && Array.isArray(slot.residualGapCodes) && slot.residualGapCodes.length)), "candidate coverage lost a residual gap");

  const privateRoot = path.resolve(ROOT, "content-private", "source-candidates", "external-foods");
  const expectedPrivate = new Set([CATALOG_RELATIVE, MANIFEST_RELATIVE, REVIEW_RELATIVE]);
  const actualPrivate = new Set(walk(privateRoot, []).map((file) => path.relative(ROOT, file).replace(/\\/g, "/")));
  assert.deepStrictEqual([...actualPrivate].sort(), [...expectedPrivate].sort(), "unregistered external-food source candidate file exists");
  const review = fs.readFileSync(path.resolve(ROOT, ...REVIEW_RELATIVE.split("/")), "utf8");
  assert.strictEqual(review, buildReviewHtml(manifest), "private source review is stale or was edited by hand");
  assert(review.includes(`content="${EXPECTED_CSP}"`), "private source review CSP drifted");
  assert(!ACTIVE_HTML.test(review), "private source review contains active or navigable content");
  assert((review.match(/<article\b/g) || []).length === manifest.candidateCount + manifest.evidenceCount + manifest.targetCount + manifest.gapCount, "private source review card count drifted");
  manifest.evidenceItems.forEach((item) => {
    assert(review.includes(item.id) && review.includes(item.evidenceSemanticDigest), `evidence review card is missing ${item.id}`);
  });

  const forbidden = privateSourceFingerprints(manifest);
  const runtimeTextExtensions = new Set([".js", ".json", ".wxml", ".wxss"]);
  let runtimeReferences = 0;
  for (const file of uploadFiles()) {
    if (!runtimeTextExtensions.has(path.extname(file).toLowerCase())) continue;
    const text = fs.readFileSync(file, "utf8");
    runtimeReferences += countForbiddenReferences(text, forbidden);
  }
  assert.strictEqual(runtimeReferences, 0, "private external-food source candidate leaked into upload files");
  console.log(JSON.stringify({
    sourceCandidates: manifest.candidateCount,
    evidenceItems: manifest.evidenceCount,
    candidateTargets: manifest.targetCount,
    explicitGaps: manifest.gapCount,
    publicationEligible: 0,
    runtimeReferences
  }));
  return manifest;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[check-external-food-source-candidates] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { countForbiddenReferences, main, privateSourceFingerprints };
