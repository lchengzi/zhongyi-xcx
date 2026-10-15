# 固定教育内容发布 API 契约

这些接口管理固定教育内容的快照、独立批准、发布事件和全局冻结，不提供诊断、处方、照片或整方发布。React 入口为“内容协作 → 固定版本发布”。服务端公开能力默认关闭；接口已实现不代表工作内容已公开，实际验收范围见 [发布治理记录](publication-lifecycle.md)。

## 登录与请求边界

管理接口统一位于 `/api/v1/editorial`，要求有效账号 Cookie；本地编辑密钥不能操作。POST 另需允许的精确 `Origin`、当前会话的 `X-CSRF-Token` 和 `Content-Type: application/json`。会话恢复、撤销和登录限流见 [账号说明](authentication.md)。

管理接口只接受 GET 与 POST，不接受查询参数，GET 不接受正文。POST 必须只包含对应契约中的字段，不能额外提交 `force`、跳过审校或用户健康资料。内部内容协作请求上限为 32 KiB。食材和快照路径标识只接受小写字母、数字及连字符，长度不超过 80；历史版本必须是规范的正安全整数，不接受 `01`、`1e1` 或小数形式。

所有操作说明 `comment` 必须非空，最多 1000 字；`confirmed` 必须为布尔值 `true`。冻结依据编号最多 200 字。摘要格式为 `sha256:` 加 64 位小写十六进制，且必须使用最新读取的实际值。版本字段不使用客户端时间戳，也不能通过任意加一来规避冲突。

## 读取接口

| GET 路径 | 权限 | 成功响应 |
| --- | --- | --- |
| `/publications/:id` | 管理员、编辑、审阅 | `PublicationWorkspaceView`；最近 20 个快照及当前有效公开快照 |
| `/publications/:id/versions/:version` | 同上 | 相同工作区，额外包含指定旧快照及其最新批准；不存在返回 404 |
| `/publications/:id/snapshots/:snapshotId` | 同上 | 此食材的单个 `PublicationSnapshotView`；不返回其他食材的快照 |
| `/publication-controls` | 仅管理员 | `{enabled, items}`，`items` 为最近 20 条冻结/恢复记录，最新在前 |

工作区包含 `ingredientId`、`preflight`、`basisDigest`、`snapshots`、`approvals`、`events`、`eventVersion`、`control`、`enabled`、`activeSnapshotId` 和 `blockedReasons`。`basisDigest=null` 表示当前资料条件不足，不能生成新快照；资料齐备并不等于已批准或已发布。事件窗口为最近 20 条，显示窗口不限制服务端完整历史校验。

`enabled` 仅表示服务端显式开启了这类公开能力，不代表每个条目可公开。只有 `activeSnapshotId` 指向当前有效的发布快照；冻结、撤回、资格/来源失效或撤权都可能让它为空。客户端应分别展示开关、冻结、有效快照与阻断原因，不能只用顶部写死的“已发布”或“未启用”。

快照 HTTP 视图只包含资格摘要：`userId`、`revision`、`accountRevision`、`profession`、`status`、`evidenceKind`、`validUntil`、`digest`。他人的资格依据编号、核验备注和核验人信息不随资格摘要返回。快照摘要绑定服务端完整记录，不是删减视图的散列；不能对 HTTP 摘要视图重算散列并声称验证了完整快照。完整类型见 [共享契约](../shared/contracts.ts)。

## 写入接口与版本来源

成功写入返回 201 及新增的不可变记录。随后仍须重新读取工作区，不把 POST 响应或按钮状态当作持续有效的公开许可。

| POST 路径 | 权限与条件 | 成功响应 |
| --- | --- | --- |
| `/publications/:id/snapshots` | 管理员或编辑；当前资料与固定摘要匹配 | `PublicationSnapshotView`，不批准、不发布 |
| `/publications/:id/approvals` | 仅管理员；批准时还须未参与该条目编辑、审校、来源或快照整理 | `PublicationApproval`，批准或撤销均追加版本 |
| `/publications/:id/actions` | 仅管理员；发布/回滚须能力启用及全部依据当前有效 | `PublicationEvent`，不覆盖正文或历史目录 |
| `/publication-controls` | 仅管理员；明确填写全局影响与恢复核对依据 | `PublicationControl`，不自动恢复旧内容 |

下面四段 JSON 只展示字段结构，零摘要、示例编号和版本不能作为实际提交依据；它们不表示真实专业意见、批准或恢复核对。实际操作必须读取当前工作区、核对固定内容及人员/来源后再构造请求。测试仅校验这些示例的输入结构，不执行发布。

生成快照使用工作区的 `basisDigest`：

```json
{
  "expectedBasisDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "comment": "示例结构，不代表已完成内容核对。",
  "confirmed": true
}
```

批准或撤销批准使用快照的 `id`、`digest`，该快照最近批准的 `version`（没有则为 0），以及工作区 `control.version`（没有则为 0）。`decision` 只接受 `approve` 或 `revoke`：

```json
{
  "snapshotId": "snapshot-id-from-workspace",
  "snapshotDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "expectedApprovalVersion": 0,
  "expectedControlVersion": 1,
  "decision": "approve",
  "comment": "示例结构，不是实际独立批准。",
  "confirmed": true
}
```

发布事件使用工作区 `eventVersion` 和 `control.version`，不是快照版本或正文修订。`action` 只接受 `publish`、`withdraw` 或 `rollback`：

```json
{
  "snapshotId": "snapshot-id-from-workspace",
  "action": "publish",
  "expectedVersion": 0,
  "expectedControlVersion": 1,
  "comment": "示例结构，不授予公开内容权限。",
  "confirmed": true
}
```

冻结/恢复使用最近冻结记录的 `version`（没有则为 0），影响所有食材，不是当前所选条目。`action` 只接受 `freeze` 或 `resume`：

```json
{
  "action": "resume",
  "expectedVersion": 0,
  "evidenceReference": "EXAMPLE_NOT_REAL_VERIFICATION",
  "comment": "示例结构，不是实际恢复核对。",
  "confirmed": true
}
```

生成快照不需要开启公开能力；批准本身不公开内容，且要求当前已恢复发布操作。相同依据不能重复生成快照，同一有效批准不能重复提交，已是当前有效版本的发布也不能重复记录。接口没有自动幂等重试协议；不能把任意失败当作安全重试许可。

撤回可在开关关闭、冻结或依据失效时进行，但只能撤回最新发布指针；已经撤回不能再次撤回。撤回后的快照必须重新批准，再明确发布或回滚。回滚目标必须曾发布过且当前仍具备有效批准、资格和来源；选择旧版本不是绕过审校。

冻结创建新的授权批次，恢复沿用该批次，不自动恢复旧批准。迁移/备份恢复追加的新冻结及会话撤销须单独核对；恢复前还要检查备份之后发生的撤权和专业意见撤销。

## 匿名教育接口

`GET /api/v1/public/education/:id` 不要求登录，只接受规范的精确 GET 路径，不接受查询参数、正文、子路径或公开写操作。服务端默认 `EDUCATION_PUBLICATION_ENABLED=false`；只有 accounts 模式可显式开启，React 不能修改该开关。工作环境不能为演示而无审校地开启。

成功响应仅包含 `scope`、`ingredientId`、`name`、`snapshotId`、`snapshotVersion`、`contentRevision`、`baseReleaseId`、`publishedAt`、`ediblePart`、`latinName`、`educationText`、`safetyText`、`sources` 和 `boundary`。来源仅有 `title`、`publisher`、`url`、`locator`、`checkedAt`、`validUntil`；不返回资格、账号、操作者、内部批注、私有依据编号或完整审校历史。

每次读取都重新检查固定依据、当前授权和正式历史目录身份。开关关闭返回 503 `publication_disabled`；没有有效指针、冻结、撤回或依据失效返回不泄露内部原因的 404 `not_found`；目录漂移或历史损坏返回 503 `education_unavailable`。响应使用 `Cache-Control: no-store`，不能缓存旧内容来绕过撤销。

该接口不替换 `/api/v1/public/catalog`，也尚未接入微信小程序。现有小程序继续使用受控历史目录与离线回退，不上传搜索或健康问项；旧目录不能因此标为今日最新。

## 错误处理与前端恢复

| HTTP 状态 | 典型情形 | 客户端处理 |
| --- | --- | --- |
| 400 | 字段、摘要格式、确认项、版本或查询无效 | 保留输入，修正请求；不能添加绕过参数 |
| 401 | 会话过期或服务端撤权 | 保留未保存输入，重新登录并读取权限与版本 |
| 403 | Origin/CSRF、角色或参与者自批失败 | 保留输入，核对账号与权限，不换参数重试自批 |
| 404 | 食材/快照不存在，或匿名内容无当前有效发布 | 不显示私有历史或推断“安全可食” |
| 409 | 版本冲突、重复操作、冻结、依据失效或非法状态转换 | 重新读取工作区，人工复核后再构造请求 |
| 413 | 正文超过上限 | 缩减请求；不拆分一次批准为部分写入 |
| 500/503 或断网 | 内部错误或服务不可用 | 保留输入，明确结果未确认；不自动重复写入 |

如果 POST 已成功而紧接着 GET 失败，应明确显示“操作已记录，但状态刷新失败”；如果没有收到明确 POST 结果，则不能声称服务器没有写入。React 在这两种情况下都停止继续提交、保留输入，要求重新读取最新状态。权限与版本检查仍在服务端写事务内执行，不能用禁用按钮代替。

## 复现与证据

`npm.cmd run typecheck:publication-tests` 严格检查共用接口用例及 SQLite/PostgreSQL 入口。`node --import tsx --test tests/publication-http.test.ts` 运行配置、SQLite 共用接口及测试身份防误判检查。新增 `npm.cmd run test:postgres:publication` 通过自有控制器单独运行真实 PostgreSQL 的全部 7 组共用发布 HTTP 用例，不编译或改写 `build/`；`npm.cmd run ci:postgres` 仍是包括迁移、恢复、运行与重启在内的完整数据库验收，二者不能互相替代。

共用用例源位于 [接口行为用例](../tests/publication-http-cases.ts)，两种真实仓储的隔离构造位于 [测试夹具](../tests/publication-http-fixture.ts)。PostgreSQL 分支必须实际迁移到全新测试 schema 并打开 PostgreSQL 仓储；引擎标签检查本身不是数据库通过证据。专项入口有独立集群、随机端口和自有报告，限定 `scope=publication-http`，不读取工作库、不修改旧数据库轮次或其报告，也不是对遗留完整轮次的重启或替代。

专项报告写入 `.local/postgres-publication-http-test-results.latest.json` 和该集群目录的 `result.json`。只有本轮所有 7 项通过、零失败/跳过/取消、控制器正常退出且 `fixtureStopped=true` 才能记为完成；停机观察到期仍继续等待同一自有进程，不强停、不重复请求或重启。完整 CI 会拒绝该专项范围，不能凭它宣称备份恢复、数据库重启、PostgreSQL 页面或部署通过。实际轮次与限制见 [发布治理验收](publication-lifecycle.md)。
