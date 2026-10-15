"use strict";

// Private historical transcription and discrepancy detection, not approval or current-law verification.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const RECORD_PATH = "content-private/research-refresh/2026-10-10-official-nine-review.json";
const PROVENANCE_PATH = "content-private/research-refresh/2026-10-10-shanzhuyu-provenance.json";
const PDF_PATH = "content-private/research-refresh/official-documents/nhc-2023-9-gazette.pdf";
const PDF_SHA = "sha256:fd329f6d7c3b38d0c9728682b268bcdc1a46704d7d01084bd1484b2a059d6cfa";
const CATALOG_SHA = "sha256:5b21a1e30d592cfa00017ad9021d591219cb0d74fb86c1f3ab5fad6c7115c092";
const EARLIER = "content-private/research-refresh/2026-10-09-official-document-captures.json";
const EARLIER_SHA = "sha256:e29599b3a78663c3f7f500799b2afbe05896e2aa388593e525b275945ef9bec3";
const PDF_URL = "https://www.nhc.gov.cn/cms-search/downFiles/afd501ee12ee480fb2ccb9e638e7ed90.pdf";
const ROWS = [
  ["dang-shen", "党参", "根"], ["rou-cong-rong-huang-mo", "肉苁蓉（荒漠）", "肉质茎"],
  ["tie-pi-shi-hu", "铁皮石斛", "茎"], ["xi-yang-shen", "西洋参", "根"], ["huang-qi", "黄芪", "根"],
  ["ling-zhi", "灵芝", "子实体"], ["shan-zhu-yu", "山茱萸", "果实"], ["tian-ma", "天麻", "块茎"], ["du-zhong-ye", "杜仲叶", "叶"]
].map(([ingredientId, name, part], index) => ({ row: index + 1, ingredientId, name, printedPage: index ? "17" : "16", part }));
function keys(value, names) { assert.deepEqual(Object.keys(value).sort(), names.split(" ").sort()); }
function text(value) { assert(typeof value === "string" && value.trim().length > 0); }
function digest(bytes) { return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; }
function bytesFrom(root, relative) {
  const filename = path.resolve(root, relative); const base = path.resolve(root);
  assert(filename.startsWith(base + path.sep), "capture must remain inside project");
  for (let current = filename; ; current = path.dirname(current)) {
    assert(!fs.lstatSync(current).isSymbolicLink(), "linked evidence rejected");
    assert.equal(fs.realpathSync(current).toLowerCase(), current.toLowerCase(), "redirected evidence rejected");
    if (current === base) break;
  }
  assert(fs.statSync(filename).isFile()); assert(fs.statSync(filename).size <= 2 * 1024 * 1024);
  return fs.readFileSync(filename);
}
function compareParts(rows, ingredients) {
  const findings = [];
  for (const row of rows) {
    const matches = ingredients.filter(item => item.id === row.ingredientId);
    assert.equal(matches.length, 1, "comparison target must be unique and present");
    assert.equal(matches[0].name, row.name);
    const snapshotPart = matches[0].identity.ediblePart; text(snapshotPart);
    if (snapshotPart !== row.part) findings.push({ ingredientId: row.ingredientId, announcementPart: row.part, snapshotPart });
  }
  return { matchedParts: rows.length - findings.length, findings };
}
function validate(record, root, loadBytes = relative => bytesFrom(root, relative)) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements directoryAuditComplete professionalReviewState baseline document rows comparison notes retrievalIssues");
  assert.equal(record.schemaVersion, "official-nine-review.1"); assert.equal(record.checkedAt, "2026-10-10");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []); assert.equal(record.directoryAuditComplete, false);
  assert.equal(record.professionalReviewState, "pending");
  assert.deepEqual(record.baseline, { releaseId: "release-2026.08.13-complete-public-projection.10", catalogSourceAsOf: "2026-08-10",
    catalogSha256: CATALOG_SHA, earlierCaptureRecord: EARLIER, earlierCaptureRecordSha256: EARLIER_SHA });
  assert.equal(digest(loadBytes("data/ingredients.js")), CATALOG_SHA, "do not rebaseline the formal snapshot");
  const earlierBytes = loadBytes(EARLIER); assert.equal(digest(earlierBytes), EARLIER_SHA);
  const doc = record.document;
  keys(doc, "id publisher title url role documentNumber signedAt webPublishedAt pdfCreatedOn capture");
  assert.equal(doc.id, "capture-nhc-2023-9-gazette-20261010"); text(doc.publisher); text(doc.title);
  assert.equal(doc.url, PDF_URL); assert.equal(doc.role, "national_issuer_gazette");
  assert.equal(doc.documentNumber, "2023年第9号"); assert.equal(doc.signedAt, "2023-11-09");
  assert.equal(doc.webPublishedAt, null); assert.equal(doc.pdfCreatedOn, "2024-01-24");
  assert.deepEqual(doc.capture, { path: PDF_PATH, bytes: 1144136, sha256: PDF_SHA, pageCount: 37, physicalPagesRead: [18, 19],
    printedPageLabels: ["16", "17"], visualReview: "local_poppler_render_viewed", reviewedAsFoodPhoto: false });
  const original = loadBytes(PDF_PATH); assert(Buffer.isBuffer(original)); assert.equal(original.length, 1144136);
  assert.equal(original.subarray(0, 5).toString("ascii"), "%PDF-"); assert.equal(digest(original), PDF_SHA);
  assert.deepEqual(record.rows, ROWS);
  keys(record.comparison, "matchedParts findings"); assert.equal(record.comparison.findings.length, 1);
  const finding = record.comparison.findings[0];
  assert.deepEqual(finding, { id: "finding-shanzhuyu-part-scope-20261010", ingredientId: "shan-zhu-yu", field: "identity.ediblePart",
    announcementPart: "果实", snapshotPart: "果肉", importListPart: "成熟果肉", importListProcessing: "干燥",
    importListLocator: "2025年第237号进口分类附件第18行", state: "requires_source_reconciliation", resolution: null,
    professionalReviewState: "pending", doesNotBroadenFoodUse: true, doesNotApproveExistingPhoto: true });
  const earlier = JSON.parse(earlierBytes.toString("utf8"));
  const importRow = earlier.documents[1].evidence.selectedParts.find(row => row.row === 18);
  assert.equal(importRow.name, "山茱萸"); assert.equal(importRow.part, finding.importListPart);
  assert.equal(importRow.processingLabel, finding.importListProcessing);
  const compared = compareParts(record.rows, require(path.join(root, "data/ingredients.js")).ingredients);
  assert.equal(record.comparison.matchedParts, compared.matchedParts);
  assert.deepEqual(compared.findings, record.comparison.findings.map(({ ingredientId, announcementPart, snapshotPart }) => ({ ingredientId, announcementPart, snapshotPart })));
  assert.equal(record.notes.length, 4); record.notes.forEach(text);
  assert.equal(record.retrievalIssues.length, 2);
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome effect"); text(issue.effect);
    assert.equal(issue.url, index ? PDF_URL : "https://www.nhc.gov.cn/sps/c100088/new_list.shtml");
    assert.equal(issue.outcome, index ? "web_fetch_timeout_then_verified_local_capture" : "http_412");
  });
  return { checkedAt: record.checkedAt, capturedOfficialDocuments: 1, documentPagesViewed: 2, sourceBytesVerified: original.length,
    comparedParts: 9, matchedParts: compared.matchedParts, unresolvedPartFindings: compared.findings.length,
    directoryAuditComplete: false, professionalApprovals: 0, foodPhotosReviewed: 0, assertions: "passed" };
}
function tokens(record) { return [RECORD_PATH, record.document.id, record.document.url, record.document.capture.path,
  ...record.comparison.findings.map(item => item.id)]; }
function validateProvenance(record, root, loadBytes = relative => bytesFrom(root, relative)) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements previousRecord ingredientId existingSourceId canonicalSource governmentRepublication localOriginalCapture assessment notes retrievalIssues");
  assert.equal(record.schemaVersion, "shanzhuyu-provenance.1"); assert.equal(record.checkedAt, "2026-10-10");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []);
  assert.deepEqual(record.previousRecord, { path: RECORD_PATH,
    sha256: "sha256:50d60a1e97cf6b231ea2056a2cff4b65a1f614d7662efb8dfe615f824cbc9151",
    findingId: "finding-shanzhuyu-part-scope-20261010" });
  const previousBytes = loadBytes(RECORD_PATH);
  assert.equal(digest(previousBytes), record.previousRecord.sha256, "preserve the original dated finding");
  const previous = JSON.parse(previousBytes.toString("utf8")); validate(previous, root, loadBytes);
  assert.equal(record.ingredientId, previous.comparison.findings[0].ingredientId);
  assert.equal(record.existingSourceId, "nhc-interpretation-2023-9");
  assert.deepEqual(record.canonicalSource, {
    url: "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
    role: "national_issuer_interpretation", indexedPublishedAt: "2023-11-17",
    indexedBodyPartLabel: "干燥成熟果肉", access: "search_index_body_returned_live_http_412" });
  const item = require(path.join(root, "data/ingredients.js")).ingredients.find(item => item.id === record.ingredientId);
  assert(item.regulatory.sourceIds.includes(record.existingSourceId));
  const source = item.sources.find(source => source.id === record.existingSourceId);
  assert(source); assert.equal(source.url, record.canonicalSource.url);
  assert.equal(source.publishedAt, record.canonicalSource.indexedPublishedAt);
  assert.deepEqual(record.governmentRepublication, {
    url: "https://www.ganxian.gov.cn/gxqxxgk/zcjd9hht/202311/51706ef906154551b70187447738432f.shtml",
    publisher: "赣县区人民政府网站", role: "government_republication_not_national_issuer",
    pageGeneratedOn: "2023-11-30", disclosureIndex: "-2023-6082172", access: "web_full_body_read",
    locator: "山茱萸段落", partLabel: "干燥成熟果肉" });
  assert.equal(record.localOriginalCapture, null, "a web transcription is not a local original capture");
  assert.deepEqual(record.assessment, { announcementPart: "果实", snapshotPart: "果肉", importPart: "成熟果肉",
    importProcessing: "干燥", interpretationProvidesFleshProvenance: true, snapshotErrorEstablished: false,
    state: "provenance_added_professional_reconciliation_pending", resolution: null,
    professionalReviewState: "pending", photoIdentityConfirmed: false, wholeFruitUseApproved: false,
    directoryAuditComplete: false });
  assert.equal(record.notes.length, 4); record.notes.forEach(text);
  assert.equal(record.retrievalIssues.length, 1);
  keys(record.retrievalIssues[0], "url outcome effect");
  assert.equal(record.retrievalIssues[0].url, "https://www.nhc.gov.cn/wjw/c100379/202311/cff8436e06ed477fa6cbbf617d1c323c.shtml");
  assert.equal(record.retrievalIssues[0].outcome, "http_412"); text(record.retrievalIssues[0].effect);
  return { checkedAt: record.checkedAt, fleshProvenanceAdded: 1, governmentRepublicationsRead: 1,
    localOriginalCapturesAdded: 0, professionalApprovals: 0, snapshotErrorsEstablished: 0, assertions: "passed" };
}
function provenanceTokens(record) {
  // The canonical interpretation URL already exists in the locked public snapshot.
  // Bind it above rather than treating this follow-up as permission to publish a new URL.
  return [PROVENANCE_PATH, record.schemaVersion, record.assessment.state, record.governmentRepublication.url];
}
module.exports = { RECORD_PATH, PROVENANCE_PATH, PDF_PATH, compareParts, validate, tokens, validateProvenance, provenanceTokens };
