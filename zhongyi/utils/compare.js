"use strict";

const {
  arrayText,
  triStateText,
  regulatoryText,
  auditText,
  USAGE_TEXT,
  GOAL_TEXT,
  TASTE_TEXT
} = require("./format");
const safetyEngine = require("./safety");
const { PART_LABEL, foodIdentityDisplay } = require("./food-display");

const COMPARE_NOTICE = "对照仅展示各条目的单项资料，不表示这些食材可以同时食用。";

function mapText(values, dictionary, fallback) {
  return arrayText((Array.isArray(values) ? values : []).map((value) => dictionary[value] || value), fallback);
}

function evaluationFor(evaluations, ingredient) {
  if (Array.isArray(evaluations)) {
    return evaluations.find((item) => item && item.ingredientId === ingredient.id) || null;
  }
  if (evaluations && typeof evaluations === "object") {
    const value = evaluations[ingredient.id];
    return value && value.ingredientId === ingredient.id ? value : null;
  }
  return null;
}

const GROUPS = [
  {
    title: "身份与合规",
    rows: [
      ["名称", (item) => item.name || "待确认"],
      ["别名", (item) => arrayText(item.aliases, "暂无别名")],
      ["类别", (item) => item.category === "food_medicine" ? "食药物质" : "普通食品"],
      ["基原植物或物种", (item) => arrayText(item.identity && item.identity.plantNames, "待确认")],
      [PART_LABEL, (item) => foodIdentityDisplay(item).partText],
      ["部位资料复核", (item) => foodIdentityDisplay(item).partReviewText],
      ["目录状态", regulatoryText],
      ["用途边界", (item) => item.regulatory && item.regulatory.restriction || "待确认"]
    ]
  },
  {
    title: "食品使用信息",
    rows: [
      ["常见形态", (item) => mapText(item.usageTypes, USAGE_TEXT, "待确认")],
      ["食用形态复核", (item) => item.foodUse && item.foodUse.mappingReviewState === "reviewed" ? "食用形态映射已复核" : "食用形态映射待逐项复核"],
      ["加工资料说明", (item) => arrayText(item.foodUse && item.foodUse.note, "待确认；不提供自行加工或用量建议")],
      ["加工注意事项", (item) => arrayText(item.safety && item.safety.preparationWarnings, "当前资料未收录；不代表已确认没有风险", "；")],
      ["浏览场景", (item) => mapText(item.goals, GOAL_TEXT, "待确认")],
      ["感官标签", (item) => mapText(item.sensory && item.sensory.tastes, TASTE_TEXT, "待确认")],
      ["内容标签", (item) => arrayText(item.tags)]
    ]
  },
  {
    title: "个体安全资料",
    rows: [
      ["本次筛选状态", (item, evaluation) => {
        if (!evaluation) return "尚未评估";
        if (evaluation.blocked) return "已停止筛选";
        return evaluation.warnings && evaluation.warnings.length ? "需先确认" : "未命中已知阻止项";
      }],
      ["孕期", (item) => triStateText(safetyEngine.populationRuleState(item, "pregnancy"))],
      ["哺乳期", (item) => triStateText(safetyEngine.populationRuleState(item, "breastfeeding"))],
      ["婴幼儿", (item) => triStateText(safetyEngine.populationRuleState(item, "infantsToddlers"))],
      ["儿童或青少年", (item) => triStateText(safetyEngine.populationRuleState(item, "children"))],
      ["老年人", (item) => triStateText(safetyEngine.populationRuleState(item, "olderAdults"))],
      ["过敏匹配范围", (item) => arrayText(item.safety && item.safety.allergenKeys, "待审校")],
      ["基础疾病资料", (item) => item.safety && item.safety.conditionReviewState === "reviewed" ? "已审校" : "待审校"],
      ["相互作用资料", (item) => item.safety && item.safety.interactionReviewState === "reviewed" ? "已审校" : "待审校"]
    ]
  },
  {
    title: "来源与审校",
    rows: [
      ["来源", (item) => arrayText((item.sources || []).map((source) => source.title))],
      ["来源核对", (item) => item.audit && item.audit.sourceCheckState === "checked" ? "已核对" : "待核对"],
      ["条目来源核对日期", (item) => item.audit && item.audit.sourceCheckedAt || "待确认"],
      ["专业审校", auditText],
      ["资料说明", (item) => item.audit && item.audit.note || "待确认"]
    ]
  }
];

function buildCompareGroups(ingredients, differencesOnly, evaluations) {
  const items = Array.isArray(ingredients) ? ingredients.slice(0, 4) : [];
  return GROUPS.map((group) => ({
    title: group.title,
    rows: group.rows.map(([label, getter]) => {
      const values = items.map((item) => {
        const value = getter(item, evaluationFor(evaluations, item));
        return String(value == null || value === "" ? "待确认" : value);
      });
      return {
        label,
        values,
        cells: values.map((text, index) => ({ key: `${label}-${index}`, ingredientId: items[index].id, nameCn: items[index].name || "待确认", text })),
        different: new Set(values).size > 1
      };
    }).filter((row) => !differencesOnly || row.different)
  })).filter((group) => group.rows.length);
}

module.exports = {
  COMPARE_NOTICE,
  GROUPS,
  buildCompareGroups
};
