# 食材照片缺口升级研究线索

核对日期：2026-08-12。

2026-10-10 的[照片来源与加工形态筛选](source-photo-screening-2026-10-10.md)追溯地黄期刊图注与网站级许可、排除曾冷冻枸杞用于干果照片，并保存天冬根部图片链接及许可缺口。没有新的已目检像素，没有改写下列历史科研记录、批准图片或关闭三个缺口。

2026-10-08 的[独立追溯记录](source-refresh-2026-10-08.md)增加地黄 Commons 文件元数据线索，并记录一篇天冬论文暂不作为实物照片候选的依据。没有改写以下三条历史科研记录或关闭原缺口；新记录没有可审阅像素，不算视觉排除。

2026-10-09 的[天冬样品图筛选](tiandong-photo-screening-2026-10-09.md)另存一条2024年原始研究样品图线索和一条干燥研究宏观照片用途排除。原图像素、样品加工状态及部分许可条件仍待核对，以下历史目录与三个缺口不变。

同日新增[地黄蒸制形态图便笺](../content-private/research-refresh/2026-10-09-rehmannia-steam-photo-note.md)，定位2023年原始研究图2a及文章级许可。只有文字证据，没有完成看图审阅；它是私有人工线索，不是结构化候选或批准对象，以下历史目录和三个缺口保持不变。

这套工作流只保存“值得继续追溯、但尚不足以成为条目图片”的科研图线索。它不会替代 `content-private/media-candidates/food-forms/` 中枸杞子、地黄、天冬的三个明确缺口，也不会进入小程序包或正式版本制品。

## 当前三条线索

| 食材 | 研究线索 | 有用信息 | 仍不能使用的原因 |
| --- | --- | --- | --- |
| 枸杞子 | Frontiers 2018，Figure 5 | 原始研究纳入 51 份枸杞果实样品；部分样品有馆藏凭证，全部样品做了 HPTLC 身份复核 | Figure 5A 没有绑定单一样品号或馆藏号，研究又同时包含 `Lycium barbarum` 与 `L. chinense`；目录身份仍待复核 |
| 地黄 | MDPI 2022，Figure 1 | 原始栽培试验展示具名品种 Jinjiu 的成熟植株和鲜块根 | 未固定稳定原图 URL/摘要，未找到图像对应 voucher 或独立鉴定人，也不是食品或加工批次 |
| 天冬 | Frontiers 2022，Figure 1 | 综述复合图含地下部和文中所称 medicinal part | 尚未追到各子图原始来源、拍摄者、样品和 voucher；正文加工叙述不能反向证明子图加工状态 |

## 强制边界

- 每条记录必须保持 `doesNotCloseGap: true`、`publicationEligible: false`、空 `runtimePlacements`。
- 身份、部位与加工用途全部为 `prohibited`；权利与专业审核均为 `pending`。
- 只保存远端元数据，不下载、不热链图片。离线审阅页的 CSP 禁止脚本、图片和网络请求。
- 每条记录绑定当前材料摘要、原 food-form gap 摘要和规则版本；任一对象变化都会使生成清单失效。
- 独立批准快照锁定整条研究记录，不能通过“重算摘要”把另一篇论文或另一张图换进来。

## 命令与文件

```text
npm run build:media-drafts
node tools/check-food-form-gap-research.js
node tools/test-food-form-gap-research.js
```

源目录为 `content-private/media-candidates/food-form-gap-upgrades/`，包含研究目录、生成清单和静态离线审阅页。`content-private` 已被上传配置排除，这套私有研究数据也不在 12 件正式 release artifact 中。

下一步只能是继续追溯原始样品与图像证据：枸杞需要 Figure 5A 的单一样品/物种映射及目录身份复核；地黄需要稳定媒体、voucher/鉴定链和加工批次；天冬需要复合图各子图的原始来源及样品凭证。在这些条件满足前，三个原缺口必须保留。
