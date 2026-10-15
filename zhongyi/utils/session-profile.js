"use strict";

const safety = require("./safety");

const AGE_GROUPS = ["unknown", "infant_toddler", "child", "adult", "older_adult"];

function statusValue(value, legacyYes) {
  if (value === "yes" || value === "no") return value;
  if (value === "unknown" && !legacyYes) return value;
  return legacyYes ? "yes" : "unknown";
}

function fromSession(input) {
  const session = input && typeof input === "object" ? input : {};
  const flags = Array.isArray(session.riskFlags) ? session.riskFlags : [];
  const allergies = Array.isArray(session.allergies) ? session.allergies.slice() : [];
  const conditions = Array.isArray(session.conditions) ? session.conditions.slice() : [];
  const medications = Array.isArray(session.medications) ? session.medications.slice() : [];
  const ageGroup = AGE_GROUPS.includes(session.ageGroup)
    ? session.ageGroup
    : flags.includes("infant_toddler") ? "infant_toddler"
      : flags.includes("child") ? "child"
        : flags.includes("older_adult") ? "older_adult" : "unknown";
  return safety.normalizeProfile({
    ageGroup,
    pregnancy: statusValue(session.pregnancyStatus, flags.includes("pregnancy")),
    breastfeeding: statusValue(session.breastfeedingStatus, flags.includes("breastfeeding")),
    allergies,
    allergyStatus: statusValue(session.allergyStatus, flags.includes("known_allergy") || allergies.length > 0),
    conditions,
    conditionStatus: statusValue(session.conditionStatus, flags.includes("chronic_condition") || conditions.length > 0),
    medications,
    medicationStatus: statusValue(session.medicationStatus, flags.includes("medication") || medications.length > 0),
    redFlags: Array.isArray(session.redFlags) ? session.redFlags : []
  });
}

module.exports = { fromSession };
