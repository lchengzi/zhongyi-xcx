"use strict";

const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const { expectedIngredientReviewDigest } = require("./recipe-digests");
const {
  EXPECTED_TARGET_IDS,
  MANIFEST_RELATIVE,
  expectedGapEvidenceDigest,
  expectedDepictionMetadataDigest,
  expectedRetrievalMetadataDigest,
  expectedSourceMetadataDigest,
  readCandidateDimensions,
  sha256Buffer,
  validateManifest
} = require("./food-form-candidate-core");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_RELATIVE = "content-private/media-candidates/food-forms/food-form-catalog.json";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...relative.split("/")), "utf8").replace(/^\uFEFF/, ""));
}

function descriptor(relative, mimeType, role) {
  const file = path.join(ROOT, ...relative.split("/"));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe food-form review asset " + relative);
  const buffer = fs.readFileSync(file);
  const dimensions = readCandidateDimensions(buffer, mimeType, relative);
  return {
    role,
    path: relative,
    mimeType,
    bytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    sha256: sha256Buffer(buffer)
  };
}

function materialBindings(ingredient) {
  return {
    catalogContentVersion: catalog.contentVersion,
    rulesVersion: ruleSet.contentVersion,
    ingredientDigest: expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion)
  };
}

function buildSource(source) {
  const result = {
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
    rightsReviewState: "pending"
  };
  if (source.providerMetadata) result.providerMetadata = source.providerMetadata;
  result.sourceMetadataDigest = expectedSourceMetadataDigest(result);
  return result;
}

function buildRetrieval(source) {
  const retrieval = source.retrieval;
  if (!retrieval || typeof retrieval !== "object") throw new Error("Missing retrieval record for " + source.id);
  if (retrieval.state === "remote_metadata_only") {
    if (retrieval.localAssetAvailable !== false || retrieval.reasonCode !== "source_asset_not_copied" ||
      retrieval.sourcePath || retrieval.reviewPath || retrieval.upstreamPreviewUrl || retrieval.retrievalProxy ||
      retrieval.retrievalRequestUrl || retrieval.retrievedAt) {
      throw new Error("Remote-only candidate carries local asset claims: " + source.id);
    }
    const result = {
      retrieval: {
        state: "remote_metadata_only",
        localAssetAvailable: false,
        reasonCode: "source_asset_not_copied",
        note: retrieval.note
      },
      assets: null
    };
    result.retrieval.retrievalMetadataDigest = expectedRetrievalMetadataDigest(result.retrieval);
    return result;
  }
  if (retrieval.state === "local_review_copy") {
    if (retrieval.localAssetAvailable !== true || !retrieval.sourcePath || !retrieval.reviewPath) {
      throw new Error("Local review candidate is missing paths: " + source.id);
    }
    const result = {
      retrieval: {
        state: "local_review_copy",
        localAssetAvailable: true,
        copyType: retrieval.copyType,
        upstreamPreviewUrl: retrieval.upstreamPreviewUrl,
        retrievalProxy: retrieval.retrievalProxy,
        retrievalRequestUrl: retrieval.retrievalRequestUrl,
        retrievedAt: retrieval.retrievedAt,
        note: retrieval.note
      },
      assets: {
        sourceCopy: descriptor(retrieval.sourcePath, "image/jpeg", "cached_review_source_not_original"),
        review: descriptor(retrieval.reviewPath, "image/webp", "review_derivative")
      }
    };
    result.retrieval.retrievalMetadataDigest = expectedRetrievalMetadataDigest(result.retrieval);
    return result;
  }
  throw new Error("Unsupported retrieval state for " + source.id);
}

function buildRecord(source) {
  if (!source || typeof source !== "object") throw new Error("Invalid food-form source record");
  const ingredient = catalog.ingredients.find((item) => item.id === source.ingredientId);
  if (!ingredient) throw new Error("Unknown ingredient " + source.ingredientId);
  const retrieval = buildRetrieval(source);
  const depiction = {
    canonicalName: ingredient.name,
    catalogLatinName: ingredient.identity.latinName,
    catalogPart: ingredient.identity.ediblePart,
    sourceLabelExact: source.source.sourceLabelExact,
    visualObservation: source.visualObservation,
    catalogPartHypothesis: source.catalogPartHypothesis,
    processingState: source.processingState,
    catalogPartAlignment: source.catalogPartAlignment,
    originCoverage: source.originCoverage,
    sourceIdentityEvidence: {
      label: source.source.sourceTaxonLabel,
      evidenceKind: source.source.taxonEvidenceKind
    },
    scientificNameMatchState: source.scientificNameMatchState,
    identificationUse: "prohibited",
    edibilityUse: "prohibited",
    medicalUse: "prohibited",
    riskNotes: source.riskNotes
  };
  return {
    id: source.id,
    ingredientId: source.ingredientId,
    status: "candidate",
    role: "catalog_part_or_processing_reference_candidate",
    placements: [],
    publicationEligible: false,
    depiction,
    depictionMetadataDigest: expectedDepictionMetadataDigest(depiction),
    source: buildSource(source.source),
    retrieval: retrieval.retrieval,
    assets: retrieval.assets,
    bindings: materialBindings(ingredient),
    audit: {
      identityReviewState: "pending",
      partReviewState: "pending",
      processingReviewState: "pending",
      rightsReviewState: "pending",
      professionalReviewState: "pending",
      reviews: []
    }
  };
}

function buildGap(source) {
  if (!source || typeof source !== "object") throw new Error("Invalid food-form gap record");
  const ingredient = catalog.ingredients.find((item) => item.id === source.ingredientId);
  if (!ingredient) throw new Error("Unknown gap ingredient " + source.ingredientId);
  const gap = {
    id: source.id,
    ingredientId: source.ingredientId,
    status: "no_candidate",
    role: "catalog_part_or_processing_reference_gap",
    placements: [],
    publicationEligible: false,
    fallbackAllowed: false,
    reasonCode: source.reasonCode,
    reason: source.reason,
    searchSummary: source.searchSummary,
    checkedSources: source.checkedSources,
    identificationUse: "prohibited",
    edibilityUse: "prohibited",
    medicalUse: "prohibited",
    bindings: materialBindings(ingredient),
    audit: {
      searchReviewState: "recorded_unverified",
      identityReviewState: "pending",
      professionalReviewState: "pending",
      reviews: []
    }
  };
  gap.searchEvidenceDigest = expectedGapEvidenceDigest(gap);
  return gap;
}

function buildManifest(config = readJson(CONFIG_RELATIVE)) {
  if (!config || config.schemaVersion !== "1.0.0" ||
    JSON.stringify(config.targetIngredientIds) !== JSON.stringify(EXPECTED_TARGET_IDS) ||
    !Array.isArray(config.records) || !Array.isArray(config.gaps)) {
    throw new Error("Invalid food-form candidate source catalog");
  }
  const manifest = {
    schemaVersion: "1.0.0",
    contentVersion: config.contentVersion,
    createdAt: config.createdAt,
    scope: "private_review_only",
    targetIngredientIds: config.targetIngredientIds,
    count: config.records.length,
    gapCount: config.gaps.length,
    policy: {
      clientUploadAllowed: false,
      runtimeReferenceAllowed: false,
      identificationUse: "prohibited",
      edibilityUse: "prohibited",
      medicalUse: "prohibited",
      requiredReviewRoles: [
        "pharmacognosy_reviewer",
        "pharmacist",
        "compliance",
        "rights_clearance",
        "release_approver"
      ]
    },
    records: config.records.map(buildRecord),
    gaps: config.gaps.map(buildGap)
  };
  validateManifest(manifest, ROOT);
  return manifest;
}

function main() {
  const manifest = buildManifest();
  const output = path.join(ROOT, ...MANIFEST_RELATIVE.split("/"));
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    foodFormCandidates: manifest.count,
    localReviewCopies: manifest.records.filter((record) => record.retrieval.localAssetAvailable).length,
    remoteMetadataOnly: manifest.records.filter((record) => !record.retrieval.localAssetAvailable).length,
    explicitGaps: manifest.gapCount,
    publicationEligible: 0,
    output: MANIFEST_RELATIVE
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[build-food-form-candidate-manifest] " + error.message);
    process.exit(1);
  }
}

module.exports = { buildManifest };
