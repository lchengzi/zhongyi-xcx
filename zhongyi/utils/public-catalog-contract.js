"use strict";

const localCatalog = require("../data/ingredients");
const activeRelease = require("../data/version-runtime.js");

function projectIngredient(item) {
  const pick = (value) => typeof value === "string" ? value : "";
  const identity = item.identity || {};
  const audit = item.audit || {};
  const regulatory = item.regulatory || {};
  return {
    id: pick(item.id), name: pick(item.name), pinyin: pick(item.pinyin),
    aliases: (item.aliases || []).filter((value) => typeof value === "string"),
    batch: pick(item.batch), latinName: pick(identity.latinName),
    ediblePart: pick(identity.ediblePart), identityState: pick(identity.partReviewState),
    professionalReviewState: pick(audit.professionalReviewState), restriction: pick(regulatory.restriction),
    sources: (item.sources || []).map((source) => ({
      id: pick(source.id), title: pick(source.title), publisher: pick(source.publisher),
      url: pick(source.url), status: pick(source.status), checkedAt: pick(source.checkedAt)
    }))
  };
}

function expectedEnvelope() {
  return {
    schemaVersion: 1, purpose: "historical_catalog_reference",
    releaseId: activeRelease.releaseId, releaseDigest: activeRelease.releaseDigest,
    contentVersion: localCatalog.contentVersion, sourceAsOf: localCatalog.catalogCoverage.asOf,
    items: localCatalog.ingredients.map(projectIngredient)
  };
}

// Compare to the trusted LOCAL structure rather than trusting remote hashes or
// review flags. This simultaneously checks types, nested allowlists and values.
// A response cannot bring a different safety/identity release into the runtime.
function equalsExpected(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((item, index) => equalsExpected(actual[index], item));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const keys = Object.keys(expected);
    return Object.keys(actual).length === keys.length && keys.every((key) => (
      Object.prototype.hasOwnProperty.call(actual, key) && equalsExpected(actual[key], expected[key])
    ));
  }
  return actual === expected;
}

function validate(payload) {
  if (!equalsExpected(payload, expectedEnvelope())) throw new Error("incompatible_public_catalog");
  // Keep an owned JSON copy: neither a transport callback nor a page can mutate
  // the accepted response into a subsequent unvalidated update.
  return JSON.parse(JSON.stringify(payload));
}

function forDisplay(payload) {
  const accepted = validate(payload);
  return localCatalog.ingredients.map((local, index) => {
    const remote = accepted.items[index];
    return {
      ...local,
      name: remote.name, pinyin: remote.pinyin, aliases: remote.aliases.slice(),
      identity: { ...local.identity, latinName: remote.latinName, ediblePart: remote.ediblePart },
      sources: (local.sources || []).map((source, sourceIndex) => ({ ...source, ...remote.sources[sourceIndex] }))
      // All medical/safety/triage/food-use/review fields remain from localCatalog.
    };
  });
}

module.exports = { expectedEnvelope, validate, forDisplay, projectIngredient };
