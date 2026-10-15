# HTTPS 请求阶段与超时定位

隔离 HTTPS 验收现在保存客户端阶段时序，并关联编译服务已有的最少字段请求日志。诊断本身用于区分连接、证书握手、等待响应头和读取正文，不修改生产认证、数据库持久性、3000ms 测试超时设置或业务重发规则。随后已实施[SQLite登录限流事务优化](sqlite-login-transactions.md)，不与这一诊断阶段混为同一版本。

2026-10-09 的新一轮 SQLite 验收再次出现登录超时，结果为5/6；诊断已将本次故障缩小到取得可信 TLS 连接后等待响应头，但尚不能判断登录内部的具体慢操作。三类受控停滞均按预期分类，不代表历史故障已经修复。

## 记录和关联

每次编译应用正常退出后，`application-N.json` 同时保留生命周期与 `diagnostics`。客户端只记录本轮序号、所属应用序号、开始时间、固定请求分类、方法、阶段耗时、连接复用/证书验证状态、终态、状态码、合法 UUID v4 请求编号和白名单错误码。实际路径、查询参数、账户、密码、Cookie、正文、异常消息和原始标准输出不保存。

服务端仍只有[请求日志](request-diagnostics.md)中的八个字段，不新增客户端可控的关联值。收集器严格校验字段集合、类型、枚举、编号、时间和完成/中断状态关系；任何额外字段都会使整条记录被拒绝。未结束的行最多4096字符，每个应用最多1024条服务端记录；客户端全轮最多4096条，每个应用验收最多512条。超过限制不能获得通过证明。

收到合法响应编号且恰好匹配一条服务端记录时，关联为 `request_id`。没有响应头时，只在同一个自有应用内按固定分类、方法与时间重叠寻找候选；即使只找到一条，也只能标为 `time_window`。多条候选标为 `ambiguous`，没有候选标为 `none`。时间关联依赖本机时钟；它不是身份确认，也不能跨应用、跨主机或跨数据库运行拼接。

| 末端阶段 | 已观察到的事实 | 仍不能判断 |
| --- | --- | --- |
| `socket_assignment` | 尚未观察到 socket 分配 | 是否到达服务端 |
| `tcp_connect` | 已分配 socket，尚未观察到 TCP 连接完成 | 认证或数据库是否执行 |
| `tls_handshake` | TCP 已连接，尚未确认可信 TLS | 是证书拒绝、握手停滞还是其他连接错误 |
| `response_headers` | 已确认可信 TLS，尚未收到响应头 | 服务端内部哪一步耗时 |
| `response_body` | 已收到响应头，正文尚未结束 | 响应是否完整、写入是否已提交 |
| `complete` | 客户端正文读取结束 | 内容的专业正确性或后续业务状态 |

`flushed` 表示客户端把请求交给操作系统，不证明服务器已收到；复用连接会明确记录 `reusedSocket`，不能把复用后的时间当成新握手耗时。`secureConnect` 本身也不足以证明证书可信，分类另外检查 `authorized`。[Node 请求事件](https://nodejs.org/download/release/v22.15.1/docs/api/http.html#event-finish)、[Node TLS 事件](https://nodejs.org/download/release/v22.15.1/docs/api/tls.html#event-secureconnect)

3000ms 是 socket 无活动超时，不是整次请求的绝对截止。握手注入本轮实际约6016ms才终止，设置仍为3000ms；诊断分别保存设置与实际耗时，不用两者相等作通过条件。[Node 请求超时](https://nodejs.org/download/release/v22.15.1/docs/api/http.html#requestsettimeouttimeout-callback)

## 本次失败证据

[统一入口失败报告](../.local/ci-runs/https-d388f726-bb37-440d-804a-2a98e089624b/report.json)实际退出1，SQLite5/6，零跳过/取消；PostgreSQL阶段因前阶段失败未运行。[SQLite终态](../.local/https-tests/run-gCPJ15/result.json)记录全部夹具已停止，七份应用摘要均实际退出0。错误记录不删除，也不通过放宽超时获得绿色结果。

[应用1诊断](../.local/https-tests/run-gCPJ15/application-1.json)中的认证 POST，TCP约4.26ms、可信TLS约5.19ms、请求输出约5.34ms，3012.66ms超时，未收到响应头。关联仅为时间窗口候选：该候选服务端记录耗时3382.66ms、状态200、`completed`。这些事实支持继续检查服务端登录路径，但不能直接归因于密码派生、SQLite锁、提交或磁盘。服务端完成输出不证明客户端收到，更不能据此自动重发登录或其他写入。

[故障注入报告](../.local/https-tests/run-gCPJ15/diagnostic-faults.json)为 `verified=true`：独立 TCP 服务停在 TLS 握手，独立 HTTPS 路由分别停在响应头前和正文中。三次均触发原超时设置，分类分别为 `tls_handshake`、`response_headers`、`response_body`；后两次服务端明确记录 `aborted`，关联分别为时间窗口候选与精确编号。注入服务不访问业务数据库，全部连接和监听器由本轮测试关闭，不增加生产故障接口。

14:33:59 CST，独立 `test:postgres:https` 实际退出0：[数据库终态](../.local/postgres-tests/cluster-tbKQbt/result.json)与[PG HTTPS终态](../.local/https-tests/run-KgOzh7/result.json)均为6/6，零失败/跳过/取消，数据库与HTTPS夹具正常停止。三份数据库schema直接查询仍通过；七份应用诊断共106次客户端/服务端精确编号匹配，[三类注入](../.local/https-tests/run-KgOzh7/diagnostic-faults.json)通过。这是独立PG阶段的成功，不覆盖前述统一入口失败，也不是本轮双库全部通过。应用到PG的连接仍为回环明文，完整数据库TLS52项属于此前另一轮。

## 复演和门禁

```powershell
node --import tsx --test tests/request-log.test.ts tests/tls-config.test.ts tests/ci.test.ts
npm.cmd run typecheck
# 需要现有 OpenSSL 3+ 与 Edge；必要时先配置 HTTPS_TEST_OPENSSL。
npm.cmd run ci:https
```

针对性43/43与七组类型检查已经实际通过。其中请求日志专项由原8项增至16项，新增字段白名单、分块输入/上限、阶段分类、连接复用、终态冻结、错误脱敏、精确编号及不确定时间关联测试。默认平台回归保留这些用例；配置测试要求两类数据库都提供七个应用、至少七次精确匹配和三类故障注入证明。测试文件或配置存在不等于整套 HTTPS 已通过。

14:35:55 CST，[核心终态](../.local/ci-runs/core-da1605ab-96c0-43ae-acca-0a0925013fcb/report.json)八阶段全部实际退出0：七组类型、180项平台、42例离线契约、原生完整检查/26个脚本、生产构建和[编译日志专项1/1](../.local/request-log-runs/run-RWk5IO/report.json)，后者四个实际请求精确匹配且正常停止。独立检查两库共14份应用摘要，退出码均为0、诊断记录零丢弃，SQLite100次/PG106次精确匹配；失败SQLite摘要被CI门禁拒绝，独立PG联合证明被接受。核心通过不覆盖HTTPS失败。

本批没有更改正式目录、安全规则、图片候选、业务数据库结构或公开内容状态；完整PG迁移恢复、双库完整页面41项、独立演示及微信双端未在本批重跑。本轮PG页面截图由测试生成，但没有新增人工视觉验收结论。

GitHub 配置仅新增 `application-*.json` 和 `diagnostic-faults.json` 两种精确诊断路径，不上传原始进程输出、证书、私钥或数据库；远程实际执行仍待确认。后续的[隔离SQL测量与限流事务合并](sqlite-login-transactions.md)已有独立证据；不能据此倒填本节失败请求的内部时序。完整迁移恢复、数据库TLS、容器、公网、微信双端和专业签审继续分别验收。
