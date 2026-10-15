# PostgreSQL 连接加密与身份校验

数据库连接的 TLS 与浏览器访问服务的 HTTPS 是两条独立链路。生产模式的共享连接池现在强制显式 `verify-full`，校验证书链和服务器名称，不接受明文或降级；非生产本机演示仍可显式使用明文。这是应用和操作者入口的代码约束，不证明生产数据库服务器、网络或容器已经配置并运行。服务的 HTTPS 配置见 [直接 HTTPS](https-runtime.md)。

## 连接配置

普通应用入口仍通过服务端环境中的 `DATABASE_URL` 获取连接；容器入口另支持 `DATABASE_URL_FILE`。数据库凭据不写入小程序、浏览器、命令行参数或截图。下面只列地址参数结构，不含真实账号或密码。

| 查询参数 | 行为 |
| --- | --- |
| 无参数或 `sslmode=disable` | 仅非生产演示允许明文；生产模式在创建连接池前以 `tls_required` 拒绝，不自动升级或降级 |
| `sslmode=verify-full` | 使用 Node 信任配置，验证证书链与连接主机名，最低 TLS 1.2；连接失败不会回退明文 |
| `sslmode=verify-full&sslrootcert=绝对路径` | 使用指定 CA 文件，仍验证连接主机名；路径须 URL 编码，文件及父级不得是链接 |

私有 CA 文件必须是可读的非空普通文件，最多 64 KiB；相对路径、目录、缺失文件及链接被拒绝。配置错误使用固定消息，不回显连接凭据或文件路径。证书 SAN 必须匹配 URL 中的主机名；DNS 名称与 IP 地址不能互相替代。

连接查询参数只接受单次 `sslmode` 和 `sslrootcert`。`no-verify`、`prefer`、`require`、`verify-ca`、`ssl=true`、`uselibpqcompat`、主机覆盖、重复参数及其他查询选项均拒绝，不是原驱动全部参数的透传接口。客户端证书和直接 SSL 协商尚未提供配置入口。

连接池先解析和检查地址，再去掉传给驱动的查询参数，显式传入 `rejectUnauthorized=true` 和最低 TLS 版本，保留 Node 默认服务器身份校验。[node-postgres SSL 说明](https://node-postgres.com/features/ssl)指出，连接地址中的 SSL 选项可能替换独立传入的 `ssl` 对象；因此仅给连接池补一个对象不足以保证校验策略不会被覆盖。

## 隔离数据库验收

完整入口仍是 `npm.cmd run ci:postgres`，不增加 CI 分组。该入口与 `ci:https` 的 PostgreSQL 阶段均为每轮新建的集群生成两天有效的私有 CA 和仅含 `DNS:localhost` 的服务器证书，数据库只监听回环地址，以 SCRAM 认证并通过 `pg_hba.conf` 拒绝明文连接。完整数据库套件验证迁移、API、编译应用、恢复和数据库重启；HTTPS 联合套件验证同一轮编译服务的两段加密，二者分别验收。

四项真实连接检查分别读取当前 SQL 会话的 `pg_stat_ssl`、移除 CA、把主机名改为 IP、移除 TLS 参数。它们要求实际加密连接成功，以及不可信证书、错误主机名和明文连接分别被拒绝，不能用配置对象检查代替握手与 SQL 结果。控制器仅接受当前子进程带本轮随机标识的完整证明；CI 还要求本轮测试全部通过、数据库实际停止和证明字段一致。

需要已安装的 OpenSSL 3+，可用仅对当前终端有效的 `HTTPS_TEST_OPENSSL` 指定工具路径。测试不安装工具，不导入系统 CA，不访问工作数据库，也不对外发布；证书、私钥和数据库留在忽略提交的本轮目录，CI 仅归档安全摘要，不上传这些文件。类型检查沿用现有七组配置，新握手测试已纳入其中。

## 本机实际结果

2026-10-09 13:58:41 CST，[完整 PostgreSQL CI](../.local/ci-runs/postgres-66791e5e-120e-4bde-9dd7-1cb6dc53d4ae/report.json)实际退出 0：52/52、零失败/跳过/取消，六次数据库完整重启，最终正常停止。[集群终态](../.local/postgres-tests/cluster-hWsW05/result.json)同时确认四项 TLS 证明、`databaseTlsVerified=true`、`fixtureStopped=true` 和未修改系统信任。运行环境为 Windows、Node v22.15.1、PostgreSQL 18.4；本轮临时证书由已有 OpenSSL 3.0.18 生成，没有安装工具。

原有 48 项迁移、API、编译应用/操作者入口、加密恢复和发布检查全部保留，并改在严格 TLS 连接上运行；新增四项在数据库重启后真正握手与读取 SQL。正常停机多次超过初次观察窗口，均继续等待同一自有进程，没有重复停机、强杀或降低持久化设置。数据库测试与最终停止是两个时刻，整轮通过以停止后的 CI 终态为准。

13:58:56 CST，[核心八阶段](../.local/ci-runs/core-dce6f2d2-5455-4f8b-a235-f02dded9dd40/report.json)也实际退出 0：七组类型、172 项平台、42 例离线契约、原生完整检查/26 脚本、Web/API 生产构建及[编译日志 1/1](../.local/request-log-runs/run-sg0jZn/report.json)。连接配置新增五项回归计入平台，四项真实数据库检查只计入 PostgreSQL 52 项，不混算总数；没有调用真实模型或改动工作数据库。

14:05:08 CST，原有双库 HTTPS 在新目录完整重跑各6/6并正常停止，验证现有编译服务和明文PG演示仍可读写。其首轮SQLite登录超时、原断言重跑及四张窄屏抽查见[HTTPS回归](https-runtime.md#数据库连接策略后的-https-回归)；超时原因仍待定位。这两阶段的数据库连接仍为明文，不能把它们与上述TLS-only数据库拼成同一轮两条链路同时加密的部署证明。

## 生产连接约束验收

2026-10-09 15:35:37 CST，[生产约束后的双库HTTPS](../.local/ci-runs/https-c5245cb0-05dc-400f-8779-81e4f0e71b2c/report.json)实际退出0，SQLite6/6、PostgreSQL6/6、零失败/跳过/取消，服务和数据库正常停止。[PG HTTPS摘要](../.local/https-tests/run-9fOHQD/result.json)及[数据库终态](../.local/postgres-tests/cluster-MN9cW8/result.json)对应同一轮；七次编译应用连接均TLS1.3/256位，三个业务schema、请求编号关联与原业务断言保留。

新增两项配置回归验证全局生产模式不可放宽，以及显式传入生产环境时不修改主机环境、不回退SQLite；连接专项15/15通过。联合套件还实际运行编译服务、初始化、迁移验证、备份、账号初始化与容器操作者入口，明文均以 `tls_required` 拒绝，没有生成测试备份或创建指定的新schema。测试没有执行真实生产迁移、备份或账号操作，也不把这组拒绝检查当作完整恢复套件再次通过。

15:30:24 CST 的[首轮失败](../.local/ci-runs/https-9a2a97a1-a44e-421e-aef4-229f59da46ae/report.json)保留：SQLite6/6、PG5/6，全部夹具正常停止。容器初始化已返回 `tls_required`，新增测试却预期通用容器错误；改为严格核对实际策略错误码后完整复跑通过，没有放宽连接校验。八张新PNG已生成，本批未目视复查，不当作微信真机验收；完整PG52项、完整HTTP页面和独立演示本批未重跑。

15:37:50 CST，[最终核心](../.local/ci-runs/core-fc1ec884-d4ef-43da-8877-a4485b75661a/report.json)实际退出0，八阶段、七组类型、192项平台、42例离线、原生完整检查/26脚本、生产构建和[编译日志1/1](../.local/request-log-runs/run-S6qvyo/report.json)通过。两项新配置检查计入192项，编译操作者拒绝检查在HTTPS六项内，不重复加总；未改数据库结构、工作库或公开内容。

## 部署边界

2026-10-09 15:14:00 CST，[联合HTTPS终态](../.local/ci-runs/https-ddced1cd-27cb-47ff-b782-bcb04f452dca/report.json)另实际退出0：两库各6/6、服务和数据库正常停止；PG七次编译应用启动的真实 SQL 连接均为 TLS1.3、256位，错误CA、错误主机名与明文均被拒绝。此轮同时验证两段连接，详见[同轮证据](https-runtime.md#https-与数据库-tls-同轮检查)，不改写上述历史明文HTTPS报告，也不冒充再次执行完整52项恢复套件。

`NODE_ENV=production` 已在共享连接池入口强制要求 URL 明确设置 `sslmode=verify-full`；即使调用者传入宽松标志也不能关闭生产约束。显式传入生产配置的业务仓储也向连接池传递该要求，不依赖修改全局环境。编译服务、初始化、迁移/升级/验证、账号初始化以及备份/恢复均复用这个工厂；SQLite 没有这条网络连接，不强制迁移为 PostgreSQL。

生产数据库端仍须独立配置服务器证书、私钥与访问规则，仅打开 `ssl=on` 不会自动拒绝明文。还需核验服务器允许的账号/地址、证书主机名及应用权限；客户端约束不能替代数据库整体策略。[PostgreSQL SSL 配置](https://www.postgresql.org/docs/18/ssl-tcp.html)、[认证规则](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html)

默认 Compose、本机 HTTP 演示和完整 HTTP 浏览器夹具仍是非生产，可保留明文；HTTPS 联合夹具要求 TLS-only 数据库。`compose.https.yaml` 将应用设为生产，原明文数据库 secret 与默认无 TLS 的 postgres 服务不满足条件，单独套用覆盖文件会拒绝启动。需先准备有 TLS 的数据库和严格 URL；私有 CA 另行以只读方式挂载，不能拿 `TLS_HEALTH_CA_FILE` 代替数据库 CA，也不能靠降低 `NODE_ENV` 把演示当生产。

运行与迁移账号另有[权限策略与生产门禁](postgres-runtime-permissions.md)，生产业务仓储使用自身身份只读检查，不持有迁移凭据；[双段HTTPS受限角色联合验收](https-runtime.md#生产权限门禁与受限角色联合验收)两库各6项、PG七次真实角色/TLS连接通过。[独立受限账号编排](container-credential-separation.md)已按命令分配两份秘密文件，原有HTTP演示仍保持非生产，实际Docker挂载未验。此处不证明公网数据库、公众受信证书、证书续期或撤销策略、客户端证书认证、Linux容器、生产账号切换和远程CI已验收。专业审校、内容发布与微信安卓/iOS测试保持独立，不因连接加密通过而自动满足。
