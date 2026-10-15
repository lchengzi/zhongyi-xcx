"use strict";

// Offline boundary checks only. This does not verify websites, licenses or medical facts.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ARTIFACT_PATHS } = require("./version-core");
const sourceScreening = require("./source-screening-core");
const universityLeads = require("./university-photo-leads-core");
const officialNine = require("./official-nine-review-core");
const { PHOTO_CAPTURE_RECORD_PATH, PHOTO_CAPTURE_BATCH2_PATH, PHOTO_CAPTURE_BATCH3_PATH, PHOTO_CAPTURE_BATCH4_PATH,
  validatePhotoCaptures, validatePhotoCapturesBatch2, validatePhotoCapturesBatch3, validatePhotoCapturesBatch4, checkPhotoCaptureCopies } = require("./photo-capture-core");

const ROOT = path.resolve(__dirname, "..");
const RECORD_PATH = "content-private/research-refresh/2026-10-08.json";
const PHOTO_RECORD_PATH = "content-private/research-refresh/2026-10-09.json";
const ACCESS_RECORD_PATH = "content-private/research-refresh/2026-10-09-food-form-access.json";
const DIRECTORY_RECORD_PATH = "content-private/research-refresh/2026-10-09-directory-scope.json";
const INTEGRITY_RECORD_PATH = "content-private/research-refresh/2026-10-09-goji-integrity.json";
const SPECIMEN_LINKS_RECORD_PATH = "content-private/research-refresh/2026-10-09-specimen-photo-links.json";
const EXISTING_PHOTO_RECORD_PATH = "content-private/research-refresh/2026-10-09-existing-photo-metadata.json";
const PROCESSING_PAIR_RECORD_PATH = "content-private/research-refresh/2026-10-09-rehmannia-processing-pair.json";
const LITERATURE_TRIAGE_RECORD_PATH = "content-private/research-refresh/2026-10-09-literature-photo-triage.json";
const TIANDONG_SCREENING_RECORD_PATH = "content-private/research-refresh/2026-10-09-tiandong-photo-screening.json";
const OFFICIAL_CAPTURE_RECORD_PATH = "content-private/research-refresh/2026-10-09-official-document-captures.json";
const FOOD_FORM_CATALOG_SHA256 = "sha256:ccd0f652e2b9f6b3544ac58467b2f0a45d610de428832157de43a14d3580202c";
const HISTORICAL_COUNT_URL = "https://www.nhc.gov.cn/wjw/jiany/202508/6141c788fa794723afb4e71af48b3d93.shtml";
// Integrity of the manually transcribed ordered names, NOT a webpage digest or factual approval.
const DIRECTORY_NAMES_SHA256 = "dea718eb8468f573ac7aa699054bec629f1b3e89f5fbca9be825303d6f267a71";
const PHOTO_RECORD_SHA256 = "sha256:09fcc63a946cbe8a29a8a6f28ec965ce1a4f761f87a88e9e7cb23060e239535e";
const PREVIOUS_RECORD_SHA256 = "sha256:b641b57793cab0a3d8d4d9c51009282a69e7b28f3f112f05388c11a39a04e32e";
const BASELINE_PATHS = [
  "data/ingredients.js",
  "content-private/media-candidates/food-forms/food-form-catalog.json",
  "content-private/media-candidates/food-form-gap-upgrades/research-catalog.json"
];
// Root diagnostics are already excluded from upload by project.config.json and
// check-project; nested folders with the same name remain part of the scan.
const EXCLUDES = new Set(["content-private", ".local", "docs", "tools", "node_modules", ".git", "cloud-assets"]);
const OFFICIAL_CONTRACTS = [
  ["refresh-shanxi-call-2026", "wjw.shanxi.gov.cn", "application_call_not_approval"],
  ["refresh-shaanxi-count-2026", "snamr.shaanxi.gov.cn", "dated_count_statement_not_complete_audit"],
  ["refresh-samr-sanghuang-2026", "www.samr.gov.cn", "dated_non_listing_statement"]
];
const PHOTO_CONTRACTS = [
  ["refresh-dihuang-commons-phoenixshi-2026", "di-huang", "commons.wikimedia.org", "metadata_lead_visual_pending"],
  ["refresh-tiandong-frontiers-genome-2026", "tian-dong", "www.frontiersin.org", "not_a_food_form_photo_candidate"]
];
// These are dated research contracts, not a mechanism for approving media.
const NEW_PHOTO_CONTRACTS = [
  ["refresh-dihuang-steam-fig2-2023", "di-huang", "link.springer.com", "processing_comparison_lead_visual_pending", "CC BY 4.0", "by/4.0", "2023-03-01", null, "media.springernature.com"],
  ["refresh-goji-myrabella-dried-2013", "gou-qi-zi", "commons.wikimedia.org", "retail_dried_fruit_lead_identity_pending", "CC BY-SA 3.0 Unported", "by-sa/3.0", "2013-05-26", "2013-05-26", "upload.wikimedia.org"],
  ["refresh-goji-vmenkov-linxia-2009", "gou-qi-zi", "commons.wikimedia.org", "retail_dried_fruit_lead_identity_pending", "CC BY-SA 3.0 Unported (one listed option)", "by-sa/3.0", "2009-09-24", "2009-07-25", "upload.wikimedia.org"],
  ["refresh-dihuang-genome-ncnd-2021", "di-huang", "pmc.ncbi.nlm.nih.gov", "not_eligible_for_commercial_adapted_media_without_permission", "CC BY-NC-ND 4.0", "by-nc-nd/4.0", "2021-07-08", null, null]
];

function read(relative) { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8")); }
function text(value) { assert(typeof value === "string" && value.trim().length > 0, "nonempty text required"); }
function keys(value, expected) {
  assert(value && typeof value === "object" && !Array.isArray(value), "object required");
  assert.deepEqual(Object.keys(value).sort(), expected.split(" ").sort(), "unsupported or missing fields");
}
function date(value) {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), "date required");
  assert.equal(new Date(value).toISOString().slice(0, 10), value, "invalid calendar date");
}
function url(value, host) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.username + parsed.password + parsed.port + parsed.hash, "", "unsafe URL");
  if (host) assert.equal(parsed.hostname, host, "source host drift");
}
function strings(value) {
  assert(Array.isArray(value) && value.length > 0, "nonempty text list required");
  value.forEach(text);
}
function source(value, checkedAt, host, official) {
  keys(value, official
    ? "publisher title url publishedAt signedAt metadataDocumentDate dateConflict access contentSha256"
    : "publisher title url publishedAt access contentSha256");
  text(value.publisher); text(value.title); url(value.url, host); date(value.publishedAt);
  assert(value.publishedAt <= checkedAt, "future publication date");
  assert.equal(value.contentSha256, null, "no source binary was captured");
  if (official) {
    date(value.signedAt); date(value.metadataDocumentDate);
    assert(value.signedAt <= checkedAt && value.metadataDocumentDate <= checkedAt);
    assert.equal(value.access, "full_text_read");
  } else assert(["full_text_read", "file_page_read"].includes(value.access));
}
function validateRecord(record) {
  keys(record, "schemaVersion checkedAt scope publicationEligible directoryAuditComplete runtimePlacements baseline officialObservations photoFollowups retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "1.0.0"); date(record.checkedAt);
  assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false);
  assert.equal(record.directoryAuditComplete, false, "limited retrieval cannot prove directory completeness");
  assert.deepEqual(record.runtimePlacements, []);
  keys(record.baseline, "releaseId catalogSourceAsOf files photoCandidateCount unresolvedGapIds");
  date(record.baseline.catalogSourceAsOf); text(record.baseline.releaseId);
  assert.deepEqual(record.baseline.files.map((file) => file.path), BASELINE_PATHS);
  for (const file of record.baseline.files) {
    keys(file, "path sha256");
    assert(/^sha256:[a-f0-9]{64}$/.test(file.sha256), "baseline digest required");
  }
  assert.equal(record.baseline.photoCandidateCount, 19);
  assert.deepEqual(record.baseline.unresolvedGapIds,
    ["food-form-gap-gou-qi-zi-v01", "food-form-gap-di-huang-v01", "food-form-gap-tian-dong-v01"]);
  assert.equal(record.officialObservations.length, OFFICIAL_CONTRACTS.length);
  record.officialObservations.forEach((item, index) => {
    keys(item, "id classification source applicationDeadline summary limitations provesNationalDirectoryApproval professionalReviewState");
    const [id, host, classification] = OFFICIAL_CONTRACTS[index];
    assert.equal(item.id, id); assert.equal(item.classification, classification);
    source(item.source, record.checkedAt, host, true);
    text(item.summary); strings(item.limitations);
    if (item.applicationDeadline !== null) date(item.applicationDeadline);
    assert.equal(item.provesNationalDirectoryApproval, false);
    assert.equal(item.professionalReviewState, "pending");
  });
  const [call, count, nonListing] = record.officialObservations;
  assert.equal(call.applicationDeadline, "2026-09-30");
  assert.equal(call.source.dateConflict, false);
  assert.deepEqual([count.source.publishedAt, count.source.signedAt, count.source.metadataDocumentDate, count.source.dateConflict],
    ["2026-07-01", "2026-06-29", "2026-07-29", true], "preserve conflicting source date fields");
  assert.deepEqual([nonListing.source.publishedAt, nonListing.source.signedAt, nonListing.source.metadataDocumentDate, nonListing.source.dateConflict],
    ["2026-08-17", "2026-08-06", "2026-08-06", false]);
  assert.equal(record.photoFollowups.length, PHOTO_CONTRACTS.length);
  record.photoFollowups.forEach((item, index) => {
    keys(item, "id ingredientId existingGapId disposition source media summary limitations aiAltTextUsedAsVisualEvidence doesNotCloseGap publicationEligible runtimePlacements rightsReviewState professionalReviewState");
    const [id, ingredientId, host, disposition] = PHOTO_CONTRACTS[index];
    assert.equal(item.id, id); assert.equal(item.ingredientId, ingredientId);
    assert.equal(item.existingGapId, `food-form-gap-${ingredientId}-v01`);
    assert.equal(item.disposition, disposition);
    source(item.source, record.checkedAt, host, false);
    keys(item.media, "creator createdAt licenseName licenseUrl imageUrl width height bytes sha256 localAssetAvailable visualReviewState");
    const media = item.media;
    text(media.creator); text(media.licenseName); url(media.licenseUrl, "creativecommons.org");
    url(media.imageUrl, index === 0 ? "upload.wikimedia.org" : "www.frontiersin.org");
    if (media.createdAt !== null) date(media.createdAt);
    for (const field of ["width", "height"]) assert(media[field] === null || (Number.isSafeInteger(media[field]) && media[field] > 0));
    assert.equal(media.bytes, null); assert.equal(media.sha256, null);
    assert.equal(media.localAssetAvailable, false);
    assert.equal(media.visualReviewState, "not_performed", "URL/alt text is not pixel review");
    text(item.summary); strings(item.limitations);
    assert.equal(item.aiAltTextUsedAsVisualEvidence, false);
    assert.equal(item.doesNotCloseGap, true); assert.equal(item.publicationEligible, false);
    assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
  });
  assert(Array.isArray(record.retrievalIssues) && record.retrievalIssues.length === 2);
  record.retrievalIssues.forEach((item) => {
    keys(item, "url outcome effect"); url(item.url, "www.nhc.gov.cn");
    assert.equal(item.outcome, "http_412"); text(item.effect);
  });
  strings(record.nextActions);
}
function validatePhotoRefresh(record) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord photoFollowups retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-followup.1");
  assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []);
  assert.deepEqual(record.baselineRecord, { path: RECORD_PATH, sha256: PREVIOUS_RECORD_SHA256 },
    "dated baseline cannot be rebound or replaced");
  assert.equal(record.photoFollowups.length, NEW_PHOTO_CONTRACTS.length);
  record.photoFollowups.forEach((item, index) => {
    keys(item, "id ingredientId existingGapId disposition source media evidence summary limitations aiAltTextUsedAsVisualEvidence doesNotCloseGap publicationEligible runtimePlacements rightsReviewState professionalReviewState");
    const [id, ingredientId, host, disposition, licenseName, licensePath, publishedAt, createdAt, imageHost] = NEW_PHOTO_CONTRACTS[index];
    assert.equal(item.id, id); assert.equal(item.ingredientId, ingredientId);
    assert.equal(item.existingGapId, `food-form-gap-${ingredientId}-v01`);
    assert.equal(item.disposition, disposition);
    source(item.source, record.checkedAt, host, false);
    assert.equal(item.source.publishedAt, publishedAt, "publication/upload date drift");
    assert.equal(item.source.access, host === "commons.wikimedia.org" ? "file_page_read" : "full_text_read");
    keys(item.media, "creator createdAt licenseName licenseUrl imageUrl width height bytes sha256 localAssetAvailable visualReviewState");
    const media = item.media;
    text(media.creator);
    assert.equal(media.createdAt, createdAt, "capture date is not upload date");
    assert.equal(media.licenseName, licenseName);
    assert.equal(media.licenseUrl, `https://creativecommons.org/licenses/${licensePath}/`);
    if (imageHost) url(media.imageUrl, imageHost);
    else assert.equal(media.imageUrl, null, "no unverified direct image URL");
    assert.deepEqual([media.width, media.height], [[null, null], [2003, 1216], [2048, 1536], [null, null]][index]);
    assert.equal(media.bytes, null); assert.equal(media.sha256, null);
    assert.equal(media.localAssetAvailable, false);
    assert.equal(media.visualReviewState, "not_performed", "labels are not pixel review");
    keys(item.evidence, "locator sourceLabels sampleProvenance rightsConditions licenseAlternatives foodIdentityConfirmed foodProcessingApproved");
    text(item.evidence.locator); strings(item.evidence.sourceLabels); text(item.evidence.sampleProvenance);
    strings(item.evidence.rightsConditions);
    assert.deepEqual(item.evidence.licenseAlternatives, index === 2
      ? ["GFDL 1.2 or later", "CC BY-SA 3.0", "CC BY-SA 2.5", "CC BY-SA 2.0", "CC BY-SA 1.0"] : []);
    assert.equal(item.evidence.foodIdentityConfirmed, false);
    assert.equal(item.evidence.foodProcessingApproved, false);
    text(item.summary); strings(item.limitations);
    assert.equal(item.aiAltTextUsedAsVisualEvidence, false);
    assert.equal(item.doesNotCloseGap, true); assert.equal(item.publicationEligible, false);
    assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
  });
  assert.deepEqual(record.photoFollowups[0].evidence.sourceLabels, ["fresh UPR", "dried UPR", "PRR"]);
  assert.equal(record.retrievalIssues.length, 4);
  const issueContracts = [
    ["https://link.springer.com/content/pdf/10.1186/s13765-023-00773-7.pdf", "text_available_page_screenshot_cache_miss"],
    [record.photoFollowups[0].media.imageUrl, "cache_miss"],
    [record.photoFollowups[1].media.imageUrl, "no_reviewable_image_returned"],
    [record.photoFollowups[2].media.imageUrl, "no_reviewable_image_returned"]
  ];
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect");
    url(issue.url); text(issue.effect);
    assert.deepEqual([issue.url, issue.outcome], issueContracts[index], "retrieval failure is not visual evidence");
  });
  strings(record.nextActions);
}
function validatePhotoAccess(record) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord photoFollowups retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-access.1");
  assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []);
  assert.deepEqual(record.baselineRecord, { path: PHOTO_RECORD_PATH, sha256: PHOTO_RECORD_SHA256 });
  assert.equal(record.photoFollowups.length, 2);
  const contracts = [
    ["refresh-dihuang-tari-technical-2013", "di-huang", "source_text_lead_image_binding_and_rights_pending",
      "https://www.tari.gov.tw/form/index-1.asp?Parser=2,6,1106,,,,3764", null, "2013-11-26", null, "technical_web_page",
      "https://www.tari.gov.tw/df_ufiles/d/technical_2013_013.jpg", "search_result_only", "unknown"],
    ["refresh-tiandong-hkbu-accepted-2016", "tian-dong", "not_eligible_for_distributed_commercial_media_without_permission",
      "https://scholars.hkbu.edu.hk/ws/portalfiles/portal/55625207/RO_scmd_ja-65_JA028862.pdf", "2016-12-01", null, "2026-09-08",
      "authors_accepted_manuscript_peer_reviewed_version", null, "caption_text_only", "repository_distribution_and_commercial_use_restricted"]
  ];
  record.photoFollowups.forEach((item, index) => {
    keys(item, "id ingredientId existingGapId disposition source media evidence summary limitations aiAltTextUsedAsVisualEvidence doesNotCloseGap publicationEligible runtimePlacements rightsReviewState professionalReviewState");
    const [id, ingredient, disposition, sourceUrl, publishedAt, modifiedAt, stamp, version, imageUrl, association, rights] = contracts[index];
    assert.deepEqual([item.id, item.ingredientId, item.existingGapId, item.disposition],
      [id, ingredient, `food-form-gap-${ingredient}-v01`, disposition]);
    keys(item.source, "publisher title url publishedAt modifiedAt repositoryDownloadStamp documentVersion access contentSha256");
    text(item.source.publisher); text(item.source.title); url(item.source.url);
    assert.deepEqual([item.source.url, item.source.publishedAt, item.source.modifiedAt,
      item.source.repositoryDownloadStamp, item.source.documentVersion], [sourceUrl, publishedAt, modifiedAt, stamp, version],
    "publication, modification and repository download dates are distinct");
    assert.equal(item.source.access, "full_text_read"); assert.equal(item.source.contentSha256, null);
    keys(item.media, "imageUrl associationState creator createdAt licenseName licenseUrl width height bytes sha256 localAssetAvailable visualReviewState");
    assert.deepEqual([item.media.imageUrl, item.media.associationState], [imageUrl, association]);
    if (imageUrl) url(imageUrl);
    for (const field of ["creator", "createdAt", "licenseName", "licenseUrl", "width", "height", "bytes", "sha256"])
      assert.equal(item.media[field], null, "unverified image metadata cannot be inferred");
    assert.equal(item.media.localAssetAvailable, false); assert.equal(item.media.visualReviewState, "not_performed");
    keys(item.evidence, "locator captionPanelLabels bodyPanelReferences panelReferenceConflict rightsState rightsConditions foodIdentityConfirmed foodProcessingApproved");
    text(item.evidence.locator); strings(item.evidence.rightsConditions);
    assert.equal(item.evidence.rightsState, rights);
    assert.deepEqual(item.evidence.captionPanelLabels, index === 0 ? []
      : ["H: Asparagus racemosus root tubers", "I: Asparagus cochinchinensis"]);
    assert.deepEqual(item.evidence.bodyPanelReferences, index === 0 ? [] : ["Fig. 1H and 1E"]);
    assert.equal(item.evidence.panelReferenceConflict, index === 1, "do not silently correct source panel conflicts");
    assert.equal(item.evidence.foodIdentityConfirmed, false); assert.equal(item.evidence.foodProcessingApproved, false);
    text(item.summary); strings(item.limitations);
    assert.equal(item.aiAltTextUsedAsVisualEvidence, false); assert.equal(item.doesNotCloseGap, true);
    assert.equal(item.publicationEligible, false); assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
  });
  assert.equal(record.retrievalIssues.length, 2);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); text(issue.effect);
    assert.deepEqual([issue.url, issue.outcome], index === 0
      ? [contracts[0][8], "cache_miss"] : [contracts[1][3], "text_available_page_screenshot_cache_miss"]);
  });
  strings(record.nextActions);
}
function validatePhotoBaseline(record, previousBytes) {
  const digest = `sha256:${crypto.createHash("sha256").update(previousBytes).digest("hex")}`;
  assert.equal(digest, record.baselineRecord.sha256, "prior dated record changed; do not rebind it");
}
function compareReferenceNames(observed, catalog) {
  for (const values of [observed, catalog]) {
    strings(values);
    assert.equal(new Set(values).size, values.length, "duplicate names cannot be hidden by set comparison");
  }
  const observedSet = new Set(observed); const catalogSet = new Set(catalog);
  const observedOnly = observed.filter((name) => !catalogSet.has(name)).sort();
  const catalogOnly = catalog.filter((name) => !observedSet.has(name)).sort();
  return { observedCount: observed.length, catalogCount: catalog.length,
    matchedCount: observed.length - observedOnly.length, observedOnly, catalogOnly };
}
function validateDirectoryScope(record) {
  keys(record, "schemaVersion checkedAt scope publicationEligible directoryAuditComplete runtimePlacements baselineRecord baseline officialObservations nameCrossCheck retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "directory-scope.1");
  assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false); assert.equal(record.directoryAuditComplete, false);
  assert.deepEqual(record.runtimePlacements, []);
  assert.deepEqual(record.baselineRecord, { path: RECORD_PATH, sha256: PREVIOUS_RECORD_SHA256 });
  assert.deepEqual(record.baseline, { releaseId: "release-2026.08.13-complete-public-projection.10", catalogSourceAsOf: "2026-08-10",
    catalogSha256: "sha256:5b21a1e30d592cfa00017ad9021d591219cb0d74fb86c1f3ab5fad6c7115c092" });
  const contracts = [
    ["directory-heshan-reference-2026", "local_licensing_reference_not_national_revision", "https://www.heshan.gov.cn/zwgk/zfgb/2026/01/content/post_3542338.html", "local_issuer", "2026-01-07", "2026-01-07", "2026-02-01", "2029-01-31", 106, null],
    ["directory-jilin-wuweizi-reply-2026", "dated_application_progress_not_approval", "https://xxgk.jl.gov.cn/zcbm/fgw_98077/xxgkmlqy/202605/t20260506_9580076.html", "local_issuer", "2026-05-06", "2026-04-29", null, null, 106, null],
    ["directory-ezhou-report-2026", "local_report_not_original_national_notice", "https://www.ezhou.gov.cn/gk/xxgkzt/yshj/ysdt/202608/t20260814_778130.html", "government_news_not_original_notice", "2026-08-14", null, null, null, 106, "2026-08-07"],
    ["directory-import-pilot-237-2025", "import_classification_not_directory_addition", "https://www.hunan.gov.cn/zqt/zcsd/202512/t20251205_33863202.html", "government_republication", "2025-12-05", "2025-12-03", null, null, null, null]
  ];
  assert.equal(record.officialObservations.length, contracts.length);
  record.officialObservations.forEach((item, index) => {
    keys(item, "id classification source evidence provesNationalDirectoryApproval professionalReviewState");
    const [id, classification, sourceUrl, role, published, signed, effectiveFrom, effectiveUntil, count, reportedDate] = contracts[index];
    assert.equal(item.id, id); assert.equal(item.classification, classification);
    keys(item.source, "publisher title url documentNumber publishedAt signedAt effectiveFrom effectiveUntil sourceRole access contentSha256");
    const s = item.source;
    text(s.publisher); text(s.title); url(s.url); assert.equal(s.url, sourceUrl);
    if (s.documentNumber !== null) text(s.documentNumber);
    assert.equal(s.sourceRole, role); assert.equal(s.access, "full_text_read"); assert.equal(s.contentSha256, null);
    assert.deepEqual([s.publishedAt, s.signedAt, s.effectiveFrom, s.effectiveUntil], [published, signed, effectiveFrom, effectiveUntil],
      "signature, republication, reported date and validity must not be conflated");
    [s.publishedAt, s.signedAt, s.effectiveFrom, s.effectiveUntil].filter((value) => value !== null).forEach(date);
    assert(s.publishedAt <= record.checkedAt);
    keys(item.evidence, "locators reportedCount reportedDocumentDate jurisdiction summary limitations");
    strings(item.evidence.locators); text(item.evidence.jurisdiction); text(item.evidence.summary); strings(item.evidence.limitations);
    assert.equal(item.evidence.reportedCount, count); assert.equal(item.evidence.reportedDocumentDate, reportedDate);
    assert.equal(item.provesNationalDirectoryApproval, false); assert.equal(item.professionalReviewState, "pending");
  });
  const crossCheck = record.nameCrossCheck;
  keys(crossCheck, "sourceObservationId locator transcription comparison observedNames");
  assert.equal(crossCheck.sourceObservationId, contracts[0][0]); assert.equal(crossCheck.locator, "附件1第1至106行");
  assert.equal(crossCheck.transcription, "manual_from_retrieved_html_table");
  assert.equal(crossCheck.comparison, "exact_name_set_no_alias_or_punctuation_normalization");
  strings(crossCheck.observedNames); assert.equal(crossCheck.observedNames.length, 106);
  assert.equal(new Set(crossCheck.observedNames).size, 106);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(crossCheck.observedNames)).digest("hex"), DIRECTORY_NAMES_SHA256,
    "dated manual transcription changed; review the source rather than normalizing away a difference");
  assert.equal(record.retrievalIssues.length, 3);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); text(issue.effect); url(issue.url);
    assert.deepEqual([issue.url, issue.outcome], [
      ["https://www.nhc.gov.cn/sps/c100088/new_list.shtml", "http_412"],
      [HISTORICAL_COUNT_URL, "http_412"],
      [contracts[3][2], "attachment_fetch_failed"]
    ][index]);
  });
  strings(record.nextActions);
}
function validatePhotoIntegrity(record, previous) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord photoIntegrityObservations retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-integrity.1"); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []);
  keys(record.baselineRecord, "path sha256");
  assert.equal(record.baselineRecord.path, PHOTO_RECORD_PATH); assert.equal(record.baselineRecord.sha256, PHOTO_RECORD_SHA256);
  validatePhotoRefresh(previous);
  const contracts = [
    ["integrity-goji-myrabella-20261009", "refresh-goji-myrabella-dried-2013", "1275056781", "2026-09-11", 2387990,
      "2ea23db37a10e9c39360e97212ee99fbc257932f", "Photo: Myrabella / Wikimedia Commons /", "single_listed_license"],
    ["integrity-goji-vmenkov-20261009", "refresh-goji-vmenkov-linxia-2009", "1255902058", "2026-08-03", 1647066,
      "827f18a6419b69d44d5519ef99ae1f3f098f20a8", "Vmenkov / Wikimedia Commons / CC BY-SA 3.0", "one_of_several_alternatives_not_cumulative"]
  ];
  assert(Array.isArray(record.photoIntegrityObservations)); assert.equal(record.photoIntegrityObservations.length, 2);
  record.photoIntegrityObservations.forEach((item, index) => {
    keys(item, "id previousPhotoId ingredientId sourceUrl permanentUrl sourceAccess permanentLinkAccess pageModifiedAt capturedAt uploadedAt original rights localAssetAvailable localBytes localSha256 visualReviewState foodIdentityConfirmed foodProcessingApproved professionalReviewState doesNotCloseGap publicationEligible runtimePlacements limitations");
    const [id, previousId, revision, modifiedAt, bytes, checksum, attribution, selection] = contracts[index];
    const prior = previous.photoFollowups.find((candidate) => candidate.id === previousId); assert(prior);
    assert.equal(item.id, id); assert.equal(item.previousPhotoId, previousId); assert.equal(item.ingredientId, prior.ingredientId);
    url(item.sourceUrl, "commons.wikimedia.org"); assert.equal(item.sourceUrl, prior.source.url);
    const fileTitle = new URL(item.sourceUrl).pathname.slice("/wiki/".length);
    url(item.permanentUrl, "commons.wikimedia.org");
    assert.equal(item.permanentUrl, `https://commons.wikimedia.org/w/index.php?title=${fileTitle}&oldid=${revision}`);
    assert.equal(item.sourceAccess, "file_page_read");
    assert.equal(item.permanentLinkAccess, "observed_on_file_page_not_separately_retrieved");
    assert.equal(item.pageModifiedAt, modifiedAt); assert.equal(item.capturedAt, prior.media.createdAt);
    assert.equal(item.uploadedAt, prior.source.publishedAt);
    for (const value of [item.pageModifiedAt, item.capturedAt, item.uploadedAt]) { date(value); assert(value <= record.checkedAt); }
    keys(item.original, "url mimeType width height bytes checksumAlgorithm checksum evidenceBasis");
    url(item.original.url, "upload.wikimedia.org"); assert.equal(item.original.url, prior.media.imageUrl);
    assert.equal(item.original.mimeType, "image/jpeg");
    assert.deepEqual([item.original.width, item.original.height], [prior.media.width, prior.media.height]);
    assert.equal(item.original.bytes, bytes); assert.equal(item.original.checksumAlgorithm, "sha1");
    assert(/^[a-f0-9]{40}$/.test(item.original.checksum)); assert.equal(item.original.checksum, checksum);
    assert.equal(item.original.evidenceBasis, "remote_file_page_metadata_not_local_measurement");
    keys(item.rights, "creator trackedLicense licenseUrl attribution selectionBasis reviewState");
    assert.equal(item.rights.creator, prior.media.creator); assert.equal(item.rights.trackedLicense, "CC BY-SA 3.0 Unported");
    assert.equal(item.rights.licenseUrl, prior.media.licenseUrl); assert.equal(item.rights.attribution, attribution);
    assert.equal(item.rights.selectionBasis, selection); assert.equal(item.rights.reviewState, "pending");
    assert.equal(item.localAssetAvailable, false); assert.equal(item.localBytes, null); assert.equal(item.localSha256, null);
    assert.equal(item.visualReviewState, "not_performed");
    assert.equal(item.foodIdentityConfirmed, false); assert.equal(item.foodProcessingApproved, false);
    assert.equal(item.professionalReviewState, "pending"); assert.equal(item.doesNotCloseGap, true);
    assert.equal(item.publicationEligible, false); assert.deepEqual(item.runtimePlacements, []); strings(item.limitations);
  });
  const issues = [
    ["https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/Goji_dried_berries.jpg/960px-Goji_dried_berries.jpg?utm_campaign=index&utm_content=thumbnail&utm_source=commons.wikimedia.org", "cache_miss"],
    ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/5656-Linxia-City-dried-Ningxia-gouji-berries.jpg/960px-5656-Linxia-City-dried-Ningxia-gouji-berries.jpg?utm_campaign=index&utm_content=thumbnail&utm_source=commons.wikimedia.org", "cache_miss"],
    [record.photoIntegrityObservations[1].original.url, "not_accessible_via_tool"],
    ["https://img.visiontimes.com/2025/02/1024px-5656-Linxia-City-dried-Ningxia-gouji-berries.jpg", "text_marker_without_image_content"]
  ];
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, issues.length);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); url(issue.url); text(issue.effect);
    assert.deepEqual([issue.url, issue.outcome], issues[index], "an image marker is not a pixel review");
  });
  strings(record.nextActions);
}
// Dated source labels only: a specimen number, page link or rights statement
// never establishes edible identity, actual image contents or publication.
function validateSpecimenPhotoLinks(record) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord specimenPhotoObservations retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "photo-specimen-links.1");
  assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false); assert.deepEqual(record.runtimePlacements, []);
  keys(record.baselineRecord, "path sha256");
  assert.equal(record.baselineRecord.path, PHOTO_RECORD_PATH);
  assert.equal(record.baselineRecord.sha256, PHOTO_RECORD_SHA256);
  const contracts = [
    ["refresh-dihuang-cmro-specimen-links", "di-huang", "www.cmro.gov.hk", null, "exhibition_page_labels", "page_link_labels", "unknown", 3],
    ["refresh-dihuang-toyama-tmpw4347", "di-huang", "ethmed.toyama-wakan.net", "TMPW No.4347", "sample_record", "sample_record_image_link", "all_rights_reserved_no_reuse_permission_observed", 1],
    ["refresh-tiandong-toyama-tmpw8658", "tian-dong", "ethmed.toyama-wakan.net", "TMPW No.8658", "sample_record", "sample_record_image_link", "all_rights_reserved_no_reuse_permission_observed", 1],
    ["refresh-goji-wstefano-pd-closeup", "gou-qi-zi", "commons.wikimedia.org", null, "filename_only", "file_page_original_link", "public_domain_statement_observed_not_review_approval", 1]
  ];
  assert(Array.isArray(record.specimenPhotoObservations));
  assert.equal(record.specimenPhotoObservations.length, contracts.length);
  record.specimenPhotoObservations.forEach((item, index) => {
    keys(item, "id ingredientId existingGapId source specimen media limitations publicationEligible runtimePlacements doesNotCloseGap foodIdentityConfirmed foodProcessingApproved rightsReviewState professionalReviewState aiAltTextUsedAsVisualEvidence");
    const [id, ingredient, host, accession, scope, association, rights, linkCount] = contracts[index];
    assert.equal(item.id, id); assert.equal(item.ingredientId, ingredient);
    assert.equal(item.existingGapId, `food-form-gap-${ingredient}-v01`);
    keys(item.source, "publisher title url access scientificInformationRenewedAt contentSha256");
    text(item.source.publisher); text(item.source.title); url(item.source.url, host);
    if (index === 1 || index === 2) assert.equal(new URL(item.source.url).pathname, `/SearchEn/View/${index === 1 ? 4347 : 8658}`);
    assert.equal(item.source.access, index === 3 ? "file_page_read" : "full_text_read");
    assert.equal(item.source.scientificInformationRenewedAt, [null, "2022-10-12", "2026-05-21", null][index]);
    assert.equal(item.source.contentSha256, null);
    keys(item.specimen, "accession taxonLabel partLabel collectionDateLiteral collectionDatePrecision scope notes");
    assert.equal(item.specimen.accession, accession); assert.equal(item.specimen.scope, scope); text(item.specimen.notes);
    assert.equal(item.specimen.taxonLabel, ["Rehmannia glutinosa Libosch.", "Rehmannia glutinosa Libosch.", "Asparagus cochinchinensis (Lour.) Merr.", null][index]);
    assert.equal(item.specimen.partLabel, ["fresh or dried root tuber", "tuberous root", "tuberous root", null][index]);
    assert.equal(item.specimen.collectionDateLiteral, [null, "1986/02/07", "1979/01/00", null][index]);
    assert.equal(item.specimen.collectionDatePrecision, [null, "day", "month_day_unknown", null][index]);
    keys(item.media, "localAssetAvailable localBytes localSha256 visualReviewState creator licenseName rightsState rightsEvidenceUrl association links");
    assert.equal(item.media.localAssetAvailable, false); assert.equal(item.media.localBytes, null); assert.equal(item.media.localSha256, null);
    assert.equal(item.media.visualReviewState, "not_performed");
    assert.equal(item.media.creator, index === 3 ? "Wstefano" : null);
    assert.equal(item.media.licenseName, index === 3 ? "PD-user public-domain dedication with fallback grant" : null);
    assert.equal(item.media.rightsState, rights); assert.equal(item.media.association, association);
    assert.equal(item.media.rightsEvidenceUrl, index === 0 ? null : item.source.url);
    assert(Array.isArray(item.media.links)); assert.equal(item.media.links.length, linkCount);
    item.media.links.forEach((link, n) => {
      keys(link, "label url retrievalOutcome"); text(link.label);
      url(link.url, ["www.cmro.gov.hk", "ethmed.toyama-wakan.net", "ethmed.toyama-wakan.net", "upload.wikimedia.org"][index]);
      assert.equal(link.retrievalOutcome, index === 0 && n < 2 ? "http_400_timeout"
        : index === 1 || index === 2 ? "cache_miss" : "reference_without_reviewable_image_content");
      if (index === 1 || index === 2) assert.equal(new URL(link.url).pathname,
        `/SearchEn/ReadImage/WEBFILE/${index === 1 ? "chinplantd_jiou_4347a.jpg" : "chinplantd_tenmon_8658a.jpg"}/10000`);
    });
    strings(item.limitations);
    for (const field of ["publicationEligible", "foodIdentityConfirmed", "foodProcessingApproved", "aiAltTextUsedAsVisualEvidence"]) assert.equal(item[field], false);
    assert.equal(item.doesNotCloseGap, true); assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
  });
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 1);
  const issue = record.retrievalIssues[0]; keys(issue, "url outcome effect");
  assert.equal(issue.url, "https://records.data.kew.org/occurrences/1d6fda23-b026-42d9-b332-5973ad49cf29");
  assert.equal(issue.outcome, "http_403"); text(issue.effect); strings(record.nextActions);
}
// These checks preserve a dated transcription and its boundaries; they do not
// fetch source pages or establish that a license or food identity is valid.
function validateExistingPhotoMetadata(record, catalogBytes) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord existingPhotoObservations retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "existing-photo-metadata.1");
  date(record.checkedAt); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false); assert.deepEqual(record.runtimePlacements, []);
  keys(record.baselineRecord, "path sha256");
  assert.equal(record.baselineRecord.path, BASELINE_PATHS[1]);
  assert.equal(record.baselineRecord.sha256, FOOD_FORM_CATALOG_SHA256);
  validatePhotoBaseline(record, catalogBytes);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const contracts = [
    ["refresh-existing-dang-shen-metadata-2026", "food-form-dang-shen-dried-segments-v01", "dang-shen", "974661806", "干党参段", "2024-01-29", "2024-09-22", "2024-12-23"],
    ["refresh-existing-huang-qi-metadata-2026", "food-form-huang-qi-mongholicus-slices-v01", "huang-qi", "1183073788", "黄芪片", "2024-03-02", "2024-06-16", "2026-03-18"],
    ["refresh-existing-tie-pi-shi-hu-rolls-metadata-2026", "food-form-tie-pi-shi-hu-dried-rolls-v01", "tie-pi-shi-hu", "1213281975", "铁皮石斛卷", "2024-01-31", "2024-07-24", "2026-05-13"]
  ];
  assert(Array.isArray(record.existingPhotoObservations));
  assert.equal(record.existingPhotoObservations.length, contracts.length);
  record.existingPhotoObservations.forEach((item, index) => {
    keys(item, "id candidateId ingredientId source remoteOriginal localAssetAvailable localBytes localSha256 visualReviewState foodIdentityConfirmed foodProcessingApproved rightsReviewState professionalReviewState aiAltTextUsedAsVisualEvidence publicationEligible runtimePlacements limitations");
    const [id, candidateId, ingredientId, revision, caption, created, uploaded, modified] = contracts[index];
    assert.deepEqual([item.id, item.candidateId, item.ingredientId], [id, candidateId, ingredientId]);
    const baseline = catalog.records.find((candidate) => candidate.id === candidateId);
    assert(baseline && baseline.ingredientId === ingredientId, "candidate identity drift");
    keys(item.source, "url permanentUrl access contentSha256 creator captionLabel createdAt uploadedAt pageModifiedAt datePrecision licenseName licenseUrl");
    const observed = item.source;
    url(observed.url, "commons.wikimedia.org");
    assert.equal(observed.url, baseline.source.sourcePage);
    url(observed.permanentUrl, "commons.wikimedia.org");
    const permanent = new URL(observed.permanentUrl);
    assert.equal(permanent.pathname, "/w/index.php");
    assert.deepEqual([...permanent.searchParams.keys()].sort(), ["oldid", "title"]);
    assert.equal(permanent.searchParams.get("title"), baseline.source.fileTitle.replace(/ /g, "_"));
    assert.equal(permanent.searchParams.get("oldid"), revision);
    assert.equal(observed.access, "file_page_read"); assert.equal(observed.contentSha256, null);
    assert.equal(observed.creator, baseline.source.author); assert.equal(observed.captionLabel, caption);
    assert.deepEqual([observed.createdAt, observed.uploadedAt, observed.pageModifiedAt], [created, uploaded, modified],
      "capture upload and page modification dates are distinct");
    for (const value of [created, uploaded, modified]) { date(value); assert(value <= record.checkedAt); }
    assert.equal(observed.datePrecision, "day_as_reported_not_verified_capture_time");
    assert.equal(observed.licenseName, "CC0 1.0 Universal");
    url(observed.licenseUrl, "creativecommons.org");
    assert.equal(observed.licenseUrl, baseline.source.licenseUrl);
    keys(item.remoteOriginal, "url sha1 bytes width height mimeType measurementScope");
    const remote = item.remoteOriginal;
    url(remote.url, "upload.wikimedia.org"); assert.equal(remote.url, baseline.source.originalUrl);
    for (const field of ["sha1", "bytes", "width", "height", "mimeType"])
      assert.equal(remote[field], baseline.source.remoteOriginal[field], "source-reported original metadata drift");
    assert.equal(remote.measurementScope, "source_page_reported_not_local_measurement");
    assert.equal(item.localAssetAvailable, false); assert.equal(item.localBytes, null); assert.equal(item.localSha256, null);
    assert.equal(item.visualReviewState, "not_performed");
    for (const field of ["publicationEligible", "foodIdentityConfirmed", "foodProcessingApproved", "aiAltTextUsedAsVisualEvidence"])
      assert.equal(item[field], false);
    assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
    strings(item.limitations);
  });
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, contracts.length);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect");
    assert.equal(issue.url, record.existingPhotoObservations[index].remoteOriginal.url);
    assert.equal(issue.outcome, "not_accessible_via_tool"); text(issue.effect);
  });
  strings(record.nextActions);
}
// Preserve dated file-page observations, not a food identity or controlled experiment.
function validateProcessingPhotoPair(record, catalogBytes) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord processingPhotoObservations comparisonLimits retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "processing-photo-pair.1"); date(record.checkedAt);
  assert.equal(record.checkedAt, "2026-10-09"); assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false); assert.deepEqual(record.runtimePlacements, []);
  keys(record.baselineRecord, "path sha256");
  assert.equal(record.baselineRecord.path, BASELINE_PATHS[1]);
  assert.equal(record.baselineRecord.sha256, FOOD_FORM_CATALOG_SHA256);
  validatePhotoBaseline(record, catalogBytes);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  assert(catalog.gaps.some((gap) => gap.id === "food-form-gap-di-huang-v01"));
  const contracts = [
    ["refresh-rehmannia-seche-label-2026", "s%C3%A9ch%C3%A9", "1136400191", "3/37", "dried_as_titled_not_verified", "2008-07-12", "Brun avec la surface sèche", 709, 531],
    ["refresh-rehmannia-prepare-label-2026", "pr%C3%A9par%C3%A9", "1136400293", "8/8f", "prepared_as_titled_not_verified", "2022-11-21", "Noir avec la viscosité", 750, 417]
  ];
  assert(Array.isArray(record.processingPhotoObservations)); assert.equal(record.processingPhotoObservations.length, 2);
  record.processingPhotoObservations.forEach((item, index) => {
    keys(item, "id ingredientId existingGapId processingLabelState source media foodIdentityConfirmed processingIdentityConfirmed aiAltTextUsedAsVisualEvidence doesNotCloseGap rightsReviewState professionalReviewState publicationEligible runtimePlacements limitations");
    const [id, title, revision, directory, label, created, description, width, height] = contracts[index];
    assert.equal(item.id, id); assert.equal(item.ingredientId, "di-huang");
    assert.equal(item.existingGapId, "food-form-gap-di-huang-v01"); assert.equal(item.processingLabelState, label);
    keys(item.source, "url permanentUrl creator descriptionExact createdAt uploadedAt pageModifiedAt licenseName licenseUrl");
    const source = item.source;
    url(source.url, "commons.wikimedia.org"); url(source.permanentUrl, "commons.wikimedia.org");
    assert.equal(source.url, `https://commons.wikimedia.org/wiki/File:Rehmannia_${title}.jpg`);
    assert.equal(source.permanentUrl, `https://commons.wikimedia.org/w/index.php?title=File:Rehmannia_${title}.jpg&oldid=${revision}`);
    assert.equal(source.creator, "Phoenixshi"); assert.equal(source.descriptionExact, description);
    assert.deepEqual([source.createdAt, source.uploadedAt, source.pageModifiedAt], [created, "2022-11-22", "2025-12-25"]);
    for (const field of ["createdAt", "uploadedAt", "pageModifiedAt"]) { date(source[field]); assert(source[field] <= record.checkedAt); }
    assert.equal(source.licenseName, "CC BY-SA 4.0");
    assert.equal(source.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
    keys(item.media, "imageUrl width height exactBytes sha256 localAssetAvailable visualReviewState");
    url(item.media.imageUrl, "upload.wikimedia.org");
    assert.equal(item.media.imageUrl, `https://upload.wikimedia.org/wikipedia/commons/${directory}/Rehmannia_${title}.jpg`);
    assert.equal(item.media.width, width); assert.equal(item.media.height, height);
    assert.equal(item.media.exactBytes, null); assert.equal(item.media.sha256, null);
    assert.equal(item.media.localAssetAvailable, false); assert.equal(item.media.visualReviewState, "not_performed");
    for (const field of ["foodIdentityConfirmed", "processingIdentityConfirmed", "aiAltTextUsedAsVisualEvidence", "publicationEligible"]) assert.equal(item[field], false);
    assert.equal(item.doesNotCloseGap, true); assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending"); strings(item.limitations);
  });
  keys(record.comparisonLimits, "sameSpeciesConfirmed sameBatchConfirmed processingDifferenceVerified foodUseApproved");
  for (const value of Object.values(record.comparisonLimits)) assert.equal(value, false);
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 2);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); assert.equal(issue.url, record.processingPhotoObservations[index].media.imageUrl);
    assert.equal(issue.outcome, "no_reviewable_pixels_returned"); text(issue.effect);
  });
  strings(record.nextActions);
}
// A dated source-text triage, not image inspection, specimen verification or permission.
function validateLiteraturePhotoTriage(record, catalogBytes) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord literaturePhotoObservations retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "literature-photo-triage.1"); date(record.checkedAt);
  assert.equal(record.checkedAt, "2026-10-09"); assert.equal(record.scope, "private_research_only");
  assert.equal(record.publicationEligible, false); assert.deepEqual(record.runtimePlacements, []);
  keys(record.baselineRecord, "path sha256");
  assert.equal(record.baselineRecord.path, BASELINE_PATHS[1]);
  assert.equal(record.baselineRecord.sha256, FOOD_FORM_CATALOG_SHA256);
  validatePhotoBaseline(record, catalogBytes);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const contracts = [
    ["refresh-cistanche-thermal-fig1-2021", "rou-cong-rong-huang-mo", "candidate", "food-form-rou-cong-rong-dried-stem-v01",
      "processing_photo_lead_visual_pending", "https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2021.742511/full",
      "10.3389/fnut.2021.742511", "2021-10-14", null, "CC BY 4.0", "by/4.0",
      "https://www.frontiersin.org/files/Articles/742511/xml-images/fnut-08-742511-g0001.webp",
      "https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2021.742511/pdf", 5, "Figure 1",
      ["A：蒸制前", "B：蒸制后未干燥", "C：蒸制后干燥"], "longitudinal_split_described_not_independently_verified", null],
    ["refresh-rehmannia-cmc-fig1-ncnd-2026", "di-huang", "gap", "food-form-gap-di-huang-v01",
      "commercial_or_adapted_media_permission_required", "https://link.springer.com/article/10.1186/s12870-026-08326-y",
      "10.1186/s12870-026-08326-y", "2026-02-13", "2026-03-20", "CC BY-NC-ND 4.0", "by-nc-nd/4.0", null,
      "https://link.springer.com/content/pdf/10.1186/s12870-026-08326-y.pdf", 3, "Figure 1",
      ["A：三月龄鲜根", "B：切片外植体", "C：培养后的切片", "D：愈伤组织", "E和F：显微图"], "independent_cell_line_sources_not_food_batch", "GDD230XT99"],
    ["refresh-rehmannia-four-forms-nonphoto-2023", "di-huang", "gap", "food-form-gap-di-huang-v01",
      "not_a_food_form_photo_source", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10746076/",
      "10.3390/molecules28247995", "2023-12-07", null, "CC BY 4.0", "by/4.0", null, null, null, "Figures 1-16; section 4.2",
      ["图1和图2：色谱", "图3：成分差异", "图4至图16：质谱或碎裂途径"], "separately_collected_or_purchased_not_paired", null]
  ];
  assert(Array.isArray(record.literaturePhotoObservations)); assert.equal(record.literaturePhotoObservations.length, contracts.length);
  record.literaturePhotoObservations.forEach((item, index) => {
    keys(item, "id ingredientId catalogReferenceKind catalogReferenceId disposition source media evidence rightsReviewState professionalReviewState aiAltTextUsedAsVisualEvidence publicationEligible runtimePlacements limitations");
    const [id, ingredient, kind, reference, disposition, sourceUrl, doi, published, version, license, licensePath,
      imageUrl, pdfUrl, page, locator, panels, relation, voucher] = contracts[index];
    assert.deepEqual([item.id, item.ingredientId, item.catalogReferenceKind, item.catalogReferenceId, item.disposition],
      [id, ingredient, kind, reference, disposition]);
    const references = kind === "candidate" ? catalog.records : catalog.gaps;
    assert(references.some((entry) => entry.id === reference && entry.ingredientId === ingredient), "catalog reference drift");
    keys(item.source, "publisher titleZh url doi publishedAt versionOfRecordAt access contentSha256");
    text(item.source.publisher); text(item.source.titleZh); url(item.source.url); assert.equal(item.source.url, sourceUrl);
    assert.equal(item.source.doi, doi); assert.equal(item.source.publishedAt, published); date(item.source.publishedAt);
    assert(item.source.publishedAt <= record.checkedAt);
    assert.equal(item.source.versionOfRecordAt, version);
    if (version !== null) { date(version); assert(published <= version && version <= record.checkedAt); }
    assert.equal(item.source.access, "relevant_full_text_read"); assert.equal(item.source.contentSha256, null);
    keys(item.media, "imageUrl pdfUrl pdfPage1Based figureLocator licenseName licenseUrl localAssetAvailable bytes sha256 visualReviewState");
    assert.deepEqual([item.media.imageUrl, item.media.pdfUrl, item.media.pdfPage1Based, item.media.figureLocator], [imageUrl, pdfUrl, page, locator]);
    for (const link of [imageUrl, pdfUrl].filter(Boolean)) url(link);
    assert.equal(item.media.licenseName, license); assert.equal(item.media.licenseUrl, `https://creativecommons.org/licenses/${licensePath}/`);
    assert.equal(item.media.localAssetAvailable, false); assert.equal(item.media.bytes, null); assert.equal(item.media.sha256, null);
    assert.equal(item.media.visualReviewState, "not_performed");
    keys(item.evidence, "basis panelMeanings sampleRelation sampleProvenance voucherReference methodCaptionAlignment methodCaveat foodIdentityConfirmed foodProcessingApproved");
    assert.equal(item.evidence.basis, "source_text_only"); assert.deepEqual(item.evidence.panelMeanings, panels);
    assert.equal(item.evidence.sampleRelation, relation); assert.equal(item.evidence.voucherReference, voucher);
    assert.equal(item.evidence.methodCaptionAlignment, index === 0 ? "photography_stage_unspecified" : "not_applicable");
    text(item.evidence.sampleProvenance); text(item.evidence.methodCaveat);
    assert.equal(item.evidence.foodIdentityConfirmed, false); assert.equal(item.evidence.foodProcessingApproved, false);
    assert.equal(item.publicationEligible, false); assert.equal(item.aiAltTextUsedAsVisualEvidence, false);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
    assert.deepEqual(item.runtimePlacements, []); strings(item.limitations);
  });
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 3);
  const expectedIssues = [
    [contracts[0][11], "cache_miss_no_reviewable_pixels"],
    [contracts[0][12], "pdf_text_read_screenshot_cache_miss"],
    [contracts[1][12], "pdf_text_read_screenshot_cache_miss"]
  ];
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); assert.deepEqual([issue.url, issue.outcome], expectedIssues[index]); text(issue.effect);
  });
  strings(record.nextActions);
}
// Text-level source screening only: no pixels, photographic identity or food approval.
function validateTiandongPhotoScreening(record, catalogBytes) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord literaturePhotoObservations retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "tiandong-photo-screening.1");
  assert.equal(record.checkedAt, "2026-10-09"); date(record.checkedAt);
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []);
  keys(record.baselineRecord, "path sha256");
  assert.deepEqual(record.baselineRecord, { path: BASELINE_PATHS[1], sha256: FOOD_FORM_CATALOG_SHA256 });
  validatePhotoBaseline(record, catalogBytes);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  assert(catalog.gaps.some((gap) => gap.id === "food-form-gap-tian-dong-v01" && gap.ingredientId === "tian-dong"));
  const contracts = [
    ["refresh-tiandong-maxent-samples-2024", "sample_photo_lead_processing_and_visual_pending",
      "https://onlinelibrary.wiley.com/doi/10.1002/ece3.70354", "10.1002/ece3.70354", "2024-10-03",
      "https://onlinelibrary.wiley.com/doi/pdf/10.1002/ece3.70354", 3,
      "Figure 1(e); caption 1(b-d); section 2.1", "CC BY (version not verified)", null,
      ["a：样品与分布信息", "b至d：野外天冬，图注署名Tong Zhang", "e：本研究所用样品"],
      "field_and_research_samples_not_paired_processing", "processing_stage_unspecified"],
    ["refresh-tiandong-drying-microscopy-exclusion-2022", "not_a_macroscopic_food_form_photo_source",
      "https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2022.868209/full", "10.3389/fnut.2022.868209", "2022-05-06",
      null, null, "Figures 1-5; scanning electron microscopy methods; Table 3", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/",
      ["图1至图3：挥发性成分谱图", "图4：主成分分析", "图5：干燥材料显微结构"],
      "experimental_drying_groups_not_food_batch_verification", "not_applicable"]
  ];
  assert(Array.isArray(record.literaturePhotoObservations)); assert.equal(record.literaturePhotoObservations.length, 2);
  record.literaturePhotoObservations.forEach((item, index) => {
    keys(item, "id ingredientId catalogReferenceKind catalogReferenceId disposition source media evidence rightsReviewState professionalReviewState aiAltTextUsedAsVisualEvidence publicationEligible runtimePlacements limitations");
    const [id, disposition, sourceUrl, doi, published, pdf, page, locator, license, licenseUrl, panels, relation, alignment] = contracts[index];
    assert.deepEqual([item.id, item.ingredientId, item.catalogReferenceKind, item.catalogReferenceId, item.disposition],
      [id, "tian-dong", "gap", "food-form-gap-tian-dong-v01", disposition]);
    keys(item.source, "publisher titleZh url doi publishedAt versionOfRecordAt access contentSha256");
    text(item.source.publisher); text(item.source.titleZh); url(item.source.url);
    assert.deepEqual([item.source.url, item.source.doi, item.source.publishedAt, item.source.versionOfRecordAt,
      item.source.access, item.source.contentSha256], [sourceUrl, doi, published, null, "relevant_full_text_read", null]);
    date(item.source.publishedAt); assert(item.source.publishedAt <= record.checkedAt);
    keys(item.media, "imageUrl pdfUrl pdfPage1Based figureLocator licenseName licenseUrl localAssetAvailable bytes sha256 visualReviewState");
    assert.deepEqual([item.media.imageUrl, item.media.pdfUrl, item.media.pdfPage1Based, item.media.figureLocator,
      item.media.licenseName, item.media.licenseUrl], [null, pdf, page, locator, license, licenseUrl]);
    for (const link of [pdf, licenseUrl].filter(Boolean)) url(link);
    assert.deepEqual([item.media.localAssetAvailable, item.media.bytes, item.media.sha256, item.media.visualReviewState],
      [false, null, null, "not_performed"]);
    keys(item.evidence, "basis panelMeanings sampleRelation sampleProvenance voucherReference methodCaptionAlignment methodCaveat foodIdentityConfirmed foodProcessingApproved");
    assert.deepEqual([item.evidence.basis, item.evidence.panelMeanings, item.evidence.sampleRelation,
      item.evidence.voucherReference, item.evidence.methodCaptionAlignment], ["source_text_only", panels, relation, null, alignment]);
    text(item.evidence.sampleProvenance); text(item.evidence.methodCaveat);
    assert.equal(item.evidence.foodIdentityConfirmed, false); assert.equal(item.evidence.foodProcessingApproved, false);
    assert.equal(item.publicationEligible, false); assert.equal(item.aiAltTextUsedAsVisualEvidence, false);
    assert.equal(item.rightsReviewState, "pending"); assert.equal(item.professionalReviewState, "pending");
    assert.deepEqual(item.runtimePlacements, []); strings(item.limitations);
  });
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 2);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); url(issue.url); text(issue.effect);
    assert.deepEqual([issue.url, issue.outcome], index === 0
      ? [contracts[0][5], "pdf_text_read_screenshot_cache_miss"] : [contracts[0][2], "supplement_link_internal_error"]);
  });
  strings(record.nextActions);
}
// These contracts preserve a dated transcription and actual captured bytes.
// Passing them does not establish current law, food identity or professional approval.
const OFFICIAL_CAPTURE_CONTRACTS = [
  {
    id: "capture-nhc-2024-4-gazette-20261009", classification: "historical_national_announcement_and_attachment",
    url: "https://www.nhc.gov.cn/wjw/c100393/202501/729a796e3b234f80924a963bada70ccc/files/1741759576414_75843.pdf",
    number: "2024年第4号", signed: "2024-08-12", role: "national_issuer_gazette",
    path: "content-private/research-refresh/official-documents/nhc-2024-4-gazette.pdf",
    sha256: "sha256:85b9603dc838251038e7330b505e369addae1d9e238805a29a5f67a3cb36cc49", bytes: 942224,
    pages: 17, read: [3], labels: ["1"], names: ["地黄", "麦冬", "天冬", "化橘红"],
    parts: [[1, "地黄", "块根", null], [2, "麦冬", "块根", null], [3, "天冬", "块根", null], [4, "化橘红", "外层果皮", null]]
  },
  {
    id: "capture-import-2025-237-hk-20261009", classification: "government_reprint_import_classification_not_directory_addition",
    url: "https://www.tid.gov.hk/en/tradecircular/files/2025/ci10582025a.pdf",
    number: "2025年第237号", signed: "2025-12-03", role: "government_republication_not_original_issuer_page",
    path: "content-private/research-refresh/official-documents/import-2025-237-hk-reprint.pdf",
    sha256: "sha256:9cd332b6d68b5844d4cf069ef73a39e306ed13a050c15ee9632d84cdd3b91074", bytes: 310812,
    pages: 4, read: [1, 2, 3, 4], labels: ["1", "2", "3", "4"],
    names: "丁香|八角茴香|甘草|肉豆蔻|姜黄|砂仁|小茴香|枸杞子|当归|西红花|荜茇|党参|天麻|草果|灵芝|黄芥子|青果|山茱萸|铁皮石斛|菊花|肉桂|杏仁（苦）|肉苁蓉（荒漠）|西洋参|黄芪|杜仲叶|地黄|麦冬|天冬|化橘红".split("|"),
    parts: [[8, "枸杞子", "成熟果实", "新鲜或干燥"], [18, "山茱萸", "成熟果肉", "干燥"],
      [27, "地黄", "块根", "新鲜或干燥"], [28, "麦冬", "块根", "干燥"], [29, "天冬", "块根", "干燥"],
      [30, "化橘红", "外层果皮", "未成熟或近成熟的干燥"]]
  }
];
function captureBytes(relative) {
  const filename = path.join(ROOT, relative);
  let target = filename;
  while (true) {
    assert(!fs.lstatSync(target).isSymbolicLink(), "linked capture rejected");
    assert.equal(path.resolve(fs.realpathSync(target)).toLowerCase(), path.resolve(target).toLowerCase(), "redirected capture rejected");
    if (target === ROOT) break;
    target = path.dirname(target);
  }
  assert(fs.statSync(filename).isFile(), "capture must be a file");
  assert(fs.statSync(filename).size <= 2 * 1024 * 1024, "capture too large");
  return fs.readFileSync(filename);
}
function validateOfficialDocumentCaptures(record, loadBytes = captureBytes) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements directoryAuditComplete professionalReviewState baseline documents retrievalIssues nextActions");
  assert.equal(record.schemaVersion, "official-document-captures.1"); assert.equal(record.checkedAt, "2026-10-09");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []); assert.equal(record.directoryAuditComplete, false);
  assert.equal(record.professionalReviewState, "pending");
  assert.deepEqual(record.baseline, { releaseId: "release-2026.08.13-complete-public-projection.10",
    catalogSourceAsOf: "2026-08-10", catalogSha256: "sha256:5b21a1e30d592cfa00017ad9021d591219cb0d74fb86c1f3ab5fad6c7115c092" });
  assert(Array.isArray(record.documents)); assert.equal(record.documents.length, 2);
  record.documents.forEach((item, index) => {
    const expected = OFFICIAL_CAPTURE_CONTRACTS[index];
    keys(item, "id classification source capture evidence limitations");
    assert.equal(item.id, expected.id); assert.equal(item.classification, expected.classification);
    keys(item.source, "publisher title url documentNumber signedAt webPublishedAt role");
    text(item.source.publisher); text(item.source.title); assert.equal(item.source.url, expected.url); url(item.source.url);
    assert.equal(item.source.documentNumber, expected.number); assert.equal(item.source.signedAt, expected.signed);
    assert.equal(item.source.webPublishedAt, null); assert.equal(item.source.role, expected.role);
    keys(item.capture, "path sha256 bytes pageCount physicalPagesRead printedPageLabels visualReview reviewedAsFoodPhoto");
    assert.equal(item.capture.path, expected.path); assert.equal(item.capture.sha256, expected.sha256);
    assert.equal(item.capture.bytes, expected.bytes); assert.equal(item.capture.pageCount, expected.pages);
    assert.deepEqual(item.capture.physicalPagesRead, expected.read); assert.deepEqual(item.capture.printedPageLabels, expected.labels);
    assert.equal(item.capture.visualReview, "local_poppler_render_viewed"); assert.equal(item.capture.reviewedAsFoodPhoto, false);
    const bytes = loadBytes(item.capture.path);
    assert(Buffer.isBuffer(bytes)); assert.equal(bytes.length, expected.bytes); assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, expected.sha256, "captured PDF bytes drifted");
    keys(item.evidence, "rowCount names selectedParts notes");
    assert.equal(item.evidence.rowCount, expected.names.length); assert.deepEqual(item.evidence.names, expected.names);
    assert(Array.isArray(item.evidence.selectedParts));
    const parts = item.evidence.selectedParts.map((row) => {
      keys(row, "row name part processingLabel"); return [row.row, row.name, row.part, row.processingLabel];
    });
    assert.deepEqual(parts, expected.parts); strings(item.evidence.notes); strings(item.limitations);
  });
  assert(Array.isArray(record.retrievalIssues)); assert.equal(record.retrievalIssues.length, 2);
  record.retrievalIssues.forEach((issue) => { keys(issue, "url outcome effect"); url(issue.url); text(issue.outcome); text(issue.effect); });
  strings(record.nextActions);
}
function forbiddenTokens(record) {
  return ["content-private/research-refresh/", ...(record.officialObservations || []).flatMap((item) => [item.id, item.source.url]),
    ...(record.schemaVersion === "official-nine-review.1" ? officialNine.tokens(record) : []),
    ...(record.schemaVersion === "shanzhuyu-provenance.1" ? officialNine.provenanceTokens(record) : []),
    ...(record.sourceScreeningObservations ? sourceScreening.tokens(record) : []),
    ...(record.universityPhotoLeads ? universityLeads.tokens(record) : []),
    ...(record.photoFollowups || []).flatMap((item) => [item.id, item.source.url, item.media.imageUrl]),
    ...(record.photoIntegrityObservations || []).flatMap((item) => [item.id, item.previousPhotoId, item.sourceUrl, item.permanentUrl, item.original.url]),
    ...(record.specimenPhotoObservations || []).flatMap((item) => [item.id, item.source.url, item.media.rightsEvidenceUrl, ...item.media.links.map((link) => link.url)]),
    ...(record.existingPhotoObservations || []).flatMap((item) => [item.id, item.candidateId, item.source.url, item.source.permanentUrl, item.remoteOriginal.url]),
    ...(record.processingPhotoObservations || []).flatMap((item) => [item.id, item.source.url, item.source.permanentUrl, item.media.imageUrl]),
    ...(record.literaturePhotoObservations || []).flatMap((item) => [item.id, item.source.url, item.source.doi,
      item.media.imageUrl, item.media.pdfUrl, item.evidence.voucherReference]),
    ...(record.documents || []).flatMap((item) => [item.id, item.source.url, item.capture.path]),
    ...(record.photoCaptures || []).flatMap((item) => [item.id, item.candidateId, item.previousObservationId, item.capture.path, item.sourceObservation?.page]),
    // This one retrieval retries an already-public URL in the digest-bound .10
    // catalog. It is not a new private source. No prefixes, hosts or query URLs
    // are exempted; main also verifies its presence in the unchanged baseline.
    ...record.retrievalIssues.map((item) => item.url).filter((value) =>
      !(record.schemaVersion === "directory-scope.1" && value === HISTORICAL_COUNT_URL))]
    .filter((value) => typeof value === "string" && value.length > 0);
}
function validateRuntimeText(content, record) {
  for (const token of forbiddenTokens(record)) assert(!content.includes(token), "private research reference entered runtime");
}
function checkRuntime(root, record, relative = "") {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (EXCLUDES.has(next.split(path.sep)[0])) continue;
    const absolute = path.join(root, next);
    assert(!fs.lstatSync(absolute).isSymbolicLink(), "runtime symlink rejected");
    if (entry.isDirectory()) checkRuntime(root, record, next);
    else if (/\.(?:js|json|wxml|wxss)$/.test(entry.name)) validateRuntimeText(fs.readFileSync(absolute, "utf8"), record);
  }
}
function main() {
  const universityRecord = read(universityLeads.RECORD_PATH);
  console.log(JSON.stringify(universityLeads.validate(universityRecord, ROOT)));
  checkRuntime(ROOT, universityRecord);
  const provenanceRecord = read(officialNine.PROVENANCE_PATH);
  console.log(JSON.stringify(officialNine.validateProvenance(provenanceRecord, ROOT)));
  checkRuntime(ROOT, provenanceRecord);
  const nineRecord = read(officialNine.RECORD_PATH);
  console.log(JSON.stringify(officialNine.validate(nineRecord, ROOT)));
  checkRuntime(ROOT, nineRecord);
  const screeningRecord = read(sourceScreening.RECORD_PATH);
  console.log(JSON.stringify(sourceScreening.validate(screeningRecord, ROOT)));
  checkRuntime(ROOT, screeningRecord);
  const photoInventory = require("./photo-review-inventory").check();
  console.log(JSON.stringify({ privatePhotoInventory: photoInventory, assertions: "passed" }));
  const record = read(RECORD_PATH); validateRecord(record);
  const photoCapturesBatch4 = read(PHOTO_CAPTURE_BATCH4_PATH); validatePhotoCapturesBatch4(photoCapturesBatch4);
  checkRuntime(ROOT, photoCapturesBatch4); checkPhotoCaptureCopies(ROOT, photoCapturesBatch4);
  console.log(JSON.stringify({ checkedAt: photoCapturesBatch4.checkedAt, batch: 4, capturedPhotoOriginals: 3, localBytesVerified: 6902767,
    scaledAiVisualObservations: 3, processingRecheckConcerns: 1, captionRecheckConcerns: 1, failedOriginalRetrievals: 1,
    professionalApprovals: 0, photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" }));
  const photoCapturesBatch3 = read(PHOTO_CAPTURE_BATCH3_PATH); validatePhotoCapturesBatch3(photoCapturesBatch3);
  checkRuntime(ROOT, photoCapturesBatch3); checkPhotoCaptureCopies(ROOT, photoCapturesBatch3);
  console.log(JSON.stringify({ checkedAt: photoCapturesBatch3.checkedAt, batch: 3, capturedPhotoOriginals: 3, localBytesVerified: 7321440,
    originalResolutionAiVisualObservations: 1, scaledAiVisualObservations: 2, partRecheckConcerns: 1, failedOriginalRetrievals: 1,
    professionalApprovals: 0, photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" }));
  const photoCapturesBatch2 = read(PHOTO_CAPTURE_BATCH2_PATH); validatePhotoCapturesBatch2(photoCapturesBatch2);
  checkRuntime(ROOT, photoCapturesBatch2); checkPhotoCaptureCopies(ROOT, photoCapturesBatch2);
  console.log(JSON.stringify({ checkedAt: photoCapturesBatch2.checkedAt, batch: 2, capturedPhotoOriginals: 4, localBytesVerified: 12186772,
    scaledAiVisualObservations: 4, partRecheckConcerns: 1, failedOriginalRetrievals: 2, professionalApprovals: 0,
    photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" }));
  const photoCaptures = read(PHOTO_CAPTURE_RECORD_PATH); validatePhotoCaptures(photoCaptures);
  checkRuntime(ROOT, photoCaptures); checkPhotoCaptureCopies(ROOT, photoCaptures);
  console.log(JSON.stringify({ checkedAt: photoCaptures.checkedAt, capturedPhotoOriginals: 3, localBytesVerified: 6857766,
    scaledAiVisualObservations: 3, professionalApprovals: 0, photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" }));
  const officialCaptures = read(OFFICIAL_CAPTURE_RECORD_PATH); validateOfficialDocumentCaptures(officialCaptures);
  const photoRecord = read(PHOTO_RECORD_PATH); validatePhotoRefresh(photoRecord);
  validatePhotoBaseline(photoRecord, fs.readFileSync(path.join(ROOT, RECORD_PATH)));
  const accessRecord = read(ACCESS_RECORD_PATH); validatePhotoAccess(accessRecord);
  validatePhotoBaseline(accessRecord, fs.readFileSync(path.join(ROOT, PHOTO_RECORD_PATH)));
  const directoryRecord = read(DIRECTORY_RECORD_PATH); validateDirectoryScope(directoryRecord);
  const integrityRecord = read(INTEGRITY_RECORD_PATH); validatePhotoIntegrity(integrityRecord, photoRecord);
  validatePhotoBaseline(integrityRecord, fs.readFileSync(path.join(ROOT, PHOTO_RECORD_PATH)));
  const specimenLinks = read(SPECIMEN_LINKS_RECORD_PATH); validateSpecimenPhotoLinks(specimenLinks);
  validatePhotoBaseline(specimenLinks, fs.readFileSync(path.join(ROOT, PHOTO_RECORD_PATH)));
  const existingPhotos = read(EXISTING_PHOTO_RECORD_PATH);
  validateExistingPhotoMetadata(existingPhotos, fs.readFileSync(path.join(ROOT, BASELINE_PATHS[1])));
  const processingPair = read(PROCESSING_PAIR_RECORD_PATH);
  validateProcessingPhotoPair(processingPair, fs.readFileSync(path.join(ROOT, BASELINE_PATHS[1])));
  const literatureTriage = read(LITERATURE_TRIAGE_RECORD_PATH);
  validateLiteraturePhotoTriage(literatureTriage, fs.readFileSync(path.join(ROOT, BASELINE_PATHS[1])));
  const tiandongScreening = read(TIANDONG_SCREENING_RECORD_PATH);
  validateTiandongPhotoScreening(tiandongScreening, fs.readFileSync(path.join(ROOT, BASELINE_PATHS[1])));
  validatePhotoBaseline(directoryRecord, fs.readFileSync(path.join(ROOT, RECORD_PATH)));
  assert.equal(directoryRecord.baseline.releaseId, record.baseline.releaseId);
  assert.equal(directoryRecord.baseline.catalogSourceAsOf, record.baseline.catalogSourceAsOf);
  assert.equal(directoryRecord.baseline.catalogSha256, record.baseline.files[0].sha256);
  const active = read("data/version-active.json");
  assert.equal(record.baseline.releaseId, active.releaseId, "research baseline requires reassessment");
  for (const file of record.baseline.files) {
    const digest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file.path))).digest("hex")}`;
    assert.equal(digest, file.sha256, "baseline changed; do not silently rebind the dated research");
  }
  const catalog = require("../data/ingredients");
  assert.equal(record.baseline.catalogSourceAsOf, catalog.catalogCoverage.asOf);
  assert(catalog.ingredients.some((item) => item.sources.some((s) => s.url === HISTORICAL_COUNT_URL)),
    "the retried public URL must exist in the digest-bound historical catalog");
  const forms = read(BASELINE_PATHS[1]);
  assert.equal(forms.records.length, record.baseline.photoCandidateCount);
  assert.deepEqual(forms.gaps.map((gap) => gap.id), record.baseline.unresolvedGapIds);
  const ignores = read("project.config.json").packOptions.ignore;
  assert(ignores.some((item) => item.type === "folder" && item.value === "content-private"));
  assert(ignores.some((item) => item.type === "folder" && item.value === ".local"), "local diagnostics must stay excluded from upload");
  assert(ARTIFACT_PATHS.every((item) => !item.startsWith("content-private/")));
  checkRuntime(ROOT, record);
  checkRuntime(ROOT, photoRecord);
  checkRuntime(ROOT, accessRecord);
  checkRuntime(ROOT, directoryRecord);
  checkRuntime(ROOT, integrityRecord);
  checkRuntime(ROOT, specimenLinks);
  checkRuntime(ROOT, existingPhotos);
  checkRuntime(ROOT, processingPair);
  checkRuntime(ROOT, literatureTriage);
  checkRuntime(ROOT, tiandongScreening);
  checkRuntime(ROOT, officialCaptures);
  assert.equal(officialCaptures.baseline.releaseId, record.baseline.releaseId);
  assert.equal(officialCaptures.baseline.catalogSha256, record.baseline.files[0].sha256);
  console.log(JSON.stringify({ checkedAt: officialCaptures.checkedAt, capturedOfficialDocuments: 2, documentPagesViewed: 5,
    sourceBytesVerified: 1253036, directoryAuditComplete: false, foodPhotosReviewed: 0, assertions: "passed" }));
  const nameComparison = compareReferenceNames(directoryRecord.nameCrossCheck.observedNames, catalog.ingredients.map((item) => item.name));
  console.log(JSON.stringify({ checkedAt: record.checkedAt, officialObservations: 3, photoFollowups: 2,
    photoCandidatesAdded: 0, gapsClosed: 0, directoryAuditComplete: false, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: photoRecord.checkedAt, newPhotoLeads: 3, rightsExclusions: 1,
    visualReviewsPerformed: 0, photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: accessRecord.checkedAt, sourceTextLeads: 1, rightsExclusions: 1,
    panelReferenceConflicts: 1, visualReviewsPerformed: 0, photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: directoryRecord.checkedAt, directoryScopeObservations: 4, nameComparison,
    directoryAuditComplete: false, nationalApprovalsAdded: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: integrityRecord.checkedAt, remoteIntegrityObservations: 2,
    localImagesVerified: 0, visualReviewsPerformed: 0, photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: specimenLinks.checkedAt, specimenSourceRecords: 2, exhibitionSourceRecords: 1,
    publicDomainStatementLeads: 1, localImagesVerified: 0, visualReviewsPerformed: 0,
    photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: existingPhotos.checkedAt, existingCandidateMetadataRechecks: 3,
    localImagesVerified: 0, visualReviewsPerformed: 0, photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: processingPair.checkedAt, processingLabelPhotoLeads: 2,
    pairedExperimentVerified: false, localImagesVerified: 0, visualReviewsPerformed: 0,
    photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: literatureTriage.checkedAt, processingPhotoLeads: 1,
    restrictedPhotoSources: 1, nonPhotoSources: 1, localImagesVerified: 0, visualReviewsPerformed: 0,
    photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
  console.log(JSON.stringify({ checkedAt: tiandongScreening.checkedAt, samplePhotoLeads: 1,
    macroscopicPhotoExclusions: 1, licenseVersionsUnverified: 1, localImagesVerified: 0,
    visualReviewsPerformed: 0, photoCandidatesAdded: 0, gapsClosed: 0, assertions: "passed" }));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(`[check-research-refresh] ${error.message}`); process.exitCode = 1; }
}
module.exports = { ROOT, RECORD_PATH, PHOTO_RECORD_PATH, ACCESS_RECORD_PATH, DIRECTORY_RECORD_PATH, read, validateRecord, validatePhotoRefresh, validatePhotoAccess, validatePhotoBaseline,
  validateDirectoryScope, compareReferenceNames, INTEGRITY_RECORD_PATH, validatePhotoIntegrity,
  SPECIMEN_LINKS_RECORD_PATH, validateSpecimenPhotoLinks, EXISTING_PHOTO_RECORD_PATH, validateExistingPhotoMetadata,
  PROCESSING_PAIR_RECORD_PATH, validateProcessingPhotoPair,
  LITERATURE_TRIAGE_RECORD_PATH, validateLiteraturePhotoTriage,
  TIANDONG_SCREENING_RECORD_PATH, validateTiandongPhotoScreening,
  OFFICIAL_CAPTURE_RECORD_PATH, validateOfficialDocumentCaptures,
  PHOTO_CAPTURE_RECORD_PATH, validatePhotoCaptures, checkPhotoCaptureCopies,
  forbiddenTokens, validateRuntimeText, checkRuntime, main };
