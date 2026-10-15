# 直接 HTTPS、就绪检查与验证边界

当前选择 Node 原生 HTTPS 终止 TLS，复用已有 Express/React 服务，不额外引入 Web 框架或依赖。这个入口可在 Docker 引擎不可用时做真实本机加密验证，但不代表公网部署、微信请求域名或真机验收完成。内容审校/发布边界不变。

## 新 TS 客户端实测补充（2026-10-11）

SQLite 本机新轮次 `run-S4jiGE` 实际退出 0，6/6、21 次新客户端请求；独立编译服务重启、证书拒绝、发布/撤回均通过，服务已停止。实际报告经新增 CI 门禁接受，桌面与 390px 发布页截图已查看。

PostgreSQL 新轮次 `run-SJGyXF` 为 **失败**（4/6）：目录 GET 约 5 秒后 500、管理页按钮超时，随后准备发布测试角色时新连接超时。新客户端证明 false/0，不能套用旧 PostgreSQL 绿色报告。拥有权控制器 `cluster-PivyvB` 已正常停止；检查点同步耗时约 75 秒，观察超时后没有额外发信号或强杀。连接失败根因仍待诊断，没有扩大生产超时或自动重试写入。细节见根目录 `.refactor/evidence/public-client-tls-20261011/RUNTIME.md` 与 `REFACTOR_STATUS.md`。这些结果都不是公网/微信或真机验收。

随后新增默认关闭的连接阶段诊断（见 `docs/postgres-connection-diagnostics.md`）并修复连接获取失败时池清理遗漏；新鲜轮次 `run-MjjF9D/cluster-DRCRkx` 实际 exit 0，6/6、新客户端 21 次请求，7 个编译应用与 3 个 schema 均通过数据库 TLS/受限角色检查，服务和数据库全部正常退出。真实报告经最新 CI 门禁接受。该轮没有重现旧超时，不把“清理遗漏修复”或“新轮次通过”等同于超时根因已消除；原失败记录保留，不重复刷绿。

## 配置与启动

恢复联动新轮次：`run-WGUVeb/cluster-1oviKf` 实际 exit 0、6/6、28 次新客户端请求（恢复序列 7 次），9 个受限 TLS 编译应用/4 个业务 schema、159 次请求精确关联，全部服务和数据库正常退出。实际 PostgreSQL 捕获经加密文件往返后恢复到全新 schema，完整数据/历史/序列核对，旧会话拒绝、React 冻结页、客户端旧文清除、resume/批准不自动复活、显式回滚发布后读取、再次重启和撤回通过。最终两级报告经当前 CI 验证函数接受。SQLite `run-Y3WZAT` 同控制器另行 exit 0、6/6、21 次请求/7 应用，明确 recovery=false/0。详见根目录 `.refactor/evidence/public-client-recovery-20261011/RUNTIME.md`；这些不代表微信、生产恢复或远程 CI，历史超时根因仍未确认。

默认 `TLS_MODE=off` 保留原本机 HTTP 演示。`NODE_ENV=production` 现在拒绝 off 模式，不再仅凭 HTTPS 来源和 Secure Cookie 就运行明文入口。`TLS_MODE=direct` 要求账号认证、精确 HTTPS 来源、不同的绝对证书/私钥文件；不接受本地编辑密钥或 HTTP 来源。

服务开库前检查普通文件/读取大小、匹配密钥、非 CA 叶证书、当前有效期和所有可信来源的 SAN。证书最多 64 KiB，私钥最多 16 KiB；拒绝链接叶节点/文件替换并限制实际读取大小。证书链文件以叶证书开头；私钥应未加密并由操作系统/部署秘密管理保护，不在命令行传密码，也不回退明文。客户端仍负责验证签发链和撤销等信任策略，服务启动的文件/身份检查不等于公众信任。

下面是配置结构，路径和域名是占位符，不是已上线地址；保留原数据库环境并先完成必要迁移/管理员初始化。不要将示例路径直接当真实文件运行。

```powershell
$env:NODE_ENV = 'production'
$env:TLS_MODE = 'direct'
$env:BIND_HOST = '127.0.0.1'
$env:PORT = '4310'
$env:ALLOWED_ORIGINS = 'https://your-owned-domain.example:4310'
$env:TLS_CERT_FILE = 'C:\secure-config\fullchain.pem'
$env:TLS_KEY_FILE = 'C:\secure-config\private.key'
npm.cmd start
```

实际访问来源端口需与域名/服务一致，微信域名、证书链和端口要求必须另行核验。只有明确部署网络范围后才改 `BIND_HOST`；本阶段不打开防火墙、不安装系统服务、不申请证书或创建云资源。

最小 TLS 版本为 1.2。直接 TLS 使用 Secure/HttpOnly/SameSite=Strict 会话 Cookie、既有 Origin/CSRF/RBAC；仅实际加密 socket 且生产环境设置 `Strict-Transport-Security: max-age=86400`，不预载、不扩大到子域。`trust proxy` 仍关闭，伪造 `X-Forwarded-*` 不能获得受信代理身份。`TLS_MODE=proxy` 当前拒绝；若以后需要代理终止 TLS，须先设计受信地址、隔离后端和真实客户端限流，不能直接全信代理头。[Node TLS](https://nodejs.org/docs/latest-v22.x/api/tls.html)、[证书身份检查](https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-x509certificate)、[Express 代理边界](https://expressjs.com/en/guide/behind-proxies/)

证书目前在启动时加载，没有自动申请、续期、热重载或期限告警。更新文件后需要有计划地正常重启并复测；不能为了演示把测试 CA 装进用户系统或关闭生产证书验证。运行时实际 Node/OpenSSL 版本与补丁安全状态也需在正式部署前核验，本机旧运行时不是生产安全推荐。

## 存活与就绪分别判断

容器另提供 `compose.https.yaml` 传输覆盖：在原 Compose 之上显式设置生产/direct 模式，挂载不同证书/私钥 secret，并要求 `HTTPS_ALLOWED_ORIGINS`、主机 `HTTPS_CERT_FILE`/`HTTPS_KEY_FILE`。生产 PostgreSQL 现还必须使用 `verify-full` URL 与有 TLS 的数据库；默认明文数据库和原 secret 不满足条件，单独叠加 HTTPS 覆盖会拒绝启动，不能当作可直接运行的生产组合。主机端口仍继承仅回环，数据库仍是演示权限，**不是完整生产模板**。公有受信证书的健康客户端用 Node 根证书；私有 CA 还需单独配置只读健康 CA 文件，它不替代数据库 CA。覆盖文件解析通过也不能当镜像/挂载实测。

```powershell
# 配置真实文件与来源后，只读检查；不会启动容器。
docker compose --env-file .env.example -f compose.yaml -f compose.https.yaml --profile operator config --quiet
```

| 检查 | 实际含义 | 不能证明 |
| --- | --- | --- |
| `GET /api/health` | HTTP 进程可回应 | 数据库可读、内容完整、登录和所有业务正常 |
| `GET /api/ready` | 数据库中公开目录投影、元数据、行数、结构和摘要本次校验通过 | 全部私有表/索引无漂移、专业批准、写入权限、备份可恢复或系统容量 |
| `node build/tools/healthcheck.js` | 当前协议下到本机的证书验证请求与上述 SQL 就绪检查 | 公网可达、微信信任/域名配置、全部用户流程 |

就绪接口匿名、仅 GET、无查询参数/正文，返回 `{ok:true}` 或失败 503 `{ok:false}`，不返回数据库路径、凭据或私有记录，禁止缓存。测试修改真实 SQL 公开 payload 会使就绪失败，而存活仍成功；不会用索引展示字段代替公开摘要检查。

健康 CLI 在 direct 模式通过 Node HTTPS 验证证书与首个可信来源主机名，最低 TLS 1.2，4 秒超时；不使用 `rejectUnauthorized=false`。公共证书用 Node 信任根。仅私有测试 CA 场景可设置 `TLS_HEALTH_CA_FILE` 为绝对 CA 文件；它只影响健康客户端，不让浏览器/微信或系统自动信任。Dockerfile 已改用这个 CLI，但镜像内挂载与运行仍未验证。

## 可复现的独立本机测试

`npm.cmd run ci:https` 顺序运行 SQLite 与真实 PostgreSQL 两个阶段，每个阶段均严格检查类型，创建专属 `.local/https-tests/run-*` 和两天有效的私有 CA/localhost 证书，再把后端与前端分别生产构建到该目录的 `build/` 和 `dist/`，启动真实编译入口执行同一组六项 Node HTTPS 与 Edge 流程。不覆盖项目原有构建，不连接工作库、不使用真实模型、不修改系统证书信任。正式 106 条历史目录与三条发布工程模拟资料使用不同数据库和 seed，不能混为正式内容发布。

每轮单独保留 `result.json` 与四张工作台/发布页面截图；SQLite 最新摘要位于 `.local/https-test-results.latest.json`，PostgreSQL 的 HTTPS 摘要位于 `.local/https-postgres-test-results.latest.json`，其数据库控制器摘要另存 `.local/postgres-https-test-results.latest.json`。测试目录还含临时私钥与数据库，禁止整目录提交、打包或上传。CI 归档只配置脱敏摘要与明确的 PNG 路径，不含证书、私钥、数据库、密码或目录内构建；远程实际归档仍待运行。不要将测试证书用于生产或手动复用过期证书。

需要 Edge 与 OpenSSL 3+。若 PATH 中旧版工具/配置不正确，显式选用已安装的测试工具路径（不安装或修改全局 PATH）：

```powershell
$env:HTTPS_TEST_OPENSSL = '<absolute-path-to-your-installed-openssl.exe>'
npm.cmd run ci:https
```

控制器生成独立 OpenSSL 配置，不读取或修改主机默认配置。真实服务 TLS 使用 Node 内的 OpenSSL，不使用上述生成工具处理用户连接。工具版本/Node/TLS 引擎版本分别记录，不将“3+”当生产生命周期或安全认证。只复验一种数据库时，SQLite 使用 `npm.cmd run test:https`，PostgreSQL 使用 `npm.cmd run test:postgres:https`；后者必须由自有数据库控制器创建随机凭据并经活 IPC 传入，不能指定工作库或悄悄退回 SQLite。

六组端到端测试：

1. 真实叶证书/匹配密钥/SAN/有效期检查，错误 HTTPS 配置在开库前拒绝；PostgreSQL 阶段另要求错误 CA、错误数据库主机名和明文连接在编译应用启动时失败，并用同一连接池工厂检查实际握手错误。
2. 客户端启用证书验证并显式信任本轮私有 CA，检查授权链/主机名与 TLS 1.2/1.3；不受信 CA、错误主机名和明文请求失败；健康 CLI 成功/不受信失败。
3. HTTPS 登录、Secure/HttpOnly/Strict Cookie、Origin+CSRF、真实 SQL 备注读写和匿名公开隔离。
4. Edge 中真实 React 登录/保存/应用进程重启/刷新/退出，Cookie 安全属性、本地存储不放令牌、桌面和 390px 截图。
5. 编译 HTTPS 发布接口与新 TS 阅读客户端：固定快照、独立批准、自批/CSRF/Origin 拒绝、双版本发布与历史回滚、真实应用重启后会话和历史保留、冻结/恢复不自动复活、关闭能力后的紧急撤回及历史目录不变。客户端经真实 TLS 完成至少 21 次匿名 GET，错误主机名/不受信 CA 各两次拒绝；只暂留未过期的既有资料并标为 stale，清理后不能凭失败请求恢复。批准不发布、撤回清除、停用返回不可用及明确恢复分别核对。
6. Edge 中真实 React 发布页面：独立批准与明确发布、失败保留输入且禁用继续写入、冻结生效和 390px 审阅账号只读；账号 Cookie 保持 Secure/HttpOnly/Strict。

浏览器只对本轮叶证书 SPKI 做进程内特例，`ignoreHTTPSErrors=false`，不修改系统信任；它证明 HTTPS 浏览器业务流程，不证明默认浏览器信任。Node 客户端另行严格验证完整私有 CA 信任与主机名。该区分依据 Chromium 的 [SPKI 测试机制](https://chromium.googlesource.com/chromium/src/+/8402d3c5bc13e018fa75eba650ed881755e0223b%5E%21/)，不会把测试特例用于部署客户端。

Windows 用专属测试 IPC 在服务子进程内触发关闭处理器，并等待实际退出；Linux/Docker 的操作系统信号交付仍须实测。最终报告与 TAP 必须恰好六项相符，无跳过/取消/失败；证书链、Cookie、页面、编译入口、应用重启、发布/默认关闭/发布重启、新客户端和夹具停止均明确通过。新增 `publicEducationClientVerified=true` 与整数 `publicEducationClientRequests>=21` 必须来自本轮活 IPC 证明，缺失/旧报告拒绝；根 CI 同时监听 `packages/catalog-core/**` 变化。控制器检查独立随机凭证；CI 拒绝旧四项、陈旧、缺项或伪称公网信任的证明。预检失败单独记录 `controllerFailed`，不虚构已失败的测试数量。

新客户端测试适配仅位于 `tests/https-public-client.ts`，固定测试 origin 为 `https://localhost`，路由到控制器的回环随机端口并严格验证本轮 CA 与 SAN；不经过微信请求适配，不进入小程序产物，也不放宽真实部署配置对 localhost/显式 IP 的拒绝。该结果证明新纯 TS 客户端与编译服务的 TLS 联动，不证明默认公众信任或微信联网。

证书工具预检之前就将本次 HTTPS 报告置为运行中；预检失败写入新鲜失败结果，不遗留旧绿色报告。普通回归实际执行错误的生成工具，检查不会创建数据库，也不会用旧通过结果冒充本轮成功。

真实 PostgreSQL 控制器仍一次正常停止并等待同一进程实际退出。重启日志的 ready 行之后，增加 60 秒预算的认证只读 SQL 就绪观察，进行中的单次连接仍受原 5 秒限制：每次连接失败关闭该连接池，只对同一活进程重试 `SELECT version()`，进程退出或期限到达则失败；不重试业务写入、不更改生产连接限制、不发送第二次停机信号。该检查与 HTTPS/SQLite 证明分开记录。

## 本机实测记录（2026-10-08，第四批）

- 核心 `core-f29c6558-dc72-4a8e-a439-b3965550715b`：7 阶段通过，77 组 Node 回归、42 例离线契约、原生完整 check/test、类型与生产构建通过。
- HTTPS `https-9f42c245-b3cc-410b-8457-ca1fb7bef549`：4/4 通过，无失败/跳过，实际服务已停止；严格私有 CA/主机名、TLS、HSTS、Secure Cookie、真实 SQL 读写、Edge 重启恢复与窄屏退出通过。桌面/390px 截图已查看，没有水平溢出。
- PostgreSQL `postgres-f9e69f47-8cc1-4f38-91c1-fe74dfb2eb57`：修正后新轮次 31/31、完整重启 3 次，`fixtureStopped=true`，夹具 `cluster-bAjHda`。认证 SQL 就绪观察不更改生产连接限制，原有恢复/撤销会话/私有隔离断言保留。
- SQLite 浏览器 `browser-e850cf20-19b4-4476-84ac-c38be05ad7f7`：16/16 Edge 流程，无失败、跳过或重试后通过；这组仍是本机 HTTP，不冒充 HTTPS 或微信真机。
- PostgreSQL 浏览器 `postgres-browser-68aa1fdd-192a-48e3-9712-42759bdcf810`：16/16，`fixtureStopped=true`，夹具 `cluster-ITEi6c`；无失败/跳过/重试后通过，保留真实 PostgreSQL/HTTP 范围。
- Node 为 v22.15.1，TLS 引擎 OpenSSL 3.0.16，独立证书工具 OpenSSL 3.2.4；这些是本机实测版本，不是生产安全或默认浏览器信任声明。测试夹具为 `run-CcRgML`，公有信任/部署/系统信任改动均为 false，真实模型调用 0。

失败轮次保留：`postgres-a07eaa68-e04c-437a-bd5a-8b007625b569` 为 29/31、重启 2 次计入、夹具已停止；第三次重启完成正常检查点并输出 ready 后，认证连接超时，后续检查继续暴露同类连接问题。已增加同一活进程认证 SQL 就绪门禁，必须以修正后新轮次证明通过，不能用过去 31/31 覆盖。HTTPS 试跑 `https-54739f9e-bedc-4965-b05b-4e5d60f12669` 为 3/4：新增窄屏截图后测试误找隐藏的桌面退出按钮；修正为实际移动退出入口后重跑上述 4/4，没有删除退出或会话撤销断言。

## 固定版本发布 HTTPS 扩展验收

当前套件扩充为六项，增加真实编译发布 API、应用重启后的固定历史及默认关闭，以及 React 发布页面。前后端改在每轮目录内构建，发布工程夹具与 106 条历史目录分离。新增两项构建范围/证明门禁单元测试，完整 Node 回归 135/135 通过；调整精确证据归档后，相关 16 项门禁回归也通过。类型检查增加 `tsconfig.https-tests.json`，严格检查 HTTPS 用例及其依赖，不把这称为全仓所有旧测试的类型检查。

第一次 [预检失败报告](../.local/ci-runs/https-b602cf52-4c0b-4c93-8105-8ef49c56f4f6/report.json) 因默认 PATH 的 OpenSSL 1.1.1 不满足工具要求而结束，没有启动数据库或服务；测试计数为 0，不伪造失败用例。显式使用已安装 OpenSSL 3.2.4 后，[第二次完整报告](../.local/ci-runs/https-c8ced74c-a84d-464d-8174-4c82b66f0b82/report.json) 为 2/6 通过、4 项失败，无跳过或取消，[该轮摘要](../.local/https-tests/run-TC1qMo/result.json) 确认 `fixturesStopped=true`。前两项 TLS 检查通过，业务请求触发 3 秒客户端超时，应用重启及发布启动出现 20 秒就绪观察到期，不能记为当前 HTTPS 已通过。

已增加每次编译应用的启动、监听输出、就绪探测、停止请求和实际退出时间摘要，记录固定错误类别及退出码，不写入密码、Cookie、请求正文或原始环境；仅保存于本轮 `application-N.json`。清理按实际 `exit` 事件确认，不以 Windows IPC 管道的聚合 `close` 代替进程退出。磁盘队列较高是当时的诊断线索，不是已经证明的根因。

2026-10-08 20:41 CST，[第三次完整 CI 报告](../.local/ci-runs/https-e9d15843-f52e-4c8f-8af7-73a51704596f/report.json) 实际结束，退出 0，六项全部通过，无失败、跳过或取消；五组类型检查及隔离前后端生产构建通过。[该轮终态摘要](../.local/https-tests/run-7WNBUv/result.json) 为 `scope=compiled-https-sqlite / fixturesStopped=true`，编译入口、发布、默认关闭、发布重启及发布页面证明均为 true。仍采用 3 秒请求和 20 秒启动门限，未重试业务写入、放宽断言或降低持久性。七次编译应用启动均有实际退出 0 的记录，本轮就绪耗时约 0.44–0.65 秒；这只是本机诊断，不是吞吐或线上延迟指标。

四张截图已目视复查：[106 条工作台桌面](../.local/https-tests/run-7WNBUv/https-workbench-desktop.png)、[工作台 390px](../.local/https-tests/run-7WNBUv/https-workbench-mobile.png)、[发布页面桌面](../.local/https-tests/run-7WNBUv/https-publication-desktop.png)、[冻结只读 390px](../.local/https-tests/run-7WNBUv/https-publication-mobile.png)。测试前端为本轮 Vite 生产产物，API 为本轮编译的正式入口；两种测试 seed/数据库未混用，原小程序及工作内容不变。`publicTrustVerified=false / deploymentVerified=false / operatingSystemTrustModified=false / realModelCalls=0`；浏览器仍仅对本轮叶证书 SPKI 使用进程级特例，Node 客户端严格验证私有 CA 与主机名。

## 尚需完成

上文第四批五组本机复核均已结束，当前阶段的独立验收不能拼成当前代码五组全部通过。Compose HTTPS 覆盖实际合并解析通过，但 Docker Linux 引擎尚未运行。本机双数据库 HTTPS 工程验证不能替代容器/卷/密钥挂载、远程 CI、证书续期、最小数据库权限、日志运维、可访问公网环境、真实 AppID 或安卓/iOS 验收。后台专业审校与发布批准也继续独立推进，编辑质量通过不能进入公开内容。

## PostgreSQL 与 HTTPS 联合验收

2026-10-08 22:56 CST，独立 `test:postgres:https` 实际退出 0：[数据库控制器终态](../.local/postgres-tests/cluster-xtpT7q/result.json) 与 [HTTPS 终态](../.local/https-tests/run-FATfxp/result.json) 均为 6/6、零失败/跳过/取消，数据库和 HTTPS 服务已正常停止。前后端为本轮隔离生产构建，实际服务使用 PostgreSQL 18.4；五组类型检查及该阶段完整 Node 139/139 通过。随后新增的 CI 联合门禁另以 26 项专项回归验证，不把它计入上述 139 项历史结果。

六项测试没有缩减：登录与安全 Cookie、Origin/CSRF/RBAC、真实 React 保存与应用重启、固定快照和双版本回滚、冻结/默认关闭/紧急撤回及窄屏只读均重新执行。控制器新建一个历史目录工作台 schema 和两个发布 schema；测试直接查询 PostgreSQL 的备注、106 条目录及固定快照摘要，并确认指定的 SQLite 回退路径始终不存在。两个发布迁移源文件在业务操作后逐字摘要不变，避免将对 SQLite 源文件的写入误算为 PostgreSQL 写入。

四张本轮截图已查看：[工作台桌面](../.local/https-tests/run-FATfxp/https-workbench-desktop.png)、[工作台 390px](../.local/https-tests/run-FATfxp/https-workbench-mobile.png)、[发布桌面](../.local/https-tests/run-FATfxp/https-publication-desktop.png)、[冻结只读 390px](../.local/https-tests/run-FATfxp/https-publication-mobile.png)。页面可读，未见整页水平溢出；它们是 Web/Edge 证据，不是微信真机截图。

联合 CI 要求数据库实际退出、HTTPS 实际停止、恰好六项 TAP 与两份新鲜摘要相符、引擎为 PostgreSQL 且三个 schema 已核对；HTTPS 摘要必须来自控制器绑定的自有路径，起止时间位于同一轮数据库运行内。SQLite 与 PostgreSQL 结果不能互代，完整 48 项迁移/恢复/数据库重启报告也保持独立。

2026-10-08 23:37 CST，新增双阶段的统一 `ci:https` [完整报告](../.local/ci-runs/https-fdcb8c69-b8d4-45b2-ac40-7f8ca04338bd/report.json) 实际退出 0：SQLite 6/6 和 PostgreSQL 6/6 均通过，零失败/跳过/取消；[SQLite 摘要](../.local/https-tests/run-Ln3u7B/result.json)、[PostgreSQL HTTPS 摘要](../.local/https-tests/run-6YKSOi/result.json) 与 [数据库停止证明](../.local/postgres-tests/cluster-p8CG48/result.json) 对应同一轮，数据库最终 `fixtureStopped=true`。这是新入口的首次完整终态，不沿用前面的单阶段报告；GitHub 矩阵仍为五组，远程尚未执行。

上述历史轮次的 TLS 只保护客户端到应用的 HTTPS 连接，当时临时 PostgreSQL 使用回环明文，不能倒填为数据库 TLS、客户端证书或生产最小权限证明。完整数据库套件另有52/52、六次真实数据库重启及正常停止证据，见[数据库连接验收](postgres-transport-security.md#本机实际结果)。当前联合套件的两段加密检查见[同轮连接检查](#https-与数据库-tls-同轮检查)，历史结果不改写。浏览器仍仅使用本轮叶证书 SPKI 特例，Node 客户端严格验证私有 CA 和主机名，没有修改系统信任、对外部署或调用真实模型。

## 数据库连接策略后的 HTTPS 回归

2026-10-09 14:00:44 CST，[首轮失败报告](../.local/ci-runs/https-a1eabb76-68e4-4623-94c0-65bb072dad97/report.json)实际退出1：SQLite 5/6、1失败、零跳过/取消，PostgreSQL阶段未运行。[隔离服务终态](../.local/https-tests/run-kNw5Cw/result.json)确认夹具均已停止。第3项的登录 POST 在3006ms触发原3000ms测试等待上限；其余证书、Edge重启及发布检查通过，不能据此把整轮计为成功。

该历史轮次的日志保留服务生命周期，没有该请求的完整阶段时序，因此超时原因尚未确认；不能直接归因于证书、数据库或机器负载。失败目录与截图保留，重跑不修改代码、等待上限、权限断言或停止证明。

14:05:08 CST，[独立完整重跑](../.local/ci-runs/https-f7ddad4d-384d-4fdc-8b2b-e0c3c6c3e767/report.json)实际退出0：SQLite6/6、PostgreSQL6/6，零失败/跳过/取消。[SQLite终态](../.local/https-tests/run-7z3ttk/result.json)、[PG HTTPS终态](../.local/https-tests/run-5Pb5vw/result.json)和[数据库终态](../.local/postgres-tests/cluster-ysxzgE/result.json)均确认相应夹具停止；编译服务、Secure Cookie、三个PG schema直接查询、应用重启及固定版本发布检查保留原范围。这一轮的通过不证明首轮超时根因已解决，也不等同线上稳定性测量。

两库各四张截图保留在各自新目录，已抽查四张390px图：[SQLite工作台](../.local/https-tests/run-7z3ttk/https-workbench-mobile.png)、[SQLite冻结发布页](../.local/https-tests/run-7z3ttk/https-publication-mobile.png)、[PG工作台](../.local/https-tests/run-5Pb5vw/https-workbench-mobile.png)、[PG冻结发布页](../.local/https-tests/run-5Pb5vw/https-publication-mobile.png)。布局和只读状态可读，无整页横向溢出；它们不是微信真机证据。后续已补齐[请求阶段与日志关联](https-request-diagnostics.md)，新轮次再次出现登录等待响应头超时；原3000ms是socket无活动超时，不是整次请求绝对截止，全部安全断言保留。新证据不能倒推历史超时根因。

## HTTPS 与数据库 TLS 同轮检查

PostgreSQL 联合夹具现只接受带 `verify-full` 与本轮私有 CA 的连接地址，要求活控制器和随机证明，不接受调用者指定工作库、明文、重复参数或目录外的 CA。数据库端使用 SCRAM 并拒绝回环明文；HTTPS 证书和数据库证书由各自独立的临时 CA 签发，不把任一证书加入系统信任。

每次编译应用启动前读取现有数据库连接，关闭观察连接后启动应用；HTTPS就绪通过后再查询新出现的SQL后端。查询按PID联结 `pg_stat_activity`、`pg_stat_ssl` 与角色信息，排除观察连接自身，限定当前应用的受限账号、数据库和schema。每次要求至少一个、最多四个新连接，均使用TLS1.2或1.3、加密位数至少128；七次启动全部核对才可通过。当前诊断另保存临时数据库角色标识、无高权限/所有权/成员关系等属性，用于证明不是观察工具的连接；不保存SQL正文、业务账号、连接地址或凭据。此前15:14的历史记录只有PID与传输字段，不能倒填为角色验证。[PostgreSQL 18 连接统计](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW)

错误数据库 CA、错误主机名和明文连接既要使编译入口启动失败，也要通过应用连接池工厂取得预期的握手或认证拒绝。HTTPS 子控制器、数据库控制器和 CI 分层核对新鲜证据与实际停止；缺少任一拒绝检查或七次连接证明均不能通过。SQLite 不声明数据库 TLS，相关计数必须为0。原六组业务、发布、重启及三类受控停滞检查继续保留。

2026-10-09 15:14:00 CST，[同轮联合 CI](../.local/ci-runs/https-ddced1cd-27cb-47ff-b782-bcb04f452dca/report.json)实际退出0，SQLite6/6、PostgreSQL6/6、零失败/跳过/取消，全部服务和数据库正常停止。[SQLite摘要](../.local/https-tests/run-Xku1SK/result.json)、[PostgreSQL HTTPS摘要](../.local/https-tests/run-nM0Sg2/result.json)和[数据库终态](../.local/postgres-tests/cluster-yQ6Rqc/result.json)属于同一轮。PG七份 `application-N.json` 各包含一个新 SQL 后端，均为 TLS1.3、256位；三项数据库拒绝检查及三个实际业务 schema 核对通过。两库各七个应用实际退出0、各106次请求编号精确关联、零诊断丢弃，三类停滞注入仍通过。

数据库正常关机超过 `pg_ctl` 初次观察窗口，控制器继续等待同一自有进程至实际退出，没有第二次停机信号、强杀或降低持久性。两库各四张截图独立保留，四张390px工作台/冻结发布图已查看，未见整页水平溢出；这是 Edge 页面证据，不是微信手机验收。完整PG52项/六次数据库重启、完整HTTP页面各41项和独立演示本轮未重跑；生产强制数据库TLS、最小权限、容器、远程CI、公网与真人审校仍需分别验收。

## 生产数据库连接拒绝策略

共享连接池现根据 `NODE_ENV=production` 强制显式 `verify-full`，服务与操作者工具一致，显式生产仓储配置也不能绕过。联合套件第一项增加编译服务、初始化、迁移验证、备份、账号初始化与容器初始化的生产明文拒绝检查；可信TLS下的七次应用启动与原六项业务仍需全部通过。

2026-10-09 15:35:37 CST，[本轮双阶段终态](../.local/ci-runs/https-c5245cb0-05dc-400f-8779-81e4f0e71b2c/report.json)实际退出0，两库各6/6、服务与数据库正常停止。PG七次实际SQL连接均TLS1.3/256位，没有创建被拒绝的schema或测试备份；首轮容器错误格式误判导致PG5/6的失败保留，详见[生产约束记录](postgres-transport-security.md#生产连接约束验收)。只叠加现有HTTPS容器覆盖仍不满足数据库TLS前提；没有容器、远程、公网或微信真机运行证据。

## 生产权限门禁与受限角色联合验收

2026-10-09 17:30:05 CST，[备份用途隔离后的双库终态](../.local/ci-runs/https-410f7dbc-eca8-4f45-a255-73b796a4bc10/report.json)实际退出0，两库各6/6、零失败/跳过/取消，全部应用与数据库正常停止。[SQLite摘要](../.local/https-tests/run-7iXMrP/result.json)、[PG摘要](../.local/https-tests/run-OqArnO/result.json)和[数据库终态](../.local/postgres-tests/cluster-fLcGsp/result.json)为本轮独立证据。PG七次application逐条确认container/runtime-file、实际非高权限角色和TLS1.3/256位连接，全部退出0。五个生产明文操作者拒绝保留，备份密钥仅注入备份命令；每库106次请求精确关联与三类停滞通过。关机检查点实际完成后才确认停止，没有强杀或第二次停机信号。八张截图未目视复查，不计新的布局/微信验收。

2026-10-09 16:58:28 CST，[容器凭据分离后的双库HTTPS终态](../.local/ci-runs/https-a6384d84-1ab4-4dca-bd1f-58a9035b47ba/report.json)实际退出0，两库各6/6、零失败/跳过/取消，全部服务和数据库正常停止。[PG HTTPS摘要](../.local/https-tests/run-oUXX4h/result.json)与[数据库终态](../.local/postgres-tests/cluster-dfItzR/result.json)对应同一轮：七次应用启动现均经过真实编译容器入口、只注入运行连接文件路径；逐次application记录标记container/runtime-file，并观察实际受限角色及TLS连接。五个生产明文操作者拒绝保留，容器init改用所有者专用文件。每库106次请求精确关联与三类停滞通过，截图未目视复查。这是主机进程入口验证，不是Linux容器或秘密挂载证明，详见[凭据分离](container-credential-separation.md)。

生产业务仓储现强制使用自身连接执行只读权限检查，所有者、超级用户、角色切换、额外/缺失权限及未知对象均拒绝。HTTPS联合夹具为三个独立schema各建立非超级用户所有者和受限运行角色；迁移与授权在操作者阶段完成，常驻应用只接收自己的运行连接，不持有迁移角色凭据。schema之间不授予表访问，历史保护函数的PUBLIC调用权限只在这些自有夹具中显式撤销，不修改正式迁移SQL或工作库。

2026-10-09 16:43:09 CST，固定审计事务系统搜索路径后的[最终双库HTTPS终态](../.local/ci-runs/https-de4e7474-7bff-4c9e-a4d5-b831d6d85291/report.json)实际退出0，两库各6/6，零失败/跳过/取消，全部服务与数据库正常停止。[SQLite摘要](../.local/https-tests/run-meog4j/result.json)、[PostgreSQL HTTPS摘要](../.local/https-tests/run-rJsBmZ/result.json)和[数据库终态](../.local/postgres-tests/cluster-ujLmhS/result.json)对应同一轮。PG七次实际编译应用连接均通过受限角色检查与TLS验证，三个schema各自使用独立所有者/运行角色；每次实际SQL后端的属性与加密状态另存于该轮application记录。两库各106次请求精确关联和三类停滞检查保留；截图未在本轮目视复查，不作为新的布局或微信验收。

16:19:35 CST，[首次生产权限双库HTTPS](../.local/ci-runs/https-27e6bbc2-1786-4760-83fa-54394154e454/report.json)实际退出0，两库各6/6、零失败/跳过/取消，应用与数据库正常停止。[PostgreSQL HTTPS摘要](../.local/https-tests/run-DEdeex/result.json)与[数据库终态](../.local/postgres-tests/cluster-ycBT2v/result.json)属于同一轮：七次编译应用的新SQL后端均为TLS1.3/256位，且使用对应schema的独立运行角色；实际属性确认非超级用户、无建库/建角色/复制/绕过权限、无继承/成员关系及schema所有权。该轮早于固定系统搜索路径的加固，不代替上方最终代码复验。

首项同时让真实编译入口分别面对高权限账号、额外目录UPDATE和缺少备注UPDATE，全部以固定权限错误拒绝，不自动授予或修复；既有生产明文、错误CA/主机名拒绝与五个操作者入口保护保留。原六项登录、CSRF/RBAC、应用重启、固定发布、撤回/冻结及Edge交互全部重跑。子控制器、数据库控制器与CI均拒绝缺少七次受限角色或门禁验证字段的旧证明，SQLite相关计数仍必须为0。

两库各七个应用、各106次请求精确关联和三类受控停滞仍通过。截图生成但本轮尚未目视检查，不作为新的布局审阅或微信真机证据。容器运行/所有者秘密及独立备份密钥的分配已有[编排配置](container-backup-recovery.md)，实际引擎、秘密挂载与卷仍待验；公网、专业签审、微信双端和远程CI不由本轮替代。完整数据库迁移/恢复与核心回归结果另行记录，不拼接成全部范围同时通过。
