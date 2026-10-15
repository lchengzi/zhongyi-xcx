"use strict";

// Dated capture evidence only; no approval, image modification or publishing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const PHOTO_CAPTURE_RECORD_PATH = "content-private/research-refresh/2026-10-09-photo-captures.json";
const GALLERY_PATH = "content-private/research-refresh/photo-captures-review.html";
const BASELINE = Object.freeze({
  catalogPath: "content-private/media-candidates/food-forms/food-form-catalog.json",
  catalogSha256: "sha256:ccd0f652e2b9f6b3544ac58467b2f0a45d610de428832157de43a14d3580202c",
  metadataPath: "content-private/research-refresh/2026-10-09-existing-photo-metadata.json",
  metadataSha256: "sha256:6535ccec88c0f38ff29960268fb95cb00496ac8e9a597cbbb6938415886da6a7"
});
const CONTRACTS = [
  ["dangshen", "food-form-dang-shen-dried-segments-v01", "dang-shen", 2337877, 4000, 3000, "a65ecca3b5a228a1c71521b8f7d84cd53a41dbea61db6cb4160f6be4a5473666", 1824, 1368],
  ["huangqi", "food-form-huang-qi-mongholicus-slices-v01", "huang-qi", 2014491, 3000, 3000, "fa00045e14cf5f08ec43f6d9b798dfcfc1ed3b60b0cc195fac38dcefbc23f217", 1600, 1600],
  ["tiepi", "food-form-tie-pi-shi-hu-dried-rolls-v01", "tie-pi-shi-hu", 2505398, 3000, 3000, "411ecfc492f44454ace3ff8594596dc2f509b36b989414b7bea5f076465402cb", 1600, 1600]
];
const photoPath = (name) => `content-private/research-refresh/photo-originals/${name}-original.jpg`;
const PHOTO_CAPTURE_BATCH2_PATH = "content-private/research-refresh/2026-10-09-photo-captures-batch2.json";
const BATCH2_GALLERY = "content-private/research-refresh/photo-captures-batch2-review.html";
const BATCH2_BASELINE = Object.freeze({ catalogPath: BASELINE.catalogPath, catalogSha256: BASELINE.catalogSha256,
  previousCapturePath: PHOTO_CAPTURE_RECORD_PATH, previousCaptureSha256: "sha256:fb0878f8bd41e4e64d7890330969ec412b80a61bfca428a5e8b169ddea24ea86" });
const BATCH2_CONTRACTS = [
  ["shannai", "food-form-shan-nai-rhizome-v01", "shan-nai", 2110572, 3008, 2000, "19eb275c74097de1b1a08b65352e6b06f891b6977a7b34fd3fc3b592a9f820f3", 1924, 1280, "1205196248", "2008-02-11", "2008-02-16"],
  ["roucongrong", "food-form-rou-cong-rong-dried-stem-v01", "rou-cong-rong-huang-mo", 3272199, 3000, 3000, "626b45400cdef249fe6e65c06658983e6268bebc8b6498f6fa44a86d5c5efb80", 1600, 1600, "1213281754", "2024-10-12", "2024-10-15"],
  ["huajuhong", "food-form-hua-ju-hong-outer-peel-v01", "hua-ju-hong", 4288833, 4032, 2688, "68561ce34783c22129c03e40b8dd350f40fbd83221b47b17ad7c8b1ef5bab6b9", 1920, 1280, "1026394478", "2023-01-02", "2023-01-02"],
  ["danggui", "food-form-dang-gui-dried-slices-v01", "dang-gui", 2515168, 3000, 3000, "1d170e9d1becf4eafa1f9b1f629ac20fc6945a873e8e9cc94a0aad73b5b46bf3", 1600, 1600, "993276180", "2024-03-02", "2024-08-18"]
];
const batch2PhotoPath = name => `content-private/research-refresh/photo-originals-batch2/${name}-original.jpg`;
const PHOTO_CAPTURE_BATCH3_PATH = "content-private/research-refresh/2026-10-09-photo-captures-batch3.json";
const BATCH3_GALLERY = "content-private/research-refresh/photo-captures-batch3-review.html";
const BATCH3_BASELINE = Object.freeze({ catalogPath: BASELINE.catalogPath, catalogSha256: BASELINE.catalogSha256,
  previousCapturePath: PHOTO_CAPTURE_BATCH2_PATH, previousCaptureSha256: "sha256:e3bde6145d7405c8d03ab9f5cb9cbe45e9210323985e6d125bef97286d0c8eb4" });
const BATCH3_CONTRACTS = [
  ["jianghuang", "food-form-jiang-huang-rhizomes-v01", "jiang-huang", 131352, 1024, 720, "70bcea0b29c9efaeb54198c49425d86e19e07b73a263ca524d1a27cc09afcda4", 1024, 720, "1160545064", "2016-11-30", "2017-03-07"],
  ["caoguo", "food-form-cao-guo-dried-fruit-v01", "cao-guo", 3307524, 3000, 3000, "6ae80f830741bba5254c7a01bda81f7b71883f813ea8a86aec4e0d4f7b465e50", 1600, 1600, "1213281159", "2024-05-02", "2024-05-02"],
  ["shanzhuyu", "food-form-shan-zhu-yu-dried-fruit-v01", "shan-zhu-yu", 3882564, 3000, 3000, "1e52c8b7421e2fdf6f3e5cf5d1f1078c89af093a64091c8405ea9f01c3821e1e", 1600, 1600, "1213280238", "2024-07-07", "2024-07-07"]
];
const batch3PhotoPath = name => `content-private/research-refresh/photo-originals-batch3/${name}-original.jpg`;
const PHOTO_CAPTURE_BATCH4_PATH = "content-private/research-refresh/2026-10-09-photo-captures-batch4.json";
const BATCH4_GALLERY = "content-private/research-refresh/photo-captures-batch4-review.html";
const BATCH4_BASELINE = Object.freeze({ catalogPath: BASELINE.catalogPath, catalogSha256: BASELINE.catalogSha256,
  previousCapturePath: PHOTO_CAPTURE_BATCH3_PATH, previousCaptureSha256: "sha256:700be28697e20ef55f2b0d3f5e8d3497f7e9c4823ac9af44e914d140555d99f8" });
const BATCH4_CONTRACTS = [
  ["tiepi-stems", "food-form-tie-pi-shi-hu-stems-v01", "tie-pi-shi-hu", 3818319, 3000, 3000, "f66d48d8990323bbdfe399e62323d606d04a6c17f5d5b1c4fa72417413814b96", 1600, 1600, "1200891997", "2024-03-24", "2024-03-24"],
  ["lingzhi", "food-form-ling-zhi-market-dried-v01", "ling-zhi", 1790532, 3253, 2440, "cc14a97a4af38632db816d5fede24240c3f92c7cefb021efb47bbc0d628706f2", 1824, 1368, "1193638436", "2026-02-14", "2026-03-08"],
  ["xihonghua", "food-form-xi-hong-hua-flower-stigmas-context-v01", "xi-hong-hua", 1293916, 2160, 1440, "bf0419243088147d9ac2b51e628de43a0d2a8541e114d01c25adc89e752f208c", 1920, 1280, "1033530506", "2007-11-06", "2015-04-21"]
];
const batch4PhotoPath = name => `content-private/research-refresh/photo-originals-batch4/${name}-original.jpg`;
const FAILED_URLS = ["https://upload.wikimedia.org/wikipedia/commons/c/cd/Dried_american_ginseng_slices_%281%29.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/b/bd/Gastrodia_elata_tablets.jpg", "https://commons.wikimedia.org/wiki/File:Kaempferia_galanga.jpg"];
const ALLOWED = new Set([BASELINE.catalogPath, BASELINE.metadataPath, GALLERY_PATH, PHOTO_CAPTURE_RECORD_PATH,
  PHOTO_CAPTURE_BATCH2_PATH, PHOTO_CAPTURE_BATCH3_PATH, BATCH2_GALLERY, BATCH3_GALLERY, BATCH4_GALLERY,
  ...CONTRACTS.map((c) => photoPath(c[0])), ...BATCH2_CONTRACTS.map(c => batch2PhotoPath(c[0])),
  ...BATCH3_CONTRACTS.map(c => batch3PhotoPath(c[0])), ...BATCH4_CONTRACTS.map(c => batch4PhotoPath(c[0]))]);
const digest = (bytes, algorithm = "sha256") => crypto.createHash(algorithm).update(bytes).digest("hex");
function keys(value, expected) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), expected.split(" ").sort(), "unsupported capture fields");
}
function text(value) { assert(typeof value === "string" && value.trim().length > 0); }
function readPrivate(relative) {
  assert(ALLOWED.has(relative), "unregistered capture path");
  const filename = path.join(ROOT, relative);
  for (let current = filename; ; current = path.dirname(current)) {
    assert(!fs.lstatSync(current).isSymbolicLink(), "linked capture rejected");
    assert.equal(fs.realpathSync(current).toLowerCase(), current.toLowerCase(), "redirected capture rejected");
    if (current === ROOT) break;
  }
  const info = fs.statSync(filename);
  const maxBytes = relative === batch2PhotoPath("huajuhong") ? 5 * 1024 * 1024 : 4 * 1024 * 1024;
  assert(info.isFile() && info.size <= maxBytes, "invalid capture file");
  return fs.readFileSync(filename);
}
function originalJpegInfo(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9);
  let offset = 2, dimensions = null, app1 = false;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff);
    let marker = bytes[offset++]; while (marker === 0xff) marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    assert(offset + 2 <= bytes.length);
    const length = bytes.readUInt16BE(offset);
    assert(length >= 2 && offset + length <= bytes.length);
    if (marker === 0xe1) app1 = true;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      assert(length >= 7); dimensions = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  assert(dimensions); return { ...dimensions, app1 };
}
function validateOriginalAndObservation(item, contract, expectedPath, sha1, loadBytes, {
  app1 = true, observationBasis = "local_original_viewed_at_scaled_resolution"
} = {}) {
  const [, , , bytes, width, height, sha256, displayWidth, displayHeight] = contract;
  keys(item.capture, "path bytes sha1 sha256 width height mimeType originalMetadataRetained publicDerivativeAvailable");
  assert.deepEqual(item.capture, { path: expectedPath, bytes, sha1, sha256: `sha256:${sha256}`, width, height,
    mimeType: "image/jpeg", originalMetadataRetained: true, publicDerivativeAvailable: false });
  const binary = loadBytes(expectedPath);
  assert(Buffer.isBuffer(binary)); assert.equal(binary.length, bytes);
  assert.equal(digest(binary), sha256, "captured image bytes changed"); assert.equal(digest(binary, "sha1"), sha1);
  assert.deepEqual(originalJpegInfo(binary), { width, height, app1 });
  keys(item.visualObservation, "basis observer displayWidth displayHeight description");
  assert.equal(item.visualObservation.basis, observationBasis);
  assert.equal(item.visualObservation.observer, "ai_assisted_non_professional");
  assert.equal(item.visualObservation.displayWidth, displayWidth); assert.equal(item.visualObservation.displayHeight, displayHeight);
  text(item.visualObservation.description);
  for (const key of ["identityReviewState", "partProcessingReviewState", "rightsReviewState", "professionalReviewState"]) assert.equal(item[key], "pending");
  assert(Array.isArray(item.limitations) && item.limitations.length >= 2); item.limitations.forEach(text);
}
function validatePhotoCaptures(record, loadBytes = readPrivate) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements doesNotCloseGaps baseline photoCaptures metadataWarning retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-captures.1"); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.equal(record.doesNotCloseGaps, true); assert.deepEqual(record.runtimePlacements, []);
  assert.deepEqual(record.baseline, BASELINE);
  const catalogBytes = loadBytes(BASELINE.catalogPath), metadataBytes = loadBytes(BASELINE.metadataPath);
  assert.equal(`sha256:${digest(catalogBytes)}`, BASELINE.catalogSha256);
  assert.equal(`sha256:${digest(metadataBytes)}`, BASELINE.metadataSha256);
  const catalog = JSON.parse(catalogBytes), metadata = JSON.parse(metadataBytes);
  assert(Array.isArray(record.photoCaptures)); assert.equal(record.photoCaptures.length, 3);
  record.photoCaptures.forEach((item, index) => {
    const [name, candidateId, ingredientId] = CONTRACTS[index];
    const prior = metadata.existingPhotoObservations[index];
    const candidate = catalog.records.find((c) => c.id === candidateId);
    keys(item, "id candidateId ingredientId previousObservationId capture visualObservation identityReviewState partProcessingReviewState rightsReviewState professionalReviewState limitations");
    assert.equal(item.id, `capture-${name}-original-20261009`);
    assert.equal(item.candidateId, candidateId); assert.equal(item.ingredientId, ingredientId);
    assert.equal(item.previousObservationId, prior.id); assert.equal(prior.candidateId, candidateId);
    assert.equal(candidate.source.originalUrl, prior.remoteOriginal.url);
    assert.equal(candidate.source.remoteOriginal.sha1, prior.remoteOriginal.sha1);
    validateOriginalAndObservation(item, CONTRACTS[index], photoPath(name), prior.remoteOriginal.sha1, loadBytes);
  });
  text(record.metadataWarning);
  for (const list of [record.retrievalIssues, record.nextActions]) { assert(Array.isArray(list) && list.length); list.forEach(text); }
  assert.equal(digest(loadBytes(GALLERY_PATH)), "8c9fa1f99e7d59cc3110267e334452e79d457f19bccbd2061213fe15d4a5564c", "private gallery changed; review its image and network boundaries");
  if (loadBytes === readPrivate) assert.deepEqual(fs.readdirSync(path.join(ROOT, "content-private/research-refresh/photo-originals")).sort(), CONTRACTS.map((c) => `${c[0]}-original.jpg`).sort());
}
function validatePhotoCapturesBatch2(record, loadBytes = readPrivate) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements doesNotCloseGaps baseline photoCaptures metadataWarning retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-captures.2"); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.equal(record.doesNotCloseGaps, true); assert.deepEqual(record.runtimePlacements, []); assert.deepEqual(record.baseline, BATCH2_BASELINE);
  const catalogBytes = loadBytes(BASELINE.catalogPath), previousBytes = loadBytes(PHOTO_CAPTURE_RECORD_PATH);
  assert.equal(`sha256:${digest(catalogBytes)}`, BASELINE.catalogSha256);
  assert.equal(`sha256:${digest(previousBytes)}`, BATCH2_BASELINE.previousCaptureSha256);
  const catalog = JSON.parse(catalogBytes);
  assert(Array.isArray(record.photoCaptures)); assert.equal(record.photoCaptures.length, 4);
  record.photoCaptures.forEach((item, index) => {
    const contract = BATCH2_CONTRACTS[index];
    const [name, candidateId, ingredientId, bytes, width, height, , , , revision, photographedAt, uploadedAt] = contract;
    const candidate = catalog.records.find(c => c.id === candidateId);
    keys(item, "id candidateId ingredientId sourceObservation capture visualObservation partAlignmentConcern identityReviewState partProcessingReviewState rightsReviewState professionalReviewState limitations");
    assert.equal(item.id, `capture-${name}-original-20261009`); assert.equal(item.candidateId, candidateId); assert.equal(item.ingredientId, ingredientId);
    assert.equal(candidate.ingredientId, ingredientId);
    assert.deepEqual([candidate.source.remoteOriginal.bytes, candidate.source.remoteOriginal.width, candidate.source.remoteOriginal.height], [bytes, width, height]);
    keys(item.sourceObservation, "page pageRevision basis photographedAtDeclared uploadedAt licenseNote");
    assert.equal(item.sourceObservation.page, candidate.source.sourcePage); assert.equal(item.sourceObservation.pageRevision, revision);
    assert.equal(item.sourceObservation.basis, index === 0 ? "full_file_page_content_returned_by_search" : "full_file_page_read");
    assert.equal(item.sourceObservation.photographedAtDeclared, photographedAt); assert.equal(item.sourceObservation.uploadedAt, uploadedAt);
    text(item.sourceObservation.licenseNote);
    assert.equal(item.partAlignmentConcern, index === 2 ? "requires_part_recheck" : "unverified");
    validateOriginalAndObservation(item, contract, batch2PhotoPath(name), candidate.source.remoteOriginal.sha1, loadBytes);
  });
  text(record.metadataWarning);
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 3);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); assert.equal(issue.url, FAILED_URLS[index]); text(issue.effect);
    assert.equal(issue.outcome, index < 2 ? "http_429_no_local_file" : "direct_page_fetch_failed_full_content_returned_by_search");
  });
  assert(Array.isArray(record.nextActions) && record.nextActions.length); record.nextActions.forEach(text);
  assert.equal(digest(loadBytes(BATCH2_GALLERY)), "70be56d4431af23eb188dee752d998ae947e2c06dfa94dbb0102e1e1a0514567", "private gallery changed; review its image and network boundaries");
  if (loadBytes === readPrivate) assert.deepEqual(fs.readdirSync(path.join(ROOT, "content-private/research-refresh/photo-originals-batch2")).sort(), BATCH2_CONTRACTS.map(c => `${c[0]}-original.jpg`).sort());
}
function validatePhotoCapturesBatch3(record, loadBytes = readPrivate) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements doesNotCloseGaps baseline photoCaptures metadataWarning retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-captures.3"); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.equal(record.doesNotCloseGaps, true); assert.deepEqual(record.runtimePlacements, []); assert.deepEqual(record.baseline, BATCH3_BASELINE);
  const catalogBytes = loadBytes(BASELINE.catalogPath), previousBytes = loadBytes(PHOTO_CAPTURE_BATCH2_PATH);
  assert.equal(`sha256:${digest(catalogBytes)}`, BASELINE.catalogSha256);
  assert.equal(`sha256:${digest(previousBytes)}`, BATCH3_BASELINE.previousCaptureSha256);
  const catalog = JSON.parse(catalogBytes);
  assert(Array.isArray(record.photoCaptures)); assert.equal(record.photoCaptures.length, 3);
  record.photoCaptures.forEach((item, index) => {
    const contract = BATCH3_CONTRACTS[index];
    const [name, candidateId, ingredientId, bytes, width, height, , , , revision, photographedAt, uploadedAt] = contract;
    const candidate = catalog.records.find(c => c.id === candidateId);
    keys(item, "id candidateId ingredientId sourceObservation capture visualObservation partAlignmentConcern identityReviewState partProcessingReviewState rightsReviewState professionalReviewState limitations");
    assert.equal(item.id, `capture-${name}-original-20261009`); assert.equal(item.candidateId, candidateId); assert.equal(item.ingredientId, ingredientId);
    assert.equal(candidate.ingredientId, ingredientId);
    assert.deepEqual([candidate.source.remoteOriginal.bytes, candidate.source.remoteOriginal.width, candidate.source.remoteOriginal.height], [bytes, width, height]);
    keys(item.sourceObservation, "page pageRevision basis photographedAtDeclared uploadedAt licenseNote");
    assert.equal(item.sourceObservation.page, candidate.source.sourcePage); assert.equal(item.sourceObservation.pageRevision, revision);
    assert.equal(item.sourceObservation.basis, "full_file_page_read");
    assert.equal(item.sourceObservation.photographedAtDeclared, photographedAt); assert.equal(item.sourceObservation.uploadedAt, uploadedAt);
    text(item.sourceObservation.licenseNote);
    assert.equal(item.partAlignmentConcern, index === 2 ? "requires_part_recheck" : "unverified");
    validateOriginalAndObservation(item, contract, batch3PhotoPath(name), candidate.source.remoteOriginal.sha1, loadBytes, {
      app1: index !== 0,
      observationBasis: index === 0 ? "local_original_viewed_at_original_resolution" : "local_original_viewed_at_scaled_resolution"
    });
  });
  text(record.metadataWarning);
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 2);
  const failedDownloads = [
    ["https://upload.wikimedia.org/wikipedia/commons/6/62/Turmeric_rhizomes.jpg", "sandbox_tls_initialization_failed_then_authorized_capture"],
    ["https://upload.wikimedia.org/wikipedia/commons/1/13/Dipli.jpg", "http_429_no_local_file"]
  ];
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); assert.deepEqual([issue.url, issue.outcome], failedDownloads[index]); text(issue.effect);
  });
  assert(Array.isArray(record.nextActions) && record.nextActions.length); record.nextActions.forEach(text);
  assert.equal(digest(loadBytes(BATCH3_GALLERY)), "a6d3e2b77953e6c761e7583ab9c32ae0f5741493bd7b7fb6307f21b23ecbb68c", "private gallery changed; review its image and network boundaries");
  if (loadBytes === readPrivate) assert.deepEqual(fs.readdirSync(path.join(ROOT, "content-private/research-refresh/photo-originals-batch3")).sort(), BATCH3_CONTRACTS.map(c => `${c[0]}-original.jpg`).sort());
}
function validatePhotoCapturesBatch4(record, loadBytes = readPrivate) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements doesNotCloseGaps baseline photoCaptures metadataWarning retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-captures.4"); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.equal(record.doesNotCloseGaps, true); assert.deepEqual(record.runtimePlacements, []); assert.deepEqual(record.baseline, BATCH4_BASELINE);
  const catalogBytes = loadBytes(BASELINE.catalogPath), previousBytes = loadBytes(PHOTO_CAPTURE_BATCH3_PATH);
  assert.equal(`sha256:${digest(catalogBytes)}`, BASELINE.catalogSha256);
  assert.equal(`sha256:${digest(previousBytes)}`, BATCH4_BASELINE.previousCaptureSha256);
  const catalog = JSON.parse(catalogBytes);
  assert(Array.isArray(record.photoCaptures)); assert.equal(record.photoCaptures.length, 3);
  record.photoCaptures.forEach((item, index) => {
    const contract = BATCH4_CONTRACTS[index];
    const [name, candidateId, ingredientId, bytes, width, height, , , , revision, photographedAt, uploadedAt] = contract;
    const candidate = catalog.records.find(c => c.id === candidateId);
    keys(item, "id candidateId ingredientId sourceObservation capture visualObservation partAlignmentConcern sourceCaptionConcern identityReviewState partProcessingReviewState rightsReviewState professionalReviewState limitations");
    assert.equal(item.id, `capture-${name}-original-20261009`); assert.equal(item.candidateId, candidateId); assert.equal(item.ingredientId, ingredientId);
    assert.equal(candidate.ingredientId, ingredientId);
    assert.deepEqual([candidate.source.remoteOriginal.bytes, candidate.source.remoteOriginal.width, candidate.source.remoteOriginal.height], [bytes, width, height]);
    keys(item.sourceObservation, "page pageRevision basis photographedAtDeclared uploadedAt licenseNote");
    assert.equal(item.sourceObservation.page, candidate.source.sourcePage); assert.equal(item.sourceObservation.pageRevision, revision);
    assert.equal(item.sourceObservation.basis, "full_file_page_read");
    assert.equal(item.sourceObservation.photographedAtDeclared, photographedAt); assert.equal(item.sourceObservation.uploadedAt, uploadedAt);
    text(item.sourceObservation.licenseNote);
    assert.equal(item.partAlignmentConcern, index === 0 ? "requires_processing_recheck" : "unverified");
    assert.equal(item.sourceCaptionConcern, index === 2 ? "requires_caption_recheck" : "unverified");
    validateOriginalAndObservation(item, contract, batch4PhotoPath(name), candidate.source.remoteOriginal.sha1, loadBytes);
  });
  text(record.metadataWarning);
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 3);
  const retrievalContracts = [
    ["https://upload.wikimedia.org/wikipedia/commons/e/ec/Dried_Ophiopogon_japonicus_sticks.jpg", "http_429_no_local_original"],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC12059405/figure/f0005/", "tool_fetch_failed"],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC12059405/", "browser_verification_page_no_article_text"]
  ];
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); assert.deepEqual([issue.url, issue.outcome], retrievalContracts[index]); text(issue.effect);
  });
  assert(Array.isArray(record.nextActions) && record.nextActions.length); record.nextActions.forEach(text);
  assert.equal(digest(loadBytes(BATCH4_GALLERY)), "be34ade523dadbff60269b3e34494835a8c19b23ffbcabf6a450bf65ce51658c", "private gallery changed; review its image and network boundaries");
  if (loadBytes === readPrivate) assert.deepEqual(fs.readdirSync(path.join(ROOT, "content-private/research-refresh/photo-originals-batch4")).sort(), BATCH4_CONTRACTS.map(c => `${c[0]}-original.jpg`).sort());
}
function checkPhotoCaptureCopies(root, record) {
  const sizes = new Set(record.photoCaptures.map((c) => c.capture.bytes));
  const hashes = new Set(record.photoCaptures.map((c) => c.capture.sha256));
  const excludes = new Set(["content-private", ".local", "docs", "tools", "node_modules", ".git", "cloud-assets"]);
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (directory === root && excludes.has(entry.name)) continue;
      const target = path.join(directory, entry.name); assert(!fs.lstatSync(target).isSymbolicLink());
      if (entry.isDirectory()) walk(target);
      else if (sizes.has(fs.statSync(target).size)) assert(!hashes.has(`sha256:${digest(fs.readFileSync(target))}`), "private original copied into public runtime");
    }
  }
  walk(root);
}
module.exports = { PHOTO_CAPTURE_RECORD_PATH, PHOTO_CAPTURE_BATCH2_PATH, PHOTO_CAPTURE_BATCH3_PATH, PHOTO_CAPTURE_BATCH4_PATH,
  validatePhotoCaptures, validatePhotoCapturesBatch2, validatePhotoCapturesBatch3, validatePhotoCapturesBatch4, checkPhotoCaptureCopies };
