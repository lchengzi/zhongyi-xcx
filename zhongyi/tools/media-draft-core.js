"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { expectedIngredientReviewDigest } = require("./recipe-digests");

const MANIFEST_RELATIVE = "content-private/media-drafts/manifest.json";
const PRIVATE_PREFIX = "content-private/media-drafts/";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REQUIRED_REVIEW_ROLES = Object.freeze([
  "pharmacognosy_reviewer",
  "pharmacist",
  "compliance",
  "rights_clearance",
  "release_approver"
]);

class MediaDraftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MediaDraftError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new MediaDraftError(code, message);
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

function normalizedPrivatePath(value, label) {
  ensure(typeof value === "string" && value.length > 0, "invalid_path", label + " must be a non-empty path");
  const portable = value.replace(/\\/g, "/");
  const normalized = path.posix.normalize(portable);
  ensure(portable === normalized && !normalized.startsWith("/") && normalized.startsWith(PRIVATE_PREFIX),
    "private_boundary", label + " must stay under " + PRIVATE_PREFIX);
  ensure(!normalized.includes("/../") && !normalized.endsWith("/.."), "path_escape", label + " contains traversal");
  return normalized;
}

function resolvePrivateFile(root, relative, label) {
  const normalized = normalizedPrivatePath(relative, label);
  const workspace = path.resolve(root);
  const file = path.resolve(workspace, ...normalized.split("/"));
  const boundary = path.relative(workspace, file);
  ensure(boundary && !boundary.startsWith(".." + path.sep) && boundary !== ".." && !path.isAbsolute(boundary),
    "path_escape", label + " escapes the workspace");
  ensure(fs.existsSync(file), "missing_asset", label + " is missing: " + normalized);
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "unsafe_asset", label + " must be a regular non-link file");
  return { file, stat, normalized };
}

function readPngDimensions(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  ensure(buffer.length >= 24 && buffer.subarray(0, 8).equals(signature), "invalid_png", label + " is not a PNG");
  ensure(buffer.toString("ascii", 12, 16) === "IHDR", "invalid_png", label + " has no IHDR header");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readWebpDimensions(buffer, label) {
  ensure(buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP",
    "invalid_webp", label + " is not a WebP file");
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    ensure(dataOffset + chunkSize <= buffer.length, "invalid_webp", label + " has a truncated " + type + " chunk");
    if (type === "VP8X") {
      ensure(chunkSize >= 10, "invalid_webp", label + " has an invalid VP8X chunk");
      return {
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3)
      };
    }
    if (type === "VP8 ") {
      ensure(chunkSize >= 10 && buffer[dataOffset + 3] === 0x9d && buffer[dataOffset + 4] === 0x01 &&
        buffer[dataOffset + 5] === 0x2a, "invalid_webp", label + " has an invalid VP8 frame");
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      };
    }
    if (type === "VP8L") {
      ensure(chunkSize >= 5 && buffer[dataOffset] === 0x2f, "invalid_webp", label + " has an invalid VP8L frame");
      const b1 = buffer[dataOffset + 1];
      const b2 = buffer[dataOffset + 2];
      const b3 = buffer[dataOffset + 3];
      const b4 = buffer[dataOffset + 4];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  fail("invalid_webp", label + " has no supported image chunk");
}

function readImageDimensions(buffer, mimeType, label) {
  if (mimeType === "image/png") return readPngDimensions(buffer, label);
  if (mimeType === "image/webp") return readWebpDimensions(buffer, label);
  fail("invalid_mime", label + " uses unsupported mimeType " + mimeType);
}

function validateFileDescriptor(root, descriptor, label) {
  ensure(isObject(descriptor), "invalid_asset", label + " must be an object");
  const allowedMimes = new Map([[".png", "image/png"], [".webp", "image/webp"]]);
  const resolved = resolvePrivateFile(root, descriptor.path, label + ".path");
  const extension = path.extname(resolved.normalized).toLowerCase();
  ensure(allowedMimes.get(extension) === descriptor.mimeType, "mime_mismatch", label + " extension and mimeType do not match");
  ensure(Number.isInteger(descriptor.bytes) && descriptor.bytes === resolved.stat.size, "byte_mismatch", label + ".bytes drifted");
  ensure(DIGEST_PATTERN.test(descriptor.sha256 || ""), "invalid_digest", label + ".sha256 is invalid");
  const buffer = fs.readFileSync(resolved.file);
  ensure(sha256Buffer(buffer) === descriptor.sha256, "digest_mismatch", label + ".sha256 drifted");
  const dimensions = readImageDimensions(buffer, descriptor.mimeType, label);
  ensure(Number.isInteger(descriptor.width) && descriptor.width === dimensions.width, "dimension_mismatch", label + ".width drifted");
  ensure(Number.isInteger(descriptor.height) && descriptor.height === dimensions.height, "dimension_mismatch", label + ".height drifted");
  return { ...resolved, buffer };
}

function validatePromptRecord(root, record, label) {
  const descriptor = record.generation.promptRecord;
  ensure(isObject(descriptor), "missing_prompt_record", label + ".generation.promptRecord is required");
  const resolved = resolvePrivateFile(root, descriptor.path, label + ".generation.promptRecord.path");
  ensure(path.extname(resolved.normalized).toLowerCase() === ".json", "invalid_prompt_record", label + " prompt record must be JSON");
  ensure(Number.isInteger(descriptor.bytes) && descriptor.bytes === resolved.stat.size, "byte_mismatch", label + " prompt record bytes drifted");
  ensure(DIGEST_PATTERN.test(descriptor.sha256 || ""), "invalid_digest", label + " prompt digest is invalid");
  const bytes = fs.readFileSync(resolved.file);
  ensure(sha256Buffer(bytes) === descriptor.sha256, "digest_mismatch", label + " prompt record digest drifted");
  let prompt;
  try {
    prompt = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail("invalid_prompt_record", label + " prompt record is invalid JSON: " + error.message);
  }
  ensure(prompt.schemaVersion === "1.0.0" && prompt.ingredientId === record.ingredientId,
    "prompt_binding", label + " prompt ingredient binding drifted");
  ensure(prompt.mode === "text_to_image" && typeof prompt.prompt === "string" && prompt.prompt.trim().length >= 100,
    "invalid_prompt_record", label + " prompt record is incomplete");
  ensure(prompt.providerName === record.generation.providerName &&
    prompt.providerOutputFileId === record.generation.providerOutputFileId,
  "prompt_binding", label + " provider binding drifted");
  ensure(prompt.generatedAt === record.generation.generatedAt && !Number.isNaN(Date.parse(prompt.generatedAt)),
    "prompt_binding", label + " generation timestamp drifted");
}

function validateRecord(root, record, index, catalog, ruleSet) {
  const label = "records[" + index + "]";
  ensure(isObject(record), "invalid_record", label + " must be an object");
  ensure(typeof record.id === "string" && /^media-[a-z0-9-]+-v\d{2}$/.test(record.id), "invalid_id", label + ".id is invalid");
  const ingredient = catalog.ingredients.find((item) => item.id === record.ingredientId);
  ensure(ingredient, "unknown_ingredient", label + ".ingredientId does not exist in the catalog");
  ensure(record.status === "draft" && record.role === "ingredient_context_illustration",
    "unsafe_status", label + " must remain a context-illustration draft");
  ensure(Array.isArray(record.placements) && record.placements.length === 0,
    "unsafe_placement", label + " cannot have runtime placements before review");
  ensure(record.publicationEligible === false, "unsafe_publication", label + " cannot be publication eligible");

  const depiction = record.depiction;
  ensure(isObject(depiction), "invalid_depiction", label + ".depiction is required");
  ensure(depiction.canonicalName === ingredient.name && depiction.latinName === ingredient.identity.latinName &&
    depiction.depictedPart === ingredient.identity.ediblePart,
  "ingredient_binding", label + " depiction no longer matches the catalog identity text");
  ensure(depiction.state === "unverified_ai_interpretation" && depiction.identityClaim === "none" &&
    depiction.identificationUse === "prohibited" && depiction.medicalUse === "prohibited",
  "unsafe_depiction", label + " must not carry identity or medical claims");

  const generation = record.generation;
  ensure(isObject(generation) && generation.method === "ai_generated" &&
    typeof generation.providerName === "string" && generation.providerName.length > 0,
  "invalid_generation", label + ".generation is incomplete");
  ensure(typeof generation.providerOutputFileId === "string" && /^exec-[a-f0-9-]{36}$/.test(generation.providerOutputFileId),
    "invalid_generation", label + ".providerOutputFileId is invalid");
  ensure(!Number.isNaN(Date.parse(generation.generatedAt)), "invalid_generation", label + ".generatedAt is invalid");
  ensure(generation.explicitLabelState === "missing_private_draft" &&
    generation.implicitLabelState === "unverified_provider_original" &&
    generation.derivativeMetadataState === "unverified_after_conversion",
  "unsafe_label_state", label + " must fail closed until visible and implicit labels are verified");
  validatePromptRecord(root, record, label);

  const provenance = record.provenance;
  ensure(isObject(provenance) && provenance.rightsStatus === "pending_compliance_review" &&
    Array.isArray(provenance.licenseEvidenceIds) && provenance.licenseEvidenceIds.length === 0,
  "unsafe_rights_state", label + " must remain pending rights review");

  ensure(isObject(record.assets), "invalid_assets", label + ".assets is required");
  const original = validateFileDescriptor(root, record.assets.original, label + ".assets.original");
  validateFileDescriptor(root, record.assets.review, label + ".assets.review");
  const thumbnail = validateFileDescriptor(root, record.assets.thumbnailReview, label + ".assets.thumbnailReview");
  ensure(record.assets.original.mimeType === "image/png" && record.assets.original.width === 1254 &&
    record.assets.original.height === 1254, "invalid_original", label + " original dimensions are unexpected");
  ensure(record.assets.review.mimeType === "image/webp" && record.assets.review.width === 768 &&
    record.assets.review.height === 768, "invalid_review_asset", label + " review derivative must be 768x768 WebP");
  ensure(record.assets.thumbnailReview.mimeType === "image/webp" && record.assets.thumbnailReview.width === 320 &&
    record.assets.thumbnailReview.height === 320 && record.assets.thumbnailReview.bytes <= 12 * 1024,
  "thumbnail_budget", label + " thumbnail review derivative exceeds the 12 KiB budget");
  const originalText = original.buffer.toString("latin1");
  ensure(originalText.includes("c2pa") && originalText.includes("jumb"),
    "missing_origin_metadata", label + " original lacks detectable generation provenance metadata");
  ensure(!thumbnail.buffer.toString("latin1").includes("c2pa"),
    "derivative_state_drift", label + " thumbnail metadata state must be reviewed if provenance survives conversion");

  const bindings = record.bindings;
  ensure(isObject(bindings) && bindings.catalogContentVersion === catalog.contentVersion &&
    bindings.rulesVersion === ruleSet.contentVersion, "version_binding", label + " catalog or rules binding drifted");
  const expectedDigest = expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion);
  ensure(bindings.ingredientDigest === expectedDigest, "ingredient_digest", label + " ingredient digest drifted");

  ensure(isObject(record.audit) && record.audit.reviewState === "pending" && Array.isArray(record.audit.reviews) &&
    record.audit.reviews.length === 0 && record.audit.finalApprovedAt === null && record.audit.nextReviewAt === null,
  "unsafe_audit_state", label + " cannot claim review or approval");
  return record.id;
}

function validateManifest(manifest, root, catalog, ruleSet) {
  ensure(isObject(manifest), "invalid_manifest", "Media draft manifest must be an object");
  ensure(manifest.schemaVersion === "1.0.0" && typeof manifest.contentVersion === "string" &&
    manifest.contentVersion.length > 0, "invalid_manifest", "Media draft manifest version is invalid");
  ensure(manifest.scope === "private_review_only" && !Number.isNaN(Date.parse(manifest.createdAt)),
    "invalid_manifest", "Media draft manifest scope or timestamp is invalid");
  ensure(isObject(manifest.policy) && manifest.policy.clientUploadAllowed === false &&
    manifest.policy.runtimeReferenceAllowed === false && manifest.policy.identityUse === "prohibited" &&
    manifest.policy.medicalUse === "prohibited", "unsafe_policy", "Media draft policy must fail closed");
  ensure(JSON.stringify(manifest.policy.requiredReviewRoles) === JSON.stringify(REQUIRED_REVIEW_ROLES),
    "review_roles", "Media draft required review roles drifted");
  ensure(typeof manifest.policy.futureVisibleDisclosure === "string" &&
    manifest.policy.futureVisibleDisclosure.includes("AI生成示意图") &&
    manifest.policy.futureVisibleDisclosure.includes("不可用于"),
  "missing_disclosure", "Media draft disclosure is incomplete");
  ensure(Array.isArray(manifest.records) && manifest.count === manifest.records.length &&
    manifest.records.length > 0, "invalid_count", "Media draft count is invalid");
  const ids = manifest.records.map((record, index) => validateRecord(root, record, index, catalog, ruleSet));
  ensure(new Set(ids).size === ids.length, "duplicate_id", "Media draft IDs must be unique");
  const ingredientIds = manifest.records.map((record) => record.ingredientId);
  ensure(new Set(ingredientIds).size === ingredientIds.length,
    "duplicate_ingredient", "Only one unreviewed draft is allowed per ingredient in this batch");
  return {
    count: manifest.count,
    bytes: manifest.records.reduce((sum, record) =>
      sum + Object.values(record.assets).reduce((assetSum, asset) => assetSum + asset.bytes, 0), 0)
  };
}

function loadAndValidate(root = path.resolve(__dirname, "..")) {
  const manifestPath = path.join(root, ...MANIFEST_RELATIVE.split("/"));
  ensure(fs.existsSync(manifestPath), "missing_manifest", "Missing " + MANIFEST_RELATIVE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  const catalog = require(path.join(root, "data", "ingredients.js"));
  const ruleSet = require(path.join(root, "data", "rule-set.js"));
  return { manifest, result: validateManifest(manifest, root, catalog, ruleSet) };
}

module.exports = {
  MANIFEST_RELATIVE,
  MediaDraftError,
  REQUIRED_REVIEW_ROLES,
  loadAndValidate,
  readImageDimensions,
  sha256Buffer,
  validateManifest
};
