"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const { expectedIngredientReviewDigest } = require("./recipe-digests");
const { readImageDimensions: readWebpDimensions } = require("./media-draft-core");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_RELATIVE = "content-private/media-candidates/specimens/manifest.json";
const PRIVATE_PREFIX = "content-private/media-candidates/specimens/";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PART_VISIBILITY = new Set(["no", "partial_unverified", "unclear"]);
const VISUAL_USABILITY = new Set(["context_only", "poor"]);
const PRIVATE_SOURCE_DATE = "2026-08-10";
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LICENSE_URLS = new Set([
  "http://creativecommons.org/licenses/by/4.0/legalcode",
  "http://creativecommons.org/licenses/by/4.0/",
  "http://creativecommons.org/publicdomain/zero/1.0/legalcode",
  "http://creativecommons.org/publicdomain/zero/1.0/"
]);
const SCIENTIFIC_NAME_EQUIVALENCES = new Map([
  ["Gastrodia elata Blume\u0000Gastrodia elata Bl.", {
    matchType: "explicit_author_abbreviation",
    taxonReferenceId: "urn:lsid:ipni.org:names:635522-1"
  }],
  ["Amomum tsao-ko Crevost & Lemari\u00e9\u0000Amomum tsao-ko Crevost et Lemaire", {
    matchType: "explicit_authorship_equivalence",
    taxonReferenceId: "gbif:5635718"
  }],
  ["Cornus officinalis Siebold & Zucc.\u0000Cornus officinalis Sieb. et Zucc.", {
    matchType: "explicit_author_abbreviation",
    taxonReferenceId: "gbif:7161076"
  }]
]);

class SpecimenCandidateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpecimenCandidateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SpecimenCandidateError(code, message);
}

function ensure(condition, code, message) {
  if (!condition) fail(code, message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Buffer(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function scientificNameBinding(sourceName, catalogName) {
  if (typeof sourceName !== "string" || typeof catalogName !== "string" ||
    !sourceName.trim() || !catalogName.trim()) return null;
  if (sourceName === catalogName) return { matchType: "exact_text", taxonReferenceId: null };
  return SCIENTIFIC_NAME_EQUIVALENCES.get(sourceName + "\u0000" + catalogName) || null;
}

function expectedSourceMetadataDigest(source) {
  const canonical = {
    provider: source.provider,
    gbifKey: source.gbifKey,
    occurrenceUrl: source.occurrenceUrl,
    occurrenceID: source.occurrenceID,
    scientificName: source.scientificName,
    catalogScientificName: source.catalogScientificName,
    scientificNameMatch: source.scientificNameMatch,
    taxonReferenceId: source.taxonReferenceId,
    taxonKey: source.taxonKey,
    acceptedTaxonKey: source.acceptedTaxonKey,
    acceptedScientificName: source.acceptedScientificName,
    datasetKey: source.datasetKey,
    basisOfRecord: source.basisOfRecord,
    gbifIssues: source.gbifIssues,
    institutionCode: source.institutionCode,
    collectionCode: source.collectionCode,
    catalogNumber: source.catalogNumber,
    occurrenceLicense: source.occurrenceLicense,
    occurrenceRightsHolder: source.occurrenceRightsHolder,
    publishingOrgKey: source.publishingOrgKey,
    mediaType: source.mediaType,
    mediaIdentifier: source.mediaIdentifier,
    mediaLicense: source.mediaLicense,
    mediaCreator: source.mediaCreator,
    mediaRightsHolder: source.mediaRightsHolder,
    mediaPublisher: source.mediaPublisher,
    mediaReferences: source.mediaReferences,
    sourceCheckedAt: source.sourceCheckedAt
  };
  return sha256Buffer(Buffer.from(JSON.stringify(canonical), "utf8"));
}

function resolvePrivateFile(root, relative, label) {
  ensure(typeof relative === "string" && relative.length > 0, "invalid_path", label + " is missing");
  const portable = relative.replace(/\\/g, "/");
  const normalized = path.posix.normalize(portable);
  ensure(portable === normalized && normalized.startsWith(PRIVATE_PREFIX) && !normalized.includes("/../"),
    "private_boundary", label + " leaves the specimen candidate directory");
  const workspace = path.resolve(root);
  const file = path.resolve(workspace, ...normalized.split("/"));
  const boundary = path.relative(workspace, file);
  ensure(boundary && boundary !== ".." && !boundary.startsWith(".." + path.sep) && !path.isAbsolute(boundary),
    "path_escape", label + " escapes the workspace");
  ensure(fs.existsSync(file), "missing_asset", label + " is missing");
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "unsafe_asset", label + " must be a regular non-link file");
  return { file, stat, normalized };
}

function readJpegDimensions(buffer, label) {
  ensure(buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8, "invalid_jpeg", label + " is not JPEG");
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    ensure(offset + 2 <= buffer.length, "invalid_jpeg", label + " has a truncated segment");
    const length = buffer.readUInt16BE(offset);
    ensure(length >= 2 && offset + length <= buffer.length, "invalid_jpeg", label + " has an invalid segment");
    if (sof.has(marker)) {
      ensure(length >= 7, "invalid_jpeg", label + " has an invalid frame");
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  fail("invalid_jpeg", label + " has no supported frame");
}

function readCandidateDimensions(buffer, mimeType, label) {
  if (mimeType === "image/jpeg") return readJpegDimensions(buffer, label);
  if (mimeType === "image/webp") return readWebpDimensions(buffer, mimeType, label);
  fail("invalid_mime", label + " has unsupported mimeType");
}

function validateAsset(root, asset, label) {
  ensure(isObject(asset), "invalid_asset", label + " must be an object");
  const resolved = resolvePrivateFile(root, asset.path, label + ".path");
  const extension = path.extname(resolved.normalized).toLowerCase();
  ensure((extension === ".jpg" && asset.mimeType === "image/jpeg") ||
    (extension === ".webp" && asset.mimeType === "image/webp"), "mime_mismatch", label + " extension and MIME differ");
  const buffer = fs.readFileSync(resolved.file);
  ensure(Number.isInteger(asset.bytes) && asset.bytes === buffer.length, "byte_mismatch", label + " byte count drifted");
  ensure(DIGEST_PATTERN.test(asset.sha256 || "") && sha256Buffer(buffer) === asset.sha256,
    "digest_mismatch", label + " digest drifted");
  const dimensions = readCandidateDimensions(buffer, asset.mimeType, label);
  ensure(dimensions.width === asset.width && dimensions.height === asset.height, "dimension_mismatch", label + " dimensions drifted");
  return buffer;
}

function validateRecord(root, record, index) {
  const label = "records[" + index + "]";
  ensure(isObject(record) && /^specimen-[a-z0-9.-]+$/.test(record.id || ""), "invalid_record", label + " id is invalid");
  const ingredient = catalog.ingredients.find((item) => item.id === record.ingredientId);
  ensure(ingredient, "unknown_ingredient", label + " ingredient does not exist");
  ensure(record.status === "candidate" && record.role === "origin_specimen_reference" &&
    record.publicationEligible === false && Array.isArray(record.placements) && record.placements.length === 0,
  "unsafe_publication", label + " must remain an unplaced private candidate");

  const depiction = record.depiction;
  ensure(isObject(depiction) && depiction.canonicalName === ingredient.name &&
    depiction.latinName === ingredient.identity.latinName && depiction.catalogPart === ingredient.identity.ediblePart,
  "ingredient_binding", label + " no longer matches catalog identity");
  ensure(typeof depiction.shownMaterial === "string" && depiction.shownMaterial.length > 0 &&
    PART_VISIBILITY.has(depiction.catalogPartVisibility) && VISUAL_USABILITY.has(depiction.visualUsability) &&
    Array.isArray(depiction.riskNotes) && depiction.riskNotes.length >= 2,
  "invalid_depiction", label + " visual assessment is incomplete");
  ensure(depiction.identificationUse === "prohibited" && depiction.medicalUse === "prohibited",
    "unsafe_depiction", label + " must prohibit identification and medical use");

  const source = record.source;
  ensure(isObject(source) && Number.isInteger(source.gbifKey) &&
    source.occurrenceUrl === "https://www.gbif.org/occurrence/" + source.gbifKey,
  "source_binding", label + " GBIF source is invalid");
  const nameBinding = scientificNameBinding(source.scientificName, ingredient.identity.latinName);
  ensure(typeof source.catalogNumber === "string" && source.catalogNumber.length > 0 &&
    typeof source.occurrenceID === "string" && source.occurrenceID.length > 0 && nameBinding &&
    source.catalogScientificName === ingredient.identity.latinName &&
    source.scientificNameMatch === nameBinding.matchType &&
    source.taxonReferenceId === nameBinding.taxonReferenceId &&
    Number.isInteger(source.taxonKey) && source.taxonKey > 0 &&
    Number.isInteger(source.acceptedTaxonKey) && source.acceptedTaxonKey > 0 &&
    typeof source.acceptedScientificName === "string" && source.acceptedScientificName.length > 0 &&
    (!String(source.taxonReferenceId || "").startsWith("gbif:") ||
      source.taxonKey === Number(source.taxonReferenceId.slice(5))),
  "source_binding", label + " specimen identity is incomplete");
  ensure(source.provider === "GBIF occurrence API and linked collection" &&
    UUID_PATTERN.test(source.datasetKey || "") && source.basisOfRecord === "PRESERVED_SPECIMEN" &&
    Array.isArray(source.gbifIssues) && source.gbifIssues.every((issue) => /^[A-Z][A-Z0-9_]+$/.test(issue)) &&
    (source.institutionCode === null || (typeof source.institutionCode === "string" && source.institutionCode.length > 0)) &&
    (source.collectionCode === null || (typeof source.collectionCode === "string" && source.collectionCode.length > 0)) &&
    (source.occurrenceRightsHolder === null || (typeof source.occurrenceRightsHolder === "string" && source.occurrenceRightsHolder.length > 0)) &&
    UUID_PATTERN.test(source.publishingOrgKey || "") &&
    (source.mediaCreator === null || (typeof source.mediaCreator === "string" && source.mediaCreator.length > 0)) &&
    (source.mediaRightsHolder === null || (typeof source.mediaRightsHolder === "string" && source.mediaRightsHolder.length > 0)) &&
    (source.mediaPublisher === null || (typeof source.mediaPublisher === "string" && source.mediaPublisher.length > 0)) &&
    (source.mediaReferences === null || /^https:\/\//.test(source.mediaReferences)),
  "source_binding", label + " collection attribution is invalid");
  ensure(source.mediaType === "StillImage" && /^https:\/\//.test(source.mediaIdentifier || "") &&
    LICENSE_URLS.has(source.occurrenceLicense) &&
    (source.mediaLicense === null || LICENSE_URLS.has(source.mediaLicense)),
  "source_binding", label + " media or license URL is invalid");
  ensure(source.sourceCheckedAt === PRIVATE_SOURCE_DATE && source.rightsReviewState === "pending",
    "unsafe_rights_state", label + " rights review must remain pending");
  ensure(DIGEST_PATTERN.test(source.sourceMetadataDigest || "") &&
    source.sourceMetadataDigest === expectedSourceMetadataDigest(source),
  "source_digest", label + " source metadata digest drifted");

  ensure(isObject(record.assets), "invalid_asset", label + " assets are missing");
  validateAsset(root, record.assets.original, label + ".assets.original");
  validateAsset(root, record.assets.review, label + ".assets.review");
  ensure(record.assets.original.mimeType === "image/jpeg" && record.assets.review.mimeType === "image/webp" &&
    Math.max(record.assets.review.width, record.assets.review.height) <= 1200 &&
    record.assets.review.bytes <= 100 * 1024, "review_budget", label + " review derivative exceeds limits");

  ensure(record.bindings.catalogContentVersion === catalog.contentVersion &&
    record.bindings.rulesVersion === ruleSet.contentVersion &&
    record.bindings.ingredientDigest === expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion),
  "version_binding", label + " material binding drifted");
  ensure(isObject(record.audit) && record.audit.identityReviewState === "pending" &&
    record.audit.rightsReviewState === "pending" && record.audit.professionalReviewState === "pending" &&
    Array.isArray(record.audit.reviews) && record.audit.reviews.length === 0,
  "unsafe_audit_state", label + " cannot claim review");
  return record.id;
}

function validateManifest(manifest, root = ROOT) {
  ensure(isObject(manifest) && manifest.schemaVersion === "1.0.0" &&
    /^\d{4}\.\d{2}\.\d{2}-specimen-candidate\.\d+$/.test(manifest.contentVersion || "") &&
    typeof manifest.createdAt === "string" && !Number.isNaN(Date.parse(manifest.createdAt)) &&
    manifest.scope === "private_review_only" && Array.isArray(manifest.records) &&
    manifest.count === manifest.records.length && manifest.records.length > 0,
  "invalid_manifest", "Specimen candidate manifest is invalid");
  ensure(isObject(manifest.policy) && manifest.policy.clientUploadAllowed === false &&
    manifest.policy.runtimeReferenceAllowed === false && manifest.policy.identificationUse === "prohibited" &&
    manifest.policy.medicalUse === "prohibited", "unsafe_policy", "Specimen policy must fail closed");
  const ids = manifest.records.map((record, index) => validateRecord(root, record, index));
  ensure(new Set(ids).size === ids.length, "duplicate_id", "Specimen candidate ids must be unique");
  return {
    count: manifest.count,
    originalBytes: manifest.records.reduce((sum, record) => sum + record.assets.original.bytes, 0),
    reviewBytes: manifest.records.reduce((sum, record) => sum + record.assets.review.bytes, 0)
  };
}

function loadAndValidate(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ...MANIFEST_RELATIVE.split("/")), "utf8"));
  return { manifest, result: validateManifest(manifest, root) };
}

module.exports = {
  MANIFEST_RELATIVE,
  SpecimenCandidateError,
  loadAndValidate,
  readCandidateDimensions,
  expectedSourceMetadataDigest,
  scientificNameBinding,
  sha256Buffer,
  validateManifest
};
