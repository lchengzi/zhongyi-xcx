# PostgreSQL 连接阶段记录

初始化命令另有默认关闭的[初始化阶段诊断](postgres-initialization-diagnostics.md)，不使用 HTTP 请求编号，不能以连接建立成功代替初始化成功。

默认关闭。诊断进程显式设置 `PG_CONNECTION_DIAGNOSTICS=true` 后，后续新建连接使用观察型 Client；没有修改 5 秒连接时限、连接池大小、证书校验、SQL 超时或重试策略。

记录一条连接的开始时间、完成/失败、总耗时、固定错误码和各阶段的相对毫秒数：created、dns、tcp、tls_start、tls_ready、authentication、ready。IP 连接可以没有 dns；非 TLS 连接没有 TLS 阶段。pg 的 sslconnect 只表示开始升级 TLS，必须与实际 socket secureConnect 分开，不能将它当作已完成握手。

authentication 表示收到首个认证请求，ready 表示驱动完成建立连接；这些是排查依据，不是专业审校、默认公众信任或业务写入成功证明。连接池排队不一定创建新连接，因此没有新连接记录也不能单独证明请求没有访问数据库。

输出只允许固定字段和错误码；不输出 URL、主机、数据库名、用户名、密码、SQL、证书内容或原始错误消息。未知错误归为 other，关闭但未建立成功归为 connection_closed。时间记录便于与匿名请求日志对照，但共享连接与请求不一定一一对应。

完成后移除监听器；观察者输出失败不改变驱动结果。每个诊断进程最多保留最新 256 条不可变记录，溢出数量单独计数；这不是 stdout 日志轮转或完整隐私审计。关闭进程后内存记录失效，不持久化客户端数据。

HTTPS 测试中：

- 真实编译子服务的记录经过精确运行时校验，写入既有 `application-*.json` 的 postgresConnections，最多 512 条，额外计数 droppedPostgresConnections。
- 测试进程的角色准备/只读观测等连接记录写入 `postgres-client-setup.json`；该文件仅本机保存，没有扩大 CI 归档白名单。stdout 也包含同一脱敏结构。
- 两类记录分别属于不同进程，connection 编号不是全局跨进程 ID。
- 既有拥有权与秘密文件保护不变；不要上传包含数据库、私钥和连接 secret 的整个测试目录。

已修复角色准备时的资源清理遗漏：初始 connect 拒绝也会关闭所属 pool；取得 client 后无论回调成功/失败，都释放 client 并关闭 pool。这个修复不改变认证行为，也不证明先前超时根因已解决。

## 请求对应的失败阶段

`API_FAILURE_DIAGNOSTICS=true` 是另一个独立、默认关闭的开关。编译服务入口启用后，为实际返回500或捕获的503增加 `api_failure`；它与原 `api_request` 通过服务端生成的 `requestId` 对应，也与响应 `X-Request-ID` 相同。调用方传来的编号不回显。嵌入式服务须显式提供 `createApp` 的 `failureLog`；仅设置环境不会隐式打开所有测试或库调用。

记录时间、请求类别、受限HTTP方法、响应状态、engine/operation/phase/code/rollback/rollbackCode。PostgreSQL阶段为 acquire（取得连接）、begin、setup（本事务设置）、lock（写入锁）、work、commit。AsyncLocalStorage隔离并发请求，错误标签只在启用的请求作用域内存在；不把共享连接编号误当成请求编号。请求外的初始化/迁移失败没有HTTP请求编号，仍用原有安全启动错误及连接诊断。

只允许固定错误码；pg/pg-pool没有code的少数错误按本机驱动的完整固定消息映射为pool_acquire_timeout、connection_timeout、connection_closed，未知错误为other。不记录消息、stack、cause、SQL/参数、网址、用户/数据库名、请求正文、Cookie或健康信息；不得把未知报错追加到日志。诊断输出失败不改变业务响应。

失败保留原异常，回滚一次、释放一次，没有新增重试、连接池调整、超时延长、证书降级或权限变更。rollbackCode仅解释后续回滚失败，不能覆盖最初错误；commit失败不能被解释为确定未写入，仍需按原业务规则重新读取核对。work表示失败在回调中，不单凭阶段判断一定是网络或SQL故障。

readiness、公开目录和公开教育接口主动捕获的503也记录；503的通用错误正文不证明发生了目录篡改。400/401/403等已处理请求仍在原请求日志中，不额外写系统失败记录。没有公开诊断API。

浏览器隔离夹具显式启用该开关并提供新的 `.local/.../browser-results.json` 时，每个服务独占 `api-diagnostics-端口-UUID.jsonl`，同时保存两类脱敏记录，便于关联自然复现的错误。拒绝路径越界、链接及根目录复用，不覆盖旧证据。不扩大CI归档白名单；不要上传整个包含数据库/证书的目录。生产stdout的保留与轮转需运维配置，这不是日志保留生命周期已完成。

浏览器的连接阶段记录还需显式 `PG_CONNECTION_DIAGNOSTICS=true`。Playwright默认不转发后台stdout；2026-10-12起配置为该开关严格等于true时才pipe五个服务stdout，并标注fixture-4311至fixture-4315，默认仍忽略。这些是现有安全投影，不开启原始驱动/SQL调试日志；记录仍不是公开API。仅打开API_FAILURE_DIAGNOSTICS不能证明有TCP/认证/ready记录；控制器自己的连接也不代表各业务服务。输出修正和实际观察见根 `.refactor/evidence/postgres-diagnostic-output-20261012/RUNTIME.md`。

本轮实现与验证、历史失败及尚未定位的问题见 [跟进记录](../../.refactor/evidence/connection-followup-20261011/RUNTIME.md)。日志可观察性不等于故障已修复，也不能据连接错误直接归因于系统代理。

测试：`node --import tsx --test tests/postgres-connection-diagnostics.test.ts`，8 项覆盖阶段区分、脱敏/严格解析、清理、观察者失败隔离、内存上限，以及取得连接失败后的关闭与不重试。已纳入平台常规 test 与 HTTPS 严格类型检查。

新请求级测试为 `tests/failure-diagnostics.test.ts`，纳入每日test与严格类型检查；真实驱动的超时→回滚→HTTP500/503关联由 `tests/postgres-failure-diagnostics.test.ts` 在拥有权控制器中验证，不用驱动替身冒充真实PostgreSQL。人为制造的测试超时也不能证明此前自然中断的根因。
