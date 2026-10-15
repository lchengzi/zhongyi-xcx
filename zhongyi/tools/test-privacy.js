"use strict";

const assert = require("assert");

const memory = Object.create(null);
let failRemovalFor = "";

global.wx = {
  getStorageSync(key) { return memory[key] == null ? "" : memory[key]; },
  setStorageSync(key, value) { memory[key] = value; },
  removeStorageSync(key) {
    if (key === failRemovalFor) throw new Error("synthetic removal failure");
    delete memory[key];
  },
  getStorageInfoSync() { return { keys: Object.keys(memory) }; }
};

const storage = require("../utils/storage");
const privacy = require("../utils/privacy");

function populatedApp() {
  return {
    globalData: {
      sessionSafetyProfile: {
        ageGroup: "adult",
        pregnancyStatus: "no",
        breastfeedingStatus: "no",
        allergyStatus: "yes",
        conditionStatus: "yes",
        medicationStatus: "yes",
        riskFlags: ["known_allergy", "chronic_condition", "medication"],
        redFlags: ["sudden_severe_chest_pain"],
        allergies: ["合成过敏测试值"],
        conditions: ["合成疾病测试值"],
        medications: ["合成用药测试值"]
      },
      sessionRecipeAcknowledgements: { adult_diabetes: true },
      sessionSymptoms: ["合成症状测试值"]
    }
  };
}

const app = populatedApp();
storage.setFavorites(["seed-a", "seed-b"]);
storage.setCompare(["seed-a"]);
storage.setChecklist({ identity: true, medications: true });
memory.zhongyi_legacy_health_v0 = { value: "legacy synthetic health fixture" };
memory.unrelated_runtime_key = "keep";

const before = privacy.getLocalDataSummary(app);
assert.strictEqual(before.favoritesCount, 2, "privacy summary lost favorite count");
assert.strictEqual(before.compareCount, 1, "privacy summary lost compare count");
assert.strictEqual(before.checklistCount, 2, "privacy summary lost checklist count");
assert.strictEqual(before.diagnosisConfirmationCount, 1, "privacy summary lost diagnosis-confirmation count");
assert(before.hasHealthSession && before.hasRedFlags, "privacy summary failed to detect the health session");
assert(!JSON.stringify(before).includes("合成过敏测试值"), "privacy summary must not echo health details");
assert(!JSON.stringify(memory).includes("合成过敏测试值"), "allergy details must not reach persistent storage");
assert(!JSON.stringify(memory).includes("合成疾病测试值"), "condition details must not reach persistent storage");
assert(!JSON.stringify(memory).includes("合成用药测试值"), "medication details must not reach persistent storage");

const cleared = privacy.clearAllLocalData(app);
assert(cleared.ok && cleared.verified, "complete local deletion must be verified");
assert.deepStrictEqual(
  app.globalData.sessionSafetyProfile,
  privacy.createEmptySessionSafetyProfile(),
  "safety profile was not reset to explicit unknown values"
);
assert.deepStrictEqual(app.globalData.sessionRecipeAcknowledgements, {}, "diagnosis confirmations were not cleared");
assert(!Object.prototype.hasOwnProperty.call(app.globalData, "sessionSymptoms"), "legacy symptom session survived deletion");
assert.deepStrictEqual(storage.getChecklist(), {}, "session checklist survived deletion");
assert.strictEqual(Object.keys(memory).filter((key) => key.startsWith("zhongyi_")).length, 0, "owned persistent keys survived deletion");
assert.strictEqual(memory.unrelated_runtime_key, "keep", "deletion crossed the app-owned storage namespace");

storage.setFavorites(["seed-a"]);
app.globalData.sessionSafetyProfile = populatedApp().globalData.sessionSafetyProfile;
failRemovalFor = storage.KEYS.favorites;
const failed = privacy.clearAllLocalData(app);
assert.strictEqual(failed.ok, false, "a failed storage removal must not report successful deletion");
assert.strictEqual(failed.failedKeyCount, 1, "failed storage removal was not reported");
assert.deepStrictEqual(app.globalData.sessionSafetyProfile, privacy.createEmptySessionSafetyProfile(), "session health must clear even when persistent removal fails");

failRemovalFor = "";
assert(privacy.clearAllLocalData(app).ok, "retry after a storage failure did not complete deletion");

console.log(JSON.stringify({
  persistedHealthFields: 0,
  sessionFieldsCleared: 8,
  legacyOwnedKeysCleared: 1,
  deletionFailureFailClosed: true,
  assertions: "passed"
}, null, 2));
