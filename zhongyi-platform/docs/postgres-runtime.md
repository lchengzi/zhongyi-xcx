# PostgreSQL 业务运行模式

## 范围

目录、备注、账号/会话/限流、私有来源、内容修订、审阅任务、专业资格核验/固定意见、来源核验、只读发布前检查、原文摘录、辅助调用元数据、许可历史及持久化额度已提供真正异步的 PostgreSQL 实现。React 使用同一套 Express API，无需替换前端或向浏览器提供数据库凭据。

默认仍为 SQLite 本地模式。选择 PostgreSQL 后，所有业务仓储使用同一个 PostgreSQL schema，不另开 SQLite 账号库或备注库；初始化、连接或版本校验失败时拒绝启动，不悄悄回退。没有切换真实工作库，也没有因此启用内容发布、HTTPS 公网服务或微信真机联网。

## 启动与切换

1. 准备独立 PostgreSQL 数据库与受控凭据，将 `DATABASE_URL` 放入终端环境或部署密钥配置，不放在命令行参数、源码或截图中。
2. 备份 SQLite 源库，在明确的切换窗口停止旧库写入；按 [迁移说明](postgres-migration.md) 迁移到全新 schema，并先执行提交核验。
3. 明确选择业务运行库：

```powershell
$env:DATABASE_PROVIDER = 'postgres'
$env:DATABASE_SCHEMA = 'food_education'
npm.cmd run build
npm.cmd start
```

`DATABASE_URL` 和 `DATABASE_SCHEMA` 缺一不可。应用不自动读取 `.env`。`DB_PATH` 在 PostgreSQL 模式不用于打开或创建 SQLite 文件；仅配置 `DATABASE_URL` 而不选择 `DATABASE_PROVIDER=postgres` 不会切换业务库。

原管理员、密码散列及尚未到期的会话随迁移保留，不要重复初始化已有账号。若迁移源库本来没有账号，可在相同 PostgreSQL 环境配置下运行 `npm.cmd run account:bootstrap -- your-admin-name`，仅允许创建第一个管理员，不重置已有账号。

默认仍只监听 `127.0.0.1`。生产模式要求正式账号、Secure Cookie、明确HTTPS来源及显式direct TLS，PostgreSQL连接必须显式设置 `sslmode=verify-full`，当前不支持反向代理TLS卸载。生产业务仓储另强制自身身份与权限的只读检查，不能使用结构所有者或超级用户。[受限角色HTTPS联合验收](https-runtime.md#生产权限门禁与受限角色联合验收)两库各6项通过；完整迁移/恢复结果另见[数据库权限记录](postgres-runtime-permissions.md)。默认Compose秘密分离、数据库整体访问策略和实际部署仍待完成，能在本机连接PostgreSQL不是公网部署完成。

切回 `DATABASE_PROVIDER=sqlite` 只会选择旧 SQLite，不会把 PostgreSQL 新写入同步回去。不得将这种配置切换当成安全的数据回滚。业务切换后需要另行验证备份恢复或反向数据迁移。

## 数据库 TLS

数据库连接配置单独遵循[严格 TLS 策略](postgres-transport-security.md)：TLS 只接受 `verify-full`，可指定绝对 CA 文件路径，拒绝弱校验、重复选项与主机覆盖。无查询参数只在非生产允许明文，生产共享连接池拒绝创建；数据库端整体禁用明文仍需落实。完整 `ci:postgres` 与 `ci:https` 的数据库均为 TLS-only 夹具，需要 OpenSSL 3+；普通HTTP页面夹具保留独立的非生产范围。

## 运行账号与迁移账号

新增 `db:runtime-role:postgres -- --apply|--verify --schema 名称 --role 运行角色`，由非超级用户的 schema 所有者连接执行。它检查角色属性、成员关系、PUBLIC/列级/转授及实际对象权限，按明确清单授予31表与3序列权限；不创建账号、写口令、撤权或修改共享默认权限。服务应使用另一份受限运行秘密，不能复用迁移所有者凭据。命令需选择 `--apply` 或 `--verify` 其中之一，具体流程见[权限隔离](postgres-runtime-permissions.md)。

此前专项已使用受限账号启动真实编译HTTP API，验证登录、备注、草稿、审计和退出，并拒绝结构改动、历史改写、所有者切换与序列重置。生产业务仓储现强制使用自身连接执行只读权限检查，拒绝所有者、超级用户及额外/缺失权限；显式生产配置也不能绕过，不自动授予或修复权限。HTTPS夹具另已接入独立角色，实际结果见[权限验收](postgres-runtime-permissions.md)，不因此宣称容器或生产账号切换完成。

## 事务与并发

- 每次业务事务从连接池取一个专用客户端，所有嵌套读取与写入都使用它；提交或回滚后释放。数据库访问为真正异步，不通过同步等待或 SQL 模拟器接入。[node-postgres 事务要求](https://node-postgres.com/features/transactions)
- 复合读取使用只读、可重复读事务，使列表计数、分页、修订及固定来源引用来自同一快照。
- 当前小型编辑工作台采用 schema 级事务 advisory lock 串行化写入。锁在读取会话、权限和修订号之前取得，可协调不同连接池的写入，而不只是一个 Node 进程内的队列。[PostgreSQL 锁机制](https://www.postgresql.org/docs/current/explicit-locking.html)
- 这是有意保留的低写入量策略，不是高并发扩展已经完成。未来需要按实测吞吐与延迟决定是否改用资源级锁，并重新验证跨资源的权限和最后管理员约束。
- 保留原 `expectedRevision` / `expectedLockVersion` 契约；过期写入、重复提交和重复审阅返回 409，不覆盖新版本。
- 备注与审计事件、来源头与不可变版本、草稿与引用、提交任务与状态、审阅意见与状态分别在同一事务内提交。约束或事件写入失败时不保留半成品。
- AI 调用在事务内检查账号、固定许可修订、每日策略、次数及并发占位，再持久化授权；模型处理不占用写事务。结果终态事务重新检查账号、许可修订和有效期并写审计。两个连接池共享数据库时钟和额度，配置不一致不重置账本；失败/取消的已授权次数不返还。详见 [调用治理](assistant.md)。
- 密码计算在事务外进行，计算完成后在写事务内重新校验管理员会话；备注和协作写入也重新核对权限/会话。失败登录事件必须先提交，再向调用者返回错误，避免回滚掉安全记录。
- PostgreSQL 会折叠未加引号的列别名，因此公开契约中的 `ingredientId`、`createdAt` 等使用带引号别名；来源 JSON 字段次序保持历史摘要一致。
- Express 5 路由和认证中间件等待仓储 Promise，拒绝会进入原有统一错误处理，不把 Promise 对象直接返回页面。[Express 错误处理](https://expressjs.com/en/guide/error-handling/)

写事务锁等待、语句和事务空闲时间均有界限。超时或数据库不可用不会自动覆盖修订或换库重试；页面保留输入，用户恢复后重新读取状态。

## 版本和公开边界

启动校验 PostgreSQL 结构版本/摘要、目录绑定的迁移记录，并读取 SQL 验证正式目录摘要。已有业务写入后不要求账号、备注和草稿永久等于原始迁移快照；`--verify` 是切换前的逐行基线核验，而不是启动时覆写业务数据。

当前业务代码要求 PostgreSQL v8。旧 v1 至 v7 请先备份、停写并按迁移文档显式 `--upgrade`，之后重新应用并核验运行角色权限；服务不会自动加表。v7新增只允许SELECT/INSERT的图片核对意见历史（不是审批），不改旧1–6迁移摘要。原 SQLite v3 至 v10 导入的16/18/21/23/24/28/29/30表摘要与历史仍保留，新表为空起步，不把结构升级当成内容批准，也不补造来源核验、专业资格、意见或旧调用的授权次数。 v8追加仅SELECT/INSERT的具名图片送审版本，固定原图/来源及当次意见摘要，不改旧1–7迁移摘要；送审不是权利、专业或公开批准。

v6 增加的发布仓储已经接入迁移、恢复、应用 API 与 React 管理页面；真实 PostgreSQL 的发布 HTTP 专项 7/7、早期完整 Edge 页面 26/26 分别通过且自有夹具正常停止，当前双库页面各41项的独立结果见[持续集成记录](continuous-integration.md)。页面轮次使用 TypeScript API 与前端生产产物，不证明编译后端启动或完整迁移/恢复/运行套件；后者现已由严格 TLS 的独立完整轮次 52/52、六次实际数据库重启及正常停止另行证明，见[当前数据库终态](postgres-transport-security.md#本机实际结果)，原48项历史结果保留。`EDUCATION_PUBLICATION_ENABLED` 默认关闭；现有匿名历史目录不因此扩张，独立教育 GET 只提供有效固定快照的限定字段。v6 备份恢复另行撤销旧会话并追加新的发布冻结批次；迁移源含发布快照时也追加冻结，均不自动启用发布，见 [发布治理](publication-lifecycle.md)。

匿名 `/api/v1/public/catalog` 始终仅返回已导入的历史目录投影。私有来源、备注、草稿、审阅意见、账号及凭据不返回；SQL 目录漂移时返回 503。编辑通过仍为 `editorial_accepted / private / pending`，不是专业批准或公开发布。

## 复现验证

下文 16/21 项与两次重启是摘要辅助阶段的历史结果；当前来源核验阶段的套件、独立轮次与数据库停止证明见 [来源核验工程记录](source-verification.md)。

```powershell
npm.cmd test
npm.cmd run test:postgres
npm.cmd run test:postgres:browser
```

新增发布接口可用 `npm.cmd run test:postgres:publication` 单独验证，执行全部 7 组共用 HTTP 行为，不运行编译后端、备份恢复或重启测试，也不改写完整轮次报告。它为独立范围新建临时集群，不替代完整数据库验收；完整范围现已有独立 48 项终态，报告路径、通过条件与各轮实际结果见 [数据库验收](database-test-reliability.md)、[发布 API 复现](publication-api.md#复现与证据) 和 [发布治理](publication-lifecycle.md)。

完整当前页面可用 `npm.cmd run test:postgres:browser:source` 验证：先严格类型检查和前端生产构建，再以三个独立 PostgreSQL schema 运行全部 26 项 Edge，不覆盖 `build/`。2026-10-08 20:10 CST 已 26/26 通过、零跳过/波动，数据库正常停止；本轮报告和截图均保留在独立集群目录，详见 [当前 PostgreSQL 页面验收](publication-lifecycle.md#完整-postgresql-页面独立验收)。以下两个服务、16 项页面与 21 项数据库的描述仅属于摘要辅助历史阶段。

普通测试保留 SQLite 和原有接口/小程序适配回归。PostgreSQL 命令使用随机端口、SCRAM、仅本机监听的独立原生 PostgreSQL；浏览器命令先生产构建，再让两个测试服务都使用各自新建的 PostgreSQL schema，执行 16 组 Edge 流程（原有 10 组、3 组摘录/模拟辅助、1 组许可/额度界面及 2 组摘要）。包括多账号协作、两窗口冲突、断网/恢复、人工采用、许可撤回再授权、SQL 额度重读、摘要段落/原文映射、语义确认后填入与单独保存、失败保留输入及窄屏。2026-10-08 本轮 16 组通过，桌面/390px 摘要截图已检查；正式模型未调用。

当前真实 PostgreSQL 21 组迁移/API/运行测试通过，数据库进程实际完整重启 2 次；摘要生成终态元数据及同一账号额度保留，输出正文不写调用审计。摘要沿用原许可/授权表，不需要新 schema 或真实工作库迁移；生成和公开目录保持隔离。

测试专用账号/来源不进入真实工作库。生成测试 SQLite 只是构造迁移源；迁移后运行服务和浏览器操作确实写入 PostgreSQL。正式服务器及管理员初始化入口不导入测试账号生成器。

结果分别在 `.local/postgres-test-results.latest.json` 和 `.local/postgres-browser-test-results.latest.json`。测试集群与诊断日志在 `.local/postgres-tests/cluster-*`，均忽略提交。正常停机等待有时受 Windows 磁盘影响，控制器保留日志并等待正常停机，不强制终止数据库、不删证据或放宽业务断言。
