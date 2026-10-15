# 数据库验收的退出观察与中断记录

完整 PostgreSQL 验收必须同时取得本轮测试终态和自有数据库实际停止证明。报告停在 `running`、会话句柄失效、监听端口消失，均不能单独证明测试通过。下方为退出观察阶段的历史记录；当前连接 TLS 阶段已于 2026-10-09 13:58:41 CST 完成 52/52、六次真实重启及正常停止，见[严格数据库 TLS 实测](postgres-transport-security.md#本机实际结果)。新轮次没有改变旧失败或中断记录。

## 旧轮次的处理

2026-10-08，旧轮次 `postgres-f49bda07-89c7-4419-b233-f89961f48a67` 的会话已无法继续读取，报告仍为 `running / finishedAt=null`，集群 `cluster-bGFVBc` 没有终态 `result.json`。此前观察到前 13 项通过及两次数据库重启，但不能据此补造完整结果。

在启动新轮次之前，已只读核对旧记录绑定的四个进程 ID（27296、3024、24148、27708）和两个监听端口（63664、56513），在进程、命令行和监听查询中均不存在。保留旧报告、数据目录和日志，不改写其状态，不发送停止请求、不强杀、不删除，也不把旧 PID 作为未来操作授权。

旧轮次失去终态的根因尚未确认。独立的真实 Node 小规模探针实际收到 `exit` 和 `close` 两个事件，未复现卡住；下面的观察改进不能表述为已经证明旧故障原因。

## 测试夹具的改进

编译应用夹具现在使用 `fixtureApplicationCompletion`：启动后立即订阅实际 `exit`，并同时等待已捕获的标准输出和错误流结束，再检查退出码、信号及秘密泄漏。它不依赖聚合 `close` 的时序，不发送停机请求、不设置成功超时，也不把连接断开当成退出。

实际退出时日志管道仍可能打开，因此不能只等待 `exit` 就检查末尾日志。这一区分来自 [Node 22 子进程事件说明](https://nodejs.org/download/release/v22.15.1/docs/api/child_process.html#event-exit)；日志排空使用 [Node 流完成观察](https://nodejs.org/download/release/v22.15.1/docs/api/stream.html#streamfinishedstream-options)。应用仍由自有 IPC 请求触发正常信号处理器，没有新增生产关闭接口。

完整数据库控制器现在也在初始化之前保存本轮自有 `result.json` 和最新摘要，明确 `testedAt=null / status=running / fixtureStopped=false`。之前只有页面与发布 HTTP 专项具备这一步。初始化失败会留下失败记录；外部中断可能仍留下运行中记录，必须结合实际进程与终态核实，不能自动变绿。

## 本轮验证

- 新增两项协议单元测试，分别检查未收到聚合关闭时仍须实际退出及双日志排空，以及非零退出、启动错误和日志错误。模拟事件只证明观察契约，不是实际系统故障复现。
- 原真实 IPC 子进程测试继续覆盖提前请求、就绪后请求及控制连接断开，均正常退出；联合数据库控制协议共 11/11 通过。
- 完整平台 `npm.cmd test` 已实际退出 0，137/137 通过，零失败、跳过、取消；不是完整七阶段核心 CI 报告。
- 五组项目类型检查通过。额外对本轮涉及的四个测试入口及依赖执行严格 TypeScript 检查，首次发现可空日志流和同步/异步联合返回的旧标注问题，补齐管道断言及异步等待包装后检查通过；没有删减行为断言。

随后于 2026-10-08 22:44 CST，独立 [七阶段统一核心报告](../.local/ci-runs/core-ad2d9ae8-57ee-4ee6-bca0-b22a8d9138ea/report.json) 结束通过，包含这 137 项、42 例离线契约、完整原生检查/回归及生产构建。它是后续另一轮整体证据，不改写前述单独测试的范围，也不代表其余三个入口、远程运行或部署已完成。

## 完整数据库首轮与修正

2026-10-08 22:28 CST，首轮 [CI 失败报告](../.local/ci-runs/postgres-c7075ee7-90c6-4017-8299-615d428fd603/report.json) 与 [自有集群终态](../.local/postgres-tests/cluster-XrtlGM/result.json) 已结束：46/48 通过、2 项失败、零跳过/取消，六次数据库完整重启，自有数据库正常停止，入口退出 1。编译后端重启、加密恢复及七组共用发布 HTTP 均完成，但整轮不计通过。

两处失败均有具体证据并保留原报告：

- 初始化测试仍期待 SQLite 迁移记录 1 至 7，实际新库正确包含发布表迁移 8。修正为固定期待 1 至 8，并增加 PostgreSQL 迁移 1 至 6 及四张发布表为空的检查，不改初始化器。
- 并发撤权测试以旧 SQL 前缀识别等待，业务实际使用 `pg_catalog.pg_advisory_xact_lock`，旧匹配看不到它。改为读取自有阻塞连接 PID，通过 `pg_blocking_pids` 核对实际阻塞关系，仍须先观察撤权操作排队，之后发布写入因撤权被拒绝。没有增加观察时间、跳过竞争或仅用延时推断排队。[PostgreSQL 阻塞关系说明](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-SESSION)

在首轮实际停止之后才启动修正后的完整轮次，执行同一完整 48 项范围，而非只复跑两个失败项目。

## 完整数据库最终结果

2026-10-08 22:40 CST，[最终完整 CI 报告](../.local/ci-runs/postgres-3eb08640-4e29-47c2-ad5c-186612dd1c88/report.json) 与 [集群自身终态报告](../.local/postgres-tests/cluster-oNbK6u/result.json) 均已结束通过，入口实际退出 0。TAP 为 48/48 通过、零失败/跳过/取消，数据库完整重启六次，`scope=migration-api-and-recovery / fixtureStopped=true / sourceWorkingDatabaseModified=false`；CI 保持 `commit=null / deploymentVerified=false / externalAiEnabled=false`。

这轮覆盖当前 PostgreSQL v6 的完整迁移/API/恢复/运行范围，包括编译后的应用与操作者 CLI、加密认证恢复后的 28 张业务表和两张历史表/三个序列、旧 v3/v4/v5 备份兼容、实际排队撤权、发布冻结与重新批准，以及全部七组共用发布 HTTP。容器入口在主机子进程中运行，不是 Docker 镜像实测；正向专业记录仍是隔离工程模拟，不是真人资格认证或内容签审。

首次初始化约 110 秒，三次正常停机检查点观察超过初次 60 秒窗口，但均继续等待同一自有进程完成，未追加信号、强杀、降低持久性或替换尚未退出的数据库。失败轮次和失去终态的旧轮次继续保留，最终通过不改写它们。

复现入口为 `npm.cmd run ci:postgres`。它使用临时回环 PostgreSQL、随机凭据与全新测试 schema，覆盖迁移、业务 API、编译应用重启、备份恢复、专业和来源规则、发布内核及共用发布 HTTP；不连接或迁移工作数据库，不调用真实模型。

## 验收范围

数据库完整回归、源码 API 页面、编译 HTTPS、远程 Actions、真实容器、公网服务及微信真机是不同证据。当前改动不启用公开教育内容，不补造专业签审，不代表上线或安卓/iOS 测试完成。各独立轮次见 [自动检查记录](continuous-integration.md) 和 [发布治理](publication-lifecycle.md)。
