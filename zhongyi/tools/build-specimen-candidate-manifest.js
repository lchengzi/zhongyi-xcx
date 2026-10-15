"use strict";

const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const { expectedIngredientReviewDigest } = require("./recipe-digests");
const {
  MANIFEST_RELATIVE,
  expectedSourceMetadataDigest,
  readCandidateDimensions,
  scientificNameBinding,
  sha256Buffer,
  validateManifest
} = require("./specimen-candidate-core");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_RELATIVE = "content-private/media-candidates/specimens/specimen-catalog.json";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...relative.split("/")), "utf8").replace(/^\uFEFF/, ""));
}

function descriptor(relative, mimeType) {
  const file = path.join(ROOT, ...relative.split("/"));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe specimen asset " + relative);
  const buffer = fs.readFileSync(file);
  const dimensions = readCandidateDimensions(buffer, mimeType, relative);
  return {
    path: relative,
    mimeType,
    bytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    sha256: sha256Buffer(buffer)
  };
}

function buildRecord(source) {
  if (!source || typeof source !== "object" || !/^[A-Za-z0-9.-]+$/.test(source.assetStem || "")) {
    throw new Error("Invalid specimen source record or assetStem");
  }
  const ingredient = catalog.ingredients.find((item) => item.id === source.ingredientId);
  if (!ingredient) throw new Error("Unknown ingredient " + source.ingredientId);
  const nameBinding = scientificNameBinding(source.source.scientificName, ingredient.identity.latinName);
  if (!nameBinding) throw new Error("Unregistered specimen scientific-name binding for " + source.ingredientId);
  const base = "content-private/media-candidates/specimens/";
  const sourceRecord = {
    provider: "GBIF occurrence API and linked collection",
    gbifKey: source.source.gbifKey,
    occurrenceUrl: "https://www.gbif.org/occurrence/" + source.source.gbifKey,
    occurrenceID: source.source.occurrenceID,
    scientificName: source.source.scientificName,
    catalogScientificName: ingredient.identity.latinName,
    scientificNameMatch: nameBinding.matchType,
    taxonReferenceId: nameBinding.taxonReferenceId,
    taxonKey: source.source.taxonKey,
    acceptedTaxonKey: source.source.acceptedTaxonKey,
    acceptedScientificName: source.source.acceptedScientificName,
    datasetKey: source.source.datasetKey,
    basisOfRecord: source.source.basisOfRecord,
    gbifIssues: source.source.gbifIssues,
    institutionCode: source.source.institutionCode,
    collectionCode: source.source.collectionCode,
    catalogNumber: source.source.catalogNumber,
    occurrenceLicense: source.source.occurrenceLicense,
    occurrenceRightsHolder: source.source.occurrenceRightsHolder,
    publishingOrgKey: source.source.publishingOrgKey,
    mediaType: "StillImage",
    mediaIdentifier: source.source.mediaIdentifier,
    mediaLicense: source.source.mediaLicense,
    mediaCreator: source.source.mediaCreator,
    mediaRightsHolder: source.source.mediaRightsHolder,
    mediaPublisher: source.source.mediaPublisher,
    mediaReferences: source.source.mediaReferences,
    sourceCheckedAt: source.source.sourceCheckedAt,
    rightsReviewState: "pending"
  };
  sourceRecord.sourceMetadataDigest = expectedSourceMetadataDigest(sourceRecord);
  return {
    id: source.id,
    ingredientId: source.ingredientId,
    status: "candidate",
    role: "origin_specimen_reference",
    placements: [],
    publicationEligible: false,
    depiction: {
      canonicalName: ingredient.name,
      latinName: ingredient.identity.latinName,
      catalogPart: ingredient.identity.ediblePart,
      shownMaterial: source.shownMaterial,
      catalogPartVisibility: source.catalogPartVisibility,
      visualUsability: source.visualUsability,
      identificationUse: "prohibited",
      medicalUse: "prohibited",
      riskNotes: source.riskNotes
    },
    source: sourceRecord,
    assets: {
      original: descriptor(base + "original/" + source.assetStem + ".jpg", "image/jpeg"),
      review: descriptor(base + "review/" + source.assetStem + ".webp", "image/webp")
    },
    bindings: {
      catalogContentVersion: catalog.contentVersion,
      rulesVersion: ruleSet.contentVersion,
      ingredientDigest: expectedIngredientReviewDigest(ingredient, catalog.contentVersion, ruleSet.contentVersion)
    },
    audit: {
      identityReviewState: "pending",
      rightsReviewState: "pending",
      professionalReviewState: "pending",
      reviews: []
    }
  };
}

function buildManifest(config = readJson(CONFIG_RELATIVE)) {
  if (!config || config.schemaVersion !== "1.0.0" || !Array.isArray(config.records) || config.records.length === 0) {
    throw new Error("Invalid specimen candidate source catalog");
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
      identificationUse: "prohibited",
      medicalUse: "prohibited"
    },
    records: config.records.map(buildRecord)
  };
  validateManifest(manifest, ROOT);
  return manifest;
}

function main() {
  const manifest = buildManifest();
  fs.writeFileSync(path.join(ROOT, ...MANIFEST_RELATIVE.split("/")), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    specimenCandidates: manifest.count,
    publicationEligible: 0,
    output: MANIFEST_RELATIVE
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[build-specimen-candidate-manifest] " + error.message);
    process.exit(1);
  }
}

module.exports = { buildManifest };
