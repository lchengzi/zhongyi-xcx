"use strict";

const path = require("path");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const {
  MediaDraftError,
  loadAndValidate,
  validateManifest
} = require("./media-draft-core");
const { buildManifest } = require("./build-media-draft-manifest");

const ROOT = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(base, code, mutate) {
  const candidate = clone(base);
  mutate(candidate);
  let caught = null;
  try {
    validateManifest(candidate, ROOT, catalog, ruleSet);
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof MediaDraftError, "Mutation did not fail through MediaDraftError");
  assert(caught.code === code, "Expected " + code + " but received " + caught.code + ": " + caught.message);
}

function main() {
  const { manifest, result } = loadAndValidate(ROOT);
  assert(result.count === 8, "Private media batch must contain eight drafts");
  assert(JSON.stringify(manifest) === JSON.stringify(buildManifest()),
    "Generated private media manifest drifted from its source catalog");
  assert(manifest.records.every((record) => record.publicationEligible === false &&
    record.placements.length === 0 && record.audit.reviewState === "pending"),
  "Private media drafts must remain unpublished and unplaced");
  assert(manifest.records.every((record) => record.assets.thumbnailReview.bytes <= 12 * 1024),
    "Review thumbnails exceed the agreed byte budget");

  expectCode(manifest, "unsafe_publication", (candidate) => {
    candidate.records[0].publicationEligible = true;
  });
  expectCode(manifest, "unsafe_placement", (candidate) => {
    candidate.records[0].placements = ["list"];
  });
  expectCode(manifest, "digest_mismatch", (candidate) => {
    candidate.records[0].assets.thumbnailReview.sha256 = "sha256:" + "0".repeat(64);
  });
  expectCode(manifest, "unknown_ingredient", (candidate) => {
    candidate.records[0].ingredientId = "missing-ingredient";
  });
  expectCode(manifest, "private_boundary", (candidate) => {
    candidate.records[0].generation.promptRecord.path = "../prompt.json";
  });
  expectCode(manifest, "ingredient_digest", (candidate) => {
    candidate.records[0].bindings.ingredientDigest = "sha256:" + "0".repeat(64);
  });
  expectCode(manifest, "unsafe_rights_state", (candidate) => {
    candidate.records[0].provenance.rightsStatus = "verified";
  });
  expectCode(manifest, "unsafe_label_state", (candidate) => {
    candidate.records[0].generation.explicitLabelState = "verified";
  });

  console.log(JSON.stringify({
    mediaDrafts: result.count,
    mutationCases: 8,
    publicationEligible: 0,
    uploadLeakageAllowed: false
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[test-media-drafts] " + error.message);
    process.exit(1);
  }
}
