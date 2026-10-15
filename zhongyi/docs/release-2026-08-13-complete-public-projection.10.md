# `.10` 完整类型化公开投影自动验收记录

执行日期：2026-08-13  
Release：`release-2026.08.13-complete-public-projection.10`  
Manifest：`2026.08-manifest.10`  
Recipe schema/content：`1.1.0 / 2026.08-official-recipe.8`  
Rules：`1.6.0`  
Release 制品：12 件

## 本次收口

- 整个公开整方制品不再承接底稿对象，而是从空对象开始重建；根字段、全局 `sources`、`targets`、`recipes`、外部食材头部以及所有嵌套结构同时执行字段与类型 allowlist。
- 未发布整方的材料、原始用量、步骤、食用方式、历史备注和当前语境继续不出包，公开侧 `audit.reviews` 固定为空数组。
- `.9` 虽已扩大严格投影范围，但 withheld bundle 的 `omissionPolicy`、`substitutionPolicy`、`scalingPolicy` 三个策略字段未独立执行类型门禁。`2026.08-notices.4` 已登记 `.10` 对 `.9` 的生效替代，`rollbackAllowed=false`；`.9` 仅作为不可覆盖、不可回滚的历史证据保留。
- `.3` 至 `.8` 的 release、清单与快照保持不可覆盖，仍可在公告和两步确认门禁下作为历史回滚目标。

## 自动验证结果

- 活动版本为 `.10`，manifest、12 件制品、快照、公告摘要和规则包映射一致。
- 目录 106 条；整方草稿 5 条，其中 2 条无证型糖尿病方案、3 条须专业确认中医证型；可发布整方 0 条，公开普通食品记录 0 条。
- 页面 8 个、主包页面 5 个、普通分包 2 个。
- 上传候选 56 个文件、313828 B；主包源码 266427 B；Wi-Fi 预下载源码 47401 B；catalog 分包 17849 B；official 分包 29552 B。
- 当前私有任务包 `p3-material-review.4` 摘要为 `sha256:418ca21d2fab799480198738592bb73379a6a5a6765de323adf0fb0e8c5274d4`，绑定 `.10`：24 项材料、2 项可进入真人材料审阅、5 项整方、0 项可进入整方审阅、0 个 submission，`approvalReady=false`、`publicationEligible=false`。

## 私有研究与任务包边界

普通食品来源研究层继续保持 `schemaVersion=1.2.0` / `contentVersion=2026.08.13-external-food-source-candidate.6`：7 条类别线索、30 条逐域证据候选、18 个目标、72 个证据槽位、4 个目标级缺口，`ready=true` 数为 0。候选均为 `private / pending`，不属于正式 12 件制品，不能自动改变材料、整方或发布状态。

`p3-material-review.1/.2/.3` 均保留为历史不可变任务包；其中 `.3` 绑定已被替代且禁止回滚的 release `.9`。历史任务包不得覆盖、迁移或复用为当前 `.10` 的签审输入。

## 仍未完成

本记录只证明工程门禁、公开投影、版本一致性、上传隔离和私有任务包结构通过自动验证。当前没有真人中医、药学、营养、合规或发布批准；微信开发者工具、真实 AppID、iOS/Android 真机及 P4 证据矩阵也未执行。因此项目可用于工程预览与内容审校，但正式发布结论仍为不通过。
