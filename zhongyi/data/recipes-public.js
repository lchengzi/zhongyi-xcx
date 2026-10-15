"use strict";

// 此文件由 tools/build-public-recipes.js 生成。未发布整方不包含材料、用量、步骤或食用方式。
module.exports = {
  "schemaVersion": "1.1.0",
  "contentVersion": "2026.08-official-recipe.8",
  "publishedAt": "2026-08-13",
  "sources": [
    {
      "id": "nhc-food-guides-notice-2023",
      "status": "published",
      "type": "official_notice",
      "title": "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
      "publisher": "中华人民共和国国家卫生健康委员会",
      "documentNo": "国卫办食品函〔2023〕5号",
      "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
      "publishedAt": "2023-01-18",
      "checkedAt": "2026-08-10",
      "scope": "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
    },
    {
      "id": "nhc-adult-diabetes-guide-2023",
      "status": "published",
      "type": "official_guide",
      "title": "成人糖尿病食养指南（2023年版）",
      "publisher": "中华人民共和国国家卫生健康委员会",
      "url": "https://www.nhc.gov.cn/wjw/c100378/202301/7faed9993c9b45aea158c5335346f282/files/1732844468278_20318.pdf",
      "publishedAt": "2023-01-18",
      "checkedAt": "2026-08-10",
      "scope": "支持附录4第59页的成人糖尿病完整食养方原始材料、制作方法和食用方式。"
    },
    {
      "id": "nhc-announcement-2019-8",
      "status": "published",
      "type": "official_announcement",
      "title": "关于当归等6种新增按照传统既是食品又是中药材的物质公告（2019年第8号）",
      "publisher": "国家卫生健康委、国家市场监督管理总局",
      "url": "https://www.nhc.gov.cn/wjw/c100175/202001/60977058ce3b4449b1b1d46cff283e73.shtml",
      "publishedAt": "2019-11-25",
      "checkedAt": "2026-08-10",
      "scope": "支持当归的植物身份、部位，以及仅作为香辛料和调味品使用的现行用途限制。"
    },
    {
      "id": "nhc-adult-hyperlipidemia-guide-2023",
      "status": "published",
      "type": "official_guide",
      "title": "成人高脂血症食养指南（2023年版）",
      "publisher": "中华人民共和国国家卫生健康委员会",
      "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d/files/1732844468018_41219.pdf",
      "publishedAt": "2023-01-18",
      "checkedAt": "2026-08-10",
      "scope": "支持高脂血症候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
    },
    {
      "id": "nhc-adult-hypertension-guide-2023",
      "status": "published",
      "type": "official_guide",
      "title": "成人高血压食养指南（2023年版）",
      "publisher": "中华人民共和国国家卫生健康委员会",
      "url": "https://www.nhc.gov.cn/cms-search/downFiles/63f752a17cfd4b4781f744477561866f.pdf",
      "publishedAt": "2023-01-18",
      "checkedAt": "2026-08-10",
      "scope": "支持高血压候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
    },
    {
      "id": "nhc-announcement-2023-9",
      "status": "published",
      "type": "official_announcement",
      "title": "关于党参等9种新增按照传统既是食品又是中药材的物质公告（2023年第9号）",
      "publisher": "国家卫生健康委、国家市场监督管理总局",
      "url": "https://www.nhc.gov.cn/wjw/c100175/202311/59e03b384f9a4d0b9623e19b813f6cc4.shtml",
      "publishedAt": "2023-11-09",
      "checkedAt": "2026-08-10",
      "scope": "支持黄芪在指南发布后的现行食药物质目录事件；不改写指南中的历史备注。"
    },
    {
      "id": "nhc-interpretation-2023-9",
      "status": "published",
      "type": "official_interpretation",
      "title": "解读《关于党参等9种新增按照传统既是食品又是中药材的物质公告》",
      "publisher": "中华人民共和国国家卫生健康委员会",
      "url": "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
      "publishedAt": "2023-11-17",
      "checkedAt": "2026-08-10",
      "scope": "支持黄芪的食品形态说明及特殊人群不推荐食用信息。"
    }
  ],
  "targets": [
    {
      "id": "adult_diabetes",
      "label": "已确诊成人2型糖尿病",
      "shortLabel": "成人2型糖尿病",
      "availability": "draft_under_review",
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-diabetes-guide-2023"
      ],
      "description": "仅供已经正规医疗机构明确诊断为2型糖尿病的成年人查看官方食养资料，不根据症状推断疾病。",
      "unavailableReason": "已有2项官方完整方案完成来源录入，但普通食品身份、整方安全和专业签审尚未完成，因此暂不展示材料、用量和做法。"
    },
    {
      "id": "adult_hyperlipidemia",
      "label": "已确诊成人高脂血症",
      "shortLabel": "成人高脂血症",
      "availability": "withheld_pattern_required",
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-hyperlipidemia-guide-2023"
      ],
      "description": "官方候选方案按不同中医证型编排。",
      "unavailableReason": "当前版本不做自动辨证；需由专业人员确认中医证型后，才能选择对应的完整食养方。"
    },
    {
      "id": "adult_hypertension",
      "label": "已确诊成人高血压",
      "shortLabel": "成人高血压",
      "availability": "withheld_pattern_required",
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-hypertension-guide-2023"
      ],
      "description": "官方候选方案按不同中医证型编排。",
      "unavailableReason": "当前版本不做自动辨证；需由专业人员确认中医证型后，才能选择对应的完整食养方。"
    }
  ],
  "externalFoods": {
    "schemaVersion": "1.0.0",
    "contentVersion": "2026.08-external-food.1",
    "publishedAt": "2026-08-13",
    "items": [],
    "count": 0
  },
  "recipes": [
    {
      "id": "black-bean-huangqi-goji-soup",
      "revision": "1.0.0-draft.1",
      "name": "黑豆黄杞子汤",
      "status": "draft",
      "contentVersion": "2026.08-official-recipe.8",
      "rulesVersion": "1.6.0",
      "targetId": "adult_diabetes",
      "publicVisibility": "withheld",
      "formulaSourceId": "nhc-adult-diabetes-guide-2023",
      "safetySourceIds": [
        "nhc-interpretation-2023-9"
      ],
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-diabetes-guide-2023",
        "nhc-announcement-2023-9",
        "nhc-interpretation-2023-9"
      ],
      "sources": [
        {
          "id": "nhc-food-guides-notice-2023",
          "status": "published",
          "type": "official_notice",
          "title": "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "documentNo": "国卫办食品函〔2023〕5号",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
        },
        {
          "id": "nhc-adult-diabetes-guide-2023",
          "status": "published",
          "type": "official_guide",
          "title": "成人糖尿病食养指南（2023年版）",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/wjw/c100378/202301/7faed9993c9b45aea158c5335346f282/files/1732844468278_20318.pdf",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持附录4第59页的成人糖尿病完整食养方原始材料、制作方法和食用方式。"
        },
        {
          "id": "nhc-announcement-2023-9",
          "status": "published",
          "type": "official_announcement",
          "title": "关于党参等9种新增按照传统既是食品又是中药材的物质公告（2023年第9号）",
          "publisher": "国家卫生健康委、国家市场监督管理总局",
          "url": "https://www.nhc.gov.cn/wjw/c100175/202311/59e03b384f9a4d0b9623e19b813f6cc4.shtml",
          "publishedAt": "2023-11-09",
          "checkedAt": "2026-08-10",
          "scope": "支持黄芪在指南发布后的现行食药物质目录事件；不改写指南中的历史备注。"
        },
        {
          "id": "nhc-interpretation-2023-9",
          "status": "published",
          "type": "official_interpretation",
          "title": "解读《关于党参等9种新增按照传统既是食品又是中药材的物质公告》",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
          "publishedAt": "2023-11-17",
          "checkedAt": "2026-08-10",
          "scope": "支持黄芪的食品形态说明及特殊人群不推荐食用信息。"
        }
      ],
      "sourceLocator": {
        "documentNo": "国卫办食品函〔2023〕5号",
        "page": "第59页（PDF物理页第61页）",
        "section": "附录4 成人糖尿病食养方举例",
        "recipeTitle": "四、黑豆黄杞子汤"
      },
      "sourceContext": {
        "text": "成人糖尿病官方食养方资料",
        "diagnosticUse": "forbidden",
        "targetAgeGroups": [
          "adult"
        ]
      },
      "guideContext": {
        "title": "成人糖尿病食养指南（2023年版）",
        "edition": "2023年版",
        "section": "附录4 成人糖尿病食养方举例",
        "page": "第59页",
        "originalTarget": "主要面向成人2型糖尿病患者及基层卫生工作者；1型、妊娠期及其他类型糖尿病患者可在专业人员指导下参考。"
      },
      "audience": {
        "adultOnly": true,
        "diagnosisConfirmationRequired": true,
        "patternRequired": false,
        "allowedTargetConditions": [
          "2型糖尿病",
          "成人2型糖尿病"
        ]
      },
      "bundle": {
        "atomic": true,
        "omissionPolicy": "forbidden",
        "substitutionPolicy": "forbidden",
        "scalingPolicy": "forbidden",
        "orderLocked": true,
        "withheld": true
      },
      "historicNotes": [],
      "currentContext": [],
      "safety": {
        "sourceIds": [
          "nhc-adult-diabetes-guide-2023",
          "nhc-interpretation-2023-9"
        ],
        "redFlagPolicy": "global_stop",
        "pregnancy": "no",
        "breastfeeding": "no",
        "infantsToddlers": "no",
        "children": "unknown",
        "olderAdults": "unknown",
        "populationSourceIds": [
          "nhc-interpretation-2023-9"
        ],
        "allergenKeys": [],
        "allergenKeyBasis": "withheld_pending_review",
        "avoidConditions": [],
        "cautionConditions": [],
        "drugInteractions": [],
        "medicationCautions": [],
        "preparationBlocks": [],
        "preparationWarnings": [],
        "allergenReviewState": "partial",
        "allergenSourceIds": [
          "nhc-adult-diabetes-guide-2023"
        ],
        "conditionReviewState": "pending",
        "conditionSourceIds": [],
        "interactionReviewState": "pending",
        "interactionSourceIds": [],
        "preparationReviewState": "partial",
        "preparationSourceIds": [
          "nhc-adult-diabetes-guide-2023"
        ]
      },
      "audit": {
        "sourceCheckState": "checked",
        "sourceCheckedAt": "2026-08-10",
        "formulaReviewState": "pending",
        "medicalReviewState": "pending",
        "pharmacyReviewState": "pending",
        "complianceReviewState": "pending",
        "finalApprovedAt": null,
        "nextReviewAt": null,
        "releaseStage": "development_preview",
        "reviews": [],
        "note": "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。"
      }
    },
    {
      "id": "angelica-codonopsis-stewed-hen",
      "revision": "1.0.0-draft.1",
      "name": "归参炖母鸡",
      "status": "draft",
      "contentVersion": "2026.08-official-recipe.8",
      "rulesVersion": "1.6.0",
      "targetId": "adult_diabetes",
      "publicVisibility": "withheld",
      "formulaSourceId": "nhc-adult-diabetes-guide-2023",
      "safetySourceIds": [
        "nhc-announcement-2023-9",
        "nhc-interpretation-2023-9"
      ],
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-diabetes-guide-2023",
        "nhc-announcement-2019-8",
        "nhc-announcement-2023-9",
        "nhc-interpretation-2023-9"
      ],
      "sources": [
        {
          "id": "nhc-food-guides-notice-2023",
          "status": "published",
          "type": "official_notice",
          "title": "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "documentNo": "国卫办食品函〔2023〕5号",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
        },
        {
          "id": "nhc-adult-diabetes-guide-2023",
          "status": "published",
          "type": "official_guide",
          "title": "成人糖尿病食养指南（2023年版）",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/wjw/c100378/202301/7faed9993c9b45aea158c5335346f282/files/1732844468278_20318.pdf",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持附录4第59页的成人糖尿病完整食养方原始材料、制作方法和食用方式。"
        },
        {
          "id": "nhc-announcement-2019-8",
          "status": "published",
          "type": "official_announcement",
          "title": "关于当归等6种新增按照传统既是食品又是中药材的物质公告（2019年第8号）",
          "publisher": "国家卫生健康委、国家市场监督管理总局",
          "url": "https://www.nhc.gov.cn/wjw/c100175/202001/60977058ce3b4449b1b1d46cff283e73.shtml",
          "publishedAt": "2019-11-25",
          "checkedAt": "2026-08-10",
          "scope": "支持当归的植物身份、部位，以及仅作为香辛料和调味品使用的现行用途限制。"
        },
        {
          "id": "nhc-announcement-2023-9",
          "status": "published",
          "type": "official_announcement",
          "title": "关于党参等9种新增按照传统既是食品又是中药材的物质公告（2023年第9号）",
          "publisher": "国家卫生健康委、国家市场监督管理总局",
          "url": "https://www.nhc.gov.cn/wjw/c100175/202311/59e03b384f9a4d0b9623e19b813f6cc4.shtml",
          "publishedAt": "2023-11-09",
          "checkedAt": "2026-08-10",
          "scope": "支持黄芪在指南发布后的现行食药物质目录事件；不改写指南中的历史备注。"
        },
        {
          "id": "nhc-interpretation-2023-9",
          "status": "published",
          "type": "official_interpretation",
          "title": "解读《关于党参等9种新增按照传统既是食品又是中药材的物质公告》",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
          "publishedAt": "2023-11-17",
          "checkedAt": "2026-08-10",
          "scope": "支持黄芪的食品形态说明及特殊人群不推荐食用信息。"
        }
      ],
      "sourceLocator": {
        "documentNo": "国卫办食品函〔2023〕5号",
        "page": "第59页（PDF物理页第61页）",
        "section": "附录4 成人糖尿病食养方举例",
        "recipeTitle": "一、归参炖母鸡"
      },
      "sourceContext": {
        "text": "成人2型糖尿病官方食养方资料",
        "diagnosticUse": "forbidden",
        "targetAgeGroups": [
          "adult"
        ]
      },
      "guideContext": {
        "title": "成人糖尿病食养指南（2023年版）",
        "edition": "2023年版",
        "section": "附录4 成人糖尿病食养方举例",
        "page": "第59页（PDF物理页第61页）",
        "originalTarget": "主要面向成人2型糖尿病患者及基层卫生工作者；1型、妊娠期及其他类型糖尿病患者可在专业人员指导下参考。"
      },
      "audience": {
        "adultOnly": true,
        "diagnosisConfirmationRequired": true,
        "patternRequired": false,
        "allowedTargetConditions": [
          "2型糖尿病",
          "成人2型糖尿病"
        ]
      },
      "bundle": {
        "atomic": true,
        "omissionPolicy": "forbidden",
        "substitutionPolicy": "forbidden",
        "scalingPolicy": "forbidden",
        "orderLocked": true,
        "withheld": true
      },
      "historicNotes": [],
      "currentContext": [],
      "safety": {
        "sourceIds": [
          "nhc-adult-diabetes-guide-2023",
          "nhc-interpretation-2023-9"
        ],
        "redFlagPolicy": "global_stop",
        "pregnancy": "no",
        "breastfeeding": "no",
        "infantsToddlers": "no",
        "children": "unknown",
        "olderAdults": "unknown",
        "populationSourceIds": [
          "nhc-interpretation-2023-9"
        ],
        "allergenKeys": [],
        "allergenKeyBasis": "withheld_pending_review",
        "avoidConditions": [],
        "cautionConditions": [],
        "drugInteractions": [],
        "medicationCautions": [],
        "preparationBlocks": [],
        "preparationWarnings": [],
        "allergenReviewState": "partial",
        "allergenSourceIds": [
          "nhc-adult-diabetes-guide-2023"
        ],
        "conditionReviewState": "pending",
        "conditionSourceIds": [],
        "interactionReviewState": "partial",
        "interactionSourceIds": [
          "nhc-interpretation-2023-9"
        ],
        "preparationReviewState": "partial",
        "preparationSourceIds": [
          "nhc-adult-diabetes-guide-2023"
        ]
      },
      "audit": {
        "sourceCheckState": "checked",
        "sourceCheckedAt": "2026-08-10",
        "formulaReviewState": "pending",
        "medicalReviewState": "pending",
        "pharmacyReviewState": "pending",
        "complianceReviewState": "pending",
        "finalApprovedAt": null,
        "nextReviewAt": null,
        "releaseStage": "development_preview",
        "reviews": [],
        "note": "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。"
      }
    },
    {
      "id": "angelica-huangqi-chicken-soup",
      "revision": "1.0.0-draft.1",
      "name": "归芪鸡汤",
      "status": "draft",
      "contentVersion": "2026.08-official-recipe.8",
      "rulesVersion": "1.6.0",
      "targetId": "adult_hyperlipidemia",
      "publicVisibility": "withheld",
      "formulaSourceId": "nhc-adult-hyperlipidemia-guide-2023",
      "safetySourceIds": [
        "nhc-adult-hyperlipidemia-guide-2023",
        "nhc-announcement-2023-9",
        "nhc-interpretation-2023-9"
      ],
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-hyperlipidemia-guide-2023",
        "nhc-announcement-2019-8",
        "nhc-announcement-2023-9",
        "nhc-interpretation-2023-9"
      ],
      "sources": [
        {
          "id": "nhc-food-guides-notice-2023",
          "status": "published",
          "type": "official_notice",
          "title": "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "documentNo": "国卫办食品函〔2023〕5号",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
        },
        {
          "id": "nhc-announcement-2019-8",
          "status": "published",
          "type": "official_announcement",
          "title": "关于当归等6种新增按照传统既是食品又是中药材的物质公告（2019年第8号）",
          "publisher": "国家卫生健康委、国家市场监督管理总局",
          "url": "https://www.nhc.gov.cn/wjw/c100175/202001/60977058ce3b4449b1b1d46cff283e73.shtml",
          "publishedAt": "2019-11-25",
          "checkedAt": "2026-08-10",
          "scope": "支持当归的植物身份、部位，以及仅作为香辛料和调味品使用的现行用途限制。"
        },
        {
          "id": "nhc-adult-hyperlipidemia-guide-2023",
          "status": "published",
          "type": "official_guide",
          "title": "成人高脂血症食养指南（2023年版）",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d/files/1732844468018_41219.pdf",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持高脂血症候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
        },
        {
          "id": "nhc-announcement-2023-9",
          "status": "published",
          "type": "official_announcement",
          "title": "关于党参等9种新增按照传统既是食品又是中药材的物质公告（2023年第9号）",
          "publisher": "国家卫生健康委、国家市场监督管理总局",
          "url": "https://www.nhc.gov.cn/wjw/c100175/202311/59e03b384f9a4d0b9623e19b813f6cc4.shtml",
          "publishedAt": "2023-11-09",
          "checkedAt": "2026-08-10",
          "scope": "支持黄芪在指南发布后的现行食药物质目录事件；不改写指南中的历史备注。"
        },
        {
          "id": "nhc-interpretation-2023-9",
          "status": "published",
          "type": "official_interpretation",
          "title": "解读《关于党参等9种新增按照传统既是食品又是中药材的物质公告》",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
          "publishedAt": "2023-11-17",
          "checkedAt": "2026-08-10",
          "scope": "支持黄芪的食品形态说明及特殊人群不推荐食用信息。"
        }
      ],
      "sourceLocator": {
        "documentNo": "国卫办食品函〔2023〕5号",
        "page": "第37–38页（PDF物理页第39–40页）",
        "section": "附录4 不同证型食养方举例 · 四、气虚血瘀型 · （二）食养方",
        "recipeTitle": "3.归芪鸡汤"
      },
      "sourceContext": {
        "text": "成人高脂血症气虚血瘀型官方食养方资料",
        "diagnosticUse": "forbidden",
        "targetAgeGroups": [
          "adult"
        ]
      },
      "guideContext": {
        "title": "成人高脂血症食养指南（2023年版）",
        "edition": "2023年版",
        "section": "附录4 · 气虚血瘀型 · 食养方",
        "page": "第37–38页（PDF物理页第39–40页）",
        "originalTarget": "面向成人高脂血症人群；本条仅对应指南中的气虚血瘀型资料，有合并症者需在专业人员指导下参考。"
      },
      "audience": {
        "adultOnly": true,
        "diagnosisConfirmationRequired": true,
        "patternRequired": true,
        "patternConfirmationPolicy": "professional_confirmation_required",
        "allowedPatterns": [
          "气虚血瘀型"
        ],
        "allowedTargetConditions": [
          "成人高脂血症",
          "高脂血症"
        ]
      },
      "bundle": {
        "atomic": true,
        "omissionPolicy": "forbidden",
        "substitutionPolicy": "forbidden",
        "scalingPolicy": "forbidden",
        "orderLocked": true,
        "withheld": true
      },
      "historicNotes": [],
      "currentContext": [],
      "safety": {
        "sourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023",
          "nhc-interpretation-2023-9"
        ],
        "redFlagPolicy": "global_stop",
        "pregnancy": "no",
        "breastfeeding": "no",
        "infantsToddlers": "no",
        "children": "unknown",
        "olderAdults": "unknown",
        "populationSourceIds": [
          "nhc-interpretation-2023-9"
        ],
        "allergenKeys": [],
        "allergenKeyBasis": "withheld_pending_review",
        "avoidConditions": [],
        "cautionConditions": [],
        "drugInteractions": [],
        "medicationCautions": [],
        "preparationBlocks": [],
        "preparationWarnings": [],
        "allergenReviewState": "partial",
        "allergenSourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ],
        "conditionReviewState": "partial",
        "conditionSourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ],
        "interactionReviewState": "pending",
        "interactionSourceIds": [],
        "preparationReviewState": "partial",
        "preparationSourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ]
      },
      "audit": {
        "sourceCheckState": "checked",
        "sourceCheckedAt": "2026-08-11",
        "formulaReviewState": "pending",
        "medicalReviewState": "pending",
        "pharmacyReviewState": "pending",
        "complianceReviewState": "pending",
        "finalApprovedAt": null,
        "nextReviewAt": null,
        "releaseStage": "development_preview",
        "reviews": [],
        "note": "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。"
      }
    },
    {
      "id": "goji-sesame-vegetable-cake",
      "revision": "1.0.0-draft.1",
      "name": "枸杞芝麻蔬菜饼",
      "status": "draft",
      "contentVersion": "2026.08-official-recipe.8",
      "rulesVersion": "1.6.0",
      "targetId": "adult_hyperlipidemia",
      "publicVisibility": "withheld",
      "formulaSourceId": "nhc-adult-hyperlipidemia-guide-2023",
      "safetySourceIds": [
        "nhc-adult-hyperlipidemia-guide-2023"
      ],
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-hyperlipidemia-guide-2023"
      ],
      "sources": [
        {
          "id": "nhc-food-guides-notice-2023",
          "status": "published",
          "type": "official_notice",
          "title": "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "documentNo": "国卫办食品函〔2023〕5号",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
        },
        {
          "id": "nhc-adult-hyperlipidemia-guide-2023",
          "status": "published",
          "type": "official_guide",
          "title": "成人高脂血症食养指南（2023年版）",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d/files/1732844468018_41219.pdf",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持高脂血症候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
        }
      ],
      "sourceLocator": {
        "documentNo": "国卫办食品函〔2023〕5号",
        "page": "第38–39页（PDF物理页第40–41页）",
        "section": "附录4 不同证型食养方举例 · 五、肝肾阴虚型 · （二）食养方",
        "recipeTitle": "1.枸杞芝麻蔬菜饼"
      },
      "sourceContext": {
        "text": "成人高脂血症肝肾阴虚型官方食养方资料",
        "diagnosticUse": "forbidden",
        "targetAgeGroups": [
          "adult"
        ]
      },
      "guideContext": {
        "title": "成人高脂血症食养指南（2023年版）",
        "edition": "2023年版",
        "section": "附录4 · 肝肾阴虚型 · 食养方",
        "page": "第38–39页（PDF物理页第40–41页）",
        "originalTarget": "面向成人高脂血症人群；本条仅对应指南中的肝肾阴虚型资料，有合并症者需在专业人员指导下参考。"
      },
      "audience": {
        "adultOnly": true,
        "diagnosisConfirmationRequired": true,
        "patternRequired": true,
        "patternConfirmationPolicy": "professional_confirmation_required",
        "allowedPatterns": [
          "肝肾阴虚型"
        ],
        "allowedTargetConditions": [
          "成人高脂血症",
          "高脂血症"
        ]
      },
      "bundle": {
        "atomic": true,
        "omissionPolicy": "forbidden",
        "substitutionPolicy": "forbidden",
        "scalingPolicy": "forbidden",
        "orderLocked": true,
        "withheld": true
      },
      "historicNotes": [],
      "currentContext": [],
      "safety": {
        "sourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ],
        "redFlagPolicy": "global_stop",
        "pregnancy": "unknown",
        "breastfeeding": "unknown",
        "infantsToddlers": "unknown",
        "children": "unknown",
        "olderAdults": "unknown",
        "populationSourceIds": [],
        "allergenKeys": [],
        "allergenKeyBasis": "withheld_pending_review",
        "avoidConditions": [],
        "cautionConditions": [],
        "drugInteractions": [],
        "medicationCautions": [],
        "preparationBlocks": [],
        "preparationWarnings": [],
        "allergenReviewState": "partial",
        "allergenSourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ],
        "conditionReviewState": "partial",
        "conditionSourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ],
        "interactionReviewState": "pending",
        "interactionSourceIds": [],
        "preparationReviewState": "partial",
        "preparationSourceIds": [
          "nhc-adult-hyperlipidemia-guide-2023"
        ]
      },
      "audit": {
        "sourceCheckState": "checked",
        "sourceCheckedAt": "2026-08-11",
        "formulaReviewState": "pending",
        "medicalReviewState": "pending",
        "pharmacyReviewState": "pending",
        "complianceReviewState": "pending",
        "finalApprovedAt": null,
        "nextReviewAt": null,
        "releaseStage": "development_preview",
        "reviews": [],
        "note": "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。"
      }
    },
    {
      "id": "hypertension-liver-fire-appendix-celery-congee",
      "revision": "1.0.0-draft.1",
      "name": "芹菜粳米瘦肉粥",
      "status": "draft",
      "contentVersion": "2026.08-official-recipe.8",
      "rulesVersion": "1.6.0",
      "targetId": "adult_hypertension",
      "publicVisibility": "withheld",
      "formulaSourceId": "nhc-adult-hypertension-guide-2023",
      "safetySourceIds": [
        "nhc-adult-hypertension-guide-2023"
      ],
      "sourceIds": [
        "nhc-food-guides-notice-2023",
        "nhc-adult-hypertension-guide-2023"
      ],
      "sources": [
        {
          "id": "nhc-food-guides-notice-2023",
          "status": "published",
          "type": "official_notice",
          "title": "国家卫生健康委办公厅关于印发成人高脂血症食养指南（2023年版）等4项食养指南的通知",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "documentNo": "国卫办食品函〔2023〕5号",
          "url": "https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持三类成人食养指南的发布背景、适用定位和官方附件入口。"
        },
        {
          "id": "nhc-adult-hypertension-guide-2023",
          "status": "published",
          "type": "official_guide",
          "title": "成人高血压食养指南（2023年版）",
          "publisher": "中华人民共和国国家卫生健康委员会",
          "url": "https://www.nhc.gov.cn/cms-search/downFiles/63f752a17cfd4b4781f744477561866f.pdf",
          "publishedAt": "2023-01-18",
          "checkedAt": "2026-08-10",
          "scope": "支持高血压候选食养方属于不同中医证型附录；P3 不在未辨证时展示具体方案。"
        }
      ],
      "sourceLocator": {
        "documentNo": "国卫办食品函〔2023〕5号",
        "page": "第51页（PDF物理页第53页）",
        "section": "附录4 不同证型食养方举例 · 一、肝火上炎证",
        "recipeTitle": "（一）芹菜粳米瘦肉粥"
      },
      "sourceContext": {
        "text": "成人高血压肝火上炎证官方食养方资料",
        "diagnosticUse": "forbidden",
        "targetAgeGroups": [
          "adult"
        ]
      },
      "guideContext": {
        "title": "成人高血压食养指南（2023年版）",
        "edition": "2023年版",
        "section": "附录4 · 肝火上炎证",
        "page": "第51页（PDF物理页第53页）",
        "originalTarget": "面向成人高血压人群；本条仅对应指南中的肝火上炎证资料，有合并症者需在专业人员指导下参考。"
      },
      "audience": {
        "adultOnly": true,
        "diagnosisConfirmationRequired": true,
        "patternRequired": true,
        "patternConfirmationPolicy": "professional_confirmation_required",
        "allowedPatterns": [
          "肝火上炎证"
        ],
        "allowedTargetConditions": [
          "成人高血压",
          "高血压"
        ]
      },
      "bundle": {
        "atomic": true,
        "omissionPolicy": "forbidden",
        "substitutionPolicy": "forbidden",
        "scalingPolicy": "forbidden",
        "orderLocked": true,
        "withheld": true
      },
      "historicNotes": [],
      "currentContext": [],
      "safety": {
        "sourceIds": [
          "nhc-adult-hypertension-guide-2023"
        ],
        "redFlagPolicy": "global_stop",
        "pregnancy": "unknown",
        "breastfeeding": "unknown",
        "infantsToddlers": "unknown",
        "children": "unknown",
        "olderAdults": "unknown",
        "populationSourceIds": [],
        "allergenKeys": [],
        "allergenKeyBasis": "withheld_pending_review",
        "avoidConditions": [],
        "cautionConditions": [],
        "drugInteractions": [],
        "medicationCautions": [],
        "preparationBlocks": [],
        "preparationWarnings": [],
        "allergenReviewState": "partial",
        "allergenSourceIds": [
          "nhc-adult-hypertension-guide-2023"
        ],
        "conditionReviewState": "pending",
        "conditionSourceIds": [],
        "interactionReviewState": "pending",
        "interactionSourceIds": [],
        "preparationReviewState": "partial",
        "preparationSourceIds": [
          "nhc-adult-hypertension-guide-2023"
        ]
      },
      "audit": {
        "sourceCheckState": "checked",
        "sourceCheckedAt": "2026-08-11",
        "formulaReviewState": "pending",
        "medicalReviewState": "pending",
        "pharmacyReviewState": "pending",
        "complianceReviewState": "pending",
        "finalApprovedAt": null,
        "nextReviewAt": null,
        "releaseStage": "development_preview",
        "reviews": [],
        "note": "完整审校底稿未进入小程序上传包；当前只公开来源与发布门禁状态。"
      }
    }
  ],
  "count": 5
};
