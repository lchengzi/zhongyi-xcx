"use strict";

// Offline transcription and private-boundary validation, not image or rights approval.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const RECORD_PATH = "content-private/research-refresh/2026-10-10-polyu-photo-leads.json";
const BASELINE = { path: "content-private/media-candidates/food-forms/food-form-catalog.json",
  sha256: "sha256:ccd0f652e2b9f6b3544ac58467b2f0a45d610de428832157de43a14d3580202c" };
const CONTRACTS = [
  ["tiandong", "tian-dong", "herbal/cochinchinese-asparagus-root", "Asparagus cochinchinensis (Lour.) Merr.", "9997", "cochinchinese-asparagus-root", 2],
  ["goji", "gou-qi-zi", "tc/herbal/barbary-wolfberry-fruit", "Lycium barbarum L.", "10001", "barbary-wolfberry-fruit", 1],
  ["dihuang", "di-huang", "tc/herbal/rehmannia-root", "Rehmannia glutinosa Libosch.", "9707", "rehmannia-root", 1]
];
const ORIGIN = "https://herbaltcm.sn.polyu.edu.hk/";
function keys(value, expected) { assert.deepEqual(Object.keys(value).sort(), expected.split(" ").sort()); }
function text(value) { assert(typeof value === "string" && value.trim().length > 0); }
function validate(record, root, loadBytes = file => fs.readFileSync(path.join(root, file))) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord universityPhotoLeads retrievalIssues");
  assert.equal(record.schemaVersion, "polyu-photo-leads.1"); assert.equal(record.checkedAt, "2026-10-10");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []); assert.deepEqual(record.baselineRecord, BASELINE);
  const bytes = loadBytes(BASELINE.path);
  assert.equal(`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, BASELINE.sha256, "historical catalog cannot be rebaselined");
  const catalog = JSON.parse(bytes.toString("utf8"));
  assert.equal(record.universityPhotoLeads.length, CONTRACTS.length);
  const expectedIssues = [];
  record.universityPhotoLeads.forEach((item, index) => {
    keys(item, "id ingredientId gapId source media rights limitations foodIdentityConfirmed foodProcessingApproved professionalReviewState doesNotCloseGap publicationEligible runtimePlacements");
    const [name, ingredient, page, plant, folder, slug, count] = CONTRACTS[index];
    assert.equal(item.id, `refresh-${name}-polyu-20261010`); assert.equal(item.ingredientId, ingredient);
    assert.equal(item.gapId, `food-form-gap-${ingredient}-v01`);
    assert(catalog.gaps.some(gap => gap.id === item.gapId && gap.ingredientId === ingredient));
    assert.deepEqual([item.foodIdentityConfirmed, item.foodProcessingApproved, item.professionalReviewState,
      item.doesNotCloseGap, item.publicationEligible, item.runtimePlacements], [false, false, "pending", true, false, []]);
    keys(item.source, "publisher title url access publishedAt copyrightYear contentSha256 plantLabel partAndFormStatement");
    assert.equal(item.source.url, ORIGIN + page); assert.equal(item.source.plantLabel, plant);
    assert.equal(item.source.publisher, "香港理工大学中药资料库"); text(item.source.title); text(item.source.partAndFormStatement);
    assert.deepEqual([item.source.access, item.source.publishedAt, item.source.copyrightYear, item.source.contentSha256],
      ["relevant_page_text_read", null, "2015", null]);
    keys(item.media, "locator links photographer createdAt localAssetAvailable bytes sha256 visualReviewState pixelObservations");
    text(item.media.locator);
    const links = Array.from({ length: count }, (_, number) => `${ORIGIN}f/herbal/${folder}/2000p0/img_${slug}_${number + 1}.jpg`);
    assert.deepEqual(item.media.links, links);
    assert.deepEqual([item.media.photographer, item.media.createdAt, item.media.localAssetAvailable, item.media.bytes,
      item.media.sha256, item.media.visualReviewState, item.media.pixelObservations], [null, null, false, null, null, "not_performed", null]);
    keys(item.rights, "statementUrl access footerClaim licenseName licenseUrl reviewState projectPermissionObtained");
    assert.equal(item.rights.statementUrl, ORIGIN + (index ? "tc/copyright" : "copyright"));
    text(item.rights.footerClaim);
    assert.deepEqual([item.rights.access, item.rights.licenseName, item.rights.licenseUrl, item.rights.reviewState,
      item.rights.projectPermissionObtained], ["timeout_not_read", null, null, "pending", false]);
    assert(Array.isArray(item.limitations) && item.limitations.length >= 3); item.limitations.forEach(text);
    links.forEach(url => expectedIssues.push(url));
  });
  expectedIssues.push(ORIGIN + "copyright", ORIGIN + "tc/copyright");
  const outcomes = ["image_timeout", "image_cache_miss", "reference_without_reviewable_pixels", "image_timeout", "page_timeout", "page_timeout"];
  assert.deepEqual(record.retrievalIssues, expectedIssues.map((url, index) => ({ url, outcome: outcomes[index], automaticRetry: false })));
  return { checkedAt: record.checkedAt, universityPhotoLeads: 3, visualReviewsPerformed: 0,
    photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" };
}
function tokens(record) {
  return record.universityPhotoLeads.flatMap(item => [item.id, item.source.url, ...item.media.links, item.rights.statementUrl]);
}
module.exports = { RECORD_PATH, validate, tokens };
