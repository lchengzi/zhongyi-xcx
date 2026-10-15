"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const { expectedIngredientReviewDigest } = require("./recipe-digests");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_RELATIVE = "content-private/media-candidates/food-forms/manifest.json";
const PRIVATE_PREFIX = "content-private/media-candidates/food-forms/";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SOURCE_DATE = "2026-08-10";
const EXPECTED_TARGET_IDS = Object.freeze([
  "shan-nai",
  "dang-shen",
  "rou-cong-rong-huang-mo",
  "tie-pi-shi-hu",
  "xi-yang-shen",
  "huang-qi",
  "ling-zhi",
  "gou-qi-zi",
  "di-huang",
  "mai-dong",
  "tian-dong",
  "hua-ju-hong",
  "jiang-huang",
  "xi-hong-hua",
  "dang-gui",
  "tian-ma",
  "cao-guo",
  "bi-ba",
  "du-zhong-ye",
  "shan-zhu-yu"
]);
const REQUIRED_REVIEW_ROLES = Object.freeze([
  "pharmacognosy_reviewer",
  "pharmacist",
  "compliance",
  "rights_clearance",
  "release_approver"
]);
const MULTI_ORIGIN_IDS = new Set(["dang-shen", "huang-qi", "ling-zhi", "hua-ju-hong"]);
const PROCESSING_STATES = new Set([
  "fresh_harvested",
  "dried_cut_segments",
  "unprocessed_stems",
  "dried_rolled",
  "dried_sliced",
  "dried_whole",
  "dried_root_tubers",
  "dried_outer_peel",
  "unprocessed_leaves",
  "multiple_processed_leaf_forms",
  "source_claimed_form_unverified"
]);
const PART_ALIGNMENTS = new Set([
  "visible_claimed_part_unverified",
  "processed_part_claim_unverified"
]);
const NAME_MATCH_STATES = new Set([
  "declared_name_aligns_unverified",
  "explicit_equivalence_pending"
]);
const TAXON_EVIDENCE_KINDS = new Set([
  "caption",
  "structured_depicts",
  "commons_category",
  "common_name",
  "peer_reviewed_materials_methods"
]);
const SOURCE_ORIGIN_BINDINGS = new Map([
  ["shan-nai\u0000Kaempferia galanga\u0000commons_category", "explicit_equivalence_pending"],
  ["dang-shen\u0000Codonopsis pilosula\u0000caption", "declared_name_aligns_unverified"],
  ["rou-cong-rong-huang-mo\u0000Cistanche deserticola\u0000structured_depicts", "declared_name_aligns_unverified"],
  ["tie-pi-shi-hu\u0000Dendrobium officinale\u0000caption", "declared_name_aligns_unverified"],
  ["tie-pi-shi-hu\u0000Dendrobium officinale\u0000structured_depicts", "declared_name_aligns_unverified"],
  ["xi-yang-shen\u0000American ginseng\u0000common_name", "explicit_equivalence_pending"],
  ["huang-qi\u0000Astragalus mongholicus\u0000caption", "explicit_equivalence_pending"],
  ["ling-zhi\u0000Ganoderma lucidum\u0000structured_depicts", "explicit_equivalence_pending"],
  ["mai-dong\u0000Ophiopogon japonicus\u0000structured_depicts", "declared_name_aligns_unverified"],
  ["hua-ju-hong\u0000Citrus maxima var. Tomentosa\u0000structured_depicts", "explicit_equivalence_pending"],
  ["jiang-huang\u0000Curcuma longa\u0000commons_category", "declared_name_aligns_unverified"],
  ["xi-hong-hua\u0000Crocus sativus\u0000structured_depicts", "declared_name_aligns_unverified"],
  ["dang-gui\u0000Angelica sinensis\u0000structured_depicts", "declared_name_aligns_unverified"],
  ["tian-ma\u0000Gastrodia elata\u0000structured_depicts", "declared_name_aligns_unverified"],
  ["cao-guo\u0000Lanxangia tsao-ko\u0000structured_depicts", "explicit_equivalence_pending"],
  ["bi-ba\u0000Piper longum\u0000commons_category", "declared_name_aligns_unverified"],
  ["du-zhong-ye\u0000Eucommia ulmoides\u0000caption", "declared_name_aligns_unverified"],
  ["du-zhong-ye\u0000Eucommia ulmoides Oliv.\u0000peer_reviewed_materials_methods", "declared_name_aligns_unverified"],
  ["shan-zhu-yu\u0000Cornus officinalis\u0000structured_depicts", "declared_name_aligns_unverified"]
]);
const GAP_REASONS = new Set([
  "identity_pending_no_vouchered_food_form",
  "no_tuber_or_processed_form_candidate_found"
]);
const LICENSES = new Map([
  ["CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  ["CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/"],
  ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"]
]);
const FORBIDDEN_WEBP_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);
const APPROVED_CANDIDATE_BINDINGS = new Map([
  ["food-form-shan-nai-rhizome-v01", ["shan-nai", "sha256:f3ef9b32a97442723efd6628e886dbdf7345a11d8f43f475a1551f29e7474bbf", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:b7985f89b92dee6dfe07052e19caf3e077b19ff836020b1e5684ee54a5cfd9b1"]],
  ["food-form-dang-shen-dried-segments-v01", ["dang-shen", "sha256:8d0c468be4ed24b15bdcc8b4ebee5f8e869691683243e6d12a4d973ab310d2bb", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:df59db88ba36a76305a384e751c5ca5963121be2f4757fb2d3ee1a0f850caba8"]],
  ["food-form-rou-cong-rong-dried-stem-v01", ["rou-cong-rong-huang-mo", "sha256:d152f0f3b7a2d8351e33de2fb6ceeeb577ddfb8d26b5bf9632f8b69ebaf7681e", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:d2f9785314ccada51082eba86b07559faa2eebdda572461d1c79938e879ea9c9"]],
  ["food-form-tie-pi-shi-hu-stems-v01", ["tie-pi-shi-hu", "sha256:ad4e4d3327dc9c66f36333c7db1cabdffe14eb13af64cd74231fddac1bab669e", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:9153947f22fd206745505e9da353222b095bdeeb602ff9c7c002f583d5a1d063"]],
  ["food-form-tie-pi-shi-hu-dried-rolls-v01", ["tie-pi-shi-hu", "sha256:7bb93bc3dd5a35355fe368d4e4096e658bee30543a11becc0db246a8ed1e3418", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:ad34feb72603450ecde7653bd104f98e5a721ec1980cab6b9fb1cf67c98813e8"]],
  ["food-form-xi-yang-shen-dried-slices-v01", ["xi-yang-shen", "sha256:489a0fcf8a4b14df5b5ec4da9d505e4baaf45a8a5441489fb209ab2aa937ccd7", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:4ce39a99b126b95d0b792cb0df32610f5e66cea03ebc20ac8aad748e808d892d"]],
  ["food-form-huang-qi-mongholicus-slices-v01", ["huang-qi", "sha256:547dec1862884aa6023f55bb11d27a5e108b0c6bfa59fc7b86a46ec8ebb66bba", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:53ba9f0736d417c4d6df04ade56573ca723cb9585d816e5beb26603b8b9d401c"]],
  ["food-form-ling-zhi-market-dried-v01", ["ling-zhi", "sha256:78dae8ca623247245a7b2a8af7d7ac5cfb71537180492024452b1b54a42fd38a", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:ff4da222492bbd97fa9ef7b596e236837fb171874757e7f7342fb6e4dc39fc0c"]],
  ["food-form-mai-dong-dried-tubers-v01", ["mai-dong", "sha256:492b6e84c7f733fd78ca637baec1c159d0886e94a4177b6186b0ed04bf4c4ddb", "sha256:7fb9aa5ffa9788d551b394e3abaf09aa6a43f1b48f5bafbd8491710effdbda41", "sha256:dc9a343a32ff0e181c1a9f35c7973a4288b005a69e7b2bc27bc53cc12c8e0f6d", "sha256:d5dfb13fb52e66eed19aca31585e4c6a14bb2a0afc1403d540cdff679015266b", "sha256:9455a95e0085922a877ff71b5cae68893eeec8a1ac1e99c7fa4636de9be1b351"]],
  ["food-form-hua-ju-hong-outer-peel-v01", ["hua-ju-hong", "sha256:3d1d2ca5ff79e6794defe658b819572f167cf9091f096f46a211671a5f9d4426", "sha256:517b9ab8ea46dbff3ab46471003fe3d3f2fdc3079ddbea80f2f9d668b5dd1b76", null, null, "sha256:390bc2095bf50c73aa0878873720a922362420bc9b1c4c4d821aa5b5c1f75728"]],
  ["food-form-jiang-huang-rhizomes-v01", ["jiang-huang", "sha256:ba720c756d6cc7418484e5280bfd2748668d622a1b800ac9250282881bd775df", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:3f81c7ab9bfbbf95388fce819be045ae02b03e9168ad6a33904e1ad6fc7100d4"]],
  ["food-form-xi-hong-hua-flower-stigmas-context-v01", ["xi-hong-hua", "sha256:4ee638ca5b0ebeb72155e4b8d41a78196f5e01d57144b09b607887a52976180b", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:b6c036534d2d4195e610a96c8712cdb1c91d33db39b594f80be19d1d1c0cc2af"]],
  ["food-form-dang-gui-dried-slices-v01", ["dang-gui", "sha256:e9c22da40b3d1a1247dd9a13630a470e5c6925f8c8d6b03ca4b9e4ac3c95e020", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:fab648b6470362be33e3781a1d6f6be4e3df3f88114171ddc46a64a912085e2d"]],
  ["food-form-tian-ma-slices-v01", ["tian-ma", "sha256:6cfe52ab55483de6c237c6d8c47ef16f03bfdfc485fb9ca6d272ddbe3ad065bb", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:82ec03e7cdedc1f9724fb8ce14779e5ec732d1c4976bc13dd5cef382af4719f7"]],
  ["food-form-cao-guo-dried-fruit-v01", ["cao-guo", "sha256:d6f06c80e6529d3d60ac2f547d56f397c9c434683bc47e44fdc2d3a77ba91bf2", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:8b67e900d31a40c0707637769ed0eae0d3870adaeb8a53fee204eb1e435a4448"]],
  ["food-form-bi-ba-dried-fruit-spikes-v01", ["bi-ba", "sha256:2f544b4311a1ec16c4bbbefd6a0d1bd7d6aaec888ac78e66ad889c62d91e0af2", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:48ef86b690c6002fe910afe153c46ee8f7b28641fb5dec7d6feb38e24d33264b"]],
  ["food-form-du-zhong-ye-fresh-leaves-v01", ["du-zhong-ye", "sha256:814313c4d4ee582a8ff2d66c76213d443f6afefb35a5659f1746df11e95127f3", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:b30d919d460c616293a88dbedac23a02b2724acacd2b826530c5d59ccc97eacc"]],
  ["food-form-du-zhong-ye-processing-study-v01", ["du-zhong-ye", "sha256:613eaf393c2dc3ed26a45f6b4c789f973e19c68cb853255934807bf308d14f07", "sha256:40a1681993e2d5df219b8c0dc6a88075610bfa628348770bdc83b92787140882", null, null, "sha256:1bebb7c71b66499cb011d7285db4e5e9e65f4eed269fb09d2d238b2b9f7c4490"]],
  ["food-form-shan-zhu-yu-dried-fruit-v01", ["shan-zhu-yu", "sha256:507abdd86b6521bb29eb1b1fe950610c09fad885839ca92b2ff41d7a16fe12e3", "sha256:4ff1c541ac61fe0ebf112bd25e34c06f7a60869d4aebbb66ec4a91fc45c6cf4b", null, null, "sha256:57dbaab57054877513a92afce5bcb481f20d1c79699c95ba1af0ab641b4d866c"]]
]);
const APPROVED_GAP_BINDINGS = new Map([
  ["food-form-gap-gou-qi-zi-v01", ["gou-qi-zi", "sha256:f70d8f23ea10e0c991e33409dbe976acb0918f91f65f829c4e86ed0acdba6df7"]],
  ["food-form-gap-di-huang-v01", ["di-huang", "sha256:6bff3cea8adaa29d19dbfb1d496a80fac495cbda6d27025c36dd7ded275089f0"]],
  ["food-form-gap-tian-dong-v01", ["tian-dong", "sha256:96f7270bb751df78626635f3d74f5c2af5168c87f4c914d2e47c1d5958dd3215"]]
]);

class FoodFormCandidateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FoodFormCandidateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new FoodFormCandidateError(code, message);
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

function expectedSourceMetadataDigest(source) {
  const canonical = {
    provider: source.provider,
    pageId: source.pageId,
    fileTitle: source.fileTitle,
    sourcePage: source.sourcePage,
    originalUrl: source.originalUrl,
    remoteOriginal: source.remoteOriginal,
    description: source.description,
    sourceLabelExact: source.sourceLabelExact,
    author: source.author,
    rightsHolder: source.rightsHolder,
    licenseName: source.licenseName,
    licenseUrl: source.licenseUrl,
    attribution: source.attribution,
    sourceTaxonLabel: source.sourceTaxonLabel,
    taxonEvidenceKind: source.taxonEvidenceKind,
    sourceCheckedAt: source.sourceCheckedAt,
    rightsReviewState: source.rightsReviewState
  };
  if (source.providerMetadata) canonical.providerMetadata = source.providerMetadata;
  return sha256Buffer(Buffer.from(JSON.stringify(canonical), "utf8"));
}

function expectedDepictionMetadataDigest(depiction) {
  const canonical = {
    canonicalName: depiction.canonicalName,
    catalogLatinName: depiction.catalogLatinName,
    catalogPart: depiction.catalogPart,
    sourceLabelExact: depiction.sourceLabelExact,
    visualObservation: depiction.visualObservation,
    catalogPartHypothesis: depiction.catalogPartHypothesis,
    processingState: depiction.processingState,
    catalogPartAlignment: depiction.catalogPartAlignment,
    originCoverage: depiction.originCoverage,
    sourceIdentityEvidence: depiction.sourceIdentityEvidence,
    scientificNameMatchState: depiction.scientificNameMatchState,
    identificationUse: depiction.identificationUse,
    edibilityUse: depiction.edibilityUse,
    medicalUse: depiction.medicalUse,
    riskNotes: depiction.riskNotes
  };
  return sha256Buffer(Buffer.from(JSON.stringify(canonical), "utf8"));
}

function expectedRetrievalMetadataDigest(retrieval) {
  const canonical = {
    state: retrieval.state,
    localAssetAvailable: retrieval.localAssetAvailable,
    reasonCode: retrieval.reasonCode || null,
    copyType: retrieval.copyType || null,
    upstreamPreviewUrl: retrieval.upstreamPreviewUrl || null,
    retrievalProxy: retrieval.retrievalProxy || null,
    retrievalRequestUrl: retrieval.retrievalRequestUrl || null,
    retrievedAt: retrieval.retrievedAt || null,
    note: retrieval.note
  };
  return sha256Buffer(Buffer.from(JSON.stringify(canonical), "utf8"));
}

function expectedGapEvidenceDigest(gap) {
  const canonical = {
    ingredientId: gap.ingredientId,
    reasonCode: gap.reasonCode,
    reason: gap.reason,
    searchSummary: gap.searchSummary,
    checkedSources: gap.checkedSources
  };
  return sha256Buffer(Buffer.from(JSON.stringify(canonical), "utf8"));
}

function normalizedPrivatePath(value, label) {
  ensure(typeof value === "string" && value.length > 0, "invalid_path", label + " must be a path");
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
  let cursor = workspace;
  for (const segment of normalized.split("/")) {
    ensure(fs.existsSync(cursor) && fs.readdirSync(cursor).includes(segment),
      "path_case_mismatch", label + " path case or Unicode form differs from disk");
    cursor = path.join(cursor, segment);
  }
  const file = path.resolve(workspace, ...normalized.split("/"));
  const boundary = path.relative(workspace, file);
  ensure(boundary && boundary !== ".." && !boundary.startsWith(".." + path.sep) && !path.isAbsolute(boundary),
    "path_escape", label + " escapes the workspace");
  ensure(fs.existsSync(file), "missing_asset", label + " is missing");
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "unsafe_asset", label + " must be a regular non-link file");
  const realBoundary = path.relative(fs.realpathSync(workspace), fs.realpathSync(file));
  ensure(realBoundary && realBoundary !== ".." && !realBoundary.startsWith(".." + path.sep) && !path.isAbsolute(realBoundary),
    "path_escape", label + " resolves outside the workspace");
  return { file, stat, normalized };
}

function readJpegDimensions(buffer, label) {
  ensure(buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9,
  "invalid_jpeg", label + " is not a complete JPEG");
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions = null;
  while (offset + 3 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    ensure(offset + 2 <= buffer.length, "invalid_jpeg", label + " has a truncated segment");
    const length = buffer.readUInt16BE(offset);
    ensure(length >= 2 && offset + length <= buffer.length, "invalid_jpeg", label + " has an invalid segment");
    const payload = buffer.subarray(offset + 2, offset + length);
    ensure(marker !== 0xe1, "unsafe_jpeg_metadata", label + " contains APP1/EXIF/XMP metadata");
    ensure(marker !== 0xe2 || !payload.toString("latin1", 0, 12).startsWith("ICC_PROFILE"),
      "unsafe_jpeg_metadata", label + " contains an ICC profile");
    if (sof.has(marker)) {
      ensure(length >= 7, "invalid_jpeg", label + " has an invalid frame");
      dimensions = { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  ensure(dimensions, "invalid_jpeg", label + " has no supported image frame");
  return dimensions;
}

function inspectWebp(buffer, label) {
  ensure(buffer.length >= 20 && buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP", "invalid_webp", label + " is not WebP");
  ensure(buffer.readUInt32LE(4) + 8 === buffer.length, "invalid_webp", label + " RIFF size or trailing bytes are invalid");
  let offset = 12;
  let dimensions = null;
  let imageChunks = 0;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const paddedEnd = dataOffset + chunkSize + (chunkSize % 2);
    ensure(dataOffset + chunkSize <= buffer.length && paddedEnd <= buffer.length,
      "invalid_webp", label + " has a truncated " + type + " chunk");
    ensure(!FORBIDDEN_WEBP_CHUNKS.has(type), "unsafe_webp_metadata", label + " contains " + type + " metadata");
    chunks.push(type);
    if (type === "VP8X") {
      ensure(chunkSize >= 10, "invalid_webp", label + " has an invalid VP8X chunk");
      ensure((buffer[dataOffset] & 0x2c) === 0, "unsafe_webp_metadata", label + " advertises ICC/EXIF/XMP metadata");
      dimensions = {
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3)
      };
    } else if (type === "VP8 ") {
      ensure(chunkSize >= 10 && buffer[dataOffset + 3] === 0x9d && buffer[dataOffset + 4] === 0x01 &&
        buffer[dataOffset + 5] === 0x2a, "invalid_webp", label + " has an invalid VP8 frame");
      dimensions = {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      };
      imageChunks += 1;
    } else if (type === "VP8L") {
      ensure(chunkSize >= 5 && buffer[dataOffset] === 0x2f, "invalid_webp", label + " has an invalid VP8L frame");
      const b1 = buffer[dataOffset + 1];
      const b2 = buffer[dataOffset + 2];
      const b3 = buffer[dataOffset + 3];
      const b4 = buffer[dataOffset + 4];
      dimensions = {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      };
      imageChunks += 1;
    }
    offset = paddedEnd;
  }
  ensure(offset === buffer.length && dimensions && imageChunks === 1,
    "invalid_webp", label + " must contain one complete image payload");
  return { ...dimensions, chunks };
}

function readCandidateDimensions(buffer, mimeType, label) {
  if (mimeType === "image/jpeg") return readJpegDimensions(buffer, label);
  if (mimeType === "image/webp") return inspectWebp(buffer, label);
  fail("invalid_mime", label + " uses an unsupported MIME type");
}

function validateAsset(root, asset, label, role) {
  ensure(isObject(asset) && asset.role === role, "invalid_asset", label + " role is invalid");
  const resolved = resolvePrivateFile(root, asset.path, label + ".path");
  const extension = path.extname(resolved.normalized).toLowerCase();
  const expectedMime = extension === ".jpg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : null;
  ensure(expectedMime && asset.mimeType === expectedMime, "mime_mismatch", label + " extension and MIME differ");
  const buffer = fs.readFileSync(resolved.file);
  ensure(Number.isInteger(asset.bytes) && asset.bytes === buffer.length, "byte_mismatch", label + " byte count drifted");
  ensure(DIGEST_PATTERN.test(asset.sha256 || "") && sha256Buffer(buffer) === asset.sha256,
    "digest_mismatch", label + " digest drifted");
  const dimensions = readCandidateDimensions(buffer, asset.mimeType, label);
  ensure(dimensions.width === asset.width && dimensions.height === asset.height,
    "dimension_mismatch", label + " dimensions drifted");
  return { buffer, dimensions };
}

function validateSource(source, label) {
  ensure(isObject(source), "source_binding", label + " source must be an object");
  const remote = source.remoteOriginal;
  if (source.provider === "Wikimedia Commons") {
    ensure(Number.isInteger(source.pageId) && source.pageId > 0 && /^File:.+\.jpg$/i.test(source.fileTitle || "") &&
      /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(source.sourcePage || "") &&
      /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(source.originalUrl || ""),
    "source_binding", label + " Commons page, file or page id is invalid");
    ensure(isObject(remote) && SHA1_PATTERN.test(remote.sha1 || "") && !Object.prototype.hasOwnProperty.call(remote, "etag") &&
      Number.isInteger(remote.bytes) && remote.bytes > 0 && Number.isInteger(remote.width) && remote.width > 0 &&
      Number.isInteger(remote.height) && remote.height > 0 && remote.mimeType === "image/jpeg" && !source.providerMetadata,
    "source_binding", label + " Commons remote-original metadata is invalid");
  } else if (source.provider === "PubMed Central") {
    const metadata = source.providerMetadata;
    ensure(source.pageId === null && /^Figure [a-z0-9]+ \(Fig\.\d+\)$/.test(source.fileTitle || "") &&
      /^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/figure\/[a-z0-9]+\/$/.test(source.sourcePage || "") &&
      /^https:\/\/cdn\.ncbi\.nlm\.nih\.gov\/pmc\/blobs\//.test(source.originalUrl || ""),
    "source_binding", label + " PMC article figure page or image URL is invalid");
    ensure(isObject(remote) && /^[a-f0-9]{32}$/.test(remote.etag || "") &&
      !Object.prototype.hasOwnProperty.call(remote, "sha1") && Number.isInteger(remote.bytes) && remote.bytes > 0 &&
      Number.isInteger(remote.width) && remote.width > 0 && Number.isInteger(remote.height) && remote.height > 0 &&
      remote.mimeType === "image/jpeg", "source_binding", label + " PMC remote-image metadata is invalid");
    ensure(isObject(metadata) && typeof metadata.articleTitle === "string" && metadata.articleTitle.length >= 30 &&
      metadata.articlePage === "https://pmc.ncbi.nlm.nih.gov/articles/" + metadata.pmcid + "/" &&
      /^10\.1016\/.+/.test(metadata.doi || "") && /^PMC\d+$/.test(metadata.pmcid || "") && /^\d+$/.test(metadata.pmid || "") &&
      typeof metadata.journal === "string" && metadata.journal.length > 0 && typeof metadata.publisher === "string" &&
      metadata.publisher.length > 0 && /^f\d+$/.test(metadata.figureId || "") && /^Fig\.\d+$/.test(metadata.figureLabel || "") &&
      source.sourcePage === metadata.articlePage + "figure/" + metadata.figureId + "/" &&
      source.fileTitle === "Figure " + metadata.figureId + " (" + metadata.figureLabel + ")" &&
      Array.isArray(metadata.authors) && metadata.authors.length >= 2 && metadata.authors.every((name) =>
        typeof name === "string" && name.length > 0) && isObject(metadata.materialsIdentityEvidence) &&
      metadata.materialsIdentityEvidence.speciesExact === "E. ulmoides Oliv." &&
      metadata.materialsIdentityEvidence.voucher === null && source.sourceTaxonLabel === "Eucommia ulmoides Oliv.",
    "source_binding", label + " PMC article, figure or materials metadata is incomplete");
  } else {
    fail("source_binding", label + " source provider is unsupported");
  }
  ensure(typeof source.description === "string" && source.description.length >= 20 &&
    typeof source.sourceLabelExact === "string" && source.sourceLabelExact.length >= 5 &&
    typeof source.author === "string" && source.author.length > 0 &&
    (source.rightsHolder === null || (typeof source.rightsHolder === "string" && source.rightsHolder.length > 0)) &&
    LICENSES.get(source.licenseName) === source.licenseUrl &&
    typeof source.attribution === "string" && source.attribution.includes(source.author) &&
    typeof source.sourceTaxonLabel === "string" && source.sourceTaxonLabel.length > 0 &&
    TAXON_EVIDENCE_KINDS.has(source.taxonEvidenceKind) &&
    source.sourceCheckedAt === SOURCE_DATE && source.rightsReviewState === "pending",
  "source_binding", label + " attribution, licence or source declaration is incomplete");
  ensure(DIGEST_PATTERN.test(source.sourceMetadataDigest || "") &&
    source.sourceMetadataDigest === expectedSourceMetadataDigest(source),
  "source_digest", label + " source metadata digest drifted");
}

function validateRecord(root, record, index) {
  const label = "records[" + index + "]";
  ensure(isObject(record) && /^food-form-[a-z0-9-]+-v\d{2}$/.test(record.id || ""),
    "invalid_record", label + " id is invalid");
  const ingredient = catalog.ingredients.find((item) => item.id === record.ingredientId);
  ensure(ingredient && EXPECTED_TARGET_IDS.includes(record.ingredientId),
    "unknown_ingredient", label + " ingredient is outside this review batch");
  ensure(record.status === "candidate" && record.role === "catalog_part_or_processing_reference_candidate" &&
    record.publicationEligible === false && Array.isArray(record.placements) && record.placements.length === 0,
  "unsafe_publication", label + " must remain an unplaced private candidate");

  const depiction = record.depiction;
  ensure(isObject(depiction) && depiction.canonicalName === ingredient.name &&
    depiction.catalogLatinName === ingredient.identity.latinName && depiction.catalogPart === ingredient.identity.ediblePart,
  "ingredient_binding", label + " no longer matches the catalog identity and part");
  const expectedCoverage = record.ingredientId === "xi-yang-shen" ? "common_name_origin_unresolved" :
    MULTI_ORIGIN_IDS.has(record.ingredientId) ? "partial_of_multiple_origins" : "single_origin_declared_unverified";
  ensure(typeof depiction.sourceLabelExact === "string" && depiction.sourceLabelExact === record.source.sourceLabelExact &&
    typeof depiction.visualObservation === "string" && depiction.visualObservation.length >= 25 &&
    typeof depiction.catalogPartHypothesis === "string" && depiction.catalogPartHypothesis.length >= 25 &&
    PROCESSING_STATES.has(depiction.processingState) && PART_ALIGNMENTS.has(depiction.catalogPartAlignment) &&
    depiction.originCoverage === expectedCoverage && isObject(depiction.sourceIdentityEvidence) &&
    depiction.sourceIdentityEvidence.label === record.source.sourceTaxonLabel &&
    depiction.sourceIdentityEvidence.evidenceKind === record.source.taxonEvidenceKind &&
    NAME_MATCH_STATES.has(depiction.scientificNameMatchState) && Array.isArray(depiction.riskNotes) && depiction.riskNotes.length >= 3,
  "invalid_depiction", label + " part, process or origin coverage is incomplete");
  ensure(depiction.identificationUse === "prohibited" && depiction.edibilityUse === "prohibited" &&
    depiction.medicalUse === "prohibited", "unsafe_depiction", label + " must prohibit identification, edibility and medical use");
  ensure(DIGEST_PATTERN.test(record.depictionMetadataDigest || "") &&
    record.depictionMetadataDigest === expectedDepictionMetadataDigest(depiction),
  "depiction_digest", label + " depiction semantics digest drifted");
  validateSource(record.source, label + ".source");
  ensure(SOURCE_ORIGIN_BINDINGS.get(record.ingredientId + "\u0000" + record.source.sourceTaxonLabel +
    "\u0000" + record.source.taxonEvidenceKind) ===
      depiction.scientificNameMatchState,
  "source_origin_binding", label + " source-declared origin is not registered for this catalog ingredient");

  const retrieval = record.retrieval;
  ensure(isObject(retrieval) && typeof retrieval.note === "string" && retrieval.note.length >= 20,
    "invalid_retrieval", label + " retrieval record is incomplete");
  ensure(DIGEST_PATTERN.test(retrieval.retrievalMetadataDigest || "") &&
    retrieval.retrievalMetadataDigest === expectedRetrievalMetadataDigest(retrieval),
  "retrieval_digest", label + " retrieval metadata digest drifted");
  if (retrieval.state === "remote_metadata_only") {
    ensure(retrieval.localAssetAvailable === false && retrieval.reasonCode === "source_asset_not_copied" &&
      record.assets === null && !Object.prototype.hasOwnProperty.call(retrieval, "upstreamPreviewUrl") &&
      !Object.prototype.hasOwnProperty.call(retrieval, "retrievalProxy") &&
      !Object.prototype.hasOwnProperty.call(retrieval, "retrievalRequestUrl") &&
      !Object.prototype.hasOwnProperty.call(retrieval, "retrievedAt"),
    "invalid_retrieval", label + " remote-only record must not claim local assets");
  } else if (retrieval.state === "local_review_copy") {
    ensure(retrieval.localAssetAvailable === true && retrieval.copyType === "wikimedia_preview_via_cache" &&
      /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(retrieval.upstreamPreviewUrl || "") &&
      retrieval.retrievalProxy === "https://wsrv.nl/" &&
      /^https:\/\/wsrv\.nl\/\?url=upload\.wikimedia\.org\//.test(retrieval.retrievalRequestUrl || "") &&
      retrieval.retrievedAt === SOURCE_DATE && isObject(record.assets),
    "invalid_retrieval", label + " local review copy provenance is incomplete");
    let originalUrl;
    let previewUrl;
    let requestUrl;
    try {
      originalUrl = new URL(record.source.originalUrl);
      previewUrl = new URL(retrieval.upstreamPreviewUrl);
      requestUrl = new URL(retrieval.retrievalRequestUrl);
    } catch (error) {
      fail("invalid_retrieval", label + " local review copy URL cannot be parsed");
    }
    const expectedPreviewPrefix = originalUrl.pathname.replace("/wikipedia/commons/", "/wikipedia/commons/thumb/") + "/";
    ensure(previewUrl.origin === originalUrl.origin && previewUrl.pathname.startsWith(expectedPreviewPrefix) &&
      requestUrl.searchParams.get("url") === "upload.wikimedia.org" + previewUrl.pathname &&
      requestUrl.searchParams.get("output") === "jpg",
    "invalid_retrieval", label + " preview, proxy request and Commons original are not the same file");
    const sourceCopy = validateAsset(root, record.assets.sourceCopy, label + ".assets.sourceCopy", "cached_review_source_not_original");
    const review = validateAsset(root, record.assets.review, label + ".assets.review", "review_derivative");
    ensure(record.assets.sourceCopy.mimeType === "image/jpeg" && record.assets.review.mimeType === "image/webp" &&
      Math.max(review.dimensions.width, review.dimensions.height) <= 1200 && record.assets.review.bytes <= 100 * 1024 &&
      !sourceCopy.buffer.equals(review.buffer), "review_budget", label + " review derivative exceeds limits or is not a derivative");
  } else {
    fail("invalid_retrieval", label + " retrieval state is unsupported");
  }

  const approved = APPROVED_CANDIDATE_BINDINGS.get(record.id);
  ensure(approved && approved[0] === record.ingredientId && approved[1] === record.source.sourceMetadataDigest &&
    approved[2] === record.retrieval.retrievalMetadataDigest &&
    approved[3] === (record.assets ? record.assets.sourceCopy.sha256 : null) &&
    approved[4] === (record.assets ? record.assets.review.sha256 : null) &&
    approved[5] === record.depictionMetadataDigest,
  "approved_source_binding", label + " source, retrieval, local bytes or ingredient differ from the approved snapshot");

  ensure(isObject(record.bindings) && record.bindings.catalogContentVersion === catalog.contentVersion &&
    record.bindings.rulesVersion === ruleSet.contentVersion &&
    record.bindings.ingredientDigest === expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion),
  "version_binding", label + " catalog material binding drifted");
  ensure(isObject(record.audit) && record.audit.identityReviewState === "pending" &&
    record.audit.partReviewState === "pending" && record.audit.processingReviewState === "pending" &&
    record.audit.rightsReviewState === "pending" && record.audit.professionalReviewState === "pending" &&
    Array.isArray(record.audit.reviews) && record.audit.reviews.length === 0,
  "unsafe_audit_state", label + " cannot claim review");
  return record.id;
}

function validateGap(gap, index) {
  const label = "gaps[" + index + "]";
  ensure(isObject(gap) && /^food-form-gap-[a-z0-9-]+-v\d{2}$/.test(gap.id || ""),
    "invalid_gap", label + " id is invalid");
  const ingredient = catalog.ingredients.find((item) => item.id === gap.ingredientId);
  ensure(ingredient && EXPECTED_TARGET_IDS.includes(gap.ingredientId), "unknown_ingredient", label + " ingredient is unknown");
  ensure(gap.status === "no_candidate" && gap.role === "catalog_part_or_processing_reference_gap" &&
    gap.publicationEligible === false && gap.fallbackAllowed === false &&
    Array.isArray(gap.placements) && gap.placements.length === 0,
  "unsafe_gap", label + " must remain an explicit no-candidate gap");
  ensure(GAP_REASONS.has(gap.reasonCode) && typeof gap.reason === "string" && gap.reason.length >= 30 &&
    Array.isArray(gap.searchSummary) && gap.searchSummary.length >= 2 &&
    gap.searchSummary.every((item) => typeof item === "string" && item.length >= 15) &&
    Array.isArray(gap.checkedSources) && gap.checkedSources.length >= 2 &&
    gap.checkedSources.every((source) => isObject(source) && /^https:\/\//.test(source.url || "") &&
      ["reviewed_rejected", "retrieval_incomplete"].includes(source.reviewState) &&
      typeof source.note === "string" && source.note.length >= 15) &&
    new Set(gap.checkedSources.map((source) => source.url)).size === gap.checkedSources.length &&
    gap.checkedSources.some((source) => source.reviewState === "reviewed_rejected"),
  "invalid_gap", label + " search evidence is incomplete");
  ensure(DIGEST_PATTERN.test(gap.searchEvidenceDigest || "") &&
    gap.searchEvidenceDigest === expectedGapEvidenceDigest(gap),
  "gap_evidence_digest", label + " search evidence digest drifted");
  const approved = APPROVED_GAP_BINDINGS.get(gap.id);
  ensure(approved && approved[0] === gap.ingredientId && approved[1] === gap.searchEvidenceDigest,
    "approved_gap_binding", label + " ingredient or exclusion evidence differs from the approved snapshot");
  if (gap.ingredientId === "gou-qi-zi") {
    ensure(!ingredient.identity.latinName && ingredient.identity.partReviewState === "pending" &&
      gap.reasonCode === "identity_pending_no_vouchered_food_form",
    "gap_binding", label + " must preserve the unresolved goji identity boundary");
  } else {
    ensure(["di-huang", "tian-dong"].includes(gap.ingredientId) &&
      gap.reasonCode === "no_tuber_or_processed_form_candidate_found",
    "gap_binding", label + " is not an allowed tuber-image gap");
  }
  ensure(gap.identificationUse === "prohibited" && gap.edibilityUse === "prohibited" &&
    gap.medicalUse === "prohibited", "unsafe_gap", label + " must prohibit unsafe fallback use");
  ensure(isObject(gap.bindings) && gap.bindings.catalogContentVersion === catalog.contentVersion &&
    gap.bindings.rulesVersion === ruleSet.contentVersion &&
    gap.bindings.ingredientDigest === expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion),
  "version_binding", label + " material binding drifted");
  ensure(isObject(gap.audit) && gap.audit.searchReviewState === "recorded_unverified" &&
    gap.audit.identityReviewState === "pending" && gap.audit.professionalReviewState === "pending" &&
    Array.isArray(gap.audit.reviews) && gap.audit.reviews.length === 0,
  "unsafe_audit_state", label + " cannot claim review");
  return gap.id;
}

function validateManifest(manifest, root = ROOT) {
  ensure(isObject(manifest) && manifest.schemaVersion === "1.0.0" &&
    /^\d{4}\.\d{2}\.\d{2}-food-form-candidate\.\d+$/.test(manifest.contentVersion || "") &&
    typeof manifest.createdAt === "string" && !Number.isNaN(Date.parse(manifest.createdAt)) &&
    manifest.scope === "private_review_only" && Array.isArray(manifest.targetIngredientIds) &&
    JSON.stringify(manifest.targetIngredientIds) === JSON.stringify(EXPECTED_TARGET_IDS),
  "invalid_manifest", "Food-form candidate manifest identity is invalid");
  ensure(isObject(manifest.policy) && manifest.policy.clientUploadAllowed === false &&
    manifest.policy.runtimeReferenceAllowed === false && manifest.policy.identificationUse === "prohibited" &&
    manifest.policy.edibilityUse === "prohibited" && manifest.policy.medicalUse === "prohibited" &&
    JSON.stringify(manifest.policy.requiredReviewRoles) === JSON.stringify(REQUIRED_REVIEW_ROLES),
  "unsafe_policy", "Food-form policy must fail closed");
  ensure(Array.isArray(manifest.records) && manifest.count === manifest.records.length && manifest.records.length > 0 &&
    Array.isArray(manifest.gaps) && manifest.gapCount === manifest.gaps.length && manifest.gaps.length > 0,
  "invalid_manifest", "Food-form record or gap count is invalid");
  const represented = new Set(manifest.records.map((record) => record && record.ingredientId));
  const gaps = new Set(manifest.gaps.map((gap) => gap && gap.ingredientId));
  ensure([...represented, ...gaps].every((id) => EXPECTED_TARGET_IDS.includes(id)),
    "unknown_ingredient", "Food-form coverage contains an ingredient outside this review batch");
  ensure(![...represented].some((id) => gaps.has(id)), "coverage_overlap", "An ingredient cannot have candidates and a gap");
  const union = new Set([...represented, ...gaps]);
  ensure(union.size === EXPECTED_TARGET_IDS.length && EXPECTED_TARGET_IDS.every((id) => union.has(id)),
    "coverage_missing", "Every target ingredient must have a candidate or explicit gap");
  const recordIds = manifest.records.map((record, index) => validateRecord(root, record, index));
  const gapIds = manifest.gaps.map((gap, index) => validateGap(gap, index));
  ensure(new Set(recordIds).size === recordIds.length && new Set(gapIds).size === gapIds.length &&
    !recordIds.some((id) => gapIds.includes(id)), "duplicate_id", "Food-form record and gap IDs must be unique");
  ensure(new Set(manifest.records.map((record) => record.source.pageId)).size === manifest.records.length &&
    new Set(manifest.records.map((record) => record.source.sourcePage)).size === manifest.records.length &&
    new Set(manifest.records.map((record) => record.source.originalUrl)).size === manifest.records.length,
  "duplicate_source", "Each food-form candidate must bind a distinct source image");
  const localRecords = manifest.records.filter((record) => record.retrieval.state === "local_review_copy");
  const remoteRecords = manifest.records.filter((record) => record.retrieval.state === "remote_metadata_only");
  return {
    count: manifest.count,
    gapCount: manifest.gapCount,
    targetCount: manifest.targetIngredientIds.length,
    localReviewCopies: localRecords.length,
    remoteMetadataOnly: remoteRecords.length,
    localBytes: localRecords.reduce((sum, record) =>
      sum + record.assets.sourceCopy.bytes + record.assets.review.bytes, 0)
  };
}

function loadAndValidate(root = ROOT) {
  const manifestPath = path.join(root, ...MANIFEST_RELATIVE.split("/"));
  ensure(fs.existsSync(manifestPath), "missing_manifest", "Missing " + MANIFEST_RELATIVE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  return { manifest, result: validateManifest(manifest, root) };
}

module.exports = {
  EXPECTED_TARGET_IDS,
  FoodFormCandidateError,
  MANIFEST_RELATIVE,
  PRIVATE_PREFIX,
  expectedGapEvidenceDigest,
  expectedDepictionMetadataDigest,
  expectedRetrievalMetadataDigest,
  expectedSourceMetadataDigest,
  inspectWebp,
  loadAndValidate,
  readCandidateDimensions,
  sha256Buffer,
  validateManifest
};
