"use strict";

// Dated transcription/boundary checks, not live source, license or identity approval.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const RECORD_PATH = "content-private/research-refresh/2026-10-10-source-screening.json";
const BINDINGS = [
  ["content-private/media-candidates/food-forms/food-form-catalog.json", "ccd0f652e2b9f6b3544ac58467b2f0a45d610de428832157de43a14d3580202c"],
  ["content-private/research-refresh/2026-10-09-food-form-access.json", "5d6f857527a815adee6854920acbafe9930ad46914199c2f0dadab0516c325f0"],
  ["content-private/research-refresh/2026-10-09-tiandong-photo-screening.json", "ae5cf4d1363804838e1f7aef8e909f80262a21d50a3bbc710678d0f49dff6369"]
].map(([file, digest]) => ({ path: file, sha256: `sha256:${digest}` }));
function keys(value, expected) { assert.deepEqual(Object.keys(value).sort(), expected.split(" ").sort()); }
function text(value) { assert(typeof value === "string" && value.trim().length > 0); }
function https(value) {
  const parsed = new URL(value); assert.equal(parsed.protocol, "https:");
  assert(!parsed.username && !parsed.password && !parsed.hash);
}
function validate(record, root) {
  keys(record, "schemaVersion checkedAt scope publicationEligible runtimePlacements baselineRecord historicalBindings sourceScreeningObservations retrievalIssues");
  assert.equal(record.schemaVersion, "source-screening.1"); assert.equal(record.checkedAt, "2026-10-10");
  assert.equal(record.scope, "private_research_only"); assert.equal(record.publicationEligible, false);
  assert.deepEqual(record.runtimePlacements, []);
  assert.deepEqual([record.baselineRecord, ...record.historicalBindings], BINDINGS);
  for (const binding of BINDINGS) {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, binding.path))).digest("hex");
    assert.equal(`sha256:${digest}`, binding.sha256, "historical research changed; do not rebaseline");
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(root, record.baselineRecord.path), "utf8"));
  const contracts = [
    ["refresh-dihuang-tari-issue92-2012", "di-huang", "fresh_root_caption_lead_not_processed_form_evidence", "www.tari.gov.tw", "2012-12", "fresh_not_processed", "site_statement_file_exceptions_pending"],
    ["refresh-goji-formerly-frozen-exclusion-2010", "gou-qi-zi", "source_description_mismatch_for_dried_fruit", "commons.wikimedia.org", "2011-09-23", "formerly_frozen_not_dried_evidence", "file_license_statement_not_project_approval"],
    ["refresh-tiandong-kinmen-root-link-2017", "tian-dong", "root_link_lead_visual_processing_and_permission_pending", "forestry.kinmen.gov.tw", "2017-08-07", "unspecified", "permission_required_unless_applicable_exception"]
  ];
  assert.equal(record.sourceScreeningObservations.length, contracts.length);
  record.sourceScreeningObservations.forEach((item, index) => {
    keys(item, "id ingredientId existingGapId disposition source media evidence rights limitations aiAltTextUsedAsVisualEvidence doesNotCloseGap publicationEligible runtimePlacements professionalReviewState");
    const [id, ingredient, disposition, host, published, processing, rightsScope] = contracts[index];
    assert.deepEqual([item.id, item.ingredientId, item.disposition], [id, ingredient, disposition]);
    assert(catalog.gaps.some(g => g.id === item.existingGapId && g.ingredientId === ingredient));
    assert.equal(item.publicationEligible, false); assert.deepEqual(item.runtimePlacements, []);
    assert.equal(item.doesNotCloseGap, true); assert.equal(item.professionalReviewState, "pending");
    assert.equal(item.aiAltTextUsedAsVisualEvidence, false);
    keys(item.source, "publisher title url indexUrl permanentUrl publishedAt modifiedAt authors authorRole contentReadState contentSha256");
    for (const value of [item.source.url, item.source.indexUrl, item.source.permanentUrl].filter(Boolean)) https(value);
    assert.equal(new URL(item.source.url).hostname, host); assert.equal(item.source.publishedAt, published);
    assert.equal(item.source.contentSha256, null); text(item.source.publisher); text(item.source.title);
    keys(item.media, "locator imageUrl creator createdAt localAssetAvailable bytes sha256 visualReviewState pixelObservations");
    text(item.media.locator); if (item.media.imageUrl) https(item.media.imageUrl);
    assert.deepEqual([item.media.localAssetAvailable, item.media.bytes, item.media.sha256, item.media.visualReviewState, item.media.pixelObservations],
      [false, null, null, "not_performed", null]);
    keys(item.evidence, "basis sourceStatement processingStateFromSource previousObservationId doesNotRebindEarlierImage foodIdentityConfirmed foodProcessingApproved");
    text(item.evidence.basis); text(item.evidence.sourceStatement);
    assert.equal(item.evidence.processingStateFromSource, processing); assert.equal(item.evidence.doesNotRebindEarlierImage, true);
    assert.equal(item.evidence.foodIdentityConfirmed, false); assert.equal(item.evidence.foodProcessingApproved, false);
    keys(item.rights, "statementUrl licenseName licenseUrl scope reviewState conditions endorsementGranted");
    https(item.rights.statementUrl); if (item.rights.licenseUrl) https(item.rights.licenseUrl);
    assert.equal(item.rights.scope, rightsScope); assert.equal(item.rights.reviewState, "pending");
    assert.equal(item.rights.endorsementGranted, false);
    for (const list of [item.limitations, item.rights.conditions]) { assert(Array.isArray(list) && list.length >= 2); list.forEach(text); }
  });
  const [tari, goji, kinmen] = record.sourceScreeningObservations;
  assert.equal(tari.source.url, "https://www.tari.gov.tw/scholars/100up/2-%E6%8A%80%E8%A1%93%E6%9C%8D%E5%8B%99/%E7%AC%AC92%E6%9C%9F/11.pdf");
  assert.equal(tari.source.indexUrl, "https://www.tari.gov.tw/publication/index-1.asp?Parser=99,9,55,,,,,,,,,84");
  assert.deepEqual([tari.source.authors, tari.source.authorRole, tari.media.creator, tari.media.createdAt],
    [["賴瑞聲", "吳明哲"], "article_authors_not_verified_photographers", null, null]);
  assert.equal(tari.source.contentReadState, "pdf_text_read_pixels_unavailable");
  assert.equal(tari.evidence.previousObservationId, "refresh-dihuang-tari-technical-2013");
  assert.equal(tari.evidence.basis, "pdf_text_and_official_publication_index");
  assert.equal(tari.evidence.sourceStatement, "图一标注台湾栽培地黄植株形态；图二标注台湾栽培鲜地黄。");
  assert.deepEqual([tari.source.modifiedAt, tari.source.permanentUrl], [null, null]);
  assert.equal(tari.media.imageUrl, null); assert.equal(tari.rights.licenseUrl, "https://data.gov.tw/license");
  assert.equal(tari.rights.licenseName, "政府資料開放授權條款第1版");
  assert.equal(tari.rights.statementUrl, "https://www.tari.gov.tw/content/index.asp?Parser=1,12,1167");
  assert.equal(goji.source.permanentUrl, "https://commons.wikimedia.org/w/index.php?title=File:Goji_Berries.jpg&oldid=1275056738");
  assert.equal(goji.evidence.sourceStatement, "Formerly frozen goji berries");
  assert.equal(goji.evidence.basis, "file_description_not_visual_exclusion");
  assert.equal(goji.source.url, "https://commons.wikimedia.org/wiki/File:Goji_Berries.jpg");
  assert.deepEqual([goji.source.authors, goji.source.authorRole, goji.source.contentReadState],
    [["GiryaGirl"], "uploader_claimed_own_work", "file_description_read_no_pixels"]);
  assert.deepEqual([goji.media.createdAt, goji.media.creator, goji.source.modifiedAt], ["2010-11-15", "GiryaGirl", "2026-09-11"]);
  assert.equal(goji.media.imageUrl, null); assert.equal(goji.rights.licenseName, "CC BY-SA 3.0 Unported");
  assert.equal(goji.rights.licenseUrl, "https://creativecommons.org/licenses/by-sa/3.0/");
  assert.equal(goji.rights.statementUrl, goji.source.url);
  assert.equal(kinmen.source.url, "https://forestry.kinmen.gov.tw/cp.aspx?n=58d011d2ffc02457");
  assert.deepEqual([kinmen.source.authors, kinmen.source.authorRole, kinmen.source.contentReadState, kinmen.source.modifiedAt],
    [[], "not_stated", "page_image_link_text_read_no_pixels", null]);
  assert.equal(kinmen.evidence.basis, "publisher_image_link_alt_text_only");
  assert.equal(kinmen.evidence.sourceStatement, "天門冬根部塊莖可供藥用");
  assert.equal(kinmen.media.imageUrl, "https://ws.kinmen.gov.tw/001/Upload/322/attachment/9af4b4b2-a714-4ed9-8377-fe1a3db470cc.jpg");
  assert.equal(kinmen.rights.statementUrl, "https://forestry.kinmen.gov.tw/cp.aspx?n=04987679191D96B4");
  assert.deepEqual([kinmen.rights.licenseName, kinmen.rights.licenseUrl, kinmen.media.creator, kinmen.media.createdAt], [null, null, null, null]);
  for (const item of [goji, kinmen]) assert.deepEqual([item.source.indexUrl, item.evidence.previousObservationId], [null, null]);
  assert.equal(kinmen.source.permanentUrl, null);
  assert.equal(record.retrievalIssues.length, 7);
  const issueUrls = ["https://www.tari.gov.tw/df_ufiles/d/technical_2013_013.jpg", tari.source.url, kinmen.media.imageUrl,
    "https://www.mdpi.com/2304-8158/14/22/3932", "https://pmc.ncbi.nlm.nih.gov/articles/PMC12651911/",
    "https://www.sciencedirect.com/science/article/pii/S2590157525008685", "https://pmc.ncbi.nlm.nih.gov/articles/PMC12466303/"];
  const outcomes = ["image_preview_cache_miss", "pdf_text_read_screenshot_cache_miss", "image_preview_cache_miss",
    "http_429_article_not_read", "browser_verification_article_not_read", "http_403_article_not_read", "browser_verification_article_not_read"];
  record.retrievalIssues.forEach((issue, index) => {
    keys(issue, "url outcome automaticRetry"); https(issue.url);
    assert.equal(issue.url, issueUrls[index]);
    assert.equal(issue.outcome, outcomes[index]); assert.equal(issue.automaticRetry, false);
  });
  return { checkedAt: record.checkedAt, sourceScreeningObservations: 3, visualReviewsPerformed: 0,
    localImagesVerified: 0, photoCandidatesAdded: 0, gapsClosed: 0, publicPhotos: 0, assertions: "passed" };
}
function tokens(record) {
  return record.sourceScreeningObservations.flatMap(item => [item.id, item.source.url, item.source.indexUrl,
    item.source.permanentUrl, item.media.imageUrl, item.rights.statementUrl, item.rights.licenseUrl]).filter(Boolean);
}
module.exports = { RECORD_PATH, validate, tokens };
