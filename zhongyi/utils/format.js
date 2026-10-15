"use strict";

const safetyEngine = require("./safety");

const TRI_STATE_TEXT = {
  yes: "来源明确：适用",
  no: "来源明确：不推荐",
  unknown: "待确认"
};

const USAGE_TEXT = {
  traditional_food: "传统食品形态",
  drink: "饮品",
  porridge: "粥饭",
  soup: "汤羹",
  staple: "主食",
  seasoning: "调味",
  fruit: "果食",
  dessert: "甜品",
  baking: "烘焙",
  steaming: "蒸制增香"
};

const GOAL_TEXT = {
  traditional_food_form: "传统食品形态",
  daily_drink: "日常饮水搭配",
  breakfast_pairing: "早餐搭配",
  porridge_pairing: "粥饭搭配",
  soup_pairing: "汤羹搭配",
  seasoning: "调味增香",
  fruit_snack: "水果零食",
  dessert: "甜品搭配",
  baking: "烘焙点心"
};

const TASTE_TEXT = {
  mild: "清淡",
  sweet: "清甜",
  tart: "酸味",
  pungent: "辛香",
  grain: "谷香",
  nutty: "坚果香",
  floral: "花草香",
  citrus: "柑橘香",
  fresh: "清新",
  herbal: "植物清香",
  bitter: "微苦"
};

function arrayText(value, fallback, separator) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return Array.isArray(value) && value.length
    ? value.filter((item) => item != null && String(item).trim()).join(separator || "、")
    : (fallback == null ? "待确认" : fallback);
}

function mappedArrayText(value, dictionary, fallback) {
  return arrayText((Array.isArray(value) ? value : []).map((item) => dictionary[item] || item), fallback);
}

function triStateText(value) {
  return TRI_STATE_TEXT[value] || TRI_STATE_TEXT.unknown;
}

function regulatoryText(ingredient) {
  const regulatory = ingredient && ingredient.regulatory || {};
  if (regulatory.status === "listed") return "名称有官方目录来源";
  if (regulatory.status === "ordinary_food") return "普通食品资料";
  if (regulatory.status === "restricted") return "存在用途限制";
  return "法规状态待确认";
}

function auditText(ingredient) {
  const audit = ingredient && ingredient.audit || {};
  if (audit.professionalReviewState === "reviewed") return "专业审校完成";
  if (audit.sourceCheckState === "checked") return "来源已核对，专业审校待完成";
  return "来源待核对";
}

function evaluationText(evaluation) {
  if (!evaluation) return { label: "尚未评估", tone: "unknown" };
  if (evaluation.blocked) return { label: "已停止筛选", tone: "blocked" };
  if (evaluation.warnings && evaluation.warnings.length) return { label: "需先确认", tone: "caution" };
  return { label: "未命中已知阻止项", tone: "eligible" };
}

function listHas(list, id) {
  return Array.isArray(list) && list.includes(id);
}

function compactWarnings(value) {
  const warnings = Array.isArray(value) ? value.filter(Boolean) : [];
  if (warnings.length <= 2) return arrayText(warnings, "");
  return `${warnings.slice(0, 2).join("；")}；另有 ${warnings.length - 2} 项待确认，请查看详情。`;
}

function cardView(ingredient, favoriteIds, compareIds, evaluation) {
  const source = ingredient || {};
  const status = evaluationText(evaluation);
  return Object.assign({}, source, {
    aliasText: arrayText(source.aliases, "暂无别名"),
    goalText: mappedArrayText(source.goals, GOAL_TEXT, "暂无使用场景"),
    usageText: mappedArrayText(source.usageTypes, USAGE_TEXT, "使用形态待确认"),
    tasteText: mappedArrayText(source.sensory && source.sensory.tastes, TASTE_TEXT, "感官标签待确认"),
    regulatoryText: regulatoryText(source),
    auditText: auditText(source),
    safetyLabel: status.label,
    safetyTone: status.tone,
    warningText: compactWarnings(evaluation && evaluation.warnings),
    reasonText: arrayText(evaluation && evaluation.reasons, ""),
    isFavorite: listHas(favoriteIds, source.id),
    inCompare: listHas(compareIds, source.id)
  });
}

function detailView(ingredient, favoriteIds, compareIds, evaluation) {
  const source = ingredient || {};
  const base = cardView(source, favoriteIds, compareIds, evaluation);
  const identity = source.identity || {};
  const regulatory = source.regulatory || {};
  const traditional = source.traditional || {};
  const safety = source.safety || {};
  return Object.assign({}, base, {
    warningText: arrayText(evaluation && evaluation.warnings, ""),
    reasonText: arrayText(evaluation && evaluation.reasons, ""),
    identityRows: [
      { label: "基原植物或物种", value: arrayText(identity.plantNames, "待专业复核") },
      { label: "拉丁学名", value: identity.latinName || "待专业复核" },
      { label: "科属", value: identity.family || "待专业复核" },
      { label: "可食部位", value: identity.ediblePart || "待专业复核" }
    ],
    regulatoryRows: [
      { label: "目录状态", value: regulatoryText(source) },
      { label: "用途边界", value: regulatory.restriction || "待确认" },
      { label: "现行目录复核", value: regulatory.currentCatalogReviewState === "reviewed" ? "已完成" : "待完成" }
    ],
    traditionalRows: [
      { label: "专业审校", value: traditional.reviewState === "reviewed" ? "已完成" : "待完成" },
      { label: "传统资料", value: traditional.summary || "审校前暂不展示" }
    ],
    safetyRows: [
      { label: "孕期", value: triStateText(safetyEngine.populationRuleState(source, "pregnancy")) },
      { label: "哺乳期", value: triStateText(safetyEngine.populationRuleState(source, "breastfeeding")) },
      { label: "婴幼儿", value: triStateText(safetyEngine.populationRuleState(source, "infantsToddlers")) },
      { label: "儿童或青少年", value: triStateText(safetyEngine.populationRuleState(source, "children")) },
      { label: "老年人", value: triStateText(safetyEngine.populationRuleState(source, "olderAdults")) },
      { label: "基础疾病资料", value: safety.conditionReviewState === "reviewed" ? "已审校" : "待审校" },
      { label: "药物相互作用资料", value: safety.interactionReviewState === "reviewed" ? "已审校" : "待审校" }
    ],
    sourceRows: (source.sources || []).map((item) => ({
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      checkedAt: item.checkedAt || "待确认",
      scope: item.scope || ""
    })),
    boundaryNotice: "本页用于单项食品资料浏览，不用于疾病判断或个体化治疗。"
  });
}

module.exports = {
  TRI_STATE_TEXT,
  USAGE_TEXT,
  GOAL_TEXT,
  TASTE_TEXT,
  arrayText,
  triStateText,
  regulatoryText,
  auditText,
  cardView,
  detailView
};
