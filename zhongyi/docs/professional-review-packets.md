# P3 私有专业审校任务包

核对日期：2026-08-13。

本工作流把当前正式版本中的材料与固定食养方投影为摘要绑定的离线任务包，帮助真实专业人员看到需要核对的内容、直接来源、证据缺口和技术阻断。它只解决“把工程底稿交给真人审阅”的可追溯性，不负责证明真人身份、执业资质或电子签名，也不会修改任何 `reviewed`、`published` 或运行时数据。

## 当前任务包

- 任务包：`p3-material-review.4`
- 来源版本：`release-2026.08.13-complete-public-projection.10` / `2026.08-manifest.10`
- 整方 schema / 内容版本：`1.1.0` / `2026.08-official-recipe.8`
- 规则版本：`1.6.0`
- 任务包摘要：`sha256:418ca21d2fab799480198738592bb73379a6a5a6765de323adf0fb0e8c5274d4`
- 范围：24 项材料，其中 6 项来自 106 条食药物质目录，18 项为配方普通食品登记；另有 5 项整方任务。
- 当前仅黄芪、党参 2 项证据域已达到“可进入材料人工审阅”；这不表示已审校、已批准或可发布。
- 其余 22 项材料仍有直接证据缺口；5 项整方均受材料前置或技术门禁阻断，可进入整方人工审阅数为 0，可发布数为 0。
- 当前 submission 为 0，`approvalReady=false`、`publicationEligible=false`。
- 审阅窗口为 `2026-08-12T19:31:30Z` 至 `2026-11-10T19:31:30Z`。窗口到期、内容/规则/摘要变化或正式版本切换都会使当前任务包失效。

## 私有制品

目录 `content-private/review-packets/p3-material-review.4/` 只允许四个文件：

- `manifest.json`：24 项材料和 5 项整方的摘要输入、来源、用途、前置任务及技术阻断。
- `review-index.html`：无脚本、无表单、无网络请求的只读离线索引；不采集审阅意见。
- `reviewer-registry.json`：仅允许不可从个人信息推导的随机 reviewer 引用，以及外部资质/机构证据的受控引用。
- `review-results.json`：只保存结构化声明、受控发现码和不透明证据引用；当前为空。

整个 `content-private` 已从微信上传包排除，任务包也不属于正式版本的 12 件制品。回滚只恢复正式制品，不替换审校包；因此回滚或切换版本后，旧包会校验失败，必须归档并为新版本生成新的任务包，而不是重写已有人工记录。

`p3-material-review.1`、`p3-material-review.2`、`p3-material-review.3` 分别绑定旧基线，现均作为历史不可变任务包保留；其中 `.3` 绑定已被 `.10` 替代且禁止回滚的 release `.9`。这些目录不得被覆盖、迁移或用于当前 `.10` 的签审；当前工作只能进入 `.4` 槽位。

## 命令

```powershell
npm run build:professional-review
node tools/check-professional-review.js
node tools/test-professional-review.js
node tools/validate-professional-review.js
```

`build:professional-review` 会先验证活动正式版本，再生成任务包、只读索引和空模板，最后执行 advisory 校验。若固定槽已经包含人工 reviewer 或 submission，且版本或摘要发生变化，生成器会拒绝覆盖并要求归档和分配新的 packet ID；陌生、畸形或旧式空文件也不会被静默覆盖。

生成器在固定槽内使用排他锁。三份 JSON 只允许在全空槽中以 `wx` 排他方式首次创建；一旦齐全，后续构建只验证、不重写。出现部分初始化、版本或摘要漂移、任一文件被抢先创建时均失败关闭，并要求归档后使用新的 packet ID。因此任务包生成后应将目录视为不可变工作槽；外部人工录入须使用独立的受控写入和备份流程，不能通过重新运行构建器重置记录。

对 `.3/.4/.5` 历史版本回滚时，尚无统一登记 ID 的普通食材会被投影为 `legacy_unregistered` 材料任务，固定带有 `legacy_material_registry_missing` 及四域证据阻断，绝不会被猜测映射或视为可审材料；`.6` 起使用正式的 external food registry。`.3` 至 `.8` 的历史 release、清单与快照均继续保留且不可覆盖、可按公告门禁回滚；`.9` 仅保留不可覆盖且不可回滚的历史证据。历史快照回归会逐个验证这些 fail-closed 投影。

## 信任与隐私边界

- 仓库只验证 JSON 结构、引用、角色路由、时间、版本、摘要、前置顺序和 reviewer 引用是否不同。
- `reviewerRef` 必须由外部受控流程随机分配，不得由姓名、邮箱、手机号、证件号或执业证号做裸哈希。
- 不得在仓库存放姓名、证件号、执业证原文、联系方式、签名图片、自由文本病史、密钥或可反推个人身份的数据。
- `credentialEvidenceRef`、`organizationEvidenceRef`、`evidenceRefs` 只能使用 `evidence:opaque:<随机令牌>` 形式的外部权限系统引用；不得把文件路径、URL、姓名、机构名或证件内容编码进引用，仓库也不把这些令牌解释为真实有效资质。
- 本地结果固定标记 `identityAssurance: unverified`、`authorizationVerified: false`、`approvalReady: false`、`publicationEligible: false`、`applied: false`，且 `advisoryPatchPlan` 必须为空。
- 不同 reviewer 引用只能证明“引用不同”，不能证明真人相互独立；可信身份、资质状态、撤销检查和加密签名必须由独立的外部机构流程完成。

## 审校顺序

1. 先补齐材料身份、法规、食用形态/用途和安全四域的直接来源，配方中的“出现证据”不能冒充这些直接证据。
2. 无证据阻断的材料才可由中医临床、药师、合规三个角色分别提交结构化建议。
3. 每个整方必须等待它实际引用的全部材料都形成完整声明，且消除摘要漂移、证型门禁、法规用途冲突等技术阻断。
4. 整方的中医临床、药师、营养、合规角色先完成，发布批准角色只能最后提交且时间必须严格晚于其他角色。
5. 即使本地声明在结构和顺序上完整，也仍不能自动回填数据。只有外部可信身份与签名验证完成后，才可由受控人工流程制作并复核变更；本工具不会自动应用。

当前任务包是审校准备工具，不是审批系统，更不是医疗机构身份、电子签名或处方审方系统。
