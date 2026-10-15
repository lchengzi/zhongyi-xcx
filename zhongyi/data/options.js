"use strict";

const GOAL_OPTIONS = [
  { value: "traditional_food_form", label: "公告所述传统食品形态", description: "仅按官方公告或解读提到的食品形态浏览，不对应疾病或证候。" },
  { value: "daily_drink", label: "日常饮水搭配", description: "按常见饮品形态浏览，不对应疾病或证候。" },
  { value: "breakfast_pairing", label: "早餐搭配", description: "浏览可用于早餐主食的目录条目。" },
  { value: "porridge_pairing", label: "粥饭搭配", description: "浏览常见粥饭食材形态。" },
  { value: "soup_pairing", label: "汤羹搭配", description: "浏览常见汤羹食材形态。" },
  { value: "seasoning", label: "调味增香", description: "浏览常见调味或增香形态。" },
  { value: "fruit_snack", label: "水果零食", description: "浏览常见果实类食品形态。" },
  { value: "dessert", label: "甜品搭配", description: "浏览常见甜品食材形态。" },
  { value: "baking", label: "烘焙点心", description: "浏览常见烘焙或点心食材形态。" }
];

const CATEGORY_OPTIONS = [
  { value: "food_medicine", label: "食药物质", description: "名称有官方目录来源，具体部位与限制仍需查看条目审校状态。" },
  { value: "ordinary_food", label: "普通食品", description: "后续扩展预留；仍不代表适合所有人。" }
];

const USAGE_TYPE_OPTIONS = [
  { value: "traditional_food", label: "传统食品形态" },
  { value: "drink", label: "饮品" },
  { value: "porridge", label: "粥饭" },
  { value: "soup", label: "汤羹" },
  { value: "staple", label: "主食" },
  { value: "seasoning", label: "调味" },
  { value: "fruit", label: "果食" },
  { value: "dessert", label: "甜品" },
  { value: "baking", label: "烘焙" },
  { value: "steaming", label: "蒸制增香" }
];

const TASTE_OPTIONS = [
  { value: "mild", label: "清淡" },
  { value: "sweet", label: "清甜" },
  { value: "tart", label: "酸味" },
  { value: "pungent", label: "辛香" },
  { value: "grain", label: "谷香" },
  { value: "nutty", label: "坚果香" },
  { value: "floral", label: "花草香" },
  { value: "citrus", label: "柑橘香" },
  { value: "fresh", label: "清新" },
  { value: "herbal", label: "植物清香" },
  { value: "bitter", label: "微苦" }
];

const TRI_STATE_OPTIONS = [
  { value: "unknown", label: "不确定" },
  { value: "yes", label: "是" },
  { value: "no", label: "否" }
];

const AGE_GROUP_OPTIONS = [
  { value: "unknown", label: "未填写" },
  { value: "infant_toddler", label: "婴幼儿" },
  { value: "child", label: "儿童或青少年" },
  { value: "adult", label: "成年人" },
  { value: "older_adult", label: "老年人" }
];

const SAFETY_FILTER_OPTIONS = [
  { value: "onlySourceChecked", label: "仅看来源已核对", description: "只展示完成目录来源核对的种子条目。" }
];

// 这些选项只用于“停止继续筛选并建议及时求助”，不用于诊断。
const RED_FLAG_OPTIONS = [
  { value: "breathing_difficulty", label: "明显呼吸困难" },
  { value: "altered_consciousness", label: "意识异常或昏厥" },
  { value: "sudden_severe_chest_pain", label: "突发剧烈胸痛" },
  { value: "stroke_like_signs", label: "突发口角歪斜、单侧无力或言语异常" },
  { value: "seizure", label: "抽搐或首次癫痫样发作" },
  { value: "suspected_severe_allergy", label: "疑似严重过敏反应" },
  { value: "bleeding_or_black_stool", label: "呕血、便血或黑便" },
  { value: "persistent_vomiting_or_dehydration", label: "持续呕吐或明显脱水" },
  { value: "severe_progressive_abdominal_pain", label: "剧烈或持续加重的腹痛" },
  { value: "pregnancy_emergency_signs", label: "孕期出血、剧烈腹痛或胎动明显异常" },
  { value: "immediate_self_harm_risk", label: "有即时自伤、自杀或人身危险" }
];

const SORT_OPTIONS = [
  { value: "default", label: "默认顺序" },
  { value: "name", label: "名称排序" }
];

module.exports = {
  GOAL_OPTIONS,
  CATEGORY_OPTIONS,
  USAGE_TYPE_OPTIONS,
  TASTE_OPTIONS,
  TRI_STATE_OPTIONS,
  AGE_GROUP_OPTIONS,
  SAFETY_FILTER_OPTIONS,
  RED_FLAG_OPTIONS,
  SORT_OPTIONS
};
