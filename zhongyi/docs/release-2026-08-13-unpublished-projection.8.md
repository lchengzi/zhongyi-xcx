# `.8` 未发布整方严格公开投影自动验收记录

执行日期：2026-08-13  
Release：`release-2026.08.13-unpublished-projection.8`  
Manifest：`2026.08-manifest.8`  
Recipe schema/content：`1.1.0 / 2026.08-official-recipe.6`  
Rules：`1.4.0`

## 本次收口

- 未发布整方不再克隆完整底稿后删除已知敏感字段，而是从空对象开始建立严格 allowlist 公开投影。
- 顶层字段以及 `sources`、`sourceLocator`、`sourceContext`、`guideContext`、`audience`、`safety`、`audit` 等嵌套结构均逐层显式投影；未知顶层、嵌套、审校或未来私有字段不会随底稿对象进入公开包。
- 公开侧 `audit.reviews` 固定为空数组；未发布整方的材料、原始用量、步骤、食用方式、历史备注和当前语境仍不出包。
- 变异测试向整方、来源、定位、安全、审计及 `audit.reviews` 注入未知私有哨兵，构建结果必须完全找不到哨兵；5 条整方继续为 `draft / withheld`，可发布数保持 0。
- `.7` 及更早的 `.3/.4/.5/.6` release、清单和快照继续保留且不可覆盖；`.8` 使用新的内容与规则版本登记，不复用旧 ID。

## 自动验证结果

- `node tools/version-verify.js`：通过；活动 release 为 `.8`，12 件制品、快照和规则包摘要一致。
- `node tools/check-project.js`：通过；106 条目录、5 条整方、0 条可发布整方、0 条公开普通食品记录。
- `node tools/check-professional-review.js`：通过；当前 `p3-material-review.2` 包含 24 项材料与 5 项整方，2 项材料可进入人工审阅、0 项整方可进入下一阶段，submission 为 0，`approvalReady=false`、`publicationEligible=false`。
- `node tools/test-professional-review.js`：通过；33 个任务包变异用例通过，身份保证仍为 `unverified`，结果未应用。
- `npm test`：通过；包括来源候选的 50 个变异用例、未发布整方私有字段泄漏回归、专业审校包和版本回滚回归。
- 当前上传候选 56 个文件、305201 B；主包源码 257800 B；Wi-Fi 预下载源码 47401 B；catalog 分包 17849 B；official 分包 29552 B。

## 私有研究与审校包边界

普通食品来源研究层继续保留 `schemaVersion=1.2.0` / `contentVersion=2026.08.13-external-food-source-candidate.6`、7 条类别线索和 30 条逐域证据候选；72 个证据槽位仍全部 `ready=false`。这些私有候选不属于 12 件正式制品，不能自动改变材料、整方或发布状态。

当前任务包为 `p3-material-review.2`，摘要为 `sha256:f571f55e1d3e6467e8f8f29280f9baafa2bc92e3b36e6370a08a5a3f1c598dbe`。`p3-material-review.1` 绑定 `.7` 基线，保留为历史不可变任务包，不得覆盖、迁移或用于 `.8` 的当前签审。

## 仍未完成

本记录只证明工程门禁、公开投影、版本一致性和私有审校包结构通过自动验证，不代表专业内容审核完成。真人中医、药学、营养、合规与发布批准记录仍为空；微信开发者工具、真实 AppID、iOS/Android 真机和 P4 证据矩阵也仍未执行。因此当前可用于工程预览和内容审校，但正式发布结论继续为不通过。
