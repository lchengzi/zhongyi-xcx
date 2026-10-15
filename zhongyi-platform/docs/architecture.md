# 工程架构与数据关系

当前用户端重构位于 `apps/miniprogram`（Taro + React + TypeScript），纯TS核心位于 `packages/catalog-core`，原生 `zhongyi` 保留为基线。内容工作台为 `zhongyi-platform/web`（React + TS + Vite），API为同项目 `server`（Express + TS），关系仓储支持SQLite/PostgreSQL。小程序负责匿名教育浏览与本地安全规则，工作台负责私有内容治理；不把待审草稿、后台账号或健康会话混入公开接口。这是本机可复现、仍待完整交付的全栈工程，不代表上线、跨手机系统验收或医学审校。最新范围与逐轮证据以工作区根 `REFACTOR_PLAN.md` / `REFACTOR_STATUS.md` 为准。

## 运行边界与数据流

2026-10-12新增[私有真实照片预览及核对记录](private-photo-preview.md)：独立TS私有协议 → 显式清单/原图SHA-256绑定 → 账号只读原图API；另经具名意见/固定版本送审API → SQLite/PostgreSQL不可变历史 → React页签表单/冲突与未知结果核对。图片库不挂静态目录、不进入小程序依赖；13张既有原图/12种食材只在隔离账号页面本地验证。意见和送审均不等于专业批准；权利/专业签审、脱敏衍生图、独立图片批准与公开版本治理仍是后续交付。

```text
受验证原生 release ──→ 构建公开TS目录/基础发布绑定
         │                    ↓
         │          Taro + React + TS 微信用户端
         │            ├─ catalog-core → 本地目录/确定性安全规则
         │            ├─ 平台适配 → 收藏/对比/会话/导航
         │            └─ 固定匿名GET → 严格教育协议 → 分层补充资料
         │                         ↑
         │              /api/v1/public/education/:id（默认停用）
         ↓                         ↑
受控seed → SQL历史目录       独立发布的固定有效快照
                                   ↑
React + TypeScript 工作台           │
  └─ 同源 HTTP + Cookie/CSRF → Express API
                                ├─ 目录与备注仓储
                                ├─ 账号与会话仓储
                                ├─ 私有协作/专业意见/来源核验仓储
                                ├─ 固定发布治理仓储 → 默认关闭的教育 GET
                                └─ 可选辅助工具仓储
                                         ↓
                            SQLite 或 PostgreSQL 二选一
```

默认使用 SQLite，适合本地单进程演示；当前 Node 22 的 `node:sqlite` 仍为实验性 API。显式选择 PostgreSQL 后，整个仓储组合使用同一 schema，事务通过专用连接执行，不另开 SQLite 保存账号。初始化或版本检查失败即拒绝启动，不自动切库或修复数据。服务端秘密不进入 React 构建或小程序。

新用户端已接入固定教育GET的类型化请求客户端和微信传输适配，但构建公开地址仍为null、不会联网。内置106条历史目录与安全规则不被教育响应覆盖；内存阅读缓存默认最多60秒或更早的来源有效期。身份/协议错误、失效来源及404清除旧在线资料；离线不承诺即时撤回。请求不传搜索记录、过敏、疾病、用药或健康问项。旧原生端的可选历史目录GET保留为另一条链路，不与新协议混称。后台Cookie登录不属于小程序浏览前提；真实微信联网、手机、大字体和完整离线仍待验收，配置步骤见工作区根 `docs/mini-public-content-deployment.md`。

应用依赖只指向允许公开的纯TS核心；管理响应和数据库记录保持独立，不把管理端共享模块直接打入小程序。草稿/来源/编辑审阅的运行时响应边界见[内容工作流](workflow.md#管理端响应边界2026-10-11)，其余管理端泛型请求仍须逐步迁移，不能用TS编译代替数据检查。

## 数据关系

当前 SQLite v10 / PostgreSQL v8 有30张业务表，按职责分为六组。SQLite自身内部表不计入；PostgreSQL另有`postgres_migrations`和`migration_runs`两张历史表。发布四表已接入迁移、恢复、应用API和React管理页面；图片核对与送审表已接仓储/迁移/备份及独立HTTP和React表单，具体逐轮验收见根状态，不混淆数据层与界面证据。

| 分组 | 表 | 主要职责 |
| --- | --- | --- |
| 目录与账户 9 表 | `migrations`、`ingredients`、`metadata`、`editorial_notes`、`audit_events`、`users`、`sessions`、`login_attempts`、`security_events` | 目录投影、备注修订、身份/会话、限流及操作记录 |
| 编辑协作 7 表 | `source_records`、`source_versions`、`content_revisions`、`revision_sources`、`content_drafts`、`review_tasks`、`workflow_events` | 来源/正文固定历史、引用、当前头、独立编辑审阅 |
| 辅助治理 5 表 | `editorial_excerpts`、`assistant_events`、`excerpt_permissions`、`assistant_quota_days`、`assistant_reservations` | 固定原文、许可修订、数据库额度与调用终态元数据 |
| 专业和查证 3 表 | `professional_qualifications`、`professional_reviews`、`source_checks` | 资格依据、固定版本专业意见、来源范围及查证期限 |
| 发布治理 4 表 | `publication_snapshots`、`publication_approvals`、`publication_events`、`publication_controls` | 固定依据、独立批准、发布指针历史、冻结批次；API 与 React 管理操作已接入 |
| 私有图片治理 2 表 | `photo_notes`、`photo_submissions` | 不可变候选/原图/来源摘要、具名意见与固定意见引用的送审说明；账号修订及双头乐观版本；不是身份、加工、权利或专业批准，不改变pending状态 |

核心关系如下；箭头表示业务关联，其中固定正文、来源和资格使用复合外键绑定具体版本，而非只绑定当前头。

```text
users ──→ sessions
  ├─────→ source_versions ←── source_records 当前头
  ├─────→ content_revisions ←── content_drafts 当前头
  └─────→ professional_qualifications

ingredients ──→ editorial_notes + audit_events
  └───────────→ content_revisions
                    ├─ revision_sources ──→ source_versions
                    ├─ review_tasks
                    └─ professional_reviews ──→ 固定资格修订

source_versions ──→ source_checks（食材范围/信息域保存在核验记录中）
      └───────────→ editorial_excerpts ──→ excerpt_permissions

assistant_reservations ──→ 固定原文摘要和许可修订
      └─ 按 UTC 日期/账号计数，与 assistant_quota_days 配套

content_revisions ──→ publication_snapshots ──→ publication_approvals
ingredients ───────→ publication_events ─────→ 固定快照和批准版本
publication_controls ──→ 冻结批次由应用逐项核对，不是 epoch 外键
```

来源核验范围存为受严格校验的 JSON 文本，不是额外的食材联结表；API 写入及迁移/恢复逐项校验范围中的食材 ID。不要把此关联描述为数据库对每个 JSON 元素均建立了外键。

## 一次真实管理操作

以来源核验为例：React 读取固定来源与全局核验版本，人工填写范围与依据，再携带 `expectedVersion` 发起请求。API 验证账号、Origin、CSRF、精确字段和长度；写事务取得权限与版本的最新状态，检查来源整理者不能自核，再追加不可变记录。成功返回新历史与状态，页面更新并清空确认项；失败保留输入，并发旧版本返回 409。核验记录不修改正文或公开目录。

发布前检查在读取事务内汇总固定正文、编辑状态、专业意见和来源效力，只返回条件与缺口；`readyForReleaseApproval=true`不授予发布权限。固定快照、独立批准、撤回、历史回滚和冻结已接入SQL历史校验、恢复、管理API与React页面。即使显式启用公开能力，仍须当前有效的独立批准和明确发布；管理视图不泄露他人资格依据，工程模拟身份不是真人签审。请求未知结果须先读取核对，不自动重发写入。

不同范围的实际证据分别见[发布链路](publication-lifecycle.md)、[双库编译HTTPS](https-runtime.md)、[数据库TLS](postgres-transport-security.md)、[运行角色权限](postgres-runtime-permissions.md)、[业务备份恢复](backup-recovery.md)和根状态记录。后续已补充真实PG连接TLS/权限与新TS客户端恢复联动，不能再沿用早期“数据库TLS完全未验”的结论；这些仍是本机隔离验证，公网部署、容器引擎、远程CI、微信实际联网和手机各自待验。不将不同轮次的测试数字相加成同一部署验收。

## 关键取舍与证明范围

- 新微信用户端采用Taro/React/TS，原生项目保留回退；React同样用于真实内容协作。Taro构建与部分微信模拟器流程已有证据，不能把潜在H5/App能力或桌面窄视口当成安卓/iOS/鸿蒙设备交付。
- 共享业务契约和两套关系型仓储，不假装 SQLite 与 PostgreSQL 完全相同。PostgreSQL 使用只读可重复读事务和 schema 级写锁，适合当前低写入量工作台；没有高并发吞吐实测。
- `expectedRevision/expectedLockVersion/expectedVersion` 防止静默覆盖；历史摘要保证固定关系完整性，不是真人签名或专业背书。数据库历史触发器不抵抗有 DDL 权限者。
- 安全规则采用确定性实现。可选模型只处理已登记来源的编辑辅助，默认关闭；离线契约测试不是模型准确率或真实费用评测。
- 加密业务恢复验证全部已知表、历史及序列，随后撤销旧会话；v6 结构再追加新发布冻结批次并核对其余数据不变。它不覆盖 WAL、集群配置、异地灾备或自动切流。

对应证据入口见 [README](../README.md)、[权限](authentication.md)、[内容协作](workflow.md)、[来源核验](source-verification.md)、[迁移](postgres-migration.md)、[恢复](backup-recovery.md) 和 [CI](continuous-integration.md)。[独立本地演示](local-demo.md) 提供不依赖 Docker 的复演入口，固定关闭 AI/教育发布并使用新库；真实 React 协作和 CLI 进程重启已验证。本机测试、远程 CI、容器、公网 HTTPS、专业审校和微信真机必须分别讲解。求职时还应区分 AI 协助实现与个人已能独立解释、修改的部分，不编造用户量、性能或上线经历。
