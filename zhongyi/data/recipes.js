"use strict";

// P3 首批只展示不依赖自动辨证、且能与现行食药物质目录边界对齐的官方完整方案。
// 原始材料、用量和制作方法作为一个不可拆分的数据单元保存，禁止自动换算、替换或自由拼配。

const schemaVersion = "1.1.0";
const contentVersion = "2026.08-official-recipe.8";
const externalFoodSchemaVersion = "1.0.0";
const externalFoodContentVersion = "2026.08-external-food.1";
const publishedAt = "2026-08-13";

const sources = [
  {
    id: "nhc-food-guides-notice-2023",
    status: "published",
    type: "official_notice",
    title: "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
    publisher: "中华人民共和国国家卫生健康委员会",
    documentNo: "国卫办食品函〔2023〕5号",
    url: "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
    publishedAt: "2023-01-18",
    checkedAt: "2026-08-10",
    scope: "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
  },
  {
    id: "nhc-adult-diabetes-guide-2023",
    status: "published",
    type: "official_guide",
    title: "成人糖尿病食养指南（2023年版）",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/wjw/c100378/202301/7faed9993c9b45aea158c5335346f282/files/1732844468278_20318.pdf",
    publishedAt: "2023-01-18",
    checkedAt: "2026-08-10",
    scope: "支持附录4第59页的成人糖尿病完整食养方原始材料、制作方法和食用方式。"
  },
  {
    id: "nhc-announcement-2019-8",
    status: "published",
    type: "official_announcement",
    title: "关于当归等6种新增按照传统既是食品又是中药材的物质公告（2019年第8号）",
    publisher: "国家卫生健康委、国家市场监督管理总局",
    url: "https://www.nhc.gov.cn/wjw/c100175/202001/60977058ce3b4449b1b1d46cff283e73.shtml",
    publishedAt: "2019-11-25",
    checkedAt: "2026-08-10",
    scope: "支持当归的植物身份、部位，以及仅作为香辛料和调味品使用的现行用途限制。"
  },
  {
    id: "nhc-adult-hyperlipidemia-guide-2023",
    status: "published",
    type: "official_guide",
    title: "成人高脂血症食养指南（2023年版）",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d/files/1732844468018_41219.pdf",
    publishedAt: "2023-01-18",
    checkedAt: "2026-08-10",
    scope: "支持高脂血症候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
  },
  {
    id: "nhc-adult-hypertension-guide-2023",
    status: "published",
    type: "official_guide",
    title: "成人高血压食养指南（2023年版）",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/cms-search/downFiles/63f752a17cfd4b4781f744477561866f.pdf",
    publishedAt: "2023-01-18",
    checkedAt: "2026-08-10",
    scope: "支持高血压候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
  },
  {
    id: "nhc-announcement-2023-9",
    status: "published",
    type: "official_announcement",
    title: "关于党参等9种新增按照传统既是食品又是中药材的物质公告（2023年第9号）",
    publisher: "国家卫生健康委、国家市场监督管理总局",
    url: "https://www.nhc.gov.cn/wjw/c100175/202311/59e03b384f9a4d0b9623e19b813f6cc4.shtml",
    publishedAt: "2023-11-09",
    checkedAt: "2026-08-10",
    scope: "支持黄芪在指南发布后的现行食药物质目录事件；不改写指南中的历史备注。"
  },
  {
    id: "nhc-interpretation-2023-9",
    status: "published",
    type: "official_interpretation",
    title: "解读《关于党参等9种新增按照传统既是食品又是中药材的物质公告》",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
    publishedAt: "2023-11-17",
    checkedAt: "2026-08-10",
    scope: "支持黄芪的食品形态说明及特殊人群不推荐食用信息。"
  }
];

const stagedPatternRecipes = [
  {
    id: "angelica-huangqi-chicken-soup",
    revision: "1.0.0-draft.1",
    name: "归芪鸡汤",
    status: "draft",
    contentVersion,
    rulesVersion: "1.6.0",
    targetId: "adult_hyperlipidemia",
    publicVisibility: "withheld",
    formulaSourceId: "nhc-adult-hyperlipidemia-guide-2023",
    safetySourceIds: ["nhc-adult-hyperlipidemia-guide-2023", "nhc-announcement-2023-9", "nhc-interpretation-2023-9"],
    sources: sources.filter((source) => [
      "nhc-food-guides-notice-2023",
      "nhc-adult-hyperlipidemia-guide-2023",
      "nhc-announcement-2019-8",
      "nhc-announcement-2023-9",
      "nhc-interpretation-2023-9"
    ].includes(source.id)),
    sourceLocator: {
      documentNo: "国卫办食品函〔2023〕5号",
      page: "第37–38页（PDF物理页第39–40页）",
      section: "附录4 不同证型食养方举例 · 四、气虚血瘀型 · （二）食养方",
      recipeTitle: "3.归芪鸡汤"
    },
    sourceContext: {
      text: "成人高脂血症气虚血瘀型官方食养方资料",
      diagnosticUse: "forbidden",
      targetAgeGroups: ["adult"]
    },
    guideContext: {
      title: "成人高脂血症食养指南（2023年版）",
      edition: "2023年版",
      section: "附录4 · 气虚血瘀型 · 食养方",
      page: "第37–38页（PDF物理页第39–40页）",
      originalTarget: "面向成人高脂血症人群；本条仅对应指南中的气虚血瘀型资料，有合并症者需在专业人员指导下参考。"
    },
    audience: {
      adultOnly: true,
      diagnosisConfirmationRequired: true,
      patternRequired: true,
      patternConfirmationPolicy: "professional_confirmation_required",
      allowedPatterns: ["气虚血瘀型"],
      allowedTargetConditions: ["成人高脂血症", "高脂血症"]
    },
    bundle: {
      atomic: true,
      omissionPolicy: "forbidden",
      substitutionPolicy: "forbidden",
      scalingPolicy: "forbidden",
      orderLocked: true,
      servingText: "佐餐食用；1人1次量。",
      frequencyText: "",
      courseText: "可食用7～10天。",
      ingredients: [
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-angelica", ingredientId: "dang-gui", sourceName: "当归", sourcePartText: "根",
          processingText: "清洗后装入纱布袋", identityReviewState: "source_checked",
          identitySourceIds: ["nhc-announcement-2019-8"], useRole: "main_ingredient", allergenKeys: ["当归"],
          quantity: { kind: "exact", rawText: "10g", value: "10", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-huangqi", ingredientId: "huang-qi", sourceName: "黄芪", sourcePartText: "根",
          processingText: "清洗后装入纱布袋", identityReviewState: "source_checked",
          identitySourceIds: ["nhc-announcement-2023-9"], useRole: "main_ingredient", allergenKeys: ["黄芪"],
          quantity: { kind: "exact", rawText: "6g", value: "6", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-ginger", ingredientId: "jiang", sourceName: "生姜", sourcePartText: "来源未细分部位",
          processingText: "与鸡肉及纱布袋同入砂锅", useRole: "food_ingredient", allergenKeys: ["生姜"],
          quantity: { kind: "exact", rawText: "2片", value: "2", unit: "piece" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-chicken", sourceName: "鸡肉", sourcePartText: "来源未细分部位",
          processingText: "洗净、煮去血沫并沥干", useRole: "main_ingredient", allergenKeys: ["鸡肉"],
          quantity: { kind: "exact", rawText: "50g", value: "50", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-water", sourceName: "水", sourcePartText: "不适用",
          processingText: "煮鸡块及砂锅烹煮时使用", useRole: "supporting_ingredient", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-salt", sourceName: "食盐", sourcePartText: "不适用",
          processingText: "出锅前略微调味", useRole: "seasoning", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "略微加盐", unit: "source_text" }
        })
      ],
      steps: [
        { stepId: "step-1", order: 1, text: "鸡块洗净，用水煮去血沫，沥干备用。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-2", order: 2, text: "将黄芪、当归清洗后放入纱布袋中。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-3", order: 3, text: "与鸡肉、生姜一起放入砂锅中，加水适量，煮1小时。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-4", order: 4, text: "略微加盐调味即可。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] }
      ],
      sourceTextDigest: "pending",
      bundleDigest: "pending"
    },
    historicNotes: [
      "原指南注明：黄芪，非试点地区限执业医师使用。该句按2023年1月发布时的历史语境保留。",
      "原指南允许黄芪用山药10g或人参（人工种植≤5年）3g代替；系统只保存原文备注，不执行替换。"
    ],
    currentContext: [
      "2023年第9号公告后，黄芪新增纳入食药物质目录；仍须遵守现行公告、特殊人群边界和专业审校。",
      "当归现行食药物质目录记录为仅作香辛料和调味品；整方用途冲突未完成合规复核前不得发布。"
    ],
    safety: {
      sourceIds: ["nhc-adult-hyperlipidemia-guide-2023", "nhc-interpretation-2023-9"],
      redFlagPolicy: "global_stop",
      pregnancy: "no", breastfeeding: "no", infantsToddlers: "no", children: "unknown", olderAdults: "unknown",
      populationSourceIds: ["nhc-interpretation-2023-9"],
      allergenKeys: ["当归", "黄芪", "生姜", "鸡肉"], allergenKeyBasis: "ingredient_name_only",
      avoidConditions: [], cautionConditions: ["气火亢盛所致面赤眼干等症状"],
      drugInteractions: [], medicationCautions: [], preparationBlocks: [], preparationWarnings: [],
      allergenReviewState: "partial", allergenSourceIds: ["nhc-adult-hyperlipidemia-guide-2023"],
      conditionReviewState: "partial", conditionSourceIds: ["nhc-adult-hyperlipidemia-guide-2023"],
      interactionReviewState: "pending", interactionSourceIds: [],
      preparationReviewState: "partial", preparationSourceIds: ["nhc-adult-hyperlipidemia-guide-2023"]
    },
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-hyperlipidemia-guide-2023", "nhc-announcement-2019-8", "nhc-announcement-2023-9", "nhc-interpretation-2023-9"],
    audit: draftAudit("官方证型限定完整方案已按原始材料、用量、制作方法和慎用备注录入；尚待专业证型确认流程及整方签审。")
  },
  {
    id: "goji-sesame-vegetable-cake",
    revision: "1.0.0-draft.1",
    name: "枸杞芝麻蔬菜饼",
    status: "draft",
    contentVersion,
    rulesVersion: "1.6.0",
    targetId: "adult_hyperlipidemia",
    publicVisibility: "withheld",
    formulaSourceId: "nhc-adult-hyperlipidemia-guide-2023",
    safetySourceIds: ["nhc-adult-hyperlipidemia-guide-2023"],
    sources: sources.filter((source) => [
      "nhc-food-guides-notice-2023",
      "nhc-adult-hyperlipidemia-guide-2023"
    ].includes(source.id)),
    sourceLocator: {
      documentNo: "国卫办食品函〔2023〕5号",
      page: "第38–39页（PDF物理页第40–41页）",
      section: "附录4 不同证型食养方举例 · 五、肝肾阴虚型 · （二）食养方",
      recipeTitle: "1.枸杞芝麻蔬菜饼"
    },
    sourceContext: {
      text: "成人高脂血症肝肾阴虚型官方食养方资料",
      diagnosticUse: "forbidden",
      targetAgeGroups: ["adult"]
    },
    guideContext: {
      title: "成人高脂血症食养指南（2023年版）",
      edition: "2023年版",
      section: "附录4 · 肝肾阴虚型 · 食养方",
      page: "第38–39页（PDF物理页第40–41页）",
      originalTarget: "面向成人高脂血症人群；本条仅对应指南中的肝肾阴虚型资料，有合并症者需在专业人员指导下参考。"
    },
    audience: {
      adultOnly: true,
      diagnosisConfirmationRequired: true,
      patternRequired: true,
      patternConfirmationPolicy: "professional_confirmation_required",
      allowedPatterns: ["肝肾阴虚型"],
      allowedTargetConditions: ["成人高脂血症", "高脂血症"]
    },
    bundle: {
      atomic: true,
      omissionPolicy: "forbidden",
      substitutionPolicy: "forbidden",
      scalingPolicy: "forbidden",
      orderLocked: true,
      servingText: "代早餐食用或佐餐食用；1人1次量。",
      frequencyText: "",
      courseText: "可食用7～10天。",
      ingredients: [
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-goji", ingredientId: "gou-qi-zi", sourceName: "枸杞子", sourcePartText: "具体身份与部位待复核",
          processingText: "包入面饼后捏成团", useRole: "main_ingredient", allergenKeys: ["枸杞子"],
          quantity: { kind: "exact", rawText: "5g", value: "5", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-black-sesame", ingredientId: "hei-zhi-ma", sourceName: "黑芝麻", sourcePartText: "具体身份与部位待复核",
          processingText: "炒熟后与两种米粉混合", useRole: "main_ingredient", allergenKeys: ["黑芝麻", "芝麻"],
          quantity: { kind: "exact", rawText: "2g", value: "2", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-goji-leaf", sourceName: "枸杞叶", sourcePartText: "叶",
          processingText: "摘洗干净后煮入汤汁", useRole: "main_ingredient", allergenKeys: ["枸杞叶"],
          quantity: { kind: "exact", rawText: "10g", value: "10", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-glutinous-rice-flour", sourceName: "糯米粉", sourcePartText: "不适用",
          processingText: "与粳米粉、黑芝麻及备用汤汁揉成团", useRole: "main_ingredient", allergenKeys: ["糯米"],
          quantity: { kind: "exact", rawText: "50g", value: "50", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-japonica-rice-flour", sourceName: "粳米粉", sourcePartText: "不适用",
          processingText: "与糯米粉、黑芝麻及备用汤汁揉成团", useRole: "main_ingredient", allergenKeys: ["粳米"],
          quantity: { kind: "exact", rawText: "50g", value: "50", unit: "g" }
        }),
        draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId: "line-egg-liquid", sourceName: "鸡蛋液", sourcePartText: "不适用",
          processingText: "搅匀后倒入汤汁", useRole: "main_ingredient", allergenKeys: ["鸡蛋", "蛋液"],
          quantity: { kind: "exact", rawText: "20g", value: "20", unit: "g" }
        }),
        ...[
          ["line-oil", "油", "锅中加热", ["食用油"]],
          ["line-scallion", "葱花", "炝锅", ["葱"]],
          ["line-soy-sauce", "酱油", "与适量水烧开", ["酱油", "大豆"]],
          ["line-water", "水", "与酱油烧开", []],
          ["line-salt", "盐", "汤汁煮沸后调味", []],
          ["line-sesame-oil", "香油", "汤汁煮沸后淋入", ["香油", "芝麻"]]
        ].map(([lineId, sourceName, processingText, allergenKeys]) => draftLine("nhc-adult-hyperlipidemia-guide-2023", {
          lineId, sourceName, sourcePartText: "不适用", processingText, useRole: "supporting_ingredient", allergenKeys,
          quantity: { kind: "qualitative", rawText: "原文未给量", unit: "source_text" }
        }))
      ],
      steps: [
        { stepId: "step-1", order: 1, text: "黑芝麻炒熟备用。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-2", order: 2, text: "鸡蛋打入碗中搅匀；枸杞叶摘洗干净。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-3", order: 3, text: "锅中倒油烧热，下葱花炝锅，倒入酱油和适量水烧开；倒入鸡蛋液，放枸杞叶煮沸，加盐，淋香油制成汤汁备用。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-4", order: 4, text: "糯米粉、粳米粉、黑芝麻加入备用汤汁揉成团，和均匀后揉成长条，分段按成饼。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] },
        { stepId: "step-5", order: 5, text: "包入枸杞子，捏成团，上锅蒸30分钟后出锅。", sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"] }
      ],
      sourceTextDigest: "pending",
      bundleDigest: "pending"
    },
    historicNotes: [
      "原指南允许枸杞叶用其他绿色蔬菜代替；系统只保存该项原文备注，不执行替换，也不扩大到其他材料。",
      "步骤使用的油、葱花、酱油、水、盐和香油未给出定量，系统不得补克数或比例。"
    ],
    currentContext: ["枸杞叶与枸杞子是不同材料；系统不得因名称相近而合并身份、部位或数量。"],
    safety: {
      sourceIds: ["nhc-adult-hyperlipidemia-guide-2023"], redFlagPolicy: "global_stop",
      pregnancy: "unknown", breastfeeding: "unknown", infantsToddlers: "unknown", children: "unknown", olderAdults: "unknown",
      populationSourceIds: [],
      allergenKeys: ["枸杞子", "黑芝麻", "芝麻", "枸杞叶", "糯米", "粳米", "鸡蛋", "酱油", "大豆", "葱"],
      allergenKeyBasis: "ingredient_name_only",
      avoidConditions: [], cautionConditions: ["脾虚厌食", "腹胀消化不良"], drugInteractions: [], medicationCautions: [],
      preparationBlocks: [], preparationWarnings: [],
      allergenReviewState: "partial", allergenSourceIds: ["nhc-adult-hyperlipidemia-guide-2023"],
      conditionReviewState: "partial", conditionSourceIds: ["nhc-adult-hyperlipidemia-guide-2023"],
      interactionReviewState: "pending", interactionSourceIds: [],
      preparationReviewState: "partial", preparationSourceIds: ["nhc-adult-hyperlipidemia-guide-2023"]
    },
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-hyperlipidemia-guide-2023"],
    audit: draftAudit("官方证型限定完整方案已按原始材料、未定量辅料、制作方法、替代备注和慎用信息录入；尚待专业证型确认流程及整方签审。")
  },
  {
    id: "hypertension-liver-fire-appendix-celery-congee",
    revision: "1.0.0-draft.1",
    name: "芹菜粳米瘦肉粥",
    status: "draft",
    contentVersion,
    rulesVersion: "1.6.0",
    targetId: "adult_hypertension",
    publicVisibility: "withheld",
    formulaSourceId: "nhc-adult-hypertension-guide-2023",
    safetySourceIds: ["nhc-adult-hypertension-guide-2023"],
    sources: sources.filter((source) => [
      "nhc-food-guides-notice-2023",
      "nhc-adult-hypertension-guide-2023"
    ].includes(source.id)),
    sourceLocator: {
      documentNo: "国卫办食品函〔2023〕5号",
      page: "第51页（PDF物理页第53页）",
      section: "附录4 不同证型食养方举例 · 一、肝火上炎证",
      recipeTitle: "（一）芹菜粳米瘦肉粥"
    },
    sourceContext: {
      text: "成人高血压肝火上炎证官方食养方资料",
      diagnosticUse: "forbidden",
      targetAgeGroups: ["adult"]
    },
    guideContext: {
      title: "成人高血压食养指南（2023年版）",
      edition: "2023年版",
      section: "附录4 · 肝火上炎证",
      page: "第51页（PDF物理页第53页）",
      originalTarget: "面向成人高血压人群；本条仅对应指南中的肝火上炎证资料，有合并症者需在专业人员指导下参考。"
    },
    audience: {
      adultOnly: true,
      diagnosisConfirmationRequired: true,
      patternRequired: true,
      patternConfirmationPolicy: "professional_confirmation_required",
      allowedPatterns: ["肝火上炎证"],
      allowedTargetConditions: ["成人高血压", "高血压"]
    },
    bundle: {
      atomic: true,
      omissionPolicy: "forbidden",
      substitutionPolicy: "forbidden",
      scalingPolicy: "forbidden",
      orderLocked: true,
      servingText: "佐餐食用。",
      frequencyText: "",
      courseText: "",
      ingredients: [
        draftLine("nhc-adult-hypertension-guide-2023", {
          lineId: "line-celery", sourceName: "芹菜", sourcePartText: "来源未细分部位",
          processingText: "洗净切碎", useRole: "main_ingredient", allergenKeys: ["芹菜"],
          quantity: { kind: "exact", rawText: "50g", value: "50", unit: "g" }
        }),
        draftLine("nhc-adult-hypertension-guide-2023", {
          lineId: "line-japonica-rice", sourceName: "粳米", sourcePartText: "不适用",
          processingText: "与其他材料同煮为粥", useRole: "main_ingredient", allergenKeys: ["粳米"],
          quantity: { kind: "exact", rawText: "50g", value: "50", unit: "g" }
        }),
        draftLine("nhc-adult-hypertension-guide-2023", {
          lineId: "line-goji", ingredientId: "gou-qi-zi", sourceName: "枸杞子", sourcePartText: "具体身份与部位待复核",
          processingText: "与其他材料同煮为粥", useRole: "main_ingredient", allergenKeys: ["枸杞子"],
          quantity: { kind: "exact", rawText: "10g", value: "10", unit: "g" }
        }),
        draftLine("nhc-adult-hypertension-guide-2023", {
          lineId: "line-lean-pork", sourceName: "猪瘦肉", sourcePartText: "瘦肉",
          processingText: "制成肉末后同煮", useRole: "main_ingredient", allergenKeys: ["猪肉"],
          quantity: { kind: "exact", rawText: "20g", value: "20", unit: "g" }
        })
      ],
      steps: [
        {
          stepId: "step-1", order: 1,
          text: "芹菜洗净切碎，与粳米、枸杞子、猪瘦肉末同煮为粥，佐餐食用。",
          sourceIds: ["nhc-adult-hypertension-guide-2023"]
        }
      ],
      sourceTextDigest: "pending",
      bundleDigest: "pending"
    },
    historicNotes: [
      "同一指南第33页（PDF物理页第35页）的华东地区夏季食谱2另有同名早餐菜品，材料为芹菜50g、粳米40g、猪瘦肉20g，不含枸杞子且没有制作方法；两条不得合并。",
      "附录原文未给水量、火候、时长、每人份、每日频次或疗程，系统不得自行补全。"
    ],
    currentContext: ["本记录只绑定附录4肝火上炎证食养方，不继承同名地区套餐的数量、步骤或适用语境。"],
    safety: {
      sourceIds: ["nhc-adult-hypertension-guide-2023"], redFlagPolicy: "global_stop",
      pregnancy: "unknown", breastfeeding: "unknown", infantsToddlers: "unknown", children: "unknown", olderAdults: "unknown",
      populationSourceIds: [],
      allergenKeys: ["芹菜", "粳米", "枸杞子", "猪肉"], allergenKeyBasis: "ingredient_name_only",
      avoidConditions: [], cautionConditions: [], drugInteractions: [], medicationCautions: [],
      preparationBlocks: [], preparationWarnings: [],
      allergenReviewState: "partial", allergenSourceIds: ["nhc-adult-hypertension-guide-2023"],
      conditionReviewState: "pending", conditionSourceIds: [],
      interactionReviewState: "pending", interactionSourceIds: [],
      preparationReviewState: "partial", preparationSourceIds: ["nhc-adult-hypertension-guide-2023"]
    },
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-hypertension-guide-2023"],
    audit: draftAudit("官方证型限定附录食养方已按原始材料、用量和单句制作方法录入，并与同名地区套餐隔离；尚待专业证型确认流程及整方签审。")
  }
];

const targets = [
  {
    id: "adult_diabetes",
    label: "已确诊成人2型糖尿病",
    shortLabel: "成人2型糖尿病",
    availability: "draft_under_review",
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-diabetes-guide-2023"],
    description: "仅供已经正规医疗机构明确诊断为2型糖尿病的成年人查看官方食养资料，不根据症状推断疾病。",
    unavailableReason: "已有2项官方完整方案完成来源录入，但普通食品身份、整方安全和专业签审尚未完成，因此暂不展示材料、用量和做法。"
  },
  {
    id: "adult_hyperlipidemia",
    label: "已确诊成人高脂血症",
    shortLabel: "成人高脂血症",
    availability: "withheld_pattern_required",
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-hyperlipidemia-guide-2023"],
    description: "官方候选方案按不同中医证型编排。",
    unavailableReason: "当前版本不做自动辨证；需由专业人员确认中医证型后，才能选择对应的完整食养方。"
  },
  {
    id: "adult_hypertension",
    label: "已确诊成人高血压",
    shortLabel: "成人高血压",
    availability: "withheld_pattern_required",
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-hypertension-guide-2023"],
    description: "官方候选方案按不同中医证型编排。",
    unavailableReason: "当前版本不做自动辨证；需由专业人员确认中医证型后，才能选择对应的完整食养方。"
  }
];

function occurrence(recipeId, lineId, sourceId) {
  return { recipeId, lineId, sourceId, claimScope: "formula_occurrence_and_quantity_only" };
}

function pendingExternalFood(spec) {
  const occurrenceSourceIds = [...new Set(spec.occurrences.map((item) => item.sourceId))];
  return {
    id: spec.id,
    recordKind: "external_food",
    contentVersion: externalFoodContentVersion,
    name: spec.name,
    aliases: spec.aliases || [],
    category: "ordinary_food_candidate",
    occurrenceFormText: spec.foodForm,
    occurrenceEvidence: spec.occurrences,
    identity: {
      ediblePart: "待身份与具体形态来源复核",
      partReviewState: "pending",
      sourceIds: []
    },
    regulatory: {
      kind: "ordinary_food_candidate",
      status: "pending",
      currentCatalogReviewState: "pending",
      restrictionCode: "",
      restriction: "",
      sourceIds: []
    },
    foodUse: {
      commonForms: [],
      mappingReviewState: "pending",
      sourceIds: []
    },
    safety: {
      sourceIds: [],
      pregnancy: "unknown",
      breastfeeding: "unknown",
      infantsToddlers: "unknown",
      children: "unknown",
      olderAdults: "unknown",
      allergenKeys: [],
      avoidConditions: [],
      cautionConditions: [],
      drugInteractions: [],
      preparationWarnings: [],
      allergenReviewState: "pending",
      conditionReviewState: "pending",
      interactionReviewState: "pending",
      preparationReviewState: "pending"
    },
    sources: sources.filter((source) => occurrenceSourceIds.includes(source.id)),
    audit: {
      occurrenceReviewState: "source_checked",
      sourceCheckState: "pending",
      professionalReviewState: "pending",
      reviewedBy: [],
      reviewedAt: null,
      ingredientDigest: null,
      reviews: [],
      releaseStage: "development_preview",
      note: "官方食养指南仅证明该来源名称在对应整方中出现，不作为普通食品身份、法规、过敏或完整安全依据。"
    }
  };
}

const externalFoods = {
  schemaVersion: externalFoodSchemaVersion,
  contentVersion: externalFoodContentVersion,
  publishedAt,
  items: [
    pendingExternalFood({
      id: "external-food-black-bean", name: "黑豆", foodForm: "原文名称：黑豆；加工：泡发",
      occurrences: [occurrence("black-bean-huangqi-goji-soup", "line-black-bean", "nhc-adult-diabetes-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-salt", name: "食盐（含原文‘盐’）", aliases: ["食盐", "盐"], foodForm: "调味用量按各配方原文记录",
      occurrences: [
        occurrence("black-bean-huangqi-goji-soup", "line-salt", "nhc-adult-diabetes-guide-2023"),
        occurrence("angelica-codonopsis-stewed-hen", "line-salt", "nhc-adult-diabetes-guide-2023"),
        occurrence("angelica-huangqi-chicken-soup", "line-salt", "nhc-adult-hyperlipidemia-guide-2023"),
        occurrence("goji-sesame-vegetable-cake", "line-salt", "nhc-adult-hyperlipidemia-guide-2023")
      ]
    }),
    pendingExternalFood({
      id: "external-food-whole-hen", name: "母鸡", foodForm: "整只，原文要求去内脏并洗净",
      occurrences: [occurrence("angelica-codonopsis-stewed-hen", "line-hen", "nhc-adult-diabetes-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-scallion", name: "葱", foodForm: "原文未细分部位，加入砂锅",
      occurrences: [occurrence("angelica-codonopsis-stewed-hen", "line-scallion", "nhc-adult-diabetes-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-cooking-wine", name: "料酒", foodForm: "原文未给品类或酒精度",
      occurrences: [occurrence("angelica-codonopsis-stewed-hen", "line-cooking-wine", "nhc-adult-diabetes-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-chicken-meat", name: "鸡肉", foodForm: "鸡块，洗净后煮去血沫并沥干",
      occurrences: [occurrence("angelica-huangqi-chicken-soup", "line-chicken", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-water-unspecified", name: "水（来源形态待核）", aliases: ["水", "清水"], foodForm: "配方制作过程用水，来源标准未在指南中说明",
      occurrences: [
        occurrence("black-bean-huangqi-goji-soup", "line-water", "nhc-adult-diabetes-guide-2023"),
        occurrence("angelica-codonopsis-stewed-hen", "line-water", "nhc-adult-diabetes-guide-2023"),
        occurrence("angelica-huangqi-chicken-soup", "line-water", "nhc-adult-hyperlipidemia-guide-2023"),
        occurrence("goji-sesame-vegetable-cake", "line-water", "nhc-adult-hyperlipidemia-guide-2023")
      ]
    }),
    pendingExternalFood({
      id: "external-food-goji-leaf", name: "枸杞叶", foodForm: "摘洗后煮入汤汁；不得与枸杞子合并",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-goji-leaf", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-glutinous-rice-flour", name: "糯米粉", foodForm: "粉状原料",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-glutinous-rice-flour", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-japonica-rice-flour", name: "粳米粉", foodForm: "粉状原料；不得与粳米粒记录合并",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-japonica-rice-flour", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-egg-liquid", name: "鸡蛋液", foodForm: "鸡蛋打入碗中搅匀后的来源形态",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-egg-liquid", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-cooking-oil-unspecified", name: "油（种类未注明）", foodForm: "原文只写‘油’，不得映射为具体油种",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-oil", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-chopped-scallion", name: "葱花", foodForm: "切碎形态；身份与部位待核",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-scallion", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-soy-sauce", name: "酱油", foodForm: "原文未给具体品类或配料",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-soy-sauce", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-sesame-oil", name: "香油", foodForm: "原料和标准身份待核；不得仅凭名称映射到黑芝麻",
      occurrences: [occurrence("goji-sesame-vegetable-cake", "line-sesame-oil", "nhc-adult-hyperlipidemia-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-celery", name: "芹菜", foodForm: "原文未细分部位，洗净切碎",
      occurrences: [occurrence("hypertension-liver-fire-appendix-celery-congee", "line-celery", "nhc-adult-hypertension-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-japonica-rice", name: "粳米", foodForm: "米粒形态；不得与粳米粉记录合并",
      occurrences: [occurrence("hypertension-liver-fire-appendix-celery-congee", "line-japonica-rice", "nhc-adult-hypertension-guide-2023")]
    }),
    pendingExternalFood({
      id: "external-food-lean-pork", name: "猪瘦肉", foodForm: "瘦肉制成肉末后同煮",
      occurrences: [occurrence("hypertension-liver-fire-appendix-celery-congee", "line-lean-pork", "nhc-adult-hypertension-guide-2023")]
    })
  ]
};
externalFoods.count = externalFoods.items.length;

function draftLine(formulaSourceId, spec) {
  return {
    lineId: spec.lineId,
    required: true,
    ingredientId: spec.ingredientId || "",
    ingredientContentVersion: spec.ingredientId ? "2026.08-full-catalog.1" : "pending",
    ingredientSnapshotDigest: "pending",
    sourceName: spec.sourceName,
    sourcePartText: spec.sourcePartText,
    processingText: spec.processingText,
    identityReviewState: spec.identityReviewState || "pending",
    identitySourceIds: spec.identitySourceIds || [],
    quantitySourceIds: [formulaSourceId],
    useRole: spec.useRole || "food_ingredient",
    allergenKeys: spec.allergenKeys || [],
    quantity: spec.quantity,
    sourceIds: [formulaSourceId]
  };
}

function draftAudit(note) {
  return {
    sourceCheckState: "checked",
    sourceCheckedAt: "2026-08-11",
    formulaReviewState: "pending",
    medicalReviewState: "pending",
    pharmacyReviewState: "pending",
    complianceReviewState: "pending",
    reviews: [],
    finalApprovedAt: null,
    nextReviewAt: null,
    releaseStage: "development_preview",
    note
  };
}

const recipes = [
  {
    id: "black-bean-huangqi-goji-soup",
    revision: "1.0.0-draft.1",
    name: "黑豆黄杞子汤",
    status: "draft",
    contentVersion,
    rulesVersion: "1.6.0",
    targetId: "adult_diabetes",
    publicVisibility: "withheld",
    formulaSourceId: "nhc-adult-diabetes-guide-2023",
    safetySourceIds: ["nhc-interpretation-2023-9"],
    sources: sources.filter((source) => [
      "nhc-food-guides-notice-2023",
      "nhc-adult-diabetes-guide-2023",
      "nhc-announcement-2023-9",
      "nhc-interpretation-2023-9"
    ].includes(source.id)),
    sourceLocator: {
      documentNo: "国卫办食品函〔2023〕5号",
      page: "第59页（PDF物理页第61页）",
      section: "附录4 成人糖尿病食养方举例",
      recipeTitle: "四、黑豆黄杞子汤"
    },
    sourceContext: {
      text: "成人糖尿病官方食养方资料",
      diagnosticUse: "forbidden",
      targetAgeGroups: ["adult"]
    },
    guideContext: {
      title: "成人糖尿病食养指南（2023年版）",
      edition: "2023年版",
      section: "附录4 成人糖尿病食养方举例",
      page: "第59页",
      originalTarget: "主要面向成人2型糖尿病患者及基层卫生工作者；1型、妊娠期及其他类型糖尿病患者可在专业人员指导下参考。"
    },
    audience: {
      adultOnly: true,
      diagnosisConfirmationRequired: true,
      patternRequired: false,
      allowedTargetConditions: ["2型糖尿病", "成人2型糖尿病"]
    },
    bundle: {
      atomic: true,
      omissionPolicy: "forbidden",
      substitutionPolicy: "forbidden",
      scalingPolicy: "forbidden",
      orderLocked: true,
      servingText: "佐餐食用。",
      frequencyText: "",
      courseText: "",
      ingredients: [
        {
          lineId: "line-huangqi", required: true, ingredientId: "huang-qi",
          ingredientContentVersion: "2026.08-full-catalog.1", ingredientSnapshotDigest: "pending",
          sourceName: "黄芪", sourcePartText: "根", processingText: "与其他食材同煮",
          identityReviewState: "source_checked", identitySourceIds: ["nhc-announcement-2023-9"],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "main_ingredient", allergenKeys: ["黄芪"],
          quantity: { kind: "exact", rawText: "10g", value: "10", unit: "g" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-black-bean", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "黑豆", sourcePartText: "来源未细分部位", processingText: "泡发",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "main_ingredient", allergenKeys: ["黑豆"],
          quantity: { kind: "exact", rawText: "10g", value: "10", unit: "g" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-goji", required: true, ingredientId: "gou-qi-zi",
          ingredientContentVersion: "2026.08-full-catalog.1", ingredientSnapshotDigest: "pending",
          sourceName: "枸杞子", sourcePartText: "未知（配方页仅写材料名）", processingText: "与其他食材同煮",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "main_ingredient", allergenKeys: ["枸杞子"],
          quantity: { kind: "exact", rawText: "10g", value: "10", unit: "g" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-ginger", required: true, ingredientId: "jiang",
          ingredientContentVersion: "2026.08-full-catalog.1", ingredientSnapshotDigest: "pending",
          sourceName: "生姜", sourcePartText: "来源未细分部位", processingText: "与其他食材同煮",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "food_ingredient", allergenKeys: ["生姜"],
          quantity: { kind: "exact", rawText: "3g", value: "3", unit: "g" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-water", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "清水", sourcePartText: "不适用", processingText: "与其他食材同煮",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "supporting_ingredient", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "原文未给量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-salt", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "食盐", sourcePartText: "不适用", processingText: "按原文适量使用",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "seasoning", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        }
      ],
      steps: [
        {
          stepId: "step-1", order: 1,
          text: "黑豆泡发后与其他食材一起加入清水，小火煮至熟透。",
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        }
      ],
      sourceTextDigest: "pending",
      bundleDigest: "pending"
    },
    historicNotes: [
      "原指南发布时注明黄芪在非试点地区限执业医师使用；该历史备注保留，不以程序静默改写。"
    ],
    currentContext: [
      "2023年第9号公告后，黄芪新增纳入食药物质目录；仍须遵守公告、官方解读和个体安全边界。",
      "官方解读明确孕妇、哺乳期妇女及婴幼儿等特殊人群不推荐食用该批新增物质。"
    ],
    safety: {
      sourceIds: ["nhc-adult-diabetes-guide-2023", "nhc-interpretation-2023-9"],
      redFlagPolicy: "global_stop",
      pregnancy: "no",
      breastfeeding: "no",
      infantsToddlers: "no",
      children: "unknown",
      olderAdults: "unknown",
      populationSourceIds: ["nhc-interpretation-2023-9"],
      allergenKeys: ["黄芪", "黑豆", "枸杞子", "生姜"],
      allergenKeyBasis: "ingredient_name_only",
      avoidConditions: [],
      cautionConditions: [],
      drugInteractions: [],
      medicationCautions: [],
      preparationBlocks: [],
      preparationWarnings: [],
      allergenReviewState: "partial",
      allergenSourceIds: ["nhc-adult-diabetes-guide-2023"],
      conditionReviewState: "pending",
      conditionSourceIds: [],
      interactionReviewState: "pending",
      interactionSourceIds: [],
      preparationReviewState: "partial",
      preparationSourceIds: ["nhc-adult-diabetes-guide-2023"]
    },
    sourceIds: [
      "nhc-food-guides-notice-2023",
      "nhc-adult-diabetes-guide-2023",
      "nhc-announcement-2023-9",
      "nhc-interpretation-2023-9"
    ],
    audit: {
      sourceCheckState: "checked",
      sourceCheckedAt: "2026-08-10",
      formulaReviewState: "pending",
      medicalReviewState: "pending",
      pharmacyReviewState: "pending",
      complianceReviewState: "pending",
      reviews: [],
      finalApprovedAt: null,
      nextReviewAt: null,
      releaseStage: "development_preview",
      note: "官方完整方案已按原始材料、用量和制作方法录入；尚待中医师、药师和营养专业人员逐字段签审。"
    }
  },
  {
    id: "angelica-codonopsis-stewed-hen",
    revision: "1.0.0-draft.1",
    name: "归参炖母鸡",
    status: "draft",
    contentVersion,
    rulesVersion: "1.6.0",
    targetId: "adult_diabetes",
    publicVisibility: "withheld",
    formulaSourceId: "nhc-adult-diabetes-guide-2023",
    safetySourceIds: ["nhc-announcement-2023-9", "nhc-interpretation-2023-9"],
    sources: sources.filter((source) => [
      "nhc-food-guides-notice-2023",
      "nhc-adult-diabetes-guide-2023",
      "nhc-announcement-2019-8",
      "nhc-announcement-2023-9",
      "nhc-interpretation-2023-9"
    ].includes(source.id)),
    sourceLocator: {
      documentNo: "国卫办食品函〔2023〕5号",
      page: "第59页（PDF物理页第61页）",
      section: "附录4 成人糖尿病食养方举例",
      recipeTitle: "一、归参炖母鸡"
    },
    sourceContext: {
      text: "成人2型糖尿病官方食养方资料",
      diagnosticUse: "forbidden",
      targetAgeGroups: ["adult"]
    },
    guideContext: {
      title: "成人糖尿病食养指南（2023年版）",
      edition: "2023年版",
      section: "附录4 成人糖尿病食养方举例",
      page: "第59页（PDF物理页第61页）",
      originalTarget: "主要面向成人2型糖尿病患者及基层卫生工作者；1型、妊娠期及其他类型糖尿病患者可在专业人员指导下参考。"
    },
    audience: {
      adultOnly: true,
      diagnosisConfirmationRequired: true,
      patternRequired: false,
      allowedTargetConditions: ["2型糖尿病", "成人2型糖尿病"]
    },
    bundle: {
      atomic: true,
      omissionPolicy: "forbidden",
      substitutionPolicy: "forbidden",
      scalingPolicy: "forbidden",
      orderLocked: true,
      servingText: "佐餐分次食用。",
      frequencyText: "",
      courseText: "",
      ingredients: [
        {
          lineId: "line-angelica", required: true, ingredientId: "dang-gui",
          ingredientContentVersion: "2026.08-full-catalog.1", ingredientSnapshotDigest: "pending",
          sourceName: "当归", sourcePartText: "根", processingText: "洗净后放入鸡腹",
          identityReviewState: "source_checked", identitySourceIds: ["nhc-announcement-2019-8"],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "main_ingredient", allergenKeys: ["当归"],
          quantity: { kind: "exact", rawText: "12g", value: "12", unit: "g" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-codonopsis", required: true, ingredientId: "dang-shen",
          ingredientContentVersion: "2026.08-full-catalog.1", ingredientSnapshotDigest: "pending",
          sourceName: "党参", sourcePartText: "根", processingText: "洗净后放入鸡腹",
          identityReviewState: "source_checked", identitySourceIds: ["nhc-announcement-2023-9"],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "main_ingredient", allergenKeys: ["党参"],
          quantity: { kind: "exact", rawText: "20g", value: "20", unit: "g" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-hen", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "母鸡", sourcePartText: "整只（去内脏）", processingText: "去内脏并洗净",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "main_ingredient", allergenKeys: ["母鸡"],
          quantity: { kind: "exact", rawText: "1只", value: "1", unit: "piece" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-ginger", required: true, ingredientId: "jiang",
          ingredientContentVersion: "2026.08-full-catalog.1", ingredientSnapshotDigest: "pending",
          sourceName: "生姜", sourcePartText: "来源未细分部位", processingText: "加入砂锅",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "food_ingredient", allergenKeys: ["生姜"],
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-scallion", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "葱", sourcePartText: "来源未细分部位", processingText: "加入砂锅",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "food_ingredient", allergenKeys: ["葱"] ,
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-cooking-wine", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "料酒", sourcePartText: "不适用", processingText: "加入砂锅",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "seasoning", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-water", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "清水", sourcePartText: "不适用", processingText: "加入砂锅",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "supporting_ingredient", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        },
        {
          lineId: "line-salt", required: true, ingredientId: "",
          ingredientContentVersion: "pending", ingredientSnapshotDigest: "pending",
          sourceName: "食盐", sourcePartText: "不适用", processingText: "按原文适量使用",
          identityReviewState: "pending", identitySourceIds: [],
          quantitySourceIds: ["nhc-adult-diabetes-guide-2023"],
          useRole: "seasoning", allergenKeys: [],
          quantity: { kind: "qualitative", rawText: "适量", unit: "source_text" },
          sourceIds: ["nhc-adult-diabetes-guide-2023"]
        }
      ],
      steps: [
        { stepId: "step-1", order: 1, text: "母鸡去掉内脏并洗净。", sourceIds: ["nhc-adult-diabetes-guide-2023"] },
        { stepId: "step-2", order: 2, text: "当归和党参洗净后放入鸡腹。", sourceIds: ["nhc-adult-diabetes-guide-2023"] },
        { stepId: "step-3", order: 3, text: "置于砂锅中，加入葱、姜、料酒和适量清水。", sourceIds: ["nhc-adult-diabetes-guide-2023"] },
        { stepId: "step-4", order: 4, text: "大火煮沸后改小火煨炖，直至鸡肉烂熟、骨肉分离。", sourceIds: ["nhc-adult-diabetes-guide-2023"] }
      ],
      sourceTextDigest: "pending",
      bundleDigest: "pending"
    },
    historicNotes: ["原指南未注明每人份量、食用频次或疗程，系统不得自行补全。"],
    currentContext: ["当归现行食药物质目录记录为仅作香辛料和调味品；该方案用途必须由合规与专业人员单独核对，程序不会自动放行。"],
    safety: {
      sourceIds: ["nhc-adult-diabetes-guide-2023", "nhc-interpretation-2023-9"],
      redFlagPolicy: "global_stop",
      pregnancy: "no", breastfeeding: "no", infantsToddlers: "no", children: "unknown", olderAdults: "unknown",
      populationSourceIds: ["nhc-interpretation-2023-9"],
      allergenKeys: ["当归", "党参", "母鸡", "生姜", "葱"],
      allergenKeyBasis: "ingredient_name_only",
      avoidConditions: [], cautionConditions: [], drugInteractions: ["藜芦"], medicationCautions: [],
      preparationBlocks: [], preparationWarnings: [],
      allergenReviewState: "partial", allergenSourceIds: ["nhc-adult-diabetes-guide-2023"],
      conditionReviewState: "pending", conditionSourceIds: [],
      interactionReviewState: "partial", interactionSourceIds: ["nhc-interpretation-2023-9"],
      preparationReviewState: "partial", preparationSourceIds: ["nhc-adult-diabetes-guide-2023"]
    },
    sourceIds: ["nhc-food-guides-notice-2023", "nhc-adult-diabetes-guide-2023", "nhc-announcement-2019-8", "nhc-announcement-2023-9", "nhc-interpretation-2023-9"],
    audit: {
      sourceCheckState: "checked",
      sourceCheckedAt: "2026-08-10",
      formulaReviewState: "pending",
      medicalReviewState: "pending",
      pharmacyReviewState: "pending",
      complianceReviewState: "pending",
      reviews: [],
      finalApprovedAt: null,
      nextReviewAt: null,
      releaseStage: "development_preview",
      note: "官方完整方案已完成来源录入；当归用途边界、普通食材身份及整方专业安全仍待签审。"
    }
  },
  ...stagedPatternRecipes
];

const externalLineBindings = Object.freeze({
  "black-bean-huangqi-goji-soup/line-black-bean": "external-food-black-bean",
  "black-bean-huangqi-goji-soup/line-water": "external-food-water-unspecified",
  "black-bean-huangqi-goji-soup/line-salt": "external-food-salt",
  "angelica-codonopsis-stewed-hen/line-hen": "external-food-whole-hen",
  "angelica-codonopsis-stewed-hen/line-scallion": "external-food-scallion",
  "angelica-codonopsis-stewed-hen/line-cooking-wine": "external-food-cooking-wine",
  "angelica-codonopsis-stewed-hen/line-water": "external-food-water-unspecified",
  "angelica-codonopsis-stewed-hen/line-salt": "external-food-salt",
  "angelica-huangqi-chicken-soup/line-chicken": "external-food-chicken-meat",
  "angelica-huangqi-chicken-soup/line-water": "external-food-water-unspecified",
  "angelica-huangqi-chicken-soup/line-salt": "external-food-salt",
  "goji-sesame-vegetable-cake/line-goji-leaf": "external-food-goji-leaf",
  "goji-sesame-vegetable-cake/line-glutinous-rice-flour": "external-food-glutinous-rice-flour",
  "goji-sesame-vegetable-cake/line-japonica-rice-flour": "external-food-japonica-rice-flour",
  "goji-sesame-vegetable-cake/line-egg-liquid": "external-food-egg-liquid",
  "goji-sesame-vegetable-cake/line-oil": "external-food-cooking-oil-unspecified",
  "goji-sesame-vegetable-cake/line-scallion": "external-food-chopped-scallion",
  "goji-sesame-vegetable-cake/line-soy-sauce": "external-food-soy-sauce",
  "goji-sesame-vegetable-cake/line-water": "external-food-water-unspecified",
  "goji-sesame-vegetable-cake/line-salt": "external-food-salt",
  "goji-sesame-vegetable-cake/line-sesame-oil": "external-food-sesame-oil",
  "hypertension-liver-fire-appendix-celery-congee/line-celery": "external-food-celery",
  "hypertension-liver-fire-appendix-celery-congee/line-japonica-rice": "external-food-japonica-rice",
  "hypertension-liver-fire-appendix-celery-congee/line-lean-pork": "external-food-lean-pork"
});

const externalFoodIds = new Set(externalFoods.items.map((item) => item.id));
recipes.forEach((recipe) => {
  recipe.bundle.ingredients.forEach((line) => {
    const bindingKey = `${recipe.id}/${line.lineId}`;
    const externalFoodId = externalLineBindings[bindingKey];
    if (externalFoodId) {
      if (!externalFoodIds.has(externalFoodId)) throw new Error(`Unresolved external food binding: ${bindingKey}`);
      line.ingredientRegistry = "external_food";
      line.ingredientId = externalFoodId;
      line.ingredientContentVersion = externalFoodContentVersion;
      return;
    }
    if (!line.ingredientId) throw new Error(`Unresolved recipe material binding: ${bindingKey}`);
    line.ingredientRegistry = "official_catalog";
  });
});

module.exports = {
  schemaVersion,
  contentVersion,
  publishedAt,
  sources,
  targets,
  externalFoods,
  recipes,
  count: recipes.length
};
