"use strict";

const catalogData = require("../data/ingredients");
const ruleSet = require("../data/rule-set");

const TRI_STATE = Object.freeze({
  YES: "yes",
  NO: "no",
  UNKNOWN: "unknown"
});

const AGE_GROUPS = ["unknown", "infant_toddler", "child", "adult", "older_adult"];
const TRI_VALUES = [TRI_STATE.YES, TRI_STATE.NO, TRI_STATE.UNKNOWN];
const REQUIRED_INGREDIENT_REVIEW_ROLES = ["tcm_clinician", "pharmacist", "compliance"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength || 80);
}

function uniqueTextList(value, maxItems, maxLength) {
  const seen = Object.create(null);
  const result = [];
  asArray(value).forEach((item) => {
    const text = cleanText(item, maxLength || 80);
    const key = text.toLocaleLowerCase();
    if (!text || seen[key] || result.length >= (maxItems || 30)) return;
    seen[key] = true;
    result.push(text);
  });
  return result;
}

function triState(value) {
  return TRI_VALUES.includes(value) ? value : TRI_STATE.UNKNOWN;
}

function safetyRuleState(value) {
  const raw = value && typeof value === "object"
    ? (value.status || value.value || value.recommendation)
    : value;
  if (raw === TRI_STATE.YES || raw === "allow") return TRI_STATE.YES;
  if (raw === TRI_STATE.NO || raw === "avoid") return TRI_STATE.NO;
  return TRI_STATE.UNKNOWN;
}

function normalizeProfile(input) {
  const source = input && typeof input === "object" ? input : {};
  const allergies = uniqueTextList(source.allergies, 30, 80);
  const conditions = uniqueTextList(source.conditions, 30, 80);
  const medications = uniqueTextList(source.medications, 30, 80);
  let allergyStatus = triState(source.allergyStatus);
  let conditionStatus = triState(source.conditionStatus);
  let medicationStatus = triState(source.medicationStatus);
  if (allergies.length) allergyStatus = TRI_STATE.YES;
  if (conditions.length) conditionStatus = TRI_STATE.YES;
  if (medications.length) medicationStatus = TRI_STATE.YES;

  return {
    ageGroup: AGE_GROUPS.includes(source.ageGroup) ? source.ageGroup : "unknown",
    pregnancy: triState(source.pregnancy),
    breastfeeding: triState(source.breastfeeding),
    allergies,
    allergyStatus,
    conditions,
    conditionStatus,
    medications,
    medicationStatus,
    redFlags: uniqueTextList(source.redFlags, 12, 60)
  };
}

function normalizedToken(value) {
  return cleanText(value, 120).toLocaleLowerCase().replace(/[\s·•、，,;；()（）]/g, "");
}

function tokensMatch(left, right) {
  const a = normalizedToken(left);
  const b = normalizedToken(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // 至少两个字符才允许包含匹配，避免单字造成大范围误判。
  return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
}

function findMatches(profileValues, ruleValues) {
  const matches = [];
  asArray(profileValues).forEach((profileValue) => {
    asArray(ruleValues).forEach((ruleValue) => {
      if (tokensMatch(profileValue, ruleValue)) matches.push(cleanText(ruleValue, 80));
    });
  });
  return uniqueTextList(matches, 30, 80);
}

function publishedSourceSet(ingredient) {
  return new Set(asArray(ingredient && ingredient.sources)
    .filter((source) => source && source.status === "published" && cleanText(source.id, 120))
    .map((source) => cleanText(source.id, 120)));
}

function sourceGroupIsPublished(ids, published, requireNonEmpty) {
  const values = asArray(ids).filter((id) => cleanText(id, 120));
  if (requireNonEmpty && !values.length) return false;
  return values.every((id) => published.has(cleanText(id, 120)));
}

function ingredientCurrentSourcesReady(ingredient) {
  if (!ingredient || typeof ingredient !== "object") return false;
  const published = publishedSourceSet(ingredient);
  const regulatory = ingredient.regulatory || {};
  const foodUse = ingredient.foodUse || {};
  return published.size > 0 &&
    sourceGroupIsPublished(regulatory.sourceIds, published, true) &&
    sourceGroupIsPublished(foodUse.sourceIds, published, true) &&
    sourceGroupIsPublished(ingredient.sourceIds, published, false);
}

function ingredientReviewSourcesReady(ingredient) {
  const published = publishedSourceSet(ingredient);
  return ingredientCurrentSourcesReady(ingredient) &&
    sourceGroupIsPublished(ingredient && ingredient.safety && ingredient.safety.sourceIds, published, true);
}

function ingredientProfessionalReviewReady(ingredient, expectedContentVersion) {
  const audit = ingredient && ingredient.audit || {};
  const reviewContentVersion = expectedContentVersion || ingredient && ingredient.contentVersion || catalogData.contentVersion;
  const reviewedAt = Date.parse(audit.reviewedAt || "");
  const now = Date.now();
  if (audit.professionalReviewState !== "reviewed" || !Number.isFinite(reviewedAt) || reviewedAt > now ||
      !/^sha256:[a-f0-9]{64}$/.test(audit.ingredientDigest || "")) return false;
  const completed = asArray(audit.reviews).filter((review) => {
    const reviewDate = Date.parse(review && review.reviewedAt || "");
    return review && review.state === "reviewed" && review.reviewId && Number.isFinite(reviewDate) &&
      reviewDate <= reviewedAt && reviewDate <= now && review.contentVersion === reviewContentVersion &&
      review.rulesVersion === ruleSet.contentVersion && review.ingredientDigest === audit.ingredientDigest;
  });
  const roleReviews = REQUIRED_INGREDIENT_REVIEW_ROLES.map((role) => completed.find((review) => review.role === role));
  return roleReviews.every(Boolean) &&
    new Set(roleReviews.filter(Boolean).map((review) => review.reviewId)).size === REQUIRED_INGREDIENT_REVIEW_ROLES.length &&
    REQUIRED_INGREDIENT_REVIEW_ROLES.every((role) => asArray(audit.reviewedBy).includes(role));
}

function populationRuleState(ingredient, field) {
  const safety = ingredient && ingredient.safety || {};
  const audit = ingredient && ingredient.audit || {};
  const state = safetyRuleState(safety[field]);
  if (state === TRI_STATE.UNKNOWN) return state;
  const published = publishedSourceSet(ingredient);
  if (audit.sourceCheckState !== "checked" || !sourceGroupIsPublished(safety.sourceIds, published, true)) {
    return TRI_STATE.UNKNOWN;
  }
  if (state === TRI_STATE.YES && !ingredientProfessionalReviewReady(ingredient)) return TRI_STATE.UNKNOWN;
  return state;
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function missingProfileDimensions(profile) {
  const missing = [];
  if (profile.ageGroup === "unknown") missing.push("年龄阶段");
  if (profile.pregnancy === TRI_STATE.UNKNOWN) missing.push("孕期状态");
  if (profile.breastfeeding === TRI_STATE.UNKNOWN) missing.push("哺乳期状态");
  if (profile.allergyStatus === TRI_STATE.UNKNOWN) missing.push("过敏情况");
  if (profile.conditionStatus === TRI_STATE.UNKNOWN) missing.push("基础疾病情况");
  if (profile.medicationStatus === TRI_STATE.UNKNOWN) missing.push("用药情况");
  return missing;
}

function evaluateIngredient(ingredient, inputProfile) {
  const profile = normalizeProfile(inputProfile);
  const reasons = [];
  const warnings = [];
  const reasonCodes = [];
  const warningCodes = [];

  function block(code, message) {
    pushUnique(reasonCodes, code);
    pushUnique(reasons, message);
  }

  function warn(code, message) {
    pushUnique(warningCodes, code);
    pushUnique(warnings, message);
  }

  if (!ingredient || typeof ingredient !== "object") {
    block("invalid_record", "条目数据无效，已停止展示。请返回目录重新选择。");
    return {
      ingredientId: "",
      blocked: true,
      status: "blocked",
      reasons,
      warnings,
      reasonCodes,
      warningCodes,
      profile
    };
  }

  const ingredientId = cleanText(ingredient.id, 80);
  const name = cleanText(ingredient.name, 80) || "该条目";
  const regulatory = ingredient.regulatory || {};
  const safety = ingredient.safety || {};
  const foodUse = ingredient.foodUse || {};
  const audit = ingredient.audit || {};
  const pregnancyState = populationRuleState(ingredient, "pregnancy");
  const breastfeedingState = populationRuleState(ingredient, "breastfeeding");
  const infantToddlerState = populationRuleState(ingredient, "infantsToddlers");
  const childrenState = populationRuleState(ingredient, "children");
  const olderAdultState = populationRuleState(ingredient, "olderAdults");

  if (profile.redFlags.length) {
    block("red_flag", "当前填写内容含需优先处理的紧急情况，本工具停止食材筛选；请及时联系急救或就近就医。");
  }

  if (!["listed", "ordinary_food"].includes(regulatory.status)) {
    block("regulatory_unavailable", `${name} 的食品法规状态尚未确认，暂不进入可浏览结果。`);
  }

  if (!ingredientCurrentSourcesReady(ingredient) || audit.sourceCheckState !== "checked") {
    block("source_unverified", `${name} 缺少已核对的来源，暂不进入可浏览结果。`);
  }

  const allergyMatches = findMatches(profile.allergies, safety.allergenKeys);
  if (allergyMatches.length) {
    block("allergy_match", `已填写的过敏信息与 ${name} 匹配，请不要依赖本工具继续选择该条目。`);
  }

  const avoidedConditions = findMatches(profile.conditions, safety.avoidConditions);
  if (avoidedConditions.length) {
    block("condition_match", `${name} 命中已记录的禁用情况：${avoidedConditions.join("、")}。`);
  }

  const allergyProneMatches = profile.allergyStatus === TRI_STATE.YES
    ? findMatches(["过敏体质"], safety.avoidConditions)
    : [];
  if (allergyProneMatches.length) {
    block("allergy_prone_not_suitable", `${name} 的官方资料标记为过敏体质人群不推荐食用。`);
  }

  const cautionConditions = findMatches(profile.conditions, safety.cautionConditions);
  if (cautionConditions.length) {
    warn("condition_caution", `${name} 命中需专业确认的情况：${cautionConditions.join("、")}。`);
  }

  const interactionMatches = findMatches(profile.medications, safety.drugInteractions);
  if (interactionMatches.length) {
    block("interaction_match", `${name} 命中已记录的用药相互作用规则，请先咨询医生或药师。`);
  }

  if (profile.pregnancy === TRI_STATE.YES) {
    if (pregnancyState === TRI_STATE.NO) {
      block("pregnancy_not_suitable", `${name} 的官方来源资料标记为孕期不推荐食用。`);
    } else if (pregnancyState !== TRI_STATE.YES) {
      warn("pregnancy_unknown", `${name} 的孕期适用性尚未确认，请先咨询医生或药师。`);
    }
  }

  if (profile.breastfeeding === TRI_STATE.YES) {
    if (breastfeedingState === TRI_STATE.NO) {
      block("breastfeeding_not_suitable", `${name} 的官方来源资料标记为哺乳期不推荐食用。`);
    } else if (breastfeedingState !== TRI_STATE.YES) {
      warn("breastfeeding_unknown", `${name} 的哺乳期适用性尚未确认，请先咨询医生或药师。`);
    }
  }

  if (profile.ageGroup === "infant_toddler") {
    if (infantToddlerState === TRI_STATE.NO) {
      block("infants_toddlers_not_suitable", `${name} 的官方资料标记为婴幼儿不推荐食用。`);
    } else if (infantToddlerState !== TRI_STATE.YES) {
      warn("infants_toddlers_unknown", `${name} 的婴幼儿适用性尚未确认，请由监护人先咨询专业人员。`);
    }
  }

  if (profile.ageGroup === "child") {
    if (childrenState === TRI_STATE.NO) {
      block("children_not_suitable", `${name} 的来源资料标记为儿童或青少年不推荐食用。`);
    } else if (childrenState !== TRI_STATE.YES) {
      warn("children_unknown", `${name} 的儿童或青少年适用性尚未确认，请由监护人先咨询专业人员。`);
    }
  }

  if (profile.ageGroup === "older_adult") {
    if (olderAdultState === TRI_STATE.NO) {
      block("older_adult_not_suitable", `${name} 的来源资料标记为老年人不推荐食用。`);
    } else if (olderAdultState !== TRI_STATE.YES) {
      warn("older_adult_unknown", `${name} 的老年人个体安全信息不完整，尤其在合并慢病或多种用药时应先咨询专业人员。`);
    }
  }

  if (profile.conditions.length && safety.conditionReviewState !== "reviewed") {
    warn("condition_data_pending", `${name} 的基础疾病禁忌资料尚未完成专业审校。`);
  }

  if ((profile.medicationStatus === TRI_STATE.YES || profile.medications.length) && safety.interactionReviewState !== "reviewed") {
    warn("interaction_data_pending", `${name} 的药物相互作用资料尚未完成专业审校。`);
  }

  if (profile.allergies.length && safety.allergenReviewState !== "reviewed") {
    warn("allergen_data_limited", `${name} 目前只支持按条目名称匹配过敏信息，交叉过敏资料尚未审校。`);
  }
  if (profile.allergyStatus === TRI_STATE.YES && !profile.allergies.length) {
    warn("allergy_details_required", "已确认有过敏史，但尚未填写具体过敏物，当前无法完成名称匹配。 ");
  }
  if (profile.conditionStatus === TRI_STATE.YES && !profile.conditions.length) {
    warn("condition_details_required", "已确认有基础疾病或特殊情况，但尚未填写具体信息。 ");
  }
  if (profile.medicationStatus === TRI_STATE.YES && !profile.medications.length) {
    warn("medication_details_required", "已确认正在使用药品或其他相关材料，但尚未填写具体名称。 ");
  }

  if (asArray(safety.preparationWarnings).length) {
    warn("preparation_warning", `${name} 含来源记录的加工或食用注意事项，请在详情中逐项核对。`);
  }

  if (safety.preparationReviewState !== "reviewed") {
    warn("preparation_data_pending", `${name} 的加工与食用注意事项尚未完成专业审校。`);
  }

  if (foodUse.mappingReviewState !== "reviewed") {
    warn("food_use_mapping_pending", `${name} 的受控食用形态标签尚未完成逐项来源映射复核。`);
  }

  if (regulatory.currentCatalogReviewState !== "reviewed") {
    warn("catalog_refresh_pending", `${name} 的现行目录、可食部位和用途限制仍需发布前复核。`);
  }

  if (audit.professionalReviewState !== "reviewed") {
    warn("professional_review_pending", `${name} 尚未完成中医师与药师逐字段审校，仅可用于目录浏览。`);
  }

  const missingDimensions = missingProfileDimensions(profile);
  if (missingDimensions.length) {
    warn("profile_incomplete", `仍有个人安全信息未确认（${missingDimensions.join("、")}），当前结果不能判断个体适用性。`);
  }

  const blocked = reasons.length > 0;
  return {
    ingredientId,
    blocked,
    eligible: !blocked,
    status: blocked ? "blocked" : (warnings.length ? "caution" : "eligible"),
    reasons,
    warnings,
    reasonCodes,
    warningCodes,
    profile
  };
}

function evaluateCatalog(catalog, profile) {
  return asArray(catalog).map((ingredient) => evaluateIngredient(ingredient, profile));
}

module.exports = {
  rulesVersion: ruleSet.contentVersion,
  TRI_STATE,
  normalizeProfile,
  safetyRuleState,
  populationRuleState,
  evaluateIngredient,
  evaluateCatalog,
  ingredientCurrentSourcesReady,
  ingredientReviewSourcesReady,
  ingredientProfessionalReviewReady
};
