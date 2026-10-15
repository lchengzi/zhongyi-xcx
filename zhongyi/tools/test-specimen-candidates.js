"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  MANIFEST_RELATIVE,
  SpecimenCandidateError,
  loadAndValidate,
  validateManifest
} = require("./specimen-candidate-core");
const { buildManifest } = require("./build-specimen-candidate-manifest");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_RELATIVE = "content-private/media-candidates/specimens/specimen-catalog.json";
const PRIVATE_PREFIX = "content-private/media-candidates/specimens/";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...relative.split("/")), "utf8").replace(/^\uFEFF/, ""));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(base, code, mutate, label) {
  const candidate = clone(base);
  mutate(candidate);
  let caught = null;
  try {
    validateManifest(candidate, ROOT);
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof SpecimenCandidateError,
    label + " did not fail through SpecimenCandidateError");
  assert.strictEqual(caught.code, code,
    label + " expected " + code + " but received " + caught.code + ": " + caught.message);
}

function main() {
  const config = readJson(CONFIG_RELATIVE);
  const { manifest, result } = loadAndValidate(ROOT);
  const rebuilt = buildManifest(config);

  const expectedIds = [
    "specimen-jiang-huang-uzh-z-000291572",
    "specimen-xi-hong-hua-naturalis-l-3912155",
    "specimen-dang-gui-cas-1412522",
    "specimen-tian-ma-mw0047814",
    "specimen-cao-guo-cas-448162",
    "specimen-bi-ba-naturalis-l-4533047",
    "specimen-du-zhong-ye-naturalis-l-3783904",
    "specimen-shan-zhu-yu-naturalis-l-2596072"
  ];
  assert.strictEqual(config.records.length, 8, "Specimen source catalog must contain eight candidates");
  assert.strictEqual(result.count, 8, "Private specimen manifest must validate eight candidates");
  assert.deepStrictEqual(config.records.map((record) => record.id), expectedIds,
    "Specimen candidate selection or order drifted");
  assert.deepStrictEqual(manifest, rebuilt,
    "Generated specimen manifest drifted from its source catalog or asset bytes");
  assert.deepStrictEqual(buildManifest(config), rebuilt,
    "Regenerating the same specimen catalog must be deterministic");
  assert.deepStrictEqual(
    manifest.records.map((record) => [record.id, record.ingredientId]),
    config.records.map((record) => [record.id, record.ingredientId]),
    "Manifest record identity or order drifted from the source catalog"
  );

  assert(manifest.scope === "private_review_only" &&
    manifest.policy.clientUploadAllowed === false &&
    manifest.policy.runtimeReferenceAllowed === false,
  "Specimen candidates must remain behind the private boundary");
  assert(manifest.records.every((record) =>
    record.publicationEligible === false &&
    Array.isArray(record.placements) && record.placements.length === 0),
  "Specimen candidates must remain unpublished and unplaced");
  assert(manifest.records.every((record) =>
    record.source.rightsReviewState === "pending" &&
    record.audit.rightsReviewState === "pending" &&
    record.audit.professionalReviewState === "pending" &&
    record.audit.reviews.length === 0),
  "Specimen rights and professional reviews must remain pending");
  assert(manifest.records.every((record) => Number.isInteger(record.source.taxonKey) &&
    Number.isInteger(record.source.acceptedTaxonKey) &&
    /^sha256:[a-f0-9]{64}$/.test(record.source.sourceMetadataDigest)),
  "Specimen taxonomy and source metadata must remain explicitly bound");
  assert.deepStrictEqual(
    manifest.records.filter((record) => record.source.scientificNameMatch !== "exact_text")
      .map((record) => [record.ingredientId, record.source.taxonReferenceId]),
    [
      ["tian-ma", "urn:lsid:ipni.org:names:635522-1"],
      ["cao-guo", "gbif:5635718"],
      ["shan-zhu-yu", "gbif:7161076"]
    ],
    "Explicit scientific-name equivalence bindings drifted"
  );
  assert(manifest.records.every((record) =>
    [record.assets.original.path, record.assets.review.path]
      .every((assetPath) => assetPath.startsWith(PRIVATE_PREFIX))),
  "A specimen asset path left the private candidate directory");

  expectCode(manifest, "private_boundary", (candidate) => {
    candidate.records[0].assets.original.path = "data/ingredients.js";
  }, "private-path mutation");
  expectCode(manifest, "unsafe_publication", (candidate) => {
    candidate.records[0].publicationEligible = true;
  }, "publication eligibility mutation");
  expectCode(manifest, "unsafe_publication", (candidate) => {
    candidate.records[0].placements = ["list"];
  }, "runtime placement mutation");
  expectCode(manifest, "unsafe_rights_state", (candidate) => {
    candidate.records[0].source.rightsReviewState = "reviewed";
  }, "source rights mutation");
  expectCode(manifest, "unsafe_audit_state", (candidate) => {
    candidate.records[0].audit.rightsReviewState = "reviewed";
  }, "audit rights mutation");
  expectCode(manifest, "unsafe_audit_state", (candidate) => {
    candidate.records[0].audit.professionalReviewState = "reviewed";
  }, "professional review mutation");
  expectCode(manifest, "digest_mismatch", (candidate) => {
    candidate.records[0].assets.review.sha256 = "sha256:" + "0".repeat(64);
  }, "asset digest mutation");
  expectCode(manifest, "source_binding", (candidate) => {
    candidate.records[0].source.gbifKey += 1;
  }, "GBIF source mutation");
  expectCode(manifest, "source_binding", (candidate) => {
    candidate.records[3].source.scientificName = "Gastrodia elata Madeup";
  }, "unregistered scientific-name authorship mutation");
  expectCode(manifest, "source_binding", (candidate) => {
    candidate.records[0].source.basisOfRecord = "HUMAN_OBSERVATION";
  }, "basis-of-record mutation");
  expectCode(manifest, "source_digest", (candidate) => {
    candidate.records[1].source.mediaRightsHolder = "Tampered rights holder";
  }, "source metadata digest mutation");
  expectCode(manifest, "unknown_ingredient", (candidate) => {
    candidate.records[0].ingredientId = "missing-ingredient";
  }, "ingredient id mutation");
  expectCode(manifest, "invalid_depiction", (candidate) => {
    candidate.records[0].depiction.catalogPartVisibility = "verified";
  }, "depicted-part visibility mutation");
  expectCode(manifest, "version_binding", (candidate) => {
    candidate.records[0].bindings.ingredientDigest = "sha256:" + "0".repeat(64);
  }, "material digest mutation");

  console.log(JSON.stringify({
    specimenCandidates: result.count,
    mutationCases: 14,
    publicationEligible: 0,
    runtimePlacements: 0,
    manifestRegenerationStable: true
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[test-specimen-candidates] " + error.message);
    process.exit(1);
  }
}
