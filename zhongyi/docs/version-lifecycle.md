# P4 内容版本、撤回与回滚

核对日期：2026-08-13。本文约束本地内容制品，不代替代码仓库权限、人工专业审校或发布平台的版本管理。

## 1. 现有链路审计

P3 已具备两层完整性门禁：单条整方将材料、步骤、来源和审校记录绑定到摘要；每个可进入整方的材料还必须有中医、药学、合规三份独立记录，绑定当前目录版本、规则版本与材料摘要。`build-public-recipes.js` 会隐藏未达到发布条件的完整方案，`check-project.js` 会比较审核底稿与公开包。

P4 补齐的是跨文件发布身份：目录、整方底稿、公开整方、规则版本文件，以及 8 个实际执行红旗、画像归一化、筛选、材料/整方安全、三态展示、摘要与公开构建的规则文件，必须作为同一次发布的 12 件制品锁定，不能只登记一个规则版本字符串。

正式基线为：

| 字段 | 值 |
|---|---|
| Release ID | `release-2026.08.13-complete-public-projection.10` |
| Manifest | `2026.08-manifest.10` |
| Catalog schema / content | `1.2.0` / `2026.08-full-catalog.1` |
| Catalog 条目数 | 106 |
| Recipe schema / content | `1.1.0` / `2026.08-official-recipe.8` |
| Recipe 记录数 | 5（2 条无证型糖尿病草稿、3 条证型限定草稿），当前均未通过公开发布门禁 |
| Rule schema / content | `1.0.0` / `1.6.0` |
| Release 制品数 | 12（4 个带元数据模块 + 8 个原始规则文件） |

`.1` ID 是规则代码尚未纳入快照时产生的未发布初始化制品；`.2` 随后在终审中发现尚未锁定安全三态展示，也未完整阻止已撤回来源和无专业记录的正向人群声明。两者均在本地初始化阶段废弃、从未对外发布且未复用；`.3` 是首个同时绑定数据、实际规则代码和安全展示语义的工程基线。`.4` 首次登记 3 条证型限定审校草稿；随后复核发现归芪鸡汤做法中的“加水适量”尚未作为辅助材料行登记，因此保留 `.4` 的不可覆盖快照并以 `.5` 修正，未复用旧 release ID。`.6` 新增 18 条配方普通食品待审登记、统一材料解析、出现证据隔离、公开按需裁剪和旧 `1.0` 快照兼容检查。`.7` 进一步要求顶层、配方与外部食材的同 ID 来源对象完全一致，禁止把配方出现证据冒充身份依据，并对公开外部食材采用严格字段投影。`.8` 将未发布整方本身也改为从空对象开始的严格 allowlist 投影并清空公开侧 `audit.reviews`。`.9` 把严格投影扩展到公开制品根字段、全局来源、目标、整方及嵌套结构；复核随后发现 withheld bundle 的 `omissionPolicy`、`substitutionPolicy`、`scalingPolicy` 三个策略字段仍未独立执行类型门禁，因此 `.9` 已由 `notices.4` 中的生效替代公告指向 `.10`，`rollbackAllowed=false`。`.10` 对包括外部食材头部在内的整个公开整方制品从空对象执行字段与类型 allowlist，并补齐上述策略字段类型门禁。所有 5 条方案仍为隐藏草稿，可发布数仍为 0；`.3` 至 `.8` 保留为不可覆盖且可回滚的历史制品，`.9` 只保留为不可覆盖、不可回滚的历史证据。

## 2. 本地信任文件

- `data/version-manifest.json`：不可变 release 条目；保存 12 件制品的字节数、SHA-256、模块元数据、规则包摘要和快照摘要。同一 `rulesContentVersion` 不得对应两个不同规则包摘要。
- `data/version-notices.json`：撤回/替代公告登记。没有公告时也必须存在，不能用“文件缺失”表示没有撤回。
- `data/version-active.json`：当前选择的 release，并同时绑定 manifest 与公告登记的完整摘要、release 摘要和快照摘要；只改公告内容而不提升版本也会失败。
- `tools/version-snapshots/*.json`：目录、整方、公开包和匹配规则代码的 Base64 原字节快照；`tools` 已排除在小程序上传包之外。

清单的信任边界是受控代码仓库。SHA-256 能发现意外漂移、损坏及错选版本，但本地清单与制品被同一攻击者同时重写时不等同于数字签名；生产发布仍需仓库权限、评审记录和制品签名共同保护。

## 3. Fail-closed 规则

运行 `node tools/version-verify.js` 时，以下任一情况都以非零状态退出：

- manifest、公告登记或 active 状态缺失、字段未知、版本不匹配；
- 12 件制品任一 SHA-256、字节数或模块元数据不一致；
- 实际规则文件漂移、规则包摘要不一致，或同一规则版本号被登记到不同规则包；
- manifest 或撤回/替代登记内容被修改但 active 中的完整摘要未同步；
- 快照缺失、被修改、Base64 内容与清单摘要不一致；
- active release 已有生效撤回公告；
- active release 已被替代，但 active 状态仍是普通发布而非明确获准的回滚；
- 公告缺少 `content_owner` 与 `compliance` 两类批准，或替代关系成环；
- 回滚目标被撤回、release 自身禁止回滚，或替代公告明确 `rollbackAllowed: false`；
- 回滚后的恢复快照缺失或摘要不一致。

`data/version-notices.json` 当前为 `2026.08-notices.4`，含一条已生效替代公告：`.9` 被 `.10` 替代，且 `rollbackAllowed=false`。公告与 active 状态摘要均属于版本验证边界，不得删除或降回草稿以绕过门禁。

## 4. 撤回与替代公告

公告由人工决策后录入，程序不得根据网页不可访问、模型判断或一般医学推测自动发布公告。每次修改都要提升 `noticesVersion`，并重新生成/复核 active 状态。

撤回公告必须禁止回滚：

```json
{
  "id": "notice-withdraw-release-id",
  "type": "withdrawal",
  "state": "effective",
  "issuedAt": "2026-08-10T11:00:00+08:00",
  "effectiveAt": "2026-08-10T11:00:00+08:00",
  "releaseId": "release-id",
  "replacementReleaseId": null,
  "reason": "可追溯的撤回依据或决策摘要",
  "rollbackAllowed": false,
  "authorization": {
    "decisionId": "受控决策记录编号",
    "approvedBy": ["content_owner", "compliance"]
  }
}
```

替代公告必须明确旧版能否用于回滚。安全或法规问题通常应填 `false`；只有经过审批、确认旧版仍可安全恢复时才能填 `true`：

```json
{
  "id": "notice-replace-old-release",
  "type": "replacement",
  "state": "effective",
  "issuedAt": "2026-08-10T11:00:00+08:00",
  "effectiveAt": "2026-08-10T11:00:00+08:00",
  "releaseId": "old-release-id",
  "replacementReleaseId": "new-release-id",
  "reason": "可追溯的替代原因",
  "rollbackAllowed": false,
  "authorization": {
    "decisionId": "受控决策记录编号",
    "approvedBy": ["content_owner", "compliance"]
  }
}
```

若撤回的是当前 release，验证立即失败是预期行为。不得删除公告或将其改回草稿来恢复构建；应发布经审校的替代 release，或由批准人明确处理。

## 5. 构建与新版本登记

已锁定 release 的公开包使用以下入口；它会在构建前后分别校验版本：

```powershell
node tools/version-build.js
node tools/version-verify.js
```

`npm run build:recipes` 仍是底层生成器，适合准备尚未登记的新版本；它不是 P4 发布门禁。新版本顺序为：

1. 完成内容编辑、专业审校和原有 build/check/test。
2. 运行底层公开包生成器，确认审核底稿与公开包一致。
3. 捕获只写一次的候选快照：

   ```powershell
   node tools/version-snapshot.js capture --release release-id --label "版本说明" --created-at 2026-08-10T11:00:00+08:00
   ```

4. 将命令输出的 release 条目经复核后加入 manifest，并提升 `manifestVersion`。
5. 若替代旧版，将生效替代公告加入 notices 并提升 `noticesVersion`。
6. 经批准后更新 active 状态，最后运行 `version-verify.js`。验证未通过不得构建或发布。

快照命令拒绝覆盖同名文件；release ID 一经登记不得复用。
任何红旗、画像、筛选顺序、材料/整方安全门禁、摘要语义或公开构建规则变化，都必须提升 `data/rule-set.js` 的 `contentVersion`，重新取得与该规则版本绑定的专业审核。捕获工具会拒绝在既有 manifest 中把同一规则版本登记为另一套规则代码。

## 6. 可验证回滚

回滚分成只读计划和显式执行两步。计划会验证目标快照、公告和回滚资格，并产生绑定当前 release、manifest、公告及目标摘要的 `planDigest`：

```powershell
node tools/version-rollback.js plan --release target-release-id
```

确认输出后，必须逐字提供目标 ID 和计划摘要：

```powershell
node tools/version-rollback.js apply --release target-release-id `
  --confirm-release target-release-id `
  --confirm-plan sha256:计划输出的摘要
```

执行器只允许写 manifest 登记的 12 件固定内容/规则文件和 `data/version-active.json`。写入前会：

1. 再次计算计划并核对两项确认；
2. 在 `tools/version-recovery/` 保存当前 12 件文件及 active 状态；
3. 验证目标快照每个文件的字节数与摘要；
4. 使用同目录暂存文件与备份完成事务替换；
5. 对回滚后的整个工作区重新运行版本验证；失败时恢复原文件。

当前清单保留 `.3` 至 `.10` 八个不可覆盖 release，`.10` 为活动版本。`.3` 至 `.8` 是可验证的历史回滚目标；`.9` 因生效替代公告明确 `rollbackAllowed=false`，只能作为历史证据，回滚工具必须拒绝选择它。当前检查器对已登记的旧配方 schema 使用明确兼容分支，但仍拒绝未知 schema 和旧版伪发布。执行回滚前必须审查目标内容差异、公告状态，并提供工具生成的目标 ID 与计划摘要两项确认。工具会继续拒绝“回滚到当前版本”。

## 7. 定向验证

```powershell
node tools/version-test.js
node tools/version-verify.js
node tools/check-project.js
node tools/test-safety.js
node tools/test-recipes.js
```

`version-test.js` 在系统临时目录构造两个 release，覆盖：目录和实际规则代码未登记漂移、规则版本号复用、manifest/公告内容同版本篡改、公告清单缺失、生效替代、生效撤回、禁止回滚、确认摘要错误、快照篡改、事务回滚和恢复快照验证。测试不会改正式 data 文件。
