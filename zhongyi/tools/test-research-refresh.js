"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { ROOT, RECORD_PATH, PHOTO_RECORD_PATH, ACCESS_RECORD_PATH, read, validateRecord, validatePhotoRefresh, validatePhotoAccess, validatePhotoBaseline,
  DIRECTORY_RECORD_PATH, validateDirectoryScope, compareReferenceNames, INTEGRITY_RECORD_PATH, validatePhotoIntegrity, forbiddenTokens, validateRuntimeText, checkRuntime, main } = require("./check-research-refresh");
const record = read(RECORD_PATH);
const sourceScreening = require("./source-screening-core");
const screeningRecord = read(sourceScreening.RECORD_PATH);
const officialNine = require("./official-nine-review-core");
const nineRecord = read(officialNine.RECORD_PATH);
const provenanceRecord = read(officialNine.PROVENANCE_PATH);
const universityLeads = require("./university-photo-leads-core");
const universityRecord = read(universityLeads.RECORD_PATH);
test("university leads bind three existing gaps without adding photos or changing the catalog", () => {
  assert.deepEqual(universityLeads.validate(universityRecord, ROOT), { checkedAt: "2026-10-10", universityPhotoLeads: 3,
    visualReviewsPerformed: 0, photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" });
  assert.throws(() => universityLeads.validate(universityRecord, ROOT, () => Buffer.from("changed catalog")));
});
test("university source plant labels, gap mapping and image association cannot be substituted", () => {
  for (const mutate of [v => { v.universityPhotoLeads.reverse(); },
    v => { v.universityPhotoLeads[0].gapId = "food-form-gap-di-huang-v01"; },
    v => { v.universityPhotoLeads[1].source.plantLabel = "Lycium chinense"; },
    v => { v.universityPhotoLeads[1].media.links = v.universityPhotoLeads[2].media.links; },
    v => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); }]) {
    const value = structuredClone(universityRecord); mutate(value); assert.throws(() => universityLeads.validate(value, ROOT));
  }
});
test("university copyright year is not publication, capture or photography evidence", () => {
  for (const mutate of [v => { v.universityPhotoLeads[0].source.publishedAt = "2015"; },
    v => { v.universityPhotoLeads[1].media.createdAt = "2015"; },
    v => { v.universityPhotoLeads[2].media.photographer = v.universityPhotoLeads[2].source.publisher; },
    v => { v.universityPhotoLeads[0].source.contentSha256 = "invented"; }]) {
    const value = structuredClone(universityRecord); mutate(value); assert.throws(() => universityLeads.validate(value, ROOT));
  }
});
test("unreturned image pixels and unread copyright cannot become observation or permission", () => {
  for (const mutate of [v => { v.universityPhotoLeads[0].media.visualReviewState = "viewed"; },
    v => { v.universityPhotoLeads[0].media.pixelObservations = "generated search description"; },
    v => { v.universityPhotoLeads[1].media.localAssetAvailable = true; },
    v => { v.universityPhotoLeads[2].rights.licenseName = "CC BY 4.0"; },
    v => { v.universityPhotoLeads[2].rights.projectPermissionObtained = true; },
    v => { v.retrievalIssues[0].automaticRetry = true; }, v => { v.retrievalIssues[2].outcome = "image_viewed"; }]) {
    const value = structuredClone(universityRecord); mutate(value); assert.throws(() => universityLeads.validate(value, ROOT));
  }
});
test("university medicinal labels cannot approve food identity, processing or public placement", () => {
  for (const mutate of [v => { v.publicationEligible = true; }, v => { v.runtimePlacements = ["detail"]; },
    v => { v.universityPhotoLeads[0].foodIdentityConfirmed = true; }, v => { v.universityPhotoLeads[1].foodProcessingApproved = true; },
    v => { v.universityPhotoLeads[2].professionalReviewState = "approved"; }, v => { v.universityPhotoLeads[0].doesNotCloseGap = false; },
    v => { v.universityPhotoLeads[0].extraPermission = true; }]) {
    const value = structuredClone(universityRecord); mutate(value); assert.throws(() => universityLeads.validate(value, ROOT));
  }
});
test("all university photo lead identifiers and links remain excluded from the public runtime", () => {
  for (const token of universityLeads.tokens(universityRecord)) {
    assert(forbiddenTokens(universityRecord).includes(token)); assert.throws(() => validateRuntimeText(token, universityRecord));
  }
  checkRuntime(ROOT, universityRecord);
});
test("existing interpretation supplies flesh provenance without declaring a snapshot error or approval", () => {
  assert.deepEqual(officialNine.validateProvenance(provenanceRecord, ROOT), { checkedAt: "2026-10-10",
    fleshProvenanceAdded: 1, governmentRepublicationsRead: 1, localOriginalCapturesAdded: 0,
    professionalApprovals: 0, snapshotErrorsEstablished: 0, assertions: "passed" });
});
test("interpretation provenance distinguishes live restriction, republication role and dates from original capture", () => {
  for (const mutate of [v => { v.canonicalSource.access = "live_full_body_read"; },
    v => { v.governmentRepublication.role = "national_issuer"; },
    v => { v.governmentRepublication.pageGeneratedOn = "2023-11-17"; },
    v => { v.localOriginalCapture = { sha256: "invented" }; },
    v => { v.existingSourceId = "import-classification"; },
    v => { v.assessment.announcementPart = "果肉"; }]) {
    const value = structuredClone(provenanceRecord); mutate(value);
    assert.throws(() => officialNine.validateProvenance(value, ROOT));
  }
});
test("new provenance preserves earlier finding bytes and cannot grant food, photo or professional approval", () => {
  const loader = relative => fs.readFileSync(path.join(ROOT, relative));
  assert.throws(() => officialNine.validateProvenance(provenanceRecord, ROOT, file =>
    file === officialNine.RECORD_PATH ? Buffer.from("rewritten finding") : loader(file)));
  for (const mutate of [v => { v.assessment.resolution = "resolved"; },
    v => { v.assessment.snapshotErrorEstablished = true; }, v => { v.assessment.professionalReviewState = "approved"; },
    v => { v.assessment.photoIdentityConfirmed = true; }, v => { v.assessment.wholeFruitUseApproved = true; },
    v => { v.assessment.directoryAuditComplete = true; }, v => { v.publicationEligible = true; },
    v => { v.runtimePlacements = ["detail"]; }]) {
    const value = structuredClone(provenanceRecord); mutate(value);
    assert.throws(() => officialNine.validateProvenance(value, ROOT));
  }
});
test("new government republication stays private while the pre-existing canonical source remains unchanged", () => {
  for (const token of officialNine.provenanceTokens(provenanceRecord)) {
    assert(forbiddenTokens(provenanceRecord).includes(token));
    assert.throws(() => validateRuntimeText(`fixture ${token}`, provenanceRecord));
  }
  assert(!forbiddenTokens(provenanceRecord).includes(provenanceRecord.canonicalSource.url));
  checkRuntime(ROOT, provenanceRecord);
});
test("nine-item gazette capture verifies real bytes, two read pages and one unresolved part difference", () => {
  assert.deepEqual(officialNine.validate(nineRecord, ROOT), { checkedAt: "2026-10-10", capturedOfficialDocuments: 1,
    documentPagesViewed: 2, sourceBytesVerified: 1144136, comparedParts: 9, matchedParts: 8, unresolvedPartFindings: 1,
    directoryAuditComplete: false, professionalApprovals: 0, foodPhotosReviewed: 0, assertions: "passed" });
});
test("part comparison reports exact source differences without silently merging fruit and fruit flesh", () => {
  const catalog = require("../data/ingredients").ingredients;
  assert.deepEqual(officialNine.compareParts(nineRecord.rows, catalog), { matchedParts: 8,
    findings: [{ ingredientId: "shan-zhu-yu", announcementPart: "果实", snapshotPart: "果肉" }] });
  const changed = structuredClone(catalog); changed.find(item => item.id === "tian-ma").identity.ediblePart = "根";
  assert.equal(officialNine.compareParts(nineRecord.rows, changed).findings.length, 2);
  assert.throws(() => officialNine.compareParts(nineRecord.rows, catalog.filter(item => item.id !== "shan-zhu-yu")));
  assert.throws(() => officialNine.compareParts(nineRecord.rows, [...catalog, catalog.find(item => item.id === "shan-zhu-yu")]));
});
test("captured gazette rejects changed, missing or truncated bytes rather than trusting recorded integrity", () => {
  const loader = relative => fs.readFileSync(path.join(ROOT, relative));
  for (const bad of [Buffer.from("%PDF-fixture"), Buffer.from(loader(officialNine.PDF_PATH))]) {
    bad[7] ^= 1;
    assert.throws(() => officialNine.validate(nineRecord, ROOT, relative => relative === officialNine.PDF_PATH ? bad : loader(relative)));
  }
  assert.throws(() => officialNine.validate(nineRecord, ROOT, relative => {
    if (relative === officialNine.PDF_PATH) throw Error("missing fixture"); return loader(relative);
  }));
});
test("gazette signature, PDF creation date, page positions and non-photo review remain distinct", () => {
  for (const mutate of [v => { v.document.signedAt = "2024-01-24"; }, v => { v.document.webPublishedAt = "2024-01-24"; },
    v => { v.document.capture.physicalPagesRead = Array.from({ length: 37 }, (_, index) => index + 1); },
    v => { v.document.capture.printedPageLabels = ["18", "19"]; }, v => { v.document.capture.reviewedAsFoodPhoto = true; },
    v => { v.document.capture.path = "../outside.pdf"; }]) {
    const value = structuredClone(nineRecord); mutate(value); assert.throws(() => officialNine.validate(value, ROOT));
  }
});
test("unresolved part discrepancy cannot disappear, grant whole-fruit use or approve a photo", () => {
  for (const mutate of [v => { v.comparison.findings = []; }, v => { v.comparison.matchedParts = 9; },
    v => { v.rows[6].part = "果肉"; }, v => { v.comparison.findings[0].state = "resolved"; },
    v => { v.comparison.findings[0].resolution = "use whole fruit"; }, v => { v.comparison.findings[0].doesNotBroadenFoodUse = false; },
    v => { v.comparison.findings[0].doesNotApproveExistingPhoto = false; }, v => { v.professionalReviewState = "approved"; },
    v => { v.publicationEligible = true; }, v => { v.runtimePlacements = ["detail"]; }, v => { v.directoryAuditComplete = true; }]) {
    const value = structuredClone(nineRecord); mutate(value); assert.throws(() => officialNine.validate(value, ROOT));
  }
});
test("import processing is separately bound and cannot replace the national announcement wording", () => {
  for (const mutate of [v => { v.comparison.findings[0].importListPart = "果实"; },
    v => { v.comparison.findings[0].importListProcessing = "unspecified"; }, v => { v.document.role = "import_list"; },
    v => { v.baseline.earlierCaptureRecordSha256 = "sha256:" + "0".repeat(64); },
    v => { v.baseline.catalogSourceAsOf = "2026-10-10"; }, v => { v.extraApproval = true; }]) {
    const value = structuredClone(nineRecord); mutate(value); assert.throws(() => officialNine.validate(value, ROOT));
  }
});
test("historical catalog and earlier capture record bytes cannot be rebaselined by a new observation", () => {
  const loader = relative => fs.readFileSync(path.join(ROOT, relative));
  for (const relative of ["data/ingredients.js", nineRecord.baseline.earlierCaptureRecord]) {
    assert.throws(() => officialNine.validate(nineRecord, ROOT, file => file === relative ? Buffer.from("changed fixture") : loader(file)));
  }
});
test("new gazette IDs, private original and discrepancy record remain absent from public runtime", () => {
  for (const token of officialNine.tokens(nineRecord)) {
    assert(forbiddenTokens(nineRecord).includes(token)); assert.throws(() => validateRuntimeText(`fixture ${token}`, nineRecord));
  }
  checkRuntime(ROOT, nineRecord);
});
test("new dated screening preserves formal food-form gaps and historical research bytes", () => {
  assert.deepEqual(sourceScreening.validate(screeningRecord, ROOT), { checkedAt: "2026-10-10", sourceScreeningObservations: 3,
    visualReviewsPerformed: 0, localImagesVerified: 0, photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" });
  for (const mutate of [v => { v.historicalBindings.pop(); }, v => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); },
    v => { v.sourceScreeningObservations[0].existingGapId = "food-form-gap-tian-dong-v01"; }]) {
    const v = structuredClone(screeningRecord); mutate(v); assert.throws(() => sourceScreening.validate(v, ROOT));
  }
});
test("source screening cannot publish, approve identity or close gaps", () => {
  for (const mutate of [v => { v.publicationEligible = true; }, v => { v.runtimePlacements = ["detail"]; },
    ...["professionalReviewState", "publicationEligible", "doesNotCloseGap"].map(k => v => { v.sourceScreeningObservations[0][k] = "approved"; }),
    v => { v.sourceScreeningObservations[0].evidence.foodIdentityConfirmed = true; },
    v => { v.sourceScreeningObservations[0].evidence.foodProcessingApproved = true; },
    v => { v.sourceScreeningObservations[0].rights.reviewState = "approved"; }]) {
    const v = structuredClone(screeningRecord); mutate(v); assert.throws(() => sourceScreening.validate(v, ROOT));
  }
});
test("text, captions and alt text never become viewed or locally captured pixels", () => {
  for (let i = 0; i < 3; i++) for (const mutate of [x => { x.aiAltTextUsedAsVisualEvidence = true; },
    x => { x.media.visualReviewState = "viewed"; }, x => { x.media.pixelObservations = "red roots"; },
    x => { x.media.localAssetAvailable = true; }, x => { x.media.bytes = 10; }]) {
    const v = structuredClone(screeningRecord); mutate(v.sourceScreeningObservations[i]); assert.throws(() => sourceScreening.validate(v, ROOT));
  }
});
test("TARI publication month, article authors and earlier technical image stay separate", () => {
  for (const mutate of [x => { x.source.publishedAt = "2013-11-26"; }, x => { x.source.publishedAt = "2012-12-01"; },
    x => { x.media.creator = "賴瑞聲"; }, x => { x.media.createdAt = "2012-11-19"; },
    x => { x.media.imageUrl = screeningRecord.retrievalIssues[0].url; }, x => { x.evidence.doesNotRebindEarlierImage = false; }]) {
    const v = structuredClone(screeningRecord); mutate(v.sourceScreeningObservations[0]); assert.throws(() => sourceScreening.validate(v, ROOT));
  }
});
test("formerly frozen goji description cannot be relabeled as a dried-fruit visual exclusion", () => {
  for (const mutate of [x => { x.evidence.sourceStatement = "Dried goji berries"; },
    x => { x.evidence.processingStateFromSource = "dried"; }, x => { x.evidence.basis = "pixels_viewed"; },
    x => { x.media.createdAt = x.source.publishedAt; }]) {
    const v = structuredClone(screeningRecord); mutate(v.sourceScreeningObservations[1]); assert.throws(() => sourceScreening.validate(v, ROOT));
  }
});
test("Kinmen root link does not inherit another institution's open license or processing claim", () => {
  for (const mutate of [x => { x.rights.licenseUrl = "https://data.gov.tw/license"; },
    x => { x.rights.scope = "site_statement_file_exceptions_pending"; }, x => { x.evidence.processingStateFromSource = "dried"; },
    x => { x.rights.endorsementGranted = true; }]) {
    const v = structuredClone(screeningRecord); mutate(v.sourceScreeningObservations[2]); assert.throws(() => sourceScreening.validate(v, ROOT));
  }
});
test("failed previews, limited articles and browser verification cannot become successful downloads or automatic retries", () => {
  for (let i = 0; i < screeningRecord.retrievalIssues.length; i++) for (const key of ["outcome", "automaticRetry"]) {
    const v = structuredClone(screeningRecord); v.retrievalIssues[i][key] = key === "outcome" ? "captured" : true;
    assert.throws(() => sourceScreening.validate(v, ROOT));
  }
  const v = structuredClone(screeningRecord); v.sourceScreeningObservations[0].rights.approved = true;
  assert.throws(() => sourceScreening.validate(v, ROOT));
  for (const mutate of [v => { v.sourceScreeningObservations[1].source.url = "https://commons.wikimedia.org/wiki/File:Other.jpg"; },
    v => { v.sourceScreeningObservations[0].rights.licenseName = "public domain"; },
    v => { v.retrievalIssues[0].url = v.retrievalIssues[3].url; }]) {
    const changed = structuredClone(screeningRecord); mutate(changed); assert.throws(() => sourceScreening.validate(changed, ROOT));
  }
});
test("new source IDs, media, permanent links and policy links stay outside the public runtime", () => {
  for (const token of sourceScreening.tokens(screeningRecord)) {
    assert(forbiddenTokens(screeningRecord).includes(token)); assert.throws(() => validateRuntimeText(token, screeningRecord));
  }
  for (const issue of screeningRecord.retrievalIssues) assert.throws(() => validateRuntimeText(issue.url, screeningRecord));
  checkRuntime(ROOT, screeningRecord);
});
const photoRecord = read(PHOTO_RECORD_PATH);
const accessRecord = read(ACCESS_RECORD_PATH);
const directoryRecord = read(DIRECTORY_RECORD_PATH);
const integrityRecord = read("content-private/research-refresh/2026-10-09-goji-integrity.json");
const { SPECIMEN_LINKS_RECORD_PATH, validateSpecimenPhotoLinks } = require("./check-research-refresh");
const specimenLinks = read("content-private/research-refresh/2026-10-09-specimen-photo-links.json");
const { EXISTING_PHOTO_RECORD_PATH, validateExistingPhotoMetadata } = require("./check-research-refresh");
const existingPhotos = read("content-private/research-refresh/2026-10-09-existing-photo-metadata.json");
const candidateBytes = fs.readFileSync(path.join(ROOT, existingPhotos.baselineRecord.path));
const { PROCESSING_PAIR_RECORD_PATH, validateProcessingPhotoPair } = require("./check-research-refresh");
const processingPair = read("content-private/research-refresh/2026-10-09-rehmannia-processing-pair.json");
const { LITERATURE_TRIAGE_RECORD_PATH, validateLiteraturePhotoTriage } = require("./check-research-refresh");
const literatureTriage = read("content-private/research-refresh/2026-10-09-literature-photo-triage.json");
const { TIANDONG_SCREENING_RECORD_PATH, validateTiandongPhotoScreening } = require("./check-research-refresh");
const tiandongScreening = read("content-private/research-refresh/2026-10-09-tiandong-photo-screening.json");
const { OFFICIAL_CAPTURE_RECORD_PATH, validateOfficialDocumentCaptures } = require("./check-research-refresh");
const officialCaptures = read("content-private/research-refresh/2026-10-09-official-document-captures.json");
const { validatePhotoCaptures, checkPhotoCaptureCopies } = require("./check-research-refresh");
const photoCaptures = read("content-private/research-refresh/2026-10-09-photo-captures.json");
const { validatePhotoCapturesBatch2 } = require("./photo-capture-core");
const photoCapturesBatch2 = read("content-private/research-refresh/2026-10-09-photo-captures-batch2.json");
const { validatePhotoCapturesBatch3 } = require("./photo-capture-core");
const photoCapturesBatch3 = read("content-private/research-refresh/2026-10-09-photo-captures-batch3.json");
const { validatePhotoCapturesBatch4 } = require("./photo-capture-core");
const photoCapturesBatch4 = read("content-private/research-refresh/2026-10-09-photo-captures-batch4.json");
const inventoryTool = require("./photo-review-inventory");
const inventory = inventoryTool.deriveInventory();

test("private consolidated inventory binds 19 candidates, 13 originals and one historical copy separately", () => {
  assert.deepEqual(inventoryTool.check(), {
    targetIngredients: 20, candidateRecords: 19, candidateIngredients: 17, fullOriginals: 13,
    fullOriginalIngredients: 12, fullOriginalBytes: 33268745, historicalReviewCopiesOnly: 1,
    noLocalImage: 5, priorityCandidates: 4, unresolvedGaps: 3, publishablePhotos: 0
  });
  assert.equal(inventory.bindings.length, 7);
  assert.equal(new Set(inventory.records.map(r => r.candidateId)).size, 19);
  assert.equal(inventory.catalogSourceAsOf, "2026-08-10");
});

test("consolidation never approves or mutates historical candidates and professional packets", () => {
  inventoryTool.validateInventory(inventory, inventory);
  for (const mutate of [v => { v.publicationEligible = true; }, v => { v.runtimePlacements = ["detail"]; },
    v => { v.professionalPacketModified = true; }, v => { v.doesNotCloseGaps = false; },
    v => { v.catalogSourceAsOf = "2026-10-09"; }, v => { v.records[0].historicalProcessingLabel = "confirmed"; },
    ...["identityReviewState", "partProcessingReviewState", "rightsReviewState", "professionalReviewState"].map(k => v => { v.records[0][k] = "approved"; })]) {
    const v = structuredClone(inventory); mutate(v); assert.throws(() => inventoryTool.validateInventory(v, inventory));
  }
});

test("four priority issues keep peel, pitting, processing and caption uncertainty distinct", () => {
  assert.deepEqual(inventory.records.filter(r => r.concerns.length).map(r => [r.ingredientId, r.concerns]), [
    ["tie-pi-shi-hu", ["requires_processing_recheck"]], ["hua-ju-hong", ["requires_part_recheck"]],
    ["xi-hong-hua", ["requires_caption_recheck"]], ["shan-zhu-yu", ["requires_part_recheck"]]
  ]);
  const v = structuredClone(inventory); v.records.find(r => r.ingredientId === "xi-hong-hua").concerns = [];
  assert.throws(() => inventoryTool.validateInventory(v, inventory));
});

test("historical maidong copy and five empty candidates cannot become downloaded originals", () => {
  const maidong = inventory.records.find(r => r.ingredientId === "mai-dong");
  assert.equal(maidong.localState, "historical_review_copy_only"); assert.equal(maidong.captureEvidence, null);
  assert.equal(maidong.localAsset.width, 768); assert.equal(maidong.localAsset.role, "review_derivative");
  const missing = inventory.records.filter(r => r.localState === "no_local_image");
  assert.equal(missing.length, 5); assert(missing.every(r => !r.localAsset && !r.observation));
  assert.equal(missing.filter(r => r.ingredientId === "du-zhong-ye").length, 2);
  assert(inventory.retrievalIssues.some(r => r.url?.includes("Dried_Ophiopogon") && r.outcome === "http_429_no_local_original"));
  assert.equal(inventory.retrievalIssues[0].outcome, "historical_text_note");
  assert.equal(inventory.retrievalIssues[0].effect, photoCaptures.retrievalIssues[0]);
  assert.equal(inventory.retrievalIssues[0].url, null);
  const v = structuredClone(inventory); v.records.find(r => r.ingredientId === "mai-dong").localState = "full_original";
  assert.throws(() => inventoryTool.validateInventory(v, inventory));
});

test("private overview is deterministic, local-image-only and has no approval or active controls", () => {
  const html = inventoryTool.renderInventory(inventory);
  assert.equal(html, inventoryTool.renderInventory(inventory));
  assert.equal((html.match(/<img /g) || []).length, 14);
  assert.equal((html.match(/<article /g) || []).length, 19);
  assert(!/<(?:script|form|input|button|iframe|svg|object|embed)\b/i.test(html));
  assert(!/<img[^>]+src="(?:https?:|data:|\/\/)/i.test(html));
  assert(html.includes("connect-src 'none'") && html.includes("form-action 'none'"));
  for (const phrase of ["三个缺口仍未关闭", "不是专业审校提交包", "麦冬历史副本不计入13张完整原图", "全部待审", "不新填摄影或上传日期"]) assert(html.includes(phrase));
});

test("overview escapes source and observation text, and rejects unsafe URLs and asset paths", () => {
  const v = structuredClone(inventory), attack = '<script>alert("x")</script>';
  v.records[0].name = attack; v.records[0].observation = attack; v.records[0].source.author = attack;
  v.records[0].localAsset.width = '" onerror="alert(1)';
  const html = inventoryTool.renderInventory(v);
  assert(!html.includes(attack) && !html.includes('width="" onerror=')); assert(html.includes("&lt;script&gt;"));
  for (const p of ["https://example.com/a.jpg", "../outside.jpg", "content-private/research-refresh/../a.jpg", "content-private/research-refresh/photo-originals/a.svg", "content-private/research-refresh/photo-originals/a.jpg?remote"]) assert.throws(() => inventoryTool.localImageUrl(p));
  for (const url of ["javascript:alert(1)", "data:text/html,x", "http://example.com/", "https://user:pass@example.com/"]) assert.throws(() => inventoryTool.sourceLink(url, "source"));
});

test("inventory outputs are immutable and check both destinations before creating either", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "photo-inventory-immutable-"));
  try {
    fs.mkdirSync(path.join(temp, "content-private/research-refresh"), { recursive: true });
    const jsonPath = path.join(temp, inventoryTool.INVENTORY_PATH), htmlPath = path.join(temp, inventoryTool.HTML_PATH);
    fs.writeFileSync(jsonPath, "preserve this unrelated record");
    assert.throws(() => inventoryTool.writeArtifacts(inventory, temp)); assert(!fs.existsSync(htmlPath));
    assert.equal(fs.readFileSync(jsonPath, "utf8"), "preserve this unrelated record");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("identical output reruns preserve bytes and can safely finish an exact partial pair", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "photo-inventory-rerun-"));
  try {
    fs.mkdirSync(path.join(temp, "content-private/research-refresh"), { recursive: true });
    const outputs = inventoryTool.artifacts(inventory);
    fs.writeFileSync(path.join(temp, outputs[0][0]), outputs[0][1]);
    inventoryTool.writeArtifacts(inventory, temp); inventoryTool.writeArtifacts(inventory, temp);
    for (const [p, b] of outputs) assert(fs.readFileSync(path.join(temp, p)).equals(b));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("renamed JSON and HTML inventory copies cannot leak into public runtime", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "photo-inventory-leak-"));
  try {
    const outputs = inventoryTool.artifacts(inventory);
    for (const [, b] of outputs) {
      const target = path.join(temp, "renamed.bin"); fs.writeFileSync(target, b);
      assert.throws(() => inventoryTool.checkRuntimeIsolation(temp, outputs), /copied into public/);
      fs.unlinkSync(target);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("upload-excluded root diagnostics do not exempt nested runtime inventory references", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "photo-inventory-boundary-"));
  try {
    const outputs = inventoryTool.artifacts(inventory);
    fs.mkdirSync(path.join(temp, ".local")); fs.writeFileSync(path.join(temp, ".local/report.json"), outputs[0][1]);
    inventoryTool.checkRuntimeIsolation(temp, outputs);
    fs.mkdirSync(path.join(temp, "pages/.local"), { recursive: true });
    fs.writeFileSync(path.join(temp, "pages/.local/leak.js"), '"photo-review-inventory.1"');
    assert.throws(() => inventoryTool.checkRuntimeIsolation(temp, outputs), /reference entered runtime/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("fourth batch binds three originals without rebinding prior captures or historical catalog", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4); validatePhotoCapturesBatch3(photoCapturesBatch3);
  validatePhotoCapturesBatch2(photoCapturesBatch2); validatePhotoCaptures(photoCaptures);
  assert.equal(photoCapturesBatch4.photoCaptures.length, 3);
  assert.equal(photoCapturesBatch4.photoCaptures.reduce((sum, x) => sum + x.capture.bytes, 0), 6902767);
});

test("fourth batch keeps all approval, publication and metadata boundaries pending", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  for (const mutate of [v => { v.publicationEligible = true; }, v => { v.runtimePlacements = ["detail"]; },
    v => { v.doesNotCloseGaps = false; }, v => { v.photoCaptures[0].capture.publicDerivativeAvailable = true; },
    v => { v.photoCaptures[0].capture.originalMetadataRetained = false; },
    ...["identityReviewState", "partProcessingReviewState", "rightsReviewState", "professionalReviewState"].map(key => v => { v.photoCaptures[0][key] = "approved"; })]) {
    const v = structuredClone(photoCapturesBatch4); mutate(v); assert.throws(() => validatePhotoCapturesBatch4(v));
  }
});

test("fourth batch rejects swapped candidates, paths, dimensions, previous hashes and extra fields", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  for (const mutate of [v => { v.photoCaptures.reverse(); }, v => { v.photoCaptures[0].ingredientId = "ling-zhi"; },
    v => { v.photoCaptures[0].capture.path = "../../outside.jpg"; }, v => { v.photoCaptures[1].capture.width = 1920; },
    v => { v.photoCaptures[0].capture.sha1 = "0".repeat(40); }, v => { v.baseline.previousCaptureSha256 = "sha256:" + "0".repeat(64); },
    v => { v.baseline.catalogPath = "data/ingredients.js"; }, v => { v.photoCaptures[0].extra = true; }]) {
    const v = structuredClone(photoCapturesBatch4); mutate(v); assert.throws(() => validatePhotoCapturesBatch4(v));
  }
});

test("fourth batch verifies actual binary bytes and unchanged local gallery", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  const loader = p => fs.readFileSync(path.join(ROOT, p));
  for (const item of photoCapturesBatch4.photoCaptures) {
    assert.throws(() => validatePhotoCapturesBatch4(photoCapturesBatch4, p => {
      const b = Buffer.from(loader(p)); if (p === item.capture.path) b[200] ^= 1; return b;
    }));
    assert.throws(() => validatePhotoCapturesBatch4(photoCapturesBatch4, p => { if (p === item.capture.path) throw Error("missing fixture"); return loader(p); }));
  }
  assert.throws(() => validatePhotoCapturesBatch4(photoCapturesBatch4, p => {
    const b = loader(p); return p.endsWith("photo-captures-batch4-review.html") ? Buffer.concat([b, Buffer.from("<script></script>")]) : b;
  }));
});

test("fourth batch separates photographed and uploaded dates, source versions and scaled AI observations", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  for (const mutate of [v => { v.photoCaptures[1].sourceObservation.uploadedAt = "2026-02-14"; },
    v => { v.photoCaptures[2].sourceObservation.photographedAtDeclared = "2015-04-21"; },
    v => { v.photoCaptures[0].sourceObservation.pageRevision = "0"; },
    v => { v.photoCaptures[1].sourceObservation.page = v.photoCaptures[2].sourceObservation.page; },
    v => { v.photoCaptures[0].visualObservation.observer = "professional_reviewer"; },
    v => { v.photoCaptures[1].visualObservation.displayWidth = 3253; }]) {
    const v = structuredClone(photoCapturesBatch4); mutate(v); assert.throws(() => validatePhotoCapturesBatch4(v));
  }
});

test("tiepi processing uncertainty and saffron caption mismatch cannot become part or context approval", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  assert.equal(photoCapturesBatch4.photoCaptures[0].partAlignmentConcern, "requires_processing_recheck");
  assert.equal(photoCapturesBatch4.photoCaptures[2].sourceCaptionConcern, "requires_caption_recheck");
  for (const mutate of [v => { v.photoCaptures[0].partAlignmentConcern = "unverified"; },
    v => { v.photoCaptures[2].sourceCaptionConcern = "aligned"; }, v => { delete v.photoCaptures[2].sourceCaptionConcern; },
    v => { v.photoCaptures[2].visualObservation.description = ""; }, v => { v.photoCaptures[0].limitations = []; }]) {
    const v = structuredClone(photoCapturesBatch4); mutate(v); assert.throws(() => validatePhotoCapturesBatch4(v));
  }
});

test("maidong thumbnail and blocked PMC pages do not become successfully acquired originals", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  assert(!photoCapturesBatch4.photoCaptures.some(x => ["mai-dong", "du-zhong-ye"].includes(x.ingredientId)));
  for (const mutate of [v => { v.retrievalIssues.shift(); }, v => { v.retrievalIssues[0].outcome = "captured"; },
    v => { v.retrievalIssues[1].outcome = "full_file_page_read"; }, v => { v.retrievalIssues[2].outcome = "article_read"; },
    v => { v.photoCaptures.push(structuredClone(v.photoCaptures[0])); }]) {
    const v = structuredClone(photoCapturesBatch4); mutate(v); assert.throws(() => validatePhotoCapturesBatch4(v));
  }
});

test("fourth batch references and renamed originals remain outside public runtime", () => {
  validatePhotoCapturesBatch4(photoCapturesBatch4);
  for (const item of photoCapturesBatch4.photoCaptures) for (const token of [item.id, item.capture.path, item.sourceObservation.page]) {
    assert(forbiddenTokens(photoCapturesBatch4).includes(token)); assert.throws(() => validateRuntimeText(token, photoCapturesBatch4));
  }
  checkRuntime(ROOT, photoCapturesBatch4); checkPhotoCaptureCopies(ROOT, photoCapturesBatch4);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-photo-batch4-leak-test-"));
  const target = path.join(directory, "renamed.dat");
  try {
    fs.copyFileSync(path.join(ROOT, photoCapturesBatch4.photoCaptures[0].capture.path), target);
    assert.throws(() => checkPhotoCaptureCopies(directory, photoCapturesBatch4));
  } finally { if (fs.existsSync(target)) fs.unlinkSync(target); fs.rmdirSync(directory); }
});

test("third batch binds three originals and preserves both previous batches and catalog", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  assert.equal(photoCapturesBatch3.photoCaptures.length, 3);
  assert.equal(photoCapturesBatch3.photoCaptures.reduce((sum, x) => sum + x.capture.bytes, 0), 7321440);
  validatePhotoCapturesBatch2(photoCapturesBatch2); validatePhotoCaptures(photoCaptures);
});

test("third batch never grants publication, identity, processing, rights or professional approval", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  for (const mutate of [
    v => { v.publicationEligible = true; }, v => { v.runtimePlacements = ["detail"]; }, v => { v.doesNotCloseGaps = false; },
    ...["identityReviewState", "partProcessingReviewState", "rightsReviewState", "professionalReviewState"].map(key => v => { v.photoCaptures[0][key] = "reviewed"; }),
    v => { v.photoCaptures[0].capture.publicDerivativeAvailable = true; }, v => { v.photoCaptures[0].capture.originalMetadataRetained = false; }
  ]) { const v = structuredClone(photoCapturesBatch3); mutate(v); assert.throws(() => validatePhotoCapturesBatch3(v)); }
});

test("third batch refuses candidate swaps, paths, dimensions, baseline changes and unknown fields", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  for (const mutate of [
    v => { v.photoCaptures.reverse(); }, v => { v.photoCaptures[0].ingredientId = "cao-guo"; },
    v => { v.photoCaptures[0].capture.path = "../../outside.jpg"; }, v => { v.photoCaptures[0].capture.width = 960; },
    v => { v.photoCaptures[0].capture.sha1 = "0".repeat(40); }, v => { v.baseline.previousCaptureSha256 = "sha256:" + "0".repeat(64); },
    v => { v.baseline.catalogPath = "data/ingredients.js"; }, v => { v.photoCaptures[0].extra = true; }
  ]) { const v = structuredClone(photoCapturesBatch3); mutate(v); assert.throws(() => validatePhotoCapturesBatch3(v)); }
});

test("third batch checks actual original bytes and gallery contents, not hashes in JSON alone", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  const loader = p => fs.readFileSync(path.join(ROOT, p));
  for (const item of photoCapturesBatch3.photoCaptures) {
    assert.throws(() => validatePhotoCapturesBatch3(photoCapturesBatch3, p => {
      const b = Buffer.from(loader(p)); if (p === item.capture.path) b[200] ^= 1; return b;
    }));
    assert.throws(() => validatePhotoCapturesBatch3(photoCapturesBatch3, p => { if (p === item.capture.path) throw Error("missing fixture"); return loader(p); }));
  }
  assert.throws(() => validatePhotoCapturesBatch3(photoCapturesBatch3, p => {
    const b = loader(p); return p.endsWith("photo-captures-batch3-review.html") ? Buffer.concat([b, Buffer.from("<script></script>")]) : b;
  }));
});

test("third batch preserves source dates, specific file versions and original-resolution observation", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  assert.equal(photoCapturesBatch3.photoCaptures[0].visualObservation.basis, "local_original_viewed_at_original_resolution");
  for (const mutate of [
    v => { v.photoCaptures[0].sourceObservation.uploadedAt = "2016-11-30"; },
    v => { v.photoCaptures[0].sourceObservation.pageRevision = "0"; },
    v => { v.photoCaptures[1].sourceObservation.page = v.photoCaptures[2].sourceObservation.page; },
    v => { v.photoCaptures[0].visualObservation.basis = "local_original_viewed_at_scaled_resolution"; },
    v => { v.photoCaptures[1].visualObservation.displayWidth = 3000; },
    v => { v.photoCaptures[0].visualObservation.observer = "professional_reviewer"; }
  ]) { const v = structuredClone(photoCapturesBatch3); mutate(v); assert.throws(() => validatePhotoCapturesBatch3(v)); }
});

test("shanzhuyu unknown pitting status cannot become approved fruit flesh", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  assert.equal(photoCapturesBatch3.photoCaptures[2].partAlignmentConcern, "requires_part_recheck");
  for (const mutate of [v => { v.photoCaptures[2].partAlignmentConcern = "aligned"; },
    v => { v.photoCaptures[0].visualObservation.description = ""; }, v => { v.metadataWarning = ""; }]) {
    const v = structuredClone(photoCapturesBatch3); mutate(v); assert.throws(() => validatePhotoCapturesBatch3(v));
  }
});

test("third batch preserves TLS failure and biba 429 without counting failed downloads as photos", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  assert.equal(photoCapturesBatch3.retrievalIssues.filter(x => x.outcome === "http_429_no_local_file").length, 1);
  assert(!photoCapturesBatch3.photoCaptures.some(x => x.ingredientId === "bi-ba"));
  for (const mutate of [v => { v.retrievalIssues.shift(); }, v => { v.retrievalIssues[1].outcome = "captured"; },
    v => { v.photoCaptures.push(structuredClone(v.photoCaptures[0])); }]) {
    const v = structuredClone(photoCapturesBatch3); mutate(v); assert.throws(() => validatePhotoCapturesBatch3(v));
  }
});

test("third batch references and renamed original bytes cannot enter public runtime", () => {
  validatePhotoCapturesBatch3(photoCapturesBatch3);
  for (const item of photoCapturesBatch3.photoCaptures) for (const token of [item.id, item.capture.path, item.sourceObservation.page]) {
    assert(forbiddenTokens(photoCapturesBatch3).includes(token)); assert.throws(() => validateRuntimeText(token, photoCapturesBatch3));
  }
  checkRuntime(ROOT, photoCapturesBatch3); checkPhotoCaptureCopies(ROOT, photoCapturesBatch3);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-photo-batch3-leak-test-"));
  const target = path.join(directory, "renamed.dat");
  try {
    fs.copyFileSync(path.join(ROOT, photoCapturesBatch3.photoCaptures[0].capture.path), target);
    assert.throws(() => checkPhotoCaptureCopies(directory, photoCapturesBatch3));
  } finally { if (fs.existsSync(target)) fs.unlinkSync(target); fs.rmdirSync(directory); }
});

test("second batch binds four originals without changing the first batch or historical catalog", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  assert.equal(photoCapturesBatch2.photoCaptures.length, 4);
  assert.equal(photoCapturesBatch2.photoCaptures.reduce((sum, x) => sum + x.capture.bytes, 0), 12186772);
  validatePhotoCaptures(photoCaptures);
});

test("second batch cannot upgrade pending observations into publication or professional approval", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  for (const mutate of [
    (v) => { v.publicationEligible = true; }, (v) => { v.runtimePlacements = ["detail"]; }, (v) => { v.doesNotCloseGaps = false; },
    ...["identityReviewState", "partProcessingReviewState", "rightsReviewState", "professionalReviewState"].map(key => v => { v.photoCaptures[0][key] = "reviewed"; }),
    (v) => { v.photoCaptures[0].capture.publicDerivativeAvailable = true; }, (v) => { v.photoCaptures[0].capture.originalMetadataRetained = false; }
  ]) { const v = structuredClone(photoCapturesBatch2); mutate(v); assert.throws(() => validatePhotoCapturesBatch2(v)); }
});

test("second batch refuses swapped candidates, paths, dimensions, digests and baseline", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  for (const mutate of [
    (v) => { v.photoCaptures.reverse(); }, (v) => { v.photoCaptures[0].ingredientId = "dang-gui"; },
    (v) => { v.photoCaptures[0].capture.path = "../../outside.jpg"; }, (v) => { v.photoCaptures[2].capture.height = 3024; },
    (v) => { v.photoCaptures[0].capture.sha1 = "0".repeat(40); }, (v) => { v.baseline.previousCaptureSha256 = "sha256:" + "0".repeat(64); },
    (v) => { v.baseline.catalogPath = "data/ingredients.js"; }, (v) => { v.extra = true; }
  ]) { const v = structuredClone(photoCapturesBatch2); mutate(v); assert.throws(() => validatePhotoCapturesBatch2(v)); }
});

test("second batch checks actual image bytes and unchanged local gallery rather than recorded hashes alone", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  const loader = p => fs.readFileSync(path.join(ROOT, p));
  for (const item of photoCapturesBatch2.photoCaptures) {
    assert.throws(() => validatePhotoCapturesBatch2(photoCapturesBatch2, p => {
      const b = Buffer.from(loader(p)); if (p === item.capture.path) b[200] ^= 1; return b;
    }));
    assert.throws(() => validatePhotoCapturesBatch2(photoCapturesBatch2, p => { if (p === item.capture.path) throw Error("missing fixture"); return loader(p); }));
  }
  assert.throws(() => validatePhotoCapturesBatch2(photoCapturesBatch2, p => {
    const b = loader(p); return p.endsWith("photo-captures-batch2-review.html") ? Buffer.concat([b, Buffer.from("<script></script>")]) : b;
  }));
});

test("source upload dates and direct fetch failure cannot be silently rewritten", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  for (const mutate of [
    (v) => { v.photoCaptures[0].sourceObservation.basis = "full_file_page_read"; },
    (v) => { v.photoCaptures[1].sourceObservation.uploadedAt = "2024-10-12"; },
    (v) => { v.photoCaptures[3].sourceObservation.photographedAtDeclared = "2024-08-18"; },
    (v) => { v.photoCaptures[0].sourceObservation.pageRevision = "0"; },
    (v) => { v.photoCaptures[1].sourceObservation.page = v.photoCaptures[3].sourceObservation.page; }
  ]) { const v = structuredClone(photoCapturesBatch2); mutate(v); assert.throws(() => validatePhotoCapturesBatch2(v)); }
});

test("visible huajuhong thick slices remain a part-recheck concern rather than outer-peel approval", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  assert.equal(photoCapturesBatch2.photoCaptures[2].partAlignmentConcern, "requires_part_recheck");
  for (const mutate of [
    (v) => { v.photoCaptures[2].partAlignmentConcern = "aligned"; },
    (v) => { v.photoCaptures[0].visualObservation.observer = "professional_reviewer"; },
    (v) => { v.photoCaptures[0].visualObservation.displayWidth = 3008; },
    (v) => { v.photoCaptures[0].visualObservation.description = ""; }
  ]) { const v = structuredClone(photoCapturesBatch2); mutate(v); assert.throws(() => validatePhotoCapturesBatch2(v)); }
});

test("429 retrieval failures remain failures and do not add photo captures", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  assert.equal(photoCapturesBatch2.retrievalIssues.filter(x => x.outcome === "http_429_no_local_file").length, 2);
  for (const mutate of [
    (v) => { v.retrievalIssues.shift(); }, (v) => { v.retrievalIssues[0].outcome = "captured"; },
    (v) => { v.photoCaptures.push(structuredClone(v.photoCaptures[0])); }
  ]) { const v = structuredClone(photoCapturesBatch2); mutate(v); assert.throws(() => validatePhotoCapturesBatch2(v)); }
});

test("second batch source URLs and local bytes remain outside public runtime even when renamed", () => {
  validatePhotoCapturesBatch2(photoCapturesBatch2);
  for (const item of photoCapturesBatch2.photoCaptures) for (const token of [item.id, item.capture.path, item.sourceObservation.page]) {
    assert(forbiddenTokens(photoCapturesBatch2).includes(token)); assert.throws(() => validateRuntimeText(token, photoCapturesBatch2));
  }
  checkRuntime(ROOT, photoCapturesBatch2); checkPhotoCaptureCopies(ROOT, photoCapturesBatch2);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-photo-batch2-leak-test-"));
  const target = path.join(directory, "renamed.dat");
  try {
    fs.copyFileSync(path.join(ROOT, photoCapturesBatch2.photoCaptures[2].capture.path), target);
    assert.throws(() => checkPhotoCaptureCopies(directory, photoCapturesBatch2));
  } finally { if (fs.existsSync(target)) fs.unlinkSync(target); fs.rmdirSync(directory); }
});

test("three captured originals bind local bytes, historical candidates and source metadata", () => {
  validatePhotoCaptures(photoCaptures);
  assert.equal(photoCaptures.photoCaptures.length, 3);
  assert.equal(photoCaptures.photoCaptures.reduce((sum, item) => sum + item.capture.bytes, 0), 6857766);
});

test("captured photo observation never grants identity, processing, rights or professional approval", () => {
  validatePhotoCaptures(photoCaptures);
  for (const mutate of [
    (v) => { v.publicationEligible = true; }, (v) => { v.runtimePlacements = ["detail"]; },
    (v) => { v.doesNotCloseGaps = false; },
    ...["identityReviewState", "partProcessingReviewState", "rightsReviewState", "professionalReviewState"].map((key) => (v) => { v.photoCaptures[0][key] = "reviewed"; }),
    (v) => { v.photoCaptures[0].capture.publicDerivativeAvailable = true; },
    (v) => { v.photoCaptures[0].capture.originalMetadataRetained = false; }
  ]) { const v = structuredClone(photoCaptures); mutate(v); assert.throws(() => validatePhotoCaptures(v)); }
});

test("capture path, candidate, original dimensions and baseline cannot be rebound", () => {
  validatePhotoCaptures(photoCaptures);
  for (const mutate of [
    (v) => { v.photoCaptures.reverse(); }, (v) => { v.photoCaptures[0].candidateId = v.photoCaptures[1].candidateId; },
    (v) => { v.photoCaptures[0].previousObservationId = v.photoCaptures[1].previousObservationId; },
    (v) => { v.photoCaptures[0].capture.path = "../outside.jpg"; },
    (v) => { v.photoCaptures[0].capture.width = 960; }, (v) => { v.photoCaptures[0].capture.sha256 = v.photoCaptures[1].capture.sha256; },
    (v) => { v.baseline.catalogSha256 = "sha256:" + "0".repeat(64); },
    (v) => { v.baseline.metadataPath = "data/ingredients.js"; }, (v) => { v.unrecognized = true; }
  ]) { const v = structuredClone(photoCaptures); mutate(v); assert.throws(() => validatePhotoCaptures(v)); }
});

test("photo captures reject substituted and missing bytes rather than trusting recorded digests", () => {
  validatePhotoCaptures(photoCaptures);
  const loader = (p) => fs.readFileSync(path.join(ROOT, p));
  for (const item of photoCaptures.photoCaptures) {
    assert.throws(() => validatePhotoCaptures(photoCaptures, (p) => {
      if (p !== item.capture.path) return loader(p);
      const b = Buffer.from(loader(p)); b[200] ^= 1; return b;
    }));
    assert.throws(() => validatePhotoCaptures(photoCaptures, (p) => { if (p === item.capture.path) throw Error("missing fixture"); return loader(p); }));
  }
});

test("scaled AI observation cannot become human expertise or a full-resolution pixel review", () => {
  validatePhotoCaptures(photoCaptures);
  for (const mutate of [
    (v) => { v.photoCaptures[0].visualObservation.observer = "professional_reviewer"; },
    (v) => { v.photoCaptures[0].visualObservation.basis = "all_original_pixels_reviewed"; },
    (v) => { v.photoCaptures[0].visualObservation.displayWidth = 4000; },
    (v) => { v.photoCaptures[0].visualObservation.description = ""; }
  ]) { const v = structuredClone(photoCaptures); mutate(v); assert.throws(() => validatePhotoCaptures(v)); }
});

test("capture identifiers and original file paths remain excluded from actual runtime text", () => {
  validatePhotoCaptures(photoCaptures);
  for (const item of photoCaptures.photoCaptures) for (const token of [item.id, item.capture.path]) {
    assert(forbiddenTokens(photoCaptures).includes(token));
    assert.throws(() => validateRuntimeText(`fixture ${token}`, photoCaptures));
  }
  checkRuntime(ROOT, photoCaptures);
});

test("unchanged originals with retained metadata cannot be copied into public runtime under another filename", () => {
  validatePhotoCaptures(photoCaptures); checkPhotoCaptureCopies(ROOT, photoCaptures);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-photo-leak-test-"));
  const target = path.join(directory, "renamed.dat");
  try {
    fs.copyFileSync(path.join(ROOT, photoCaptures.photoCaptures[0].capture.path), target);
    assert.throws(() => checkPhotoCaptureCopies(directory, photoCaptures));
  } finally { fs.unlinkSync(target); fs.rmdirSync(directory); }
});
function rejectsCapture(mutate) {
  const value = JSON.parse(JSON.stringify(officialCaptures)); mutate(value);
  assert.throws(() => validateOfficialDocumentCaptures(value));
}
test("official captures bind two real private PDFs and the unchanged historical catalog", () => {
  assert.equal(OFFICIAL_CAPTURE_RECORD_PATH, "content-private/research-refresh/2026-10-09-official-document-captures.json");
  validateOfficialDocumentCaptures(officialCaptures);
  assert.equal(officialCaptures.documents.reduce((sum, item) => sum + item.capture.physicalPagesRead.length, 0), 5);
});
test("captured documents cannot silently become current directory or professional publication approval", () => {
  validateOfficialDocumentCaptures(officialCaptures);
  for (const mutate of [
    (v) => { v.directoryAuditComplete = true; },
    (v) => { v.publicationEligible = true; },
    (v) => { v.runtimePlacements = ["detail"]; },
    (v) => { v.professionalReviewState = "reviewed"; },
    (v) => { v.baseline.catalogSourceAsOf = "2026-10-09"; },
    (v) => { v.baseline.catalogSha256 = "sha256:" + "0".repeat(64); },
    (v) => { v.documents[0].approved = true; }
  ]) rejectsCapture(mutate);
});
test("captured source role and signed date cannot be replaced by file metadata or reprint publication", () => {
  validateOfficialDocumentCaptures(officialCaptures);
  rejectsCapture((v) => { v.documents[0].source.signedAt = "2025-01-06"; });
  rejectsCapture((v) => { v.documents[1].source.signedAt = "2025-12-11"; });
  rejectsCapture((v) => { v.documents[1].source.role = "national_issuer_gazette"; });
  rejectsCapture((v) => { v.documents[1].source.webPublishedAt = "2025-12-03"; });
  rejectsCapture((v) => { v.documents[1].classification = "national_directory_addition"; });
});
test("capture review covers only the recorded actual pages and never counts as food-photo review", () => {
  validateOfficialDocumentCaptures(officialCaptures);
  rejectsCapture((v) => { v.documents[0].capture.physicalPagesRead = Array.from({ length: 17 }, (_, i) => i + 1); });
  rejectsCapture((v) => { v.documents[1].capture.physicalPagesRead = [1]; });
  rejectsCapture((v) => { v.documents[0].capture.printedPageLabels = ["3"]; });
  rejectsCapture((v) => { v.documents[1].capture.reviewedAsFoodPhoto = true; });
});
test("four original rows and thirty import rows retain exact names and selected part/processing distinctions", () => {
  validateOfficialDocumentCaptures(officialCaptures);
  rejectsCapture((v) => { v.documents[0].evidence.rowCount = 5; });
  rejectsCapture((v) => { v.documents[1].evidence.names[21] = "杏仁（甜、苦）"; });
  rejectsCapture((v) => { v.documents[0].evidence.selectedParts[0].processingLabel = "干燥"; });
  rejectsCapture((v) => { v.documents[1].evidence.selectedParts[1].part = "果实"; });
  rejectsCapture((v) => { v.documents[1].evidence.selectedParts[5].processingLabel = "任意成熟程度"; });
});
test("capture bytes and fixed private paths cannot be swapped or rebound by changing metadata", () => {
  validateOfficialDocumentCaptures(officialCaptures);
  rejectsCapture((v) => { v.documents[0].capture.path = "../../project.config.json"; });
  rejectsCapture((v) => { v.documents[0].capture.sha256 = v.documents[1].capture.sha256; });
  rejectsCapture((v) => { v.documents[0].capture.bytes += 1; });
  assert.throws(() => validateOfficialDocumentCaptures(officialCaptures, () => Buffer.from("%PDF-not-the-captured-file")));
  assert.throws(() => validateOfficialDocumentCaptures(officialCaptures, () => { throw new Error("missing capture"); }));
});
test("captured source IDs URLs and binary references remain forbidden in runtime", () => {
  validateOfficialDocumentCaptures(officialCaptures);
  for (const item of officialCaptures.documents) for (const token of [item.id, item.source.url, item.capture.path]) {
    assert(forbiddenTokens(officialCaptures).includes(token));
    assert.throws(() => validateRuntimeText(token, officialCaptures));
  }
  checkRuntime(ROOT, officialCaptures);
});
function rejectsTiandong(mutate) {
  const value = JSON.parse(JSON.stringify(tiandongScreening)); mutate(value);
  assert.throws(() => validateTiandongPhotoScreening(value, candidateBytes));
}
test("tiandong screening binds the existing gap without changing historical catalog bytes", () => {
  assert.equal(TIANDONG_SCREENING_RECORD_PATH, "content-private/research-refresh/2026-10-09-tiandong-photo-screening.json");
  validateTiandongPhotoScreening(tiandongScreening, candidateBytes);
  assert.throws(() => validateTiandongPhotoScreening(tiandongScreening, Buffer.concat([candidateBytes, Buffer.from(" ")])));
  rejectsTiandong((v) => { v.literaturePhotoObservations.reverse(); });
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].catalogReferenceId = "food-form-gap-di-huang-v01"; });
});
test("unspecified CC BY version stays unspecified rather than borrowing another source permission", () => {
  validateTiandongPhotoScreening(tiandongScreening, candidateBytes);
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].media.licenseName = "CC BY 4.0"; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].media.licenseUrl = "https://creativecommons.org/licenses/by/4.0/"; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[1].media.licenseName = "public domain"; });
});
test("field attribution cannot approve the sample panel or turn microscopy into a food photo", () => {
  validateTiandongPhotoScreening(tiandongScreening, candidateBytes);
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].evidence.panelMeanings[2] = "e：Tong Zhang拍摄的已去心可食天冬"; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].evidence.methodCaptionAlignment = "resolved"; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[1].disposition = v.literaturePhotoObservations[0].disposition; });
});
test("missing pixels sample identity and approvals cannot silently become verified", () => {
  validateTiandongPhotoScreening(tiandongScreening, candidateBytes);
  for (let i = 0; i < 2; i += 1) {
    for (const [field, value] of [["visualReviewState", "reviewed"], ["localAssetAvailable", true], ["bytes", 1], ["sha256", "sha256:" + "a".repeat(64)], ["imageUrl", "https://example.org/photo.jpg"]])
      rejectsTiandong((v) => { v.literaturePhotoObservations[i].media[field] = value; });
    for (const field of ["foodIdentityConfirmed", "foodProcessingApproved"]) rejectsTiandong((v) => { v.literaturePhotoObservations[i].evidence[field] = true; });
    for (const [field, value] of [["publicationEligible", true], ["professionalReviewState", "reviewed"], ["rightsReviewState", "reviewed"], ["aiAltTextUsedAsVisualEvidence", true], ["runtimePlacements", ["detail"]]])
      rejectsTiandong((v) => { v.literaturePhotoObservations[i][field] = value; });
  }
  rejectsTiandong((v) => { v.publicationEligible = true; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].approved = true; });
});
test("source dates locators and failed retrieval evidence cannot be rebound", () => {
  validateTiandongPhotoScreening(tiandongScreening, candidateBytes);
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].source.publishedAt = "2026-10-09"; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].media.pdfPage1Based = 1; });
  rejectsTiandong((v) => { v.literaturePhotoObservations[0].source.url = "https://user:password@onlinelibrary.wiley.com/private"; });
  rejectsTiandong((v) => { v.retrievalIssues[0].outcome = "image_reviewed"; });
});
test("new tiandong source identifiers and PDF links remain absent from runtime", () => {
  validateTiandongPhotoScreening(tiandongScreening, candidateBytes);
  for (const item of tiandongScreening.literaturePhotoObservations)
    for (const token of [item.id, item.source.url, item.source.doi, item.media.pdfUrl].filter(Boolean)) {
      assert(forbiddenTokens(tiandongScreening).includes(token));
      assert.throws(() => validateRuntimeText(token, tiandongScreening));
    }
  checkRuntime(ROOT, tiandongScreening);
});
function rejectsTriage(mutate) {
  const value = JSON.parse(JSON.stringify(literatureTriage)); mutate(value);
  assert.throws(() => validateLiteraturePhotoTriage(value, candidateBytes));
}
test("literature photo triage preserves the catalog and source-specific dispositions", () => {
  assert.equal(LITERATURE_TRIAGE_RECORD_PATH, "content-private/research-refresh/2026-10-09-literature-photo-triage.json");
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  assert.throws(() => validateLiteraturePhotoTriage(literatureTriage, Buffer.concat([candidateBytes, Buffer.from(" ")])));
  rejectsTriage((v) => { v.literaturePhotoObservations.reverse(); });
  rejectsTriage((v) => { v.literaturePhotoObservations[0].catalogReferenceId = "food-form-gap-di-huang-v01"; });
});
test("an open-access label cannot upgrade restricted literature photo permissions", () => {
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  for (const field of ["licenseName", "licenseUrl"]) rejectsTriage((v) => {
    v.literaturePhotoObservations[1].media[field] = v.literaturePhotoObservations[0].media[field];
  });
  rejectsTriage((v) => { v.literaturePhotoObservations[1].disposition = "processing_photo_lead_visual_pending"; });
});
test("figure labels retain experimental culture and non-photographic exclusions", () => {
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  rejectsTriage((v) => { v.literaturePhotoObservations[0].evidence.panelMeanings.reverse(); });
  rejectsTriage((v) => { v.literaturePhotoObservations[0].evidence.methodCaptionAlignment = "resolved"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[1].evidence.panelMeanings[1] = "B：可食用地黄切片"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[2].disposition = "processing_photo_lead_visual_pending"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[2].media.imageUrl = v.literaturePhotoObservations[0].media.imageUrl; });
});
test("source publication version and research dates remain distinct", () => {
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  rejectsTriage((v) => { v.literaturePhotoObservations[1].source.publishedAt = "2026-03-20"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[1].source.versionOfRecordAt = "2026-02-13"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[0].source.doi = v.literaturePhotoObservations[1].source.doi; });
  rejectsTriage((v) => { v.literaturePhotoObservations[0].source.contentSha256 = "sha256:" + "a".repeat(64); });
});
test("source-reported sample relationships and vouchers are not independent batch verification", () => {
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  for (const item of literatureTriage.literaturePhotoObservations) assert.equal(item.evidence.basis, "source_text_only");
  rejectsTriage((v) => { v.literaturePhotoObservations[0].evidence.sampleRelation = "same_batch_verified"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[2].evidence.sampleRelation = "same_batch_verified"; });
  rejectsTriage((v) => { v.literaturePhotoObservations[1].evidence.voucherReference = "verified-food-batch"; });
});
test("readable PDF text and failed screenshots cannot become image or publishing approval", () => {
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  for (let i = 0; i < 3; i += 1) {
    for (const [field, value] of [["visualReviewState", "reviewed"], ["localAssetAvailable", true], ["bytes", 1000], ["sha256", "sha256:" + "a".repeat(64)]])
      rejectsTriage((v) => { v.literaturePhotoObservations[i].media[field] = value; });
    for (const field of ["foodIdentityConfirmed", "foodProcessingApproved"]) rejectsTriage((v) => { v.literaturePhotoObservations[i].evidence[field] = true; });
    for (const [field, value] of [["publicationEligible", true], ["rightsReviewState", "reviewed"], ["professionalReviewState", "reviewed"],
      ["aiAltTextUsedAsVisualEvidence", true], ["runtimePlacements", ["detail"]]]) rejectsTriage((v) => { v.literaturePhotoObservations[i][field] = value; });
  }
  rejectsTriage((v) => { v.publicationEligible = true; });
  rejectsTriage((v) => { v.retrievalIssues[1].outcome = "image_reviewed"; });
});
test("new literature identifiers figures PDF links and voucher stay private", () => {
  validateLiteraturePhotoTriage(literatureTriage, candidateBytes);
  const tokens = forbiddenTokens(literatureTriage);
  for (const item of literatureTriage.literaturePhotoObservations)
    for (const token of [item.id, item.source.url, item.source.doi, item.media.imageUrl, item.media.pdfUrl, item.evidence.voucherReference].filter(Boolean)) {
      assert(tokens.includes(token)); assert.throws(() => validateRuntimeText(JSON.stringify({ source: token }), literatureTriage));
    }
  rejectsTriage((v) => { v.literaturePhotoObservations[0].source.url = "https://user:secret@www.frontiersin.org/private"; });
});
function rejectsPair(mutate) {
  const value = JSON.parse(JSON.stringify(processingPair)); mutate(value);
  assert.throws(() => validateProcessingPhotoPair(value, candidateBytes));
}
test("processing photo labels bind the unchanged catalog and preserve two distinct files", () => {
  assert.equal(PROCESSING_PAIR_RECORD_PATH, "content-private/research-refresh/2026-10-09-rehmannia-processing-pair.json");
  validateProcessingPhotoPair(processingPair, candidateBytes);
  assert.throws(() => validateProcessingPhotoPair(processingPair, Buffer.concat([candidateBytes, Buffer.from(" ")])));
  rejectsPair((v) => { v.processingPhotoObservations.reverse(); });
  rejectsPair((v) => { v.processingPhotoObservations[1].media.imageUrl = v.processingPhotoObservations[0].media.imageUrl; });
});
test("dried and prepared titles cannot become verified processing or a paired experiment", () => {
  validateProcessingPhotoPair(processingPair, candidateBytes);
  for (const field of Object.keys(processingPair.comparisonLimits)) rejectsPair((v) => { v.comparisonLimits[field] = true; });
  rejectsPair((v) => { v.processingPhotoObservations[1].processingLabelState = "dried_as_titled_not_verified"; });
  rejectsPair((v) => { v.processingPhotoObservations[0].processingIdentityConfirmed = true; });
});
test("processing photo creation upload revision and license statements cannot be conflated", () => {
  validateProcessingPhotoPair(processingPair, candidateBytes);
  for (const field of ["createdAt", "uploadedAt", "pageModifiedAt"]) rejectsPair((v) => { v.processingPhotoObservations[0].source[field] = "2026-10-09"; });
  rejectsPair((v) => { v.processingPhotoObservations[0].source.permanentUrl += "&redirect=no"; });
  rejectsPair((v) => { v.processingPhotoObservations[1].source.licenseName = "CC0"; });
});
test("rounded webpage sizes and empty image references do not prove bytes or visual review", () => {
  validateProcessingPhotoPair(processingPair, candidateBytes);
  for (const [field, value] of [["exactBytes", 112000], ["sha256", "sha256:" + "a".repeat(64)], ["localAssetAvailable", true], ["visualReviewState", "reviewed"]]) {
    rejectsPair((v) => { v.processingPhotoObservations[0].media[field] = value; });
  }
  rejectsPair((v) => { v.retrievalIssues[0].outcome = "image_reviewed"; });
});
test("processing photo leads cannot approve identity rights professional review or publication", () => {
  validateProcessingPhotoPair(processingPair, candidateBytes);
  for (const [field, value] of [["foodIdentityConfirmed", true], ["doesNotCloseGap", false], ["publicationEligible", true],
    ["aiAltTextUsedAsVisualEvidence", true], ["rightsReviewState", "reviewed"], ["professionalReviewState", "reviewed"], ["runtimePlacements", ["detail"]]]) {
    rejectsPair((v) => { v.processingPhotoObservations[0][field] = value; });
  }
  rejectsPair((v) => { v.publicationEligible = true; });
});
test("all processing-pair source identifiers and media links remain excluded from runtime", () => {
  validateProcessingPhotoPair(processingPair, candidateBytes);
  const tokens = forbiddenTokens(processingPair);
  for (const item of processingPair.processingPhotoObservations) for (const token of [item.id, item.source.url, item.source.permanentUrl, item.media.imageUrl]) {
    assert(tokens.includes(token)); assert.throws(() => validateRuntimeText(JSON.stringify({ source: token }), processingPair));
  }
  rejectsPair((v) => { v.processingPhotoObservations[0].source.url = "https://user:secret@commons.wikimedia.org/x"; });
});
function rejectsExisting(mutate) {
  const value = JSON.parse(JSON.stringify(existingPhotos)); mutate(value);
  assert.throws(() => validateExistingPhotoMetadata(value, candidateBytes));
}
test("existing photo source rechecks bind the original candidate catalog without rewriting it", () => {
  assert.equal(EXISTING_PHOTO_RECORD_PATH, "content-private/research-refresh/2026-10-09-existing-photo-metadata.json");
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  rejectsExisting((v) => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); });
  assert.throws(() => validateExistingPhotoMetadata(existingPhotos, Buffer.concat([candidateBytes, Buffer.from(" ")])));
  rejectsExisting((v) => { v.existingPhotoObservations.pop(); });
});
test("source rechecks cannot swap ingredients processing candidates or original files", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  rejectsExisting((v) => { v.existingPhotoObservations[2].candidateId = "food-form-tie-pi-shi-hu-stems-v01"; });
  rejectsExisting((v) => { v.existingPhotoObservations[0].ingredientId = "huang-qi"; });
  rejectsExisting((v) => { v.existingPhotoObservations[1].remoteOriginal.url = v.existingPhotoObservations[0].remoteOriginal.url; });
  rejectsExisting((v) => { v.existingPhotoObservations[1].source.url = v.existingPhotoObservations[0].source.url; });
});
test("creation upload modification and new check dates remain distinct", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  for (const field of ["createdAt", "uploadedAt", "pageModifiedAt"]) {
    rejectsExisting((v) => { v.existingPhotoObservations[0].source[field] = "2026-10-09"; });
  }
  rejectsExisting((v) => { v.checkedAt = "2024-01-01"; });
  rejectsExisting((v) => { v.existingPhotoObservations[1].source.datePrecision = "verified_camera_clock"; });
});
test("permanent links must bind the same Commons title and observed page revision", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  const original = existingPhotos.existingPhotoObservations[0].source.permanentUrl;
  for (const replacement of [original.replace("974661806", "974661807"), original + "&redirect=no",
    original.replace("File:Dried_codonopsis_pilosula.jpg", "File:Other.jpg"),
    original.replace("https://", "https://user:password@"), original + "#Summary"]) {
    rejectsExisting((v) => { v.existingPhotoObservations[0].source.permanentUrl = replacement; });
  }
});
test("remote checksums and sizes remain source-reported not local binary verification", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  for (const [field, value] of [["sha1", "0".repeat(40)], ["bytes", 42], ["width", 960], ["height", 720],
    ["mimeType", "image/webp"], ["measurementScope", "local_measurement"]]) {
    rejectsExisting((v) => { v.existingPhotoObservations[0].remoteOriginal[field] = value; });
  }
  rejectsExisting((v) => { v.existingPhotoObservations[0].localAssetAvailable = true; });
  rejectsExisting((v) => { v.existingPhotoObservations[0].localBytes = 2337877; });
  rejectsExisting((v) => { v.existingPhotoObservations[0].localSha256 = "sha256:" + "a".repeat(64); });
});
test("file-page licenses and captions cannot promote identity visual review or publication", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  for (let i = 0; i < 3; i += 1) {
    for (const field of ["publicationEligible", "foodIdentityConfirmed", "foodProcessingApproved", "aiAltTextUsedAsVisualEvidence"])
      rejectsExisting((v) => { v.existingPhotoObservations[i][field] = true; });
    for (const field of ["rightsReviewState", "professionalReviewState"])
      rejectsExisting((v) => { v.existingPhotoObservations[i][field] = "approved"; });
    rejectsExisting((v) => { v.existingPhotoObservations[i].visualReviewState = "performed"; });
    rejectsExisting((v) => { v.existingPhotoObservations[i].runtimePlacements = ["detail"]; });
  }
  rejectsExisting((v) => { v.existingPhotoObservations[0].source.licenseName = "CC BY-SA 4.0"; });
  rejectsExisting((v) => { v.existingPhotoObservations[0].source.contentSha256 = "sha256:" + "a".repeat(64); });
});
test("unavailable original image requests and strict fields cannot be silently upgraded", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  rejectsExisting((v) => { v.retrievalIssues[0].outcome = "visual_review_complete"; });
  rejectsExisting((v) => { v.retrievalIssues[0].url = "https://example.org/other.jpg"; });
  rejectsExisting((v) => { v.retrievalIssues.pop(); });
  rejectsExisting((v) => { v.publicationEligible = true; });
  rejectsExisting((v) => { v.runtimePlacements = ["catalog"]; });
  rejectsExisting((v) => { v.existingPhotoObservations[0].visualObservation = "invented from caption"; });
});
test("all existing-photo recheck references stay excluded from public runtime", () => {
  validateExistingPhotoMetadata(existingPhotos, candidateBytes);
  const tokens = forbiddenTokens(existingPhotos);
  for (const item of existingPhotos.existingPhotoObservations) {
    for (const token of [item.id, item.candidateId, item.source.url, item.source.permanentUrl, item.remoteOriginal.url]) {
      assert(tokens.includes(token));
      assert.throws(() => validateRuntimeText(JSON.stringify({ source: token }), existingPhotos));
    }
  }
  validateRuntimeText("const publicCatalogOnly = true;", existingPhotos);
});
function rejectsSpecimen(mutate) {
  const value = JSON.parse(JSON.stringify(specimenLinks)); mutate(value);
  assert.throws(() => validateSpecimenPhotoLinks(value));
}

test("specimen photo links bind the unchanged earlier record without promoting candidates", () => {
  assert.equal(SPECIMEN_LINKS_RECORD_PATH, "content-private/research-refresh/2026-10-09-specimen-photo-links.json");
  validateSpecimenPhotoLinks(specimenLinks);
  validatePhotoBaseline(specimenLinks, fs.readFileSync(path.join(ROOT, PHOTO_RECORD_PATH)));
  rejectsSpecimen((v) => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); });
  rejectsSpecimen((v) => { v.specimenPhotoObservations.pop(); });
});
test("sample images stay separate from general scientific images and exhibition labels", () => {
  validateSpecimenPhotoLinks(specimenLinks);
  rejectsSpecimen((v) => { v.specimenPhotoObservations[1].specimen.accession = "TMPW No.8658"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[2].specimen.scope = "general_scientific_information"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[1].media.association = "general_crude_drug_image"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[0].specimen.accession = "TMPW No.4347"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[3].specimen.taxonLabel = "Lycium barbarum"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[3].specimen.partLabel = "fruit"; });
});
test("incomplete collection dates are not invented or replaced by page update dates", () => {
  validateSpecimenPhotoLinks(specimenLinks);
  rejectsSpecimen((v) => { v.specimenPhotoObservations[2].specimen.collectionDateLiteral = "1979/01/01"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[2].specimen.collectionDatePrecision = "day"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[1].specimen.collectionDateLiteral = "2022/10/12"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[1].source.scientificInformationRenewedAt = "1986-02-07"; });
});
test("a PD-user statement is not CC0 or approval and reserved rights are not an open license", () => {
  validateSpecimenPhotoLinks(specimenLinks);
  rejectsSpecimen((v) => { v.specimenPhotoObservations[3].media.licenseName = "CC0"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[3].media.rightsState = "approved"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[0].media.rightsState = "government_open_license"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[1].media.licenseName = "CC BY 4.0"; });
});
test("specimen metadata cannot create local pixels food identity or publication approval", () => {
  validateSpecimenPhotoLinks(specimenLinks);
  for (let i = 0; i < 4; i += 1) {
    for (const field of ["publicationEligible", "foodIdentityConfirmed", "foodProcessingApproved", "aiAltTextUsedAsVisualEvidence"]) {
      rejectsSpecimen((v) => { v.specimenPhotoObservations[i][field] = true; });
    }
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].doesNotCloseGap = false; });
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].runtimePlacements = ["detail"]; });
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].professionalReviewState = "approved"; });
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].media.visualReviewState = "performed"; });
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].media.localAssetAvailable = true; });
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].media.localBytes = 135336; });
    rejectsSpecimen((v) => { v.specimenPhotoObservations[i].media.localSha256 = "sha256:" + "a".repeat(64); });
  }
});
test("failed image reads and index-only records cannot be silently upgraded", () => {
  validateSpecimenPhotoLinks(specimenLinks);
  rejectsSpecimen((v) => { v.retrievalIssues[0].outcome = "full_text_read"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[0].media.links[0].retrievalOutcome = "visual_review_complete"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[2].media.links[0].url = "https://example.org/replacement.jpg"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[2].source.url = "https://user:secret@ethmed.toyama-wakan.net/SearchEn/View/8658"; });
  rejectsSpecimen((v) => { v.specimenPhotoObservations[1].extra = "unsupported"; });
});
test("all specimen source image and rights references remain excluded from runtime", () => {
  validateSpecimenPhotoLinks(specimenLinks);
  const tokens = forbiddenTokens(specimenLinks);
  for (const item of specimenLinks.specimenPhotoObservations) {
    for (const token of [item.id, item.source.url, ...item.media.links.map((link) => link.url)]) {
      assert(tokens.includes(token));
      assert.throws(() => validateRuntimeText(JSON.stringify({ source: token }), specimenLinks));
    }
  }
  assert(tokens.includes(specimenLinks.retrievalIssues[0].url));
  validateRuntimeText("const publicCatalogOnly = true;", specimenLinks);
  checkRuntime(ROOT, specimenLinks);
});
const clone = () => JSON.parse(JSON.stringify(record));
function rejects(mutate) {
  const value = clone(); mutate(value);
  assert.throws(() => validateRecord(value));
}
function rejectsPhoto(mutate) {
  const value = JSON.parse(JSON.stringify(photoRecord)); mutate(value);
  assert.throws(() => validatePhotoRefresh(value));
}
function rejectsAccess(mutate) {
  const value = JSON.parse(JSON.stringify(accessRecord)); mutate(value);
  assert.throws(() => validatePhotoAccess(value));
}
function rejectsDirectory(mutate) {
  const value = JSON.parse(JSON.stringify(directoryRecord)); mutate(value);
  assert.throws(() => validateDirectoryScope(value));
}

function rejectsIntegrity(mutate) {
  const value = JSON.parse(JSON.stringify(integrityRecord)); mutate(value);
  assert.throws(() => validatePhotoIntegrity(value, photoRecord));
}

test("goji integrity observations bind the exact earlier record without rewriting it", () => {
  assert.equal(INTEGRITY_RECORD_PATH, "content-private/research-refresh/2026-10-09-goji-integrity.json");
  validatePhotoIntegrity(integrityRecord, photoRecord);
  validatePhotoBaseline(integrityRecord, fs.readFileSync(path.join(ROOT, PHOTO_RECORD_PATH)));
  rejectsIntegrity((v) => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].previousPhotoId = "refresh-goji-vmenkov-linxia-2009"; });
});
test("remote original metadata is not a local measurement or a preview checksum", () => {
  validatePhotoIntegrity(integrityRecord, photoRecord);
  for (let i = 0; i < 2; i += 1) {
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].original.checksumAlgorithm = "sha256"; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].original.checksum = "a".repeat(64); });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].original.evidenceBasis = "local_measurement"; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].original.bytes += 1; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].localBytes = v.photoIntegrityObservations[i].original.bytes; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].localSha256 = "sha256:" + "a".repeat(64); });
  }
  rejectsIntegrity((v) => { [v.photoIntegrityObservations[0].original, v.photoIntegrityObservations[1].original] = [v.photoIntegrityObservations[1].original, v.photoIntegrityObservations[0].original]; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[1].original.url = v.retrievalIssues[3].url; });
});
test("capture upload and file-page revision dates remain distinct", () => {
  validatePhotoIntegrity(integrityRecord, photoRecord);
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].capturedAt = "2026-09-11"; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[1].uploadedAt = "2009-07-25"; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[1].pageModifiedAt = "2009-09-24"; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].permanentLinkAccess = "snapshot_read"; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].permanentUrl += "&approved=true"; });
});
test("goji integrity metadata cannot confer pixels identity publication or review", () => {
  validatePhotoIntegrity(integrityRecord, photoRecord);
  rejectsIntegrity((v) => { v.publicationEligible = true; });
  rejectsIntegrity((v) => { v.runtimePlacements = ["detail"]; });
  for (let i = 0; i < 2; i += 1) {
    for (const field of ["localAssetAvailable", "foodIdentityConfirmed", "foodProcessingApproved", "publicationEligible"]) {
      rejectsIntegrity((v) => { v.photoIntegrityObservations[i][field] = true; });
    }
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].visualReviewState = "reviewed"; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].professionalReviewState = "reviewed"; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].doesNotCloseGap = false; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].rights.reviewState = "reviewed"; });
    rejectsIntegrity((v) => { v.photoIntegrityObservations[i].rights.trackedLicense = "CC0"; });
  }
  rejectsIntegrity((v) => { v.photoIntegrityObservations[1].rights.selectionBasis = "all_licenses_cumulative"; });
  rejectsIntegrity((v) => { v.retrievalIssues[3].outcome = "visual_reviewed"; });
});
test("integrity source revision thumbnail and third-party URLs stay out of runtime", () => {
  validatePhotoIntegrity(integrityRecord, photoRecord);
  validateRuntimeText("const publicOnly = true;", integrityRecord);
  const tokens = forbiddenTokens(integrityRecord);
  for (const item of integrityRecord.photoIntegrityObservations) {
    for (const token of [item.id, item.sourceUrl, item.permanentUrl, item.original.url]) assert(tokens.includes(token));
  }
  for (const token of tokens) assert.throws(() => validateRuntimeText(JSON.stringify({ url: token }), integrityRecord));
  checkRuntime(ROOT, integrityRecord);
});
test("integrity research rejects unsupported fields unsafe URLs and incomplete evidence", () => {
  validatePhotoIntegrity(integrityRecord, photoRecord);
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].sourceUrl = "https://user:secret@commons.wikimedia.org/source"; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].aiAltTextUsedAsVisualEvidence = true; });
  rejectsIntegrity((v) => { v.photoIntegrityObservations.pop(); });
  rejectsIntegrity((v) => { v.photoIntegrityObservations[0].limitations = []; });
  rejectsIntegrity((v) => { v.retrievalIssues.pop(); });
});

test("directory scope record binds the earlier research and unchanged historical catalog", () => {
  validateDirectoryScope(directoryRecord);
  validatePhotoBaseline(directoryRecord, fs.readFileSync(path.join(ROOT, RECORD_PATH)));
  rejectsDirectory((v) => { v.baselineRecord.path = PHOTO_RECORD_PATH; });
  rejectsDirectory((v) => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); });
  rejectsDirectory((v) => { v.baseline.catalogSourceAsOf = "2026-10-09"; });
  rejectsDirectory((v) => { v.baseline.catalogSha256 = "sha256:" + "0".repeat(64); });
});

test("reference comparison uses all 106 exact names, not equal counts, aliases or row positions", () => {
  const local = require("../data/ingredients").ingredients.map((item) => item.name);
  const expected = { observedCount: 106, catalogCount: 106, matchedCount: 106, observedOnly: [], catalogOnly: [] };
  assert.deepEqual(compareReferenceNames(directoryRecord.nameCrossCheck.observedNames, local), expected);
  assert.deepEqual(compareReferenceNames([...directoryRecord.nameCrossCheck.observedNames].reverse(), local), expected);
  const changed = [...directoryRecord.nameCrossCheck.observedNames]; changed[54] = "橘红";
  assert.deepEqual(compareReferenceNames(changed, local), { ...expected, matchedCount: 105, observedOnly: ["橘红"], catalogOnly: ["桔红"] });
  assert.deepEqual(compareReferenceNames(["杏仁(甜、苦)"], ["杏仁（甜、苦）"]).observedOnly, ["杏仁(甜、苦)"]);
  assert.throws(() => compareReferenceNames(["丁香", "丁香"], local));
  rejectsDirectory((v) => { v.nameCrossCheck.observedNames[54] = "橘红"; });
  rejectsDirectory((v) => { v.nameCrossCheck.comparison = "normalize_aliases"; });
});

test("local licensing, application progress, government news and import management retain distinct authority", () => {
  validateDirectoryScope(directoryRecord);
  for (let i = 0; i < 4; i += 1) {
    rejectsDirectory((v) => { v.officialObservations[i].classification = "national_directory_addition"; });
    rejectsDirectory((v) => { v.officialObservations[i].provesNationalDirectoryApproval = true; });
    rejectsDirectory((v) => { v.officialObservations[i].professionalReviewState = "reviewed"; });
  }
  rejectsDirectory((v) => { v.officialObservations[2].source.sourceRole = "national_issuer"; });
  rejectsDirectory((v) => { v.officialObservations[3].source.sourceRole = "original_issuer"; });
});

test("signature, publication, local validity and reported event dates cannot be substituted", () => {
  validateDirectoryScope(directoryRecord);
  rejectsDirectory((v) => { v.officialObservations[0].source.effectiveFrom = "2026-01-07"; });
  rejectsDirectory((v) => { v.officialObservations[0].source.effectiveUntil = "2026-10-09"; });
  rejectsDirectory((v) => { v.officialObservations[1].source.publishedAt = "2026-04-29"; });
  rejectsDirectory((v) => { v.officialObservations[2].source.publishedAt = "2026-08-07"; });
  rejectsDirectory((v) => { v.officialObservations[2].evidence.reportedDocumentDate = "2026-08-14"; });
  rejectsDirectory((v) => { v.officialObservations[3].source.effectiveFrom = "2025-12-05"; });
});

test("a matching reference or a dated count never promotes the audit, runtime or publication", () => {
  validateDirectoryScope(directoryRecord);
  rejectsDirectory((v) => { v.directoryAuditComplete = true; });
  rejectsDirectory((v) => { v.publicationEligible = true; });
  rejectsDirectory((v) => { v.scope = "public"; });
  rejectsDirectory((v) => { v.runtimePlacements = ["catalog"]; });
  rejectsDirectory((v) => { v.nameCrossCheck.latestNationalDirectoryConfirmed = true; });
});

test("failed national retrieval and an unread import attachment remain unresolved", () => {
  validateDirectoryScope(directoryRecord);
  rejectsDirectory((v) => { v.retrievalIssues[0].outcome = "complete"; });
  rejectsDirectory((v) => { v.retrievalIssues[1].url = record.retrievalIssues[1].url; });
  rejectsDirectory((v) => { v.retrievalIssues[2].outcome = "full_text_read"; });
  rejectsDirectory((v) => { v.officialObservations[3].evidence.reportedCount = 106; });
  rejectsDirectory((v) => { v.officialObservations[0].source.contentSha256 = "sha256:" + "a".repeat(64); });
});

test("directory observations reject unsupported fields, empty evidence and unsafe sources", () => {
  validateDirectoryScope(directoryRecord);
  rejectsDirectory((v) => { v.checkedAt = "2026-02-30"; });
  rejectsDirectory((v) => { v.officialObservations[0].source.url = "https://user:secret@www.heshan.gov.cn/example"; });
  rejectsDirectory((v) => { v.officialObservations[1].evidence.limitations = []; });
  rejectsDirectory((v) => { v.officialObservations[2].evidence.locators = []; });
  rejectsDirectory((v) => { v.nameCrossCheck.observedNames.pop(); });
});

test("every directory-scope identifier and URL is excluded from runtime using the existing scanner", () => {
  validateDirectoryScope(directoryRecord);
  validateRuntimeText("const onlyPublic = true;", directoryRecord);
  for (const token of forbiddenTokens(directoryRecord)) {
    assert.throws(() => validateRuntimeText(JSON.stringify({ url: token }), directoryRecord), /private research reference/);
  }
  const historicalUrl = directoryRecord.retrievalIssues[1].url;
  assert(require("../data/ingredients").ingredients.some((item) => item.sources.some((s) => s.url === historicalUrl)));
  assert(!forbiddenTokens(directoryRecord).includes(historicalUrl), "the existing public source is not a new research leak");
  validateRuntimeText(JSON.stringify({ url: historicalUrl }), directoryRecord);
  const changed = JSON.parse(JSON.stringify(directoryRecord));
  changed.retrievalIssues[1].url += "?private-research-only";
  assert.throws(() => validateDirectoryScope(changed));
  assert.throws(() => validateRuntimeText(JSON.stringify({ url: changed.retrievalIssues[1].url }), changed));
  checkRuntime(ROOT, directoryRecord);
});

test("additional access research binds the exact earlier photo record", () => {
  validatePhotoAccess(accessRecord);
  const previous = fs.readFileSync(path.join(ROOT, PHOTO_RECORD_PATH));
  validatePhotoBaseline(accessRecord, previous);
  assert.throws(() => validatePhotoBaseline(accessRecord, Buffer.concat([previous, Buffer.from("\n")])));
  rejectsAccess((v) => { v.baselineRecord.path = RECORD_PATH; });
  rejectsAccess((v) => { v.baselineRecord.sha256 = "sha256:" + "0".repeat(64); });
});
test("government domain and repository access are not an open image license", () => {
  for (let i = 0; i < 2; i += 1) {
    rejectsAccess((v) => { v.photoFollowups[i].evidence.rightsState = "open_license"; });
    rejectsAccess((v) => { v.photoFollowups[i].media.licenseName = "CC BY 4.0"; });
    rejectsAccess((v) => { v.photoFollowups[i].media.licenseUrl = "https://creativecommons.org/licenses/by/4.0/"; });
    rejectsAccess((v) => { v.photoFollowups[i].rightsReviewState = "reviewed"; });
  }
  rejectsAccess((v) => { v.photoFollowups[1].disposition = v.photoFollowups[0].disposition; });
});
test("caption and body panel mismatch must survive without a guessed correction", () => {
  rejectsAccess((v) => { v.photoFollowups[1].evidence.panelReferenceConflict = false; });
  rejectsAccess((v) => { v.photoFollowups[1].evidence.bodyPanelReferences = ["Fig. 1H and 1I"]; });
  rejectsAccess((v) => { v.photoFollowups[1].evidence.captionPanelLabels.reverse(); });
  rejectsAccess((v) => { v.photoFollowups[0].media.associationState = "page_verified"; });
});
test("modification and generated download stamps cannot become photo or publication dates", () => {
  rejectsAccess((v) => { v.photoFollowups[0].source.publishedAt = "2013-11-26"; });
  rejectsAccess((v) => { v.photoFollowups[1].source.publishedAt = "2026-09-08"; });
  rejectsAccess((v) => { v.photoFollowups[1].source.documentVersion = "publisher_final"; });
  rejectsAccess((v) => { v.photoFollowups[1].media.createdAt = "2016-12-01"; });
});
test("failed image access cannot confer pixels, identity, approval or close a gap", () => {
  rejectsAccess((v) => { v.publicationEligible = true; });
  rejectsAccess((v) => { v.scope = "public"; });
  rejectsAccess((v) => { v.runtimePlacements = ["detail"]; });
  rejectsAccess((v) => { v.photoCandidatesAdded = 2; });
  rejectsAccess((v) => { v.retrievalIssues[1].outcome = "reviewed"; });
  for (let i = 0; i < 2; i += 1) {
    for (const field of ["bytes", "width", "height"]) rejectsAccess((v) => { v.photoFollowups[i].media[field] = 1; });
    rejectsAccess((v) => { v.photoFollowups[i].media.sha256 = "sha256:" + "a".repeat(64); });
    rejectsAccess((v) => { v.photoFollowups[i].media.localAssetAvailable = true; });
    rejectsAccess((v) => { v.photoFollowups[i].media.visualReviewState = "reviewed"; });
    rejectsAccess((v) => { v.photoFollowups[i].aiAltTextUsedAsVisualEvidence = true; });
    rejectsAccess((v) => { v.photoFollowups[i].evidence.foodIdentityConfirmed = true; });
    rejectsAccess((v) => { v.photoFollowups[i].evidence.foodProcessingApproved = true; });
    rejectsAccess((v) => { v.photoFollowups[i].doesNotCloseGap = false; });
    rejectsAccess((v) => { v.photoFollowups[i].publicationEligible = true; });
    rejectsAccess((v) => { v.photoFollowups[i].runtimePlacements = ["detail"]; });
    rejectsAccess((v) => { v.photoFollowups[i].professionalReviewState = "reviewed"; });
  }
});
test("additional source and image URLs cannot enter runtime text", () => {
  validateRuntimeText("const safe = 'public';", accessRecord);
  for (const token of forbiddenTokens(accessRecord)) assert.throws(() => validateRuntimeText(JSON.stringify({ url: token }), accessRecord));
  rejectsAccess((v) => { v.photoFollowups[0].source.url = "https://example.org/source"; });
  rejectsAccess((v) => { v.photoFollowups[0].media.imageUrl = "https://user:secret@www.tari.gov.tw/photo.jpg"; });
});

test("new dated photo followups preserve the byte-exact prior research baseline", () => {
  validatePhotoRefresh(photoRecord);
  const previous = fs.readFileSync(path.join(ROOT, RECORD_PATH));
  validatePhotoBaseline(photoRecord, previous);
  assert.throws(() => validatePhotoBaseline(photoRecord, Buffer.concat([previous, Buffer.from("\n")])));
  rejectsPhoto((v) => { v.baselineRecord.path = "../other.json"; });
  rejectsPhoto((v) => { v.baselineRecord.sha256 = "sha256:" + "a".repeat(64); });
});
test("photo followups remain private and cannot claim candidate promotion or publishability", () => {
  rejectsPhoto((v) => { v.scope = "public"; });
  rejectsPhoto((v) => { v.publicationEligible = true; });
  rejectsPhoto((v) => { v.runtimePlacements = ["detail"]; });
  rejectsPhoto((v) => { v.photoCandidatesAdded = 3; });
  for (let i = 0; i < photoRecord.photoFollowups.length; i += 1) {
    rejectsPhoto((v) => { v.photoFollowups[i].doesNotCloseGap = false; });
    rejectsPhoto((v) => { v.photoFollowups[i].publicationEligible = true; });
    rejectsPhoto((v) => { v.photoFollowups[i].runtimePlacements = ["ingredient_card"]; });
    rejectsPhoto((v) => { v.photoFollowups[i].professionalReviewState = "reviewed"; });
    rejectsPhoto((v) => { v.photoFollowups[i].rightsReviewState = "reviewed"; });
  }
});
test("article processing, market names and categories cannot confer food identity or approved cooking", () => {
  for (let i = 0; i < photoRecord.photoFollowups.length; i += 1) {
    rejectsPhoto((v) => { v.photoFollowups[i].evidence.foodIdentityConfirmed = true; });
    rejectsPhoto((v) => { v.photoFollowups[i].evidence.foodProcessingApproved = true; });
    rejectsPhoto((v) => { v.photoFollowups[i].ingredientId = "tian-dong"; });
    rejectsPhoto((v) => { v.photoFollowups[i].existingGapId = "food-form-gap-tian-dong-v01"; });
  }
  rejectsPhoto((v) => { v.photoFollowups[0].evidence.sourceLabels = ["food ready to eat"]; });
});
test("share-alike alternatives and noncommercial no-derivatives restriction cannot be upgraded", () => {
  for (let i = 0; i < photoRecord.photoFollowups.length; i += 1) {
    rejectsPhoto((v) => { v.photoFollowups[i].media.licenseName = "CC0"; });
    rejectsPhoto((v) => { v.photoFollowups[i].media.licenseUrl = "https://creativecommons.org/licenses/by/4.0/?approved=true"; });
  }
  rejectsPhoto((v) => { v.photoFollowups[2].evidence.licenseAlternatives = ["CC BY 4.0"]; });
  rejectsPhoto((v) => { v.photoFollowups[3].disposition = "processing_comparison_lead_visual_pending"; });
});
test("captions and PDF text do not count as visual review or local image capture", () => {
  for (let i = 0; i < photoRecord.photoFollowups.length; i += 1) {
    rejectsPhoto((v) => { v.photoFollowups[i].media.visualReviewState = "reviewed"; });
    rejectsPhoto((v) => { v.photoFollowups[i].media.localAssetAvailable = true; });
    rejectsPhoto((v) => { v.photoFollowups[i].media.sha256 = "sha256:" + "a".repeat(64); });
    rejectsPhoto((v) => { v.photoFollowups[i].media.bytes = 1; });
    rejectsPhoto((v) => { v.photoFollowups[i].source.contentSha256 = "sha256:" + "a".repeat(64); });
    rejectsPhoto((v) => { v.photoFollowups[i].aiAltTextUsedAsVisualEvidence = true; });
  }
  rejectsPhoto((v) => { v.retrievalIssues[0].outcome = "visual_reviewed"; });
  rejectsPhoto((v) => { v.retrievalIssues.pop(); });
});
test("source upload dates and image capture dates retain their distinct meanings", () => {
  rejectsPhoto((v) => { v.checkedAt = "2026-02-30"; });
  rejectsPhoto((v) => { v.photoFollowups[2].source.publishedAt = "2009-07-25"; });
  rejectsPhoto((v) => { v.photoFollowups[2].media.createdAt = "2009-09-24"; });
  rejectsPhoto((v) => { v.photoFollowups[0].media.createdAt = "2023-03-01"; });
  rejectsPhoto((v) => { v.photoFollowups[1].media.width = 960; });
});
test("new private URLs, PDF references and ids are blocked from runtime", () => {
  validateRuntimeText("const safe = 'public catalog';", photoRecord);
  for (const token of forbiddenTokens(photoRecord)) {
    assert.throws(() => validateRuntimeText(JSON.stringify({ image: token }), photoRecord));
  }
  rejectsPhoto((v) => { v.photoFollowups[0].media.imageUrl = "http://media.springernature.com/a.png"; });
  rejectsPhoto((v) => { v.photoFollowups[1].source.url = "https://user:secret@commons.wikimedia.org/x"; });
  rejectsPhoto((v) => { v.photoFollowups[3].media.imageUrl = "https://example.org/fake.png"; });
});

test("dated private record and actual source/upload boundary pass", () => { main(); });
test("research cannot mark the directory latest, publishable or runtime placed", () => {
  rejects((v) => { v.directoryAuditComplete = true; });
  rejects((v) => { v.publicationEligible = true; });
  rejects((v) => { v.scope = "public"; });
  rejects((v) => { v.runtimePlacements = ["detail"]; });
});
test("calls, counts and non-listing observations cannot become national approval", () => {
  for (let i = 0; i < record.officialObservations.length; i += 1) {
    rejects((v) => { v.officialObservations[i].provesNationalDirectoryApproval = true; });
    rejects((v) => { v.officialObservations[i].professionalReviewState = "reviewed"; });
    rejects((v) => { v.officialObservations[i].classification = "national_approval"; });
  }
});
test("conflicting publication, signature and document dates remain distinct", () => {
  rejects((v) => { v.officialObservations[1].source.dateConflict = false; });
  rejects((v) => { v.officialObservations[1].source.publishedAt = "2026-07-29"; });
  rejects((v) => { v.officialObservations[2].source.signedAt = "2026-08-17"; });
  rejects((v) => { v.officialObservations[0].applicationDeadline = "2026-10-08"; });
});
test("URLs and unsupported fields fail closed", () => {
  rejects((v) => { v.officialObservations[0].source.url = "http://wjw.shanxi.gov.cn/"; });
  rejects((v) => { v.photoFollowups[0].source.url = "https://example.org/photo"; });
  rejects((v) => { v.photoFollowups[0].media.imageUrl = "https://user:password@upload.wikimedia.org/image.png"; });
  rejects((v) => { v.photoFollowups[0].approved = true; });
  rejects((v) => { v.baseline.files[0].path = "../secret.json"; });
});
test("no image bytes, digest or visual observation are fabricated", () => {
  for (let i = 0; i < record.photoFollowups.length; i += 1) {
    rejects((v) => { v.photoFollowups[i].media.visualReviewState = "reviewed"; });
    rejects((v) => { v.photoFollowups[i].media.localAssetAvailable = true; });
    rejects((v) => { v.photoFollowups[i].media.bytes = 290000; });
    rejects((v) => { v.photoFollowups[i].media.sha256 = "sha256:" + "a".repeat(64); });
    rejects((v) => { v.photoFollowups[i].aiAltTextUsedAsVisualEvidence = true; });
  }
});
test("photo research cannot close gaps, confer identity or acquire review/publication status", () => {
  for (let i = 0; i < record.photoFollowups.length; i += 1) {
    rejects((v) => { v.photoFollowups[i].doesNotCloseGap = false; });
    rejects((v) => { v.photoFollowups[i].publicationEligible = true; });
    rejects((v) => { v.photoFollowups[i].rightsReviewState = "reviewed"; });
    rejects((v) => { v.photoFollowups[i].professionalReviewState = "reviewed"; });
    rejects((v) => { v.photoFollowups[i].runtimePlacements = ["ingredient_card"]; });
    rejects((v) => { v.photoFollowups[i].existingGapId = "food-form-gap-gou-qi-zi-v01"; });
  }
  rejects((v) => { v.photoFollowups[1].disposition = "photo_candidate"; });
});
test("dates, source retrieval failures and historical counts cannot be silently rewritten", () => {
  rejects((v) => { v.checkedAt = "2026-02-30"; });
  rejects((v) => { v.officialObservations[0].source.publishedAt = "2027-01-01"; });
  rejects((v) => { v.retrievalIssues[0].outcome = "complete"; });
  rejects((v) => { v.baseline.photoCandidateCount = 20; });
  rejects((v) => { v.baseline.unresolvedGapIds.pop(); });
});
test("every new private token is rejected in runtime source text", () => {
  validateRuntimeText("const safe = 'public catalog';", record);
  for (const token of forbiddenTokens(record)) {
    assert.throws(() => validateRuntimeText(`const leak = ${JSON.stringify(token)};`, record));
  }
});
test("runtime scan detects nested leaks while excluding private research files", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-research-scan-"));
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert(/^zhongyi-research-scan-[a-zA-Z0-9]+$/.test(path.basename(fixture)));
  assert(fs.lstatSync(fixture).isDirectory() && !fs.lstatSync(fixture).isSymbolicLink());
  try {
    fs.mkdirSync(path.join(fixture, "pages"));
    fs.mkdirSync(path.join(fixture, "content-private"));
    fs.writeFileSync(path.join(fixture, "content-private", "research.json"), JSON.stringify(record));
    fs.writeFileSync(path.join(fixture, "pages", "index.js"), "const publicOnly = true;");
    checkRuntime(fixture, record);
    checkRuntime(fixture, photoRecord);
    fs.writeFileSync(path.join(fixture, "pages", "index.js"), forbiddenTokens(record)[1]);
    assert.throws(() => checkRuntime(fixture, record), /private research reference/);
    fs.writeFileSync(path.join(fixture, "pages", "index.js"), forbiddenTokens(photoRecord)[1]);
    assert.throws(() => checkRuntime(fixture, photoRecord), /private research reference/);
  } finally {
    // No recursive cleanup: remove only the exact regular files this test created.
    for (const relative of ["pages/index.js", "content-private/research.json"]) {
      const target = path.join(fixture, relative);
      if (!fs.existsSync(target)) continue;
      const stat = fs.lstatSync(target);
      assert(stat.isFile() && !stat.isSymbolicLink());
      fs.unlinkSync(target);
    }
    for (const relative of ["pages", "content-private"]) {
      const target = path.join(fixture, relative);
      if (!fs.existsSync(target)) continue;
      assert(!fs.lstatSync(target).isSymbolicLink());
      fs.rmdirSync(target);
    }
    fs.rmdirSync(fixture);
  }
});

test("only root local diagnostics are excluded and their upload exclusion remains required", () => {
  assert(read("project.config.json").packOptions.ignore.some(item => item.type === "folder" && item.value === ".local"));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-research-local-scan-"));
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert(/^zhongyi-research-local-scan-[a-zA-Z0-9]+$/.test(path.basename(fixture)));
  assert(fs.lstatSync(fixture).isDirectory() && !fs.lstatSync(fixture).isSymbolicLink());
  try {
    fs.mkdirSync(path.join(fixture, ".local"));
    fs.writeFileSync(path.join(fixture, ".local", "report.json"), JSON.stringify(photoCapturesBatch3));
    checkRuntime(fixture, photoCapturesBatch3);
    fs.mkdirSync(path.join(fixture, "pages"));
    fs.mkdirSync(path.join(fixture, "pages", ".local"));
    fs.writeFileSync(path.join(fixture, "pages", ".local", "report.json"), JSON.stringify(photoCapturesBatch3));
    assert.throws(() => checkRuntime(fixture, photoCapturesBatch3), /private research reference/);
  } finally {
    for (const relative of [".local/report.json", "pages/.local/report.json"]) {
      const target = path.join(fixture, relative);
      if (!fs.existsSync(target)) continue;
      assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
      fs.unlinkSync(target);
    }
    for (const relative of ["pages/.local", "pages", ".local"]) {
      const target = path.join(fixture, relative);
      if (!fs.existsSync(target)) continue;
      assert(fs.lstatSync(target).isDirectory() && !fs.lstatSync(target).isSymbolicLink()); fs.rmdirSync(target);
    }
    fs.rmdirSync(fixture);
  }
});
