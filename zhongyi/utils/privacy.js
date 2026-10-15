"use strict";

const storage = require("./storage");

const LEGACY_SESSION_HEALTH_KEYS = Object.freeze([
  "sessionSymptoms",
  "sessionSymptomSelections",
  "sessionRedFlags",
  "sessionAllergies",
  "sessionConditions",
  "sessionMedications",
  "sessionDiagnosisConfirmations"
]);

function createEmptySessionSafetyProfile() {
  return {
    ageGroup: "unknown",
    pregnancyStatus: "unknown",
    breastfeedingStatus: "unknown",
    allergyStatus: "unknown",
    conditionStatus: "unknown",
    medicationStatus: "unknown",
    riskFlags: [],
    redFlags: [],
    allergies: [],
    conditions: [],
    medications: []
  };
}

function isNonEmpty(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value != null && value !== "" && value !== false;
}

function hasSafetySession(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  if (source.ageGroup && source.ageGroup !== "unknown") return true;
  if ([
    source.pregnancyStatus,
    source.breastfeedingStatus,
    source.allergyStatus,
    source.conditionStatus,
    source.medicationStatus
  ].some((value) => value === "yes" || value === "no")) return true;
  return [
    source.riskFlags,
    source.redFlags,
    source.allergies,
    source.conditions,
    source.medications
  ].some(isNonEmpty);
}

function getLocalDataSummary(app) {
  const globalData = app && app.globalData && typeof app.globalData === "object" ? app.globalData : {};
  const acknowledgements = globalData.sessionRecipeAcknowledgements;
  const checklist = storage.getChecklist();
  const legacyHealthPresent = LEGACY_SESSION_HEALTH_KEYS.some((key) => isNonEmpty(globalData[key]));
  const persistent = storage.getPersistentState();
  const favoritesCount = persistent.favorites.length;
  const compareCount = persistent.compare.length;
  const checklistCount = Object.keys(checklist).filter((key) => checklist[key] === true).length;
  const diagnosisConfirmationCount = acknowledgements && typeof acknowledgements === "object"
    ? Object.keys(acknowledgements).filter((key) => acknowledgements[key] === true).length
    : 0;
  const hasHealthSession = hasSafetySession(globalData.sessionSafetyProfile) || legacyHealthPresent;
  return {
    favoritesCount,
    compareCount,
    favoritesAvailable: persistent.favoritesAvailable,
    compareAvailable: persistent.compareAvailable,
    storageIssue: persistent.message,
    persistentItemCount: favoritesCount + compareCount,
    checklistCount,
    diagnosisConfirmationCount,
    hasHealthSession,
    hasRedFlags: Boolean(globalData.sessionSafetyProfile && (
      Array.isArray(globalData.sessionSafetyProfile.redFlags) && globalData.sessionSafetyProfile.redFlags.length
    )),
    hasSessionData: hasHealthSession || checklistCount > 0 || diagnosisConfirmationCount > 0
  };
}

function clearAllLocalData(app) {
  const persistent = storage.clearOwnedPersistentData();
  storage.checklist.clear();
  const globalData = app && app.globalData && typeof app.globalData === "object" ? app.globalData : null;
  if (globalData) {
    globalData.sessionSafetyProfile = createEmptySessionSafetyProfile();
    globalData.sessionRecipeAcknowledgements = {};
    LEGACY_SESSION_HEALTH_KEYS.forEach((key) => { delete globalData[key]; });
    const revision = Number.isSafeInteger(globalData.sessionDataRevision) ? globalData.sessionDataRevision : 0;
    globalData.sessionDataRevision = revision + 1;
  }
  const summary = getLocalDataSummary(app);
  const sessionCleared = !summary.hasSessionData && !summary.hasRedFlags;
  const persistentCleared = summary.favoritesAvailable && summary.compareAvailable &&
    summary.persistentItemCount === 0 && persistent.remainingKeys.length === 0;
  return {
    ok: persistent.ok && persistentCleared && sessionCleared,
    persistentCleared,
    sessionCleared,
    verified: persistent.verified,
    failedKeyCount: persistent.failedKeys.length,
    remainingKeyCount: persistent.remainingKeys.length
  };
}

function getDeletionContext(app) {
  const data = app && app.globalData && typeof app.globalData === "object" ? app.globalData : {};
  return JSON.stringify([
    data.sessionDataRevision || 0,
    storage.getOwnedPersistentContext(),
    data.sessionSafetyProfile || {},
    data.sessionRecipeAcknowledgements || {},
    storage.getChecklist(),
    LEGACY_SESSION_HEALTH_KEYS.map((key) => [key, data[key]])
  ]);
}

module.exports = {
  LEGACY_SESSION_HEALTH_KEYS,
  createEmptySessionSafetyProfile,
  getLocalDataSummary,
  clearAllLocalData,
  getDeletionContext
};
