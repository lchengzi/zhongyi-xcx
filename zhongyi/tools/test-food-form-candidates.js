"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  EXPECTED_TARGET_IDS,
  FoodFormCandidateError,
  PRIVATE_PREFIX,
  expectedDepictionMetadataDigest,
  expectedGapEvidenceDigest,
  expectedRetrievalMetadataDigest,
  expectedSourceMetadataDigest,
  inspectWebp,
  loadAndValidate,
  readCandidateDimensions,
  validateManifest
} = require("./food-form-candidate-core");
const { buildManifest } = require("./build-food-form-candidate-manifest");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_RELATIVE = "content-private/media-candidates/food-forms/food-form-catalog.json";

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
  assert(caught instanceof FoodFormCandidateError, label + " did not fail through FoodFormCandidateError");
  assert.strictEqual(caught.code, code,
    label + " expected " + code + " but received " + caught.code + ": " + caught.message);
}

function appendWebpMetadata(buffer) {
  const chunk = Buffer.alloc(12);
  chunk.write("EXIF", 0, 4, "ascii");
  chunk.writeUInt32LE(4, 4);
  chunk.write("test", 8, 4, "ascii");
  const result = Buffer.concat([buffer, chunk]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

function insertJpegExif(buffer) {
  const segment = Buffer.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  return Buffer.concat([buffer.subarray(0, 2), segment, buffer.subarray(2)]);
}

function main() {
  const config = readJson(CONFIG_RELATIVE);
  const { manifest, result } = loadAndValidate(ROOT);
  const rebuilt = buildManifest(config);
  const expectedRecordIds = [
    "food-form-shan-nai-rhizome-v01",
    "food-form-dang-shen-dried-segments-v01",
    "food-form-rou-cong-rong-dried-stem-v01",
    "food-form-tie-pi-shi-hu-stems-v01",
    "food-form-tie-pi-shi-hu-dried-rolls-v01",
    "food-form-xi-yang-shen-dried-slices-v01",
    "food-form-huang-qi-mongholicus-slices-v01",
    "food-form-ling-zhi-market-dried-v01",
    "food-form-mai-dong-dried-tubers-v01",
    "food-form-hua-ju-hong-outer-peel-v01",
    "food-form-jiang-huang-rhizomes-v01",
    "food-form-xi-hong-hua-flower-stigmas-context-v01",
    "food-form-dang-gui-dried-slices-v01",
    "food-form-tian-ma-slices-v01",
    "food-form-cao-guo-dried-fruit-v01",
    "food-form-bi-ba-dried-fruit-spikes-v01",
    "food-form-du-zhong-ye-fresh-leaves-v01",
    "food-form-du-zhong-ye-processing-study-v01",
    "food-form-shan-zhu-yu-dried-fruit-v01"
  ];
  const expectedGapIds = [
    "food-form-gap-gou-qi-zi-v01",
    "food-form-gap-di-huang-v01",
    "food-form-gap-tian-dong-v01"
  ];

  assert.deepStrictEqual(manifest.targetIngredientIds, EXPECTED_TARGET_IDS,
    "The twenty high-information targets drifted");
  assert.deepStrictEqual(manifest.records.map((record) => record.id), expectedRecordIds,
    "Food-form candidate selection or order drifted");
  assert.deepStrictEqual(manifest.gaps.map((gap) => gap.id), expectedGapIds,
    "Explicit no-candidate gaps drifted");
  assert.deepStrictEqual(
    manifest.records.map((record) => [
      record.id,
      record.source.provider === "Wikimedia Commons" ? record.source.pageId : record.source.providerMetadata.pmcid,
      record.source.remoteOriginal.sha1 || record.source.remoteOriginal.etag,
      record.source.author,
      record.source.licenseName
    ]),
    [
      ["food-form-shan-nai-rhizome-v01", 3563989, "990b9b4418d40d615b13d56d8a9c20e11a107fe1", "Hariadhi", "CC BY-SA 4.0"],
      ["food-form-dang-shen-dried-segments-v01", 152987418, "40035c3265279e4f8fa404600e544a357e207761", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-rou-cong-rong-dried-stem-v01", 153943150, "f81b6e8d017d6bf4b7e68c0c9f54582e9dd17dd8", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-tie-pi-shi-hu-stems-v01", 146718842, "75c4b0ac119c365bd1bc87f1341899703df178a3", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-tie-pi-shi-hu-dried-rolls-v01", 150758895, "f39d18aa361af25f5da7e6e0dd2e50e59a2ec280", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-xi-yang-shen-dried-slices-v01", 151023518, "5f86ef7dad909b3f0af9378139a685f525ec6957", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-huang-qi-mongholicus-slices-v01", 149435231, "cf3640487493420778f13c756e9b6ad3c838f21f", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-ling-zhi-market-dried-v01", 185724714, "edd5fb5d3c93ea08369e3490f05f9e4a47dc5da8", "Motoko C. K.", "CC BY 4.0"],
      ["food-form-mai-dong-dried-tubers-v01", 151731512, "afd4d4ce357e305f9534b544edea9ff20499110c", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-hua-ju-hong-outer-peel-v01", 127300378, "7ce1dbbabf67193f43aea384a1fdc8ccc7e0c76f", "N509FZ", "CC BY-SA 4.0"],
      ["food-form-jiang-huang-rhizomes-v01", 56878743, "166779d15a82d41da1eccb80f6491625c558fdd5", "Lavinia Engelbrecht", "CC BY-SA 4.0"],
      ["food-form-xi-hong-hua-flower-stigmas-context-v01", 39703035, "1428a2e162f4a57008ac3cdf04b0d047fd4ac11d", "Emilie40", "CC0 1.0"],
      ["food-form-dang-gui-dried-slices-v01", 151583461, "b61973ee2f0fdf0223085766a2b4a0552a66c00f", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-tian-ma-slices-v01", 151732718, "8cd05b32cca98e382bf8fac1d53b02952b7b4c32", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-cao-guo-dried-fruit-v01", 147952552, "018db283f3b75580d9a20bb25173776c726e994c", "Fumikas Sagisavas", "CC0 1.0"],
      ["food-form-bi-ba-dried-fruit-spikes-v01", 24254544, "9a8a059688555449bface0288c826441cbb36b5b", "Takeaway", "CC BY-SA 3.0"],
      ["food-form-du-zhong-ye-fresh-leaves-v01", 110252651, "be7d3083d2ff77b46b8e5abfc7808a050177ff47", "Agnieszka Kwiecień, Nova", "CC BY-SA 4.0"],
      ["food-form-du-zhong-ye-processing-study-v01", "PMC12059405", "e406d7acd01b5c173ee110e79acd2133", "Yiyun Lin et al.", "CC BY 4.0"],
      ["food-form-shan-zhu-yu-dried-fruit-v01", 150089983, "cbb285d2e937a60922590422df6f88e08f54c736", "Fumikas Sagisavas", "CC0 1.0"]
    ],
    "Food-form source page, checksum, author or licence snapshot drifted"
  );
  assert.deepStrictEqual(
    manifest.gaps.map((gap) => [gap.ingredientId, gap.reasonCode, gap.checkedSources.length]),
    [
      ["gou-qi-zi", "identity_pending_no_vouchered_food_form", 2],
      ["di-huang", "no_tuber_or_processed_form_candidate_found", 6],
      ["tian-dong", "no_tuber_or_processed_form_candidate_found", 4]
    ],
    "Gap reason or checked-source coverage drifted"
  );
  assert.deepStrictEqual(manifest, rebuilt,
    "Generated food-form manifest drifted from its source catalog or local bytes");
  assert.deepStrictEqual(buildManifest(config), rebuilt,
    "Regenerating the food-form manifest must be deterministic");
  assert.deepStrictEqual(
    [result.count, result.targetCount, result.localReviewCopies, result.remoteMetadataOnly, result.gapCount],
    [19, 20, 1, 18, 3],
    "Food-form coverage/retrieval counts drifted"
  );
  assert(manifest.records.every((record) => record.publicationEligible === false &&
    record.placements.length === 0 && record.depiction.identificationUse === "prohibited" &&
    record.depiction.edibilityUse === "prohibited" && record.depiction.medicalUse === "prohibited"),
  "Every photo candidate must remain private and non-evidentiary");
  assert(manifest.records.filter((record) => record.retrieval.state === "remote_metadata_only")
    .every((record) => record.assets === null && record.retrieval.localAssetAvailable === false),
  "Remote-only candidates must not claim local files");
  assert(manifest.gaps.every((gap) => gap.fallbackAllowed === false),
    "A coverage gap must not allow fallback imagery");

  const localIndex = manifest.records.findIndex((record) => record.retrieval.state === "local_review_copy");
  const remoteIndex = manifest.records.findIndex((record) => record.retrieval.state === "remote_metadata_only");
  const pmcIndex = manifest.records.findIndex((record) => record.source.provider === "PubMed Central");
  assert(localIndex >= 0 && remoteIndex >= 0 && pmcIndex >= 0,
    "Expected local, remote-only and PubMed Central review records");

  expectCode(manifest, "unsafe_publication", (candidate) => {
    candidate.records[0].publicationEligible = true;
  }, "publication mutation");
  expectCode(manifest, "unsafe_publication", (candidate) => {
    candidate.records[0].placements = ["catalog_card"];
  }, "placement mutation");
  expectCode(manifest, "private_boundary", (candidate) => {
    candidate.records[localIndex].assets.sourceCopy.path = "data/ingredients.js";
  }, "private path mutation");
  expectCode(manifest, "path_case_mismatch", (candidate) => {
    candidate.records[localIndex].assets.sourceCopy.path =
      candidate.records[localIndex].assets.sourceCopy.path.replace("mai-dong--", "Mai-dong--");
  }, "path case mutation");
  expectCode(manifest, "digest_mismatch", (candidate) => {
    candidate.records[localIndex].assets.review.sha256 = "sha256:" + "0".repeat(64);
  }, "local asset digest mutation");
  expectCode(manifest, "source_digest", (candidate) => {
    candidate.records[0].source.rightsHolder = "Tampered rights holder";
  }, "source metadata digest mutation");
  expectCode(manifest, "unknown_ingredient", (candidate) => {
    candidate.records[0].ingredientId = "missing-ingredient";
  }, "unknown ingredient mutation");
  expectCode(manifest, "ingredient_binding", (candidate) => {
    candidate.records[0].depiction.canonicalName = "错误名称";
  }, "catalog identity mutation");
  expectCode(manifest, "unsafe_audit_state", (candidate) => {
    candidate.records[0].audit.professionalReviewState = "reviewed";
  }, "professional review mutation");
  expectCode(manifest, "source_binding", (candidate) => {
    candidate.records[0].source.rightsReviewState = "reviewed";
    candidate.records[0].source.sourceMetadataDigest = expectedSourceMetadataDigest(candidate.records[0].source);
  }, "rights review mutation");
  expectCode(manifest, "invalid_retrieval", (candidate) => {
    candidate.records[remoteIndex].assets = clone(candidate.records[localIndex].assets);
  }, "remote-only assets mutation");
  expectCode(manifest, "invalid_retrieval", (candidate) => {
    candidate.records[remoteIndex].retrieval.localAssetAvailable = true;
    candidate.records[remoteIndex].retrieval.retrievalMetadataDigest =
      expectedRetrievalMetadataDigest(candidate.records[remoteIndex].retrieval);
  }, "remote-only local flag mutation");
  expectCode(manifest, "invalid_asset", (candidate) => {
    candidate.records[localIndex].assets.review = null;
  }, "local review asset mutation");
  expectCode(manifest, "coverage_missing", (candidate) => {
    candidate.records.splice(0, 1);
    candidate.count = candidate.records.length;
  }, "target coverage mutation");
  expectCode(manifest, "coverage_overlap", (candidate) => {
    candidate.gaps[0].ingredientId = candidate.records[0].ingredientId;
  }, "candidate-gap overlap mutation");
  expectCode(manifest, "duplicate_id", (candidate) => {
    candidate.records.push(clone(candidate.records[0]));
    candidate.count = candidate.records.length;
  }, "duplicate candidate id mutation");
  expectCode(manifest, "unsafe_depiction", (candidate) => {
    candidate.records[0].depiction.edibilityUse = "allowed";
  }, "edibility-use mutation");
  expectCode(manifest, "source_origin_binding", (candidate) => {
    candidate.records[0].source.sourceTaxonLabel = "Ophiopogon japonicus";
    candidate.records[0].source.taxonEvidenceKind = "structured_depicts";
    candidate.records[0].source.sourceMetadataDigest = expectedSourceMetadataDigest(candidate.records[0].source);
    candidate.records[0].depiction.sourceIdentityEvidence = {
      label: "Ophiopogon japonicus",
      evidenceKind: "structured_depicts"
    };
    candidate.records[0].depictionMetadataDigest =
      expectedDepictionMetadataDigest(candidate.records[0].depiction);
  }, "source-origin binding mutation");
  expectCode(manifest, "version_binding", (candidate) => {
    candidate.records[0].bindings.ingredientDigest = "sha256:" + "0".repeat(64);
  }, "ingredient digest mutation");
  expectCode(manifest, "unsafe_gap", (candidate) => {
    candidate.gaps[0].fallbackAllowed = true;
  }, "gap fallback mutation");
  expectCode(manifest, "approved_source_binding", (candidate) => {
    const replacement = candidate.records[1].source;
    candidate.records[0].source.fileTitle = replacement.fileTitle;
    candidate.records[0].source.sourcePage = replacement.sourcePage;
    candidate.records[0].source.originalUrl = replacement.originalUrl;
    candidate.records[0].source.sourceMetadataDigest = expectedSourceMetadataDigest(candidate.records[0].source);
  }, "independently approved Commons file binding mutation");
  expectCode(manifest, "approved_source_binding", (candidate) => {
    const firstIndex = 0;
    const secondIndex = localIndex;
    const fields = ["ingredientId", "depiction", "depictionMetadataDigest", "source", "retrieval", "assets", "bindings"];
    for (const field of fields) {
      const held = candidate.records[firstIndex][field];
      candidate.records[firstIndex][field] = candidate.records[secondIndex][field];
      candidate.records[secondIndex][field] = held;
    }
  }, "cross-ingredient candidate binding mutation");
  expectCode(manifest, "invalid_retrieval", (candidate) => {
    const retrieval = candidate.records[localIndex].retrieval;
    retrieval.upstreamPreviewUrl =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Different.jpg/960px-Different.jpg";
    retrieval.retrievalRequestUrl =
      "https://wsrv.nl/?url=upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Different.jpg/960px-Different.jpg&output=jpg";
    retrieval.retrievalMetadataDigest = expectedRetrievalMetadataDigest(retrieval);
  }, "preview-to-original binding mutation");
  expectCode(manifest, "approved_gap_binding", (candidate) => {
    candidate.gaps[0].checkedSources[0].note += "（被篡改）";
    candidate.gaps[0].searchEvidenceDigest = expectedGapEvidenceDigest(candidate.gaps[0]);
  }, "independently approved gap evidence mutation");
  expectCode(manifest, "approved_source_binding", (candidate) => {
    candidate.records[pmcIndex].source.providerMetadata.publisher = "Unapproved publisher";
    candidate.records[pmcIndex].source.sourceMetadataDigest =
      expectedSourceMetadataDigest(candidate.records[pmcIndex].source);
  }, "independently approved PMC metadata mutation");
  expectCode(manifest, "source_binding", (candidate) => {
    candidate.records[pmcIndex].source.remoteOriginal.etag = "invalid";
    candidate.records[pmcIndex].source.sourceMetadataDigest =
      expectedSourceMetadataDigest(candidate.records[pmcIndex].source);
  }, "PMC remote integrity mutation");
  expectCode(manifest, "approved_source_binding", (candidate) => {
    const index = candidate.records.findIndex((record) => record.ingredientId === "jiang-huang");
    candidate.records[index].depiction.processingState = "fresh_harvested";
    candidate.records[index].depictionMetadataDigest =
      expectedDepictionMetadataDigest(candidate.records[index].depiction);
  }, "independently approved processing-semantics mutation");

  const localReviewPath = path.join(ROOT, ...manifest.records[localIndex].assets.review.path.split("/"));
  const webpWithExif = appendWebpMetadata(fs.readFileSync(localReviewPath));
  let webpError = null;
  try {
    inspectWebp(webpWithExif, "mutated review WebP");
  } catch (error) {
    webpError = error;
  }
  assert(webpError instanceof FoodFormCandidateError && webpError.code === "unsafe_webp_metadata",
    "A review WebP with EXIF metadata must fail closed");

  const localSourcePath = path.join(ROOT, ...manifest.records[localIndex].assets.sourceCopy.path.split("/"));
  let jpegError = null;
  try {
    readCandidateDimensions(insertJpegExif(fs.readFileSync(localSourcePath)), "image/jpeg", "mutated source JPEG");
  } catch (error) {
    jpegError = error;
  }
  assert(jpegError instanceof FoodFormCandidateError && jpegError.code === "unsafe_jpeg_metadata",
    "A cached review source with EXIF metadata must fail closed");

  assert(manifest.records[localIndex].assets.sourceCopy.path.startsWith(PRIVATE_PREFIX) &&
    manifest.records[localIndex].assets.review.path.startsWith(PRIVATE_PREFIX),
  "Local review files left the private food-form directory");
  console.log(JSON.stringify({
    foodFormCandidates: result.count,
    targetIngredients: result.targetCount,
    localReviewCopies: result.localReviewCopies,
    remoteMetadataOnly: result.remoteMetadataOnly,
    explicitGaps: result.gapCount,
    mutationCases: 29,
    structuredMutationCases: 27,
    binaryMetadataMutationCases: 2,
    publicationEligible: 0,
    runtimePlacements: 0,
    manifestRegenerationStable: true,
    webpMetadataRejected: true,
    jpegMetadataRejected: true
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[test-food-form-candidates] " + error.message);
    process.exit(1);
  }
}

module.exports = { main };
