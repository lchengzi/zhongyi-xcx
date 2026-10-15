"use strict";

const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const { expectedIngredientReviewDigest } = require("./recipe-digests");
const {
  MANIFEST_RELATIVE,
  readImageDimensions,
  sha256Buffer,
  validateManifest
} = require("./media-draft-core");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_RELATIVE = "content-private/media-drafts/draft-catalog.json";
const DISCLOSURE = "AI生成示意图｜不可用于药材或食材鉴别、采集、购买、食用、配伍、煎煮或用药判断";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...relative.split("/")), "utf8").replace(/^\uFEFF/, ""));
}

function fileDescriptor(relative, mimeType) {
  const file = path.join(ROOT, ...relative.split("/"));
  const buffer = fs.readFileSync(file);
  const dimensions = readImageDimensions(buffer, mimeType, relative);
  return {
    path: relative,
    mimeType,
    bytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    sha256: sha256Buffer(buffer)
  };
}

function promptDescriptor(relative) {
  const file = path.join(ROOT, ...relative.split("/"));
  const buffer = fs.readFileSync(file);
  return {
    path: relative,
    bytes: buffer.length,
    sha256: sha256Buffer(buffer)
  };
}

function buildRecord(source) {
  const ingredient = catalog.ingredients.find((item) => item.id === source.ingredientId);
  if (!ingredient) throw new Error("Unknown ingredient " + source.ingredientId);
  const prompt = readJson(source.promptPath);
  const base = "content-private/media-drafts/ingredient-context/";
  return {
    id: source.id,
    ingredientId: source.ingredientId,
    status: "draft",
    role: "ingredient_context_illustration",
    placements: [],
    publicationEligible: false,
    depiction: {
      canonicalName: ingredient.name,
      latinName: ingredient.identity.latinName,
      depictedPart: ingredient.identity.ediblePart,
      state: "unverified_ai_interpretation",
      identityClaim: "none",
      identificationUse: "prohibited",
      medicalUse: "prohibited"
    },
    generation: {
      method: "ai_generated",
      providerName: prompt.providerName,
      providerOutputFileId: prompt.providerOutputFileId,
      generatedAt: prompt.generatedAt,
      promptRecord: promptDescriptor(source.promptPath),
      explicitLabelState: "missing_private_draft",
      implicitLabelState: "unverified_provider_original",
      derivativeMetadataState: "unverified_after_conversion"
    },
    provenance: {
      creator: prompt.providerName,
      rightsStatus: "pending_compliance_review",
      licenseEvidenceIds: []
    },
    assets: {
      original: fileDescriptor(base + "original/" + source.assetStem + ".png", "image/png"),
      review: fileDescriptor(base + "review/" + source.assetStem + ".webp", "image/webp"),
      thumbnailReview: fileDescriptor(base + "thumbnail-review/" + source.assetStem + ".webp", "image/webp")
    },
    bindings: {
      catalogContentVersion: catalog.contentVersion,
      rulesVersion: ruleSet.contentVersion,
      ingredientDigest: expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion)
    },
    audit: {
      reviewState: "pending",
      reviews: [],
      finalApprovedAt: null,
      nextReviewAt: null
    }
  };
}

function buildManifest(config = readJson(CONFIG_RELATIVE)) {
  if (config.schemaVersion !== "1.0.0" || !Array.isArray(config.records)) {
    throw new Error("Invalid private media draft catalog");
  }
  const manifest = {
    schemaVersion: "1.0.0",
    contentVersion: config.contentVersion,
    createdAt: config.createdAt,
    scope: "private_review_only",
    count: config.records.length,
    policy: {
      clientUploadAllowed: false,
      runtimeReferenceAllowed: false,
      identityUse: "prohibited",
      medicalUse: "prohibited",
      requiredReviewRoles: [
        "pharmacognosy_reviewer",
        "pharmacist",
        "compliance",
        "rights_clearance",
        "release_approver"
      ],
      futureVisibleDisclosure: DISCLOSURE
    },
    records: config.records.map(buildRecord)
  };
  validateManifest(manifest, ROOT, catalog, ruleSet);
  return manifest;
}

function main() {
  const manifest = buildManifest();
  const target = path.join(ROOT, ...MANIFEST_RELATIVE.split("/"));
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    mediaDrafts: manifest.count,
    publicationEligible: manifest.records.filter((record) => record.publicationEligible).length,
    output: MANIFEST_RELATIVE
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[build-media-draft-manifest] " + error.message);
    process.exit(1);
  }
}

module.exports = { buildManifest };
