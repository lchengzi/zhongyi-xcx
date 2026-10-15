# 容器演示与部署边界

本阶段为已有 React/Express/PostgreSQL 工程补齐容器入口，不重写小程序、不调用真实模型、不发布待审内容。提供的是**仅本机回环的 HTTP 演示编排**，不是生产或 HTTPS 部署。Docker Desktop已启动，Linux引擎因WSL运行前提未满足尚未就绪；配置和主机测试不等于镜像运行证明。

另有独立的[受限账号编排及凭据分离](container-credential-separation.md)：生产命令分别要求运行或迁移文件，拒绝旧共用文件；该配置依赖已准备好的TLS数据库与不同角色，不与本页HTTP演示合并。[备份密钥与归档配置](container-backup-recovery.md)只扩展两个一次性服务，常驻应用不持有备份秘密。编译入口实测与Docker引擎验证分别记录。

## 本机引擎运行前提

2026-10-13 图片文件运维接续：新增独立 [三项文件操作配置](container-photo-operations.md)，不接数据库密码、不开放网络、只恢复新目录。Dockerfile补入编译图片CLI，构建阶段仍执行十组严格检查，未将私有照片或运维密钥加入镜像。宿主编译入口实际导出/校验/恢复通过，Compose配置解析通过；本次只读引擎检查仍返回服务端管道不存在，不重复启动或擅改WSL组件。

2026-10-11 新增资料检查时，平台全回归发现构建输入再次落后于工作区：日常类型检查已为九组，容器仍只复制七组，并缺少客户端联调引用的共享核心。现已改用工作区根作为构建上下文，Dockerfile 位于 `zhongyi-platform/Dockerfile`，专用 `Dockerfile.dockerignore` 仅允许平台构建源码、九份配置、唯一公开 seed 和 `packages/catalog-core/src`。目录布局在构建阶段保留相对导入；测试和共享客户端源码不复制进运行镜像。两份 Compose 已使用相同上下文，平台目录的 Compose 命令不变。专用排除文件的行为见 [Docker 官方说明](https://docs.docker.com/build/concepts/context/#filename-and-location)。这仍是配置与本机检查，不是 Linux 镜像构建/运行证明。

若直接构建，在工作区根目录执行 `docker build -f zhongyi-platform/Dockerfile --target runtime -t food-education-demo:local .`；不要在平台目录沿用 `docker build .`。先确保引擎可用，再执行，不在缺少引擎时循环启动或重试。

2026-10-11，普通本机权限下已启动安装好的Docker Desktop并观察到后台进程，未重复启动。`wsl --status`明确报告WSL2因虚拟化未启用无法启动。独立只读组件查询确认：`Microsoft-Windows-Subsystem-Linux`为1（启用），`VirtualMachinePlatform`为2（禁用），状态含义见[微软组件状态说明](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-optionalfeature)。系统同时报告`HypervisorPresent=true`；不据处理器字段的false值认定CPU不支持或必须修改BIOS。

下一步先由用户确认启用虚拟机平台，按[微软WSL安装说明](https://learn.microsoft.com/zh-cn/windows/wsl/install-manual#步骤-3---启用虚拟机功能)完成组件与用户控制的重启，再重新核对WSL和引擎。当前没有启用组件、执行安装、改固件或重启电脑。两条等待中的只读Docker查询已中止且返回退出码1，未取得服务端版本，不把等待当作引擎通过；完整[诊断记录](../.local/docker-engine-readiness-20261011/report.json)保留原始WSL输出及结构化组件值。未拉取或构建镜像、创建容器或项目数据库；Docker Desktop后台保留供用户查看。

## 构建输入修复与主机验证

2026-10-11 03:47 CST，修复镜像构建输入遗漏：`npm run build` 已包含七组类型检查，但原 Dockerfile 和白名单只有两份 TypeScript 配置，没有后续五份测试配置、Playwright 配置及对应测试源码。新增回归在修复前实际失败于 `tsconfig.publication-tests.json absent from build context`；补齐后 Docker 专项 2/2 通过。完整类型检查保持不变，未改成跳过测试类型的构建命令。

构建阶段现在允许测试 TypeScript 源码，不允许测试归档、数据库或本地输出；运行阶段仍不复制测试、Playwright 或 TypeScript 配置。[按当前 COPY 清单重建的主机验证](../.local/docker-build-inputs-0747a687-7710-40de-9293-9e6219703759/report.json)复制179份输入，实际执行七组类型检查、Vite及后端编译，部署专项16/16通过，原文件和副本摘要一致。该验证使用现有Windows依赖，不执行镜像内`npm ci`，不替代Linux镜像构建、依赖安装或容器启动证据。

同轮`docker version`仅返回客户端28.4.0，`desktop-linux`服务端管道不存在。启动已安装Docker Desktop的权限审批超时，启动命令未执行；这不是Docker启动失败或操作被判定不安全。引擎就绪后仍需实际构建、记录镜像摘要，并执行下文的数据库初始化、接口、持久化及恢复验收。此次未拉取镜像、创建容器或公开服务。

## 实现范围

- `Dockerfile` 分源码构建、生产依赖和非 root 运行三个阶段，由 Node 直接启动，不经过 shell。前端是生产构建，运行镜像只复制编译服务、共享契约、初始化/账号/迁移/备份/运行角色操作者、容器入口、就绪 CLI 和已核对公开 seed；不包含原生项目私有研究层。
- `.dockerignore` 全部排除后仅允许必要源码、配置和唯一 seed，并再次排除环境文件、数据库、备份与常见私钥。真实构建上下文仍需引擎检查，文本检查不能替代。
- 服务默认继续监听 `127.0.0.1`。显式 `BIND_HOST=0.0.0.0` 必须配合账号和精确可信来源，禁止本地密钥模式网络监听。配置在开库前校验，错误不会先创建 SQLite。
- Compose 数据库不发布主机端口，应用只映射 `127.0.0.1:4310`；应用只读文件系统、临时目录、移除 capabilities、禁止提权与容器日志轮转已配置，未宣称 Linux 实测通过。
- 数据库密码和连接字符串分别以文件 secret 授予必要服务，不写入 Docker 层、Compose 环境值或参数。读取限制 8 KiB、绝对普通文件、整条路径无链接，校验文件 ID/长度并限制实际读取。Windows 路径 stat 设备号为 0 的差异已处理；Linux 继续比较设备号并使用 `O_NOFOLLOW`。
- `init --schema NEW` 从公开 seed 与真实当前 SQLite 迁移生成专属临时源，复用事务式 PostgreSQL 迁移；私有表和账号为空，不继承工作 `DB_PATH`，不造测试账号或迁移时间。已有 schema 拒绝，不自动覆盖、初始化或切流。

镜像标签已核对官方 [Node 清单](https://github.com/docker-library/official-images/blob/master/library/node) 与 [PostgreSQL 清单](https://github.com/docker-library/official-images/blob/master/library/postgres)，使用 `node:22.23.3-bookworm-slim`、`postgres:18.6-bookworm`。标签不是不可变 digest，引擎就绪后记录拉取的 digest、平台和镜像 ID。本机数据库夹具是 Windows PostgreSQL 18.4，不能冒充上述 Linux 镜像兼容性证据。结构参考 [Docker Node 指南](https://docs.docker.com/guides/nodejs/) 和 [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)。

## 前置条件

1. 用户启动 Docker Desktop Linux 引擎；`docker version` 返回服务端版本，仅有 Compose 客户端不够。
2. 确认可下载镜像/锁定 npm 依赖且有足够空间；以下命令不上传镜像、不创建云资源、不发布公网服务。
3. 首次使用全新项目名/密钥；已有演示必须复用原项目名、密钥和卷。重新生成密码不会给旧卷自动改密。
4. 密钥不进截图、仓库或云同步目录。Linux 主机需确认应用 UID 1000 能读其连接文件；文件型 Compose secrets 不保证 UID/GID 重映射，不能靠 `mode` 配置代替实测。Windows 人工检查 ACL，`0600` 不是 ACL 证明。文件挂载不是加密秘密管理服务，授权主机用户和 Docker 管理员仍可访问。

## 首次本地演示

在平台目录逐条执行，**任一步退出码非零就停止**，不要继续初始化或启动。Compose 显式读不含秘密的 `.env.example`，避免自动读工作 `.env`；应用本身不自动加载环境文件。

```powershell
# 仅打印新密钥目录路径，不打印数据库密码或覆盖旧目录。
$env:CONTAINER_SECRET_DIR = npm.cmd run --silent container:prepare
if ($LASTEXITCODE -ne 0) { throw '密钥准备失败，停止' }
$env:COMPOSE_PROJECT_NAME = 'food-demo-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
# 保存下面两个定位信息，下次终端恢复原值，不重新生成。
$env:CONTAINER_SECRET_DIR
$env:COMPOSE_PROJECT_NAME

docker compose --env-file .env.example --profile operator config --quiet
docker compose --env-file .env.example build app
docker compose --env-file .env.example up -d --wait postgres
docker compose --env-file .env.example --profile operator run --rm operator init --schema food_demo
docker compose --env-file .env.example --profile operator run --rm operator bootstrap your-admin-name
docker compose --env-file .env.example up -d --wait app
```

管理员初始化会在操作者终端显示一次随机密码，没有通用初始密码；不要录屏或分享终端。Compose 不继承主机初始化密码、模型或备份密钥。已有账号库拒绝再次 bootstrap，不重置管理员。

访问 `http://127.0.0.1:4310`，登录、搜索、保存备注，刷新确认，再 `docker compose --env-file .env.example restart app` 查看持久化。数据库卷重建/停机恢复须另行演练，不能仅重启应用就宣称通过。

第四批起 Docker 健康入口改为证书验证兼容的 SQL 就绪 CLI，校验公开目录投影/版本/摘要，不代表全部私有表或业务健康；`/api/health` 仍仅存活。还需检查登录权限、备注读写、私有隔离和断库错误。直接 HTTPS 已有独立本机入口/测试，见 [HTTPS 说明](https-runtime.md)，此 HTTP Compose 未自动升级或挂载证书；微信仍需真实 AppID/域名与真机证据。

`migrate --verify` 表示与**最初导入快照逐行完全相同**，应在 bootstrap/业务写入之前使用。创建账号后 `roundtrip_mismatch` 表示已有合法数据变化，不是运行健康检查失败，不能为了通过而清空数据；运行时验证结构/来源并测试真实 API。

## 停止、备份与恢复

`docker compose --env-file .env.example stop` 正常停止。新终端恢复原 `CONTAINER_SECRET_DIR` 与 `COMPOSE_PROJECT_NAME` 再启动，不重复 `container:prepare` 或改名后误判丢数据。

不自动清卷，不提供 `down -v`、prune、删密钥或覆盖工作库步骤。数据库配置较长停止宽限期，给慢磁盘检查点留出时间；真实 Docker 停机仍需验证。

[现有加密业务恢复](backup-recovery.md) 已在独立本机 PostgreSQL 测试，容器输出挂载/独立密钥/只读目录尚需一起验证。临时目录文件不算持久备份，named volume 或 `docker export` 也不是已验证灾备。升级前准备可恢复备份，本阶段不切换工作库。

## 公网生产 HTTPS 待完成

当前 HTTP Cookie 不带 Secure，数据库初始化用户权限较高，不能直接暴露公网；仅改端口或 `NODE_ENV` 不等于生产部署。

生产共享连接池现要求 `sslmode=verify-full`，服务与初始化/迁移/备份操作者均不接受生产明文。默认 Compose 的 postgres 服务没有 TLS，生成的本地演示 URL 也没有该参数；因此只叠加 `compose.https.yaml` 会在数据库连接前失败，不能直接拿它当双段加密容器。需另行配置 TLS 数据库、正确主机名与只读 CA 挂载，并在真实引擎验证；当前没有这些容器运行证据。参见[数据库连接策略](postgres-transport-security.md#部署边界)。

后续确认真实域名/证书/环境；应用与迁移角色已有[权限策略、生产门禁及HTTPS联合验证](postgres-runtime-permissions.md)，默认HTTP演示仍保留原账号，生产路径另见[独立受限账号编排](container-credential-separation.md)。生产容器入口拒绝共用连接文件，业务仓储拒绝结构所有者/超级用户以及额外或缺失权限；即使先补数据库TLS，原演示高权限连接仍不满足生产条件，不能降低环境标识绕过。当前先使用Node直接TLS，不需要为演示增加代理。若以后采用TLS代理，须明确受信代理范围，不盲信请求头；验证Origin、Secure Cookie、CSRF、真实客户端限流、证书更新、故障恢复。还需镜像/依赖安全检查、容器实际备份与回滚、日志隐私、远程CI和可访问演示证据。付费、外部发布或生产操作另行确认。

## 第三批验证记录（历史）

2026-10-08：Compose v2.39.4 客户端解析实际 JSON 配置通过，默认 app/postgres、主机绑定 `127.0.0.1`、数据库无主机端口；再以 `--profile operator` 实际解析三服务，操作者无主机端口、固定初始化命令且环境中无连接明文值。未启动引擎、拉取镜像或运行容器。

新增 8 组普通回归覆盖监听/来源/生产配置、受限密钥读取、随机独立密钥、YAML/镜像结构、真实错误启动前不建库与入口冲突；新增 3 组真实 PostgreSQL 测试覆盖新库、编译操作者入口和编译服务器 HTTP/重启。Windows 用测试专属 IPC 在子进程内触发 SIGTERM 事件测试关闭处理器，不冒充 Linux/Docker 信号交付。

四组最终本机记录均通过（Windows / Node v22.15.1，`commit=null`、`deploymentVerified=false`）：

- 核心 `core-b91546a7-5655-4007-a747-22ae48db62e0`：7 阶段，69 组 Node、42 例离线契约、完整原生 check/test、类型与生产构建通过。
- 数据库 `postgres-6d12659b-27d8-43f4-aba7-742e413af454`：31 组、数据库完整重启 3 次、`fixtureStopped=true`，夹具 `cluster-SEMm1k`。
- SQLite 浏览器 `browser-b1609f37-7f02-4838-b73b-50d8dc2bcd87`：16 组 Edge，无失败/跳过/重试通过。
- PostgreSQL 浏览器 `postgres-browser-b8ef308f-b419-4b5a-916a-76493fe24653`：16 组、`fixtureStopped=true`，夹具 `cluster-qdkcxc`。

独立报告在 `.local/ci-runs/<轮次>/report.json`，失败试跑也保留。试跑修正 Windows 文件 stat 差异、保留原本机启动 URL 日志，以及把初始快照验证放在 bootstrap 之前；没有放宽原有逐行迁移断言。前端生产资源摘要对应文件名未变，未修改 Web UI 或正式小程序内容/安全制品；`.10` 的 12 件制品仍验证通过。

Docker build/up、镜像内 Node、Linux PostgreSQL 18.6、卷/密钥挂载权限、Linux 信号、HTTPS、远程部署和双端真机仍未验证。未操作工作库、调用真实模型或发布外部内容。

## 第四批：直接 HTTPS 与 SQL 就绪（本机，非容器）

新增 `compose.https.yaml`：仅覆盖应用 TLS/生产配置和两个证书 secret，默认回环端口与操作者环境不变。实际 Compose 客户端合并 JSON 解析确认应用 direct、操作者 off、三个应用 secret（数据库 URL/证书/私钥）和回环绑定；这是占位路径配置检查，没有读取真实密钥或启动容器。Docker Linux 引擎重新检查仍不可达。

独立 Node/Edge 本机 HTTPS、真实 SQL 就绪、Secure Cookie 与应用重启已通过，普通核心测试增至 77 项；PostgreSQL 新轮次 31 项/3 次重启通过。最终独立轮次及失败修复见 [HTTPS 工程记录](https-runtime.md)。直接 TLS 不要求代理；代理模式尚未实现，不能通过伪造转发头启用。

本节不覆盖上方第三批历史结果，也不把 Windows 编译入口、私有 CA 测试或 YAML 解析当成 Docker 镜像、Linux 挂载、公网信任、生产最小权限或微信验收。

## 后端请求诊断

编译入口已接入最少字段 JSON 请求日志与服务端 `X-Request-ID`，不记录原始 URL、正文、Cookie、令牌或健康信息。连接中断与完成区分，日志输出故障不改变业务响应；本机实际编译服务专项已通过，见[复现与边界](request-diagnostics.md)。运行时只输出到标准输出，部署后的保存期限、访问权限、轮转和磁盘容量仍需验证。显式本地开发密钥模式的既有启动输出可能含一次性密钥，不能分享整个进程日志。
