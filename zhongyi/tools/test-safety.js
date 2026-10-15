"use strict";

const assert = require("assert");
const catalog = require("../data/ingredients");
const ruleSet = require("../data/rule-set");
const { evaluateCatalog } = require("../utils/safety");
const { applyCatalogFilters } = require("../utils/filter");
const { buildCompareGroups } = require("../utils/compare");
const format = require("../utils/format");

function evaluations(profile) {
  return evaluateCatalog(catalog.ingredients, profile);
}

function blockedBy(profile, code) {
  return evaluations(profile).filter((item) => item.reasonCodes.includes(code));
}

const BATCH_2023_IDS = [
  "dang-shen", "rou-cong-rong-huang-mo", "tie-pi-shi-hu", "xi-yang-shen", "huang-qi",
  "ling-zhi", "shan-zhu-yu", "tian-ma", "du-zhong-ye"
];
const BATCH_2024_IDS = ["di-huang", "mai-dong", "tian-dong", "hua-ju-hong"];
const SPECIAL_POPULATION_IDS = BATCH_2023_IDS.concat(BATCH_2024_IDS).sort();
const SEASONING_ONLY_IDS = ["dang-gui", "shan-nai", "xi-hong-hua", "cao-guo", "jiang-huang", "bi-ba"].sort();
const EXPECTED_PARTS = {
  "dang-gui": "根", "shan-nai": "根茎", "xi-hong-hua": "柱头", "cao-guo": "果实", "jiang-huang": "根茎", "bi-ba": "果穗",
  "dang-shen": "根", "rou-cong-rong-huang-mo": "肉质茎", "tie-pi-shi-hu": "茎", "xi-yang-shen": "根", "huang-qi": "根",
  "ling-zhi": "子实体", "shan-zhu-yu": "果肉", "tian-ma": "块茎", "du-zhong-ye": "叶", "di-huang": "块根", "mai-dong": "块根",
  "tian-dong": "块根", "hua-ju-hong": "外层果皮", "gou-qi-zi": "果实（具体身份与部位待发布前复核）"
};
const EXPECTED_2002_NAMES = [
  "丁香", "八角茴香", "刀豆", "小茴香", "小蓟", "山药", "山楂", "马齿苋", "乌梢蛇", "乌梅", "木瓜", "火麻仁",
  "代代花", "玉竹", "甘草", "白芷", "白果", "白扁豆", "白扁豆花", "龙眼肉（桂圆）", "决明子", "百合", "肉豆蔻", "肉桂",
  "余甘子", "佛手", "杏仁（甜、苦）", "沙棘", "牡蛎", "芡实", "花椒", "赤小豆", "阿胶", "鸡内金", "麦芽", "昆布",
  "枣（大枣、酸枣、黑枣）", "罗汉果", "郁李仁", "金银花", "青果", "鱼腥草", "姜（生姜、干姜）", "枳椇子", "枸杞子", "栀子",
  "砂仁", "胖大海", "茯苓", "香橼", "香薷", "桃仁", "桑叶", "桑椹", "桔红", "桔梗", "益智仁", "荷叶", "莱菔子", "莲子",
  "高良姜", "淡竹叶", "淡豆豉", "菊花", "菊苣", "黄芥子", "黄精", "紫苏", "紫苏籽", "葛根", "黑芝麻", "黑胡椒",
  "槐米", "槐花", "蒲公英", "蜂蜜", "榧子", "酸枣仁", "鲜白茅根", "鲜芦根", "蝮蛇", "橘皮", "薄荷", "薏苡仁",
  "薤白", "覆盆子", "藿香"
].sort();
const byId = new Map(catalog.ingredients.map((item) => [item.id, item]));

assert.strictEqual(catalog.count, 106, "P3 must contain the complete 106-item official catalog");
assert.strictEqual(catalog.catalogCoverage.officialCount, 106, "versioned catalog coverage metadata drifted");
assert.deepStrictEqual(catalog.catalogCoverage.batches.map((batch) => batch.count), [87, 6, 9, 4], "official batch coverage drifted");
assert.strictEqual(new Set(catalog.ingredients.map((item) => item.id)).size, 106, "catalog ids must remain unique");
assert.strictEqual(new Set(catalog.ingredients.map((item) => item.name)).size, 106, "catalog names must remain unique");
assert.deepStrictEqual(
  catalog.ingredients
    .filter((item) => item.sources.some((source) => source.id === "nhc-food-medicine-list-2002"))
    .map((item) => item.name)
    .sort(),
  EXPECTED_2002_NAMES,
  "the 87-name 2002 official list snapshot changed"
);
assert.strictEqual(catalog.ingredients.filter((item) => item.audit.releaseStage === "seed").length, 20, "P1 high-information seed set changed");
assert.strictEqual(catalog.ingredients.filter((item) => item.audit.releaseStage === "catalog_only").length, 86, "P3 catalog-only expansion changed");
assert.strictEqual(ruleSet.contentVersion, "1.6.0", "active safety-rule contract changed without updating the regression snapshot");
assert(catalog.ingredients.every((item) => item.audit.professionalReviewState === "pending"), "an ingredient was marked professionally reviewed without the release fixture being updated");
assert(catalog.ingredients.every((item) => Array.isArray(item.audit.reviews) && item.audit.reviews.length === 0), "real ingredient review records must not be fabricated in seed data");
assert(catalog.ingredients.every((item) => item.audit.ingredientDigest === null), "pending ingredient review must not carry a false signed digest");
assert.deepStrictEqual(byId.get("tian-ma").usageTypes, ["traditional_food"], "Tianma must not be inferred into soup filtering from a generic stewed-dish source");
assert.deepStrictEqual(byId.get("tian-ma").goals, ["traditional_food_form"], "Tianma goal mapping exceeded its controlled source mapping");
const unsupportedPositivePopulation = JSON.parse(JSON.stringify(byId.get("dang-gui")));
unsupportedPositivePopulation.safety.pregnancy = "yes";
unsupportedPositivePopulation.safety.sourceIds = [];
const unsupportedPositiveResult = evaluateCatalog([unsupportedPositivePopulation], { pregnancy: "yes" })[0];
assert(unsupportedPositiveResult.warningCodes.includes("pregnancy_unknown"), "a positive pregnancy claim without a published source was treated as suitable");
assert.strictEqual(format.detailView(unsupportedPositivePopulation, [], [], unsupportedPositiveResult).safetyRows[0].value, "待确认", "detail view exposed an unsupported positive population claim");
const flagOnlyPositivePopulation = JSON.parse(JSON.stringify(unsupportedPositivePopulation));
flagOnlyPositivePopulation.safety.sourceIds = [flagOnlyPositivePopulation.sources.find((source) => source.status === "published").id];
flagOnlyPositivePopulation.audit.professionalReviewState = "reviewed";
flagOnlyPositivePopulation.audit.reviewedAt = "2026-08-09";
flagOnlyPositivePopulation.audit.ingredientDigest = `sha256:${"a".repeat(64)}`;
const flagOnlyPositiveResult = evaluateCatalog([flagOnlyPositivePopulation], { pregnancy: "yes" })[0];
assert(flagOnlyPositiveResult.warningCodes.includes("pregnancy_unknown"), "a positive population claim passed after only flipping the professional-review flag");
assert.strictEqual(format.detailView(flagOnlyPositivePopulation, [], [], flagOnlyPositiveResult).safetyRows[0].value, "待确认", "detail view trusted a professional-review flag without independent records");
assert.strictEqual(blockedBy({}, "red_flag").length, 0, "empty profile must not invent a red flag");
assert.strictEqual(blockedBy({ redFlags: ["sudden_severe_chest_pain"] }, "red_flag").length, 106, "red flag must stop the whole catalog");
assert.strictEqual(blockedBy({ pregnancy: "yes" }, "pregnancy_not_suitable").length, 13, "2023/2024 special-population rule changed");
assert.deepStrictEqual(
  blockedBy({ pregnancy: "yes" }, "pregnancy_not_suitable").map((item) => item.ingredientId).sort(),
  SPECIAL_POPULATION_IDS,
  "special-population rules moved to the wrong ingredients"
);
assert.strictEqual(blockedBy({ breastfeeding: "yes" }, "breastfeeding_not_suitable").length, 13, "breastfeeding rule changed");
assert.strictEqual(blockedBy({ ageGroup: "infant_toddler" }, "infants_toddlers_not_suitable").length, 13, "infant/toddler rule changed");
assert.deepStrictEqual(blockedBy({ medications: ["藜芦"] }, "interaction_match").map((item) => item.ingredientId).sort(), ["dang-shen", "xi-yang-shen"], "explicit interaction rule changed");
assert.deepStrictEqual(blockedBy({ conditions: ["过敏体质"] }, "condition_match").map((item) => item.ingredientId), ["tian-ma"], "explicit Tianma caution rule changed");
assert.deepStrictEqual(
  blockedBy({ allergyStatus: "yes", allergies: [] }, "allergy_prone_not_suitable").map((item) => item.ingredientId),
  ["tian-ma"],
  "known allergy-prone status without a fabricated placeholder must still stop Tianma"
);
assert(
  evaluations({ conditions: ["高血压"] })[0].warningCodes.includes("profile_incomplete"),
  "a partially filled profile must keep the unfilled dimensions explicit"
);
assert.strictEqual(applyCatalogFilters(catalog.ingredients, { goals: ["seasoning"] }, {}).length, 6, "2019 seasoning-only browse result changed");
assert.deepStrictEqual(
  catalog.ingredients.filter((item) => item.regulatory.restrictionCode === "seasoning_only").map((item) => item.id).sort(),
  SEASONING_ONLY_IDS,
  "seasoning-only restriction moved to the wrong ingredients"
);
catalog.ingredients.forEach((item) => {
  if (Object.prototype.hasOwnProperty.call(EXPECTED_PARTS, item.id)) {
    assert.strictEqual(item.identity.ediblePart, EXPECTED_PARTS[item.id], `official part snapshot changed for ${item.id}`);
  } else {
    assert.strictEqual(item.identity.partReviewState, "pending", `${item.id} must not invent a reviewed identity from the name-only 2002 list`);
    assert.deepStrictEqual(item.goals, [], `${item.id} must not invent a goal mapping from the name-only 2002 list`);
    assert.deepStrictEqual(item.usageTypes, [], `${item.id} must not invent a food-use mapping from the name-only 2002 list`);
  }
  item.sources.forEach((source) => {
    assert.strictEqual(source.status, "published", `${item.id} source status must be explicit`);
    assert(source.publishedAt && source.checkedAt, `${item.id} source dates must be explicit`);
  });
  item.foodUse.sourceIds.forEach((sourceId) => {
    assert(item.sources.some((source) => source.id === sourceId), `${item.id} food-use source binding is unresolved`);
  });
  const sourceIds = item.sources.map((source) => source.id);
  assert(sourceIds.includes("nhc-catalog-rule-2021"), `${item.id} lost the catalog-management source`);
  if (sourceIds.includes("nhc-food-medicine-list-2002")) {
    assert(sourceIds.includes("nhc-current-catalog-count-2025"), `${item.id} lost the current 106-item catalog cross-check`);
  }
  if (SEASONING_ONLY_IDS.includes(item.id)) assert(sourceIds.includes("nhc-announcement-2019-8"), `${item.id} lost its 2019 announcement`);
  if (BATCH_2023_IDS.includes(item.id)) {
    assert(sourceIds.includes("nhc-announcement-2023-9"), `${item.id} lost its 2023 announcement`);
    assert(sourceIds.includes("nhc-interpretation-2023-9"), `${item.id} lost its 2023 interpretation`);
    assert(item.safety.sourceIds.includes("nhc-interpretation-2023-9"), `${item.id} safety rules lost their 2023 source binding`);
  }
  if (BATCH_2024_IDS.includes(item.id)) {
    assert(sourceIds.includes("nhc-announcement-2024-4"), `${item.id} lost its 2024 announcement`);
    assert(sourceIds.includes("nhc-interpretation-2024-4"), `${item.id} lost its 2024 interpretation`);
    assert(item.safety.sourceIds.includes("nhc-interpretation-2024-4"), `${item.id} safety rules lost their 2024 source binding`);
  }
});
assert.strictEqual(applyCatalogFilters(catalog.ingredients, {}, { pregnancy: "yes" }).length, 93, "hard-block filter must always remove blocked records");
assert.strictEqual(applyCatalogFilters(catalog.ingredients, { safetyOnly: false }, { pregnancy: "yes" }).length, 93, "legacy input must not bypass a hard block");

const mutationSafetySourceId = catalog.ingredients[0].sources.find((source) => source.status === "published").id;
const avoidMutation = {
  ...catalog.ingredients[0],
  safety: { ...catalog.ingredients[0].safety, pregnancy: "avoid", sourceIds: [mutationSafetySourceId] }
};
assert(evaluateCatalog([avoidMutation], { pregnancy: "yes" })[0].blocked, "legacy avoid state must fail closed as a hard block");
const objectMutation = {
  ...catalog.ingredients[0],
  safety: { ...catalog.ingredients[0].safety, pregnancy: { status: "no", reviewState: "reviewed" }, sourceIds: [mutationSafetySourceId] }
};
assert(evaluateCatalog([objectMutation], { pregnancy: "yes" })[0].blocked, "legacy object state must fail closed as a hard block");
const cautionMutation = {
  ...catalog.ingredients[0],
  safety: { ...catalog.ingredients[0].safety, cautionConditions: ["高血压"] }
};
assert(
  evaluateCatalog([cautionMutation], { conditions: ["高血压"] })[0].warningCodes.includes("condition_caution"),
  "a matched caution condition must remain visible in the safety result"
);
const preparationMutation = {
  ...catalog.ingredients[0],
  safety: { ...catalog.ingredients[0].safety, preparationWarnings: ["测试加工提醒"] }
};
assert(
  evaluateCatalog([preparationMutation], {})[0].warningCodes.includes("preparation_warning"),
  "a preparation warning must affect the catalog safety status"
);
const olderAdultMutation = {
  ...catalog.ingredients[0],
  safety: { ...catalog.ingredients[0].safety, olderAdults: "no", sourceIds: [mutationSafetySourceId] }
};
assert(
  evaluateCatalog([olderAdultMutation], { ageGroup: "older_adult" })[0].reasonCodes.includes("older_adult_not_suitable"),
  "an explicit older-adult no rule must hard block"
);

const sample = catalog.ingredients.slice(0, 4);
const groups = buildCompareGroups(sample, false, evaluateCatalog(sample, {}));
assert(groups.length >= 4, "compare groups missing");
assert(groups.reduce((sum, group) => sum + group.rows.length, 0) >= 20, "compare dimensions missing");

console.log(JSON.stringify({
  ingredients: catalog.count,
  redFlagStops: blockedBy({ redFlags: ["sudden_severe_chest_pain"] }, "red_flag").length,
  pregnancyStops: blockedBy({ pregnancy: "yes" }, "pregnancy_not_suitable").length,
  infantToddlerStops: blockedBy({ ageGroup: "infant_toddler" }, "infants_toddlers_not_suitable").length,
  interactionStops: blockedBy({ medications: ["藜芦"] }, "interaction_match").length,
  assertions: "passed"
}, null, 2));
