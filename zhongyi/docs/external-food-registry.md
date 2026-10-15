# 配方普通食品材料登记

核对日期：2026-08-11。本登记只解决“官方整方中的每一行材料必须有稳定 ID”这一工程问题，不代表材料已经完成食品身份、法规、过敏、相互作用或加工安全审校。

## 当前范围

- 官方食药物质目录仍为独立的 106 条，未因配方材料而扩充或改名。
- `data/recipes.js` 内嵌 18 条 `external_food` 待审记录，覆盖 5 个整方中的 24 条普通食品材料行。
- 同一个稳定形态可以复用记录，例如四个方中的食盐和四个方中的水；形态或含义不同的记录保持分离，例如母鸡/鸡肉、葱/葱花、粳米/粳米粉、泛称油/香油。
- 全部 18 条的身份、法规、食用形态和安全字段仍为 `pending / unknown`，专业签审为空；因此 5 个整方的可发布数仍为 0。
- 当前公开索引中的 `externalFoods.items` 必须为空。只有真正通过完整发布门禁的整方所引用、且已独立审校的记录，才允许按需裁剪进入公开包。

## 18 条待审记录

| 稳定 ID | 来源名称/形态边界 |
| --- | --- |
| `external-food-black-bean` | 黑豆；原文写泡发，具体食品身份待核 |
| `external-food-salt` | 食盐及原文“盐”；按各方原量分别绑定 |
| `external-food-whole-hen` | 整只母鸡；不得与鸡肉块合并 |
| `external-food-scallion` | 葱；原文未细分部位 |
| `external-food-cooking-wine` | 料酒；原文未给品类或酒精度 |
| `external-food-chicken-meat` | 鸡肉块；不得与整只母鸡合并 |
| `external-food-water-unspecified` | 方中所写水/清水；来源标准待核，未给量时保持未给量 |
| `external-food-goji-leaf` | 枸杞叶；不得与目录中的枸杞子合并 |
| `external-food-glutinous-rice-flour` | 糯米粉 |
| `external-food-japonica-rice-flour` | 粳米粉；不得与粳米粒合并 |
| `external-food-egg-liquid` | 鸡蛋液；对应原文搅匀后的形态 |
| `external-food-cooking-oil-unspecified` | 原文只写“油”；不得猜测具体油种 |
| `external-food-chopped-scallion` | 葱花；与未说明切制的葱分开 |
| `external-food-soy-sauce` | 酱油；原文未给具体品类或配料 |
| `external-food-sesame-oil` | 香油；不得仅凭名称反向认定为目录黑芝麻 |
| `external-food-celery` | 芹菜；原文未细分部位 |
| `external-food-japonica-rice` | 粳米粒；与粳米粉分开 |
| `external-food-lean-pork` | 猪瘦肉，制作时成为肉末 |

## 证据与发布门禁

官方食养指南目前只证明某个来源名称、原始量和处理文字在特定整方材料行中出现。每一条 `occurrenceEvidence` 必须与 `foodId + recipeId + lineId` 一一对应，且来源同时出现在该行的内容来源和用量来源中。

“方中出现”来源不能充当普通食品身份、法规、常见食用形态或安全结论的直接依据。四类直接来源必须另行取得、处于已发布状态，并与出现来源完全分离。把指南 ID 复制进直接来源字段会被静态检查、运行时门禁和公开构建器共同拒绝。

材料完成审校时，至少需要中医临床、药师、合规三个独立角色的结构化记录，绑定普通食品登记版本、当前规则版本和材料摘要。公开构建按已发布整方实际引用进行 allowlist 裁剪，不会把未发布方的材料行、出现证据或审校备注带入小程序包。

这些门禁不替代真人审校。开发者不得为了消除 `external_food_not_reviewed` 而批量把状态改成 `reviewed`、复用同一个审核 ID，或把官方配方页冒充食品身份与安全来源。
