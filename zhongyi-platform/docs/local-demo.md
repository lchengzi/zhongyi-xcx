# 独立本地演示与复现

这套演示用于展示真实的 React 页面、Express API、账号权限和 SQLite 持久化协作，不连接工作库，也不要求 Docker。它保留已有 106 条历史目录投影，所有新来源、备注与草稿只写入独立演示库。教育内容发布和外部 AI 调用固定关闭，不预置专业资格、查证通过或发布批准。

当前目录来自 2026-08-10 的资料快照，release 为 `release-2026.08.13-complete-public-projection.10`，不是 2026 年 10 月的最新完整目录。演示不改变原生小程序内容、规则、照片或配方。

## 准备和启动

需要项目依赖已安装及 Node.js 22.13+。在 `zhongyi-platform` 目录使用非生产终端执行：

```powershell
npm.cmd run catalog:check
npm.cmd run build
npm.cmd run demo:prepare:compiled
```

最后一个命令会输出新建的演示ID、私有凭据文件位置，以及可以直接复制的启动命令。选择输出中的 `npm.cmd run demo:start:compiled -- 演示ID`，保留实际完整ID，再打开 `http://127.0.0.1:4314`。它直接用Node运行 `build/tools/local-demo.js`，不加载tsx；React与后端均使用已构建文件。代码修改后先重新执行 `build`，此入口不自动热更新。

原有 `demo:prepare` / `demo:start` 继续提供TypeScript源码CLI；两种CLI复用同一安全检查，可使用同一个演示ID。另有编译正式服务入口 `build/server/index.js` 的独立自动验收，不能用常规 `npm start` 替代演示命令：常规入口使用配置的工作库，手动演示入口只使用已准备的专用库。

每次 `demo:prepare` 或 `demo:prepare:compiled` 都新建一个目录，不覆盖旧演示。已有演示只需使用原ID启动，不要为了再次打开而重新准备。固定目录结构为：

```text
.local/local-demo/demo-随机UUID/
  catalog.seed.json    准备时固定的历史目录
  editorial.sqlite    独立关系型数据库
  credentials.json    三个角色的随机密码，仅供本机演示
  demo.json           完成标记和目录身份，不含密码或任意数据库路径
```

在本机安全查看 `credentials.json`，分别使用 `demo-admin`、`demo-editor`、`demo-reviewer` 登录。密码彼此独立、随机生成；应用数据库仅保存加盐 scrypt 散列。凭据文件为了复演而保留明文密码，不能上传、录屏或随项目交付。`.local/` 已被版本控制忽略；代码使用私有文件模式，但这不证明 Windows ACL 已限制其他本机账户访问。

按Ctrl+C请求正常停止，看到 `Local demo stopped` 后再关闭终端；数据库和凭据均保留。复制同一启动命令即可继续原演示。命令可追加 `--port 4315`；必须使用启动输出的精确 `127.0.0.1` 地址。端口占用时直接失败，不接管其他服务。自动测试验证的是应用信号处理程序和正常退出；本人终端快捷键与录屏操作仍需亲自复演。

## 录屏或现场演示顺序

1. 编辑登录，搜索黄芪，打开详情，解释历史来源日期和待专业审校状态。保存一条明确标注“演示”的备注，查看修订号和操作记录。
2. 进入内容协作，登记演示来源。可使用 `https://example.org/local-demo-not-professional-evidence` 和明确的占位标题；它只验证来源登记流程，不是真实资料依据，系统不会抓取该网页。
3. 选择食材，填写非医疗的演示教育说明、安全边界，引用来源固定版本和定位，保存私有草稿后提交编辑审阅。
4. 在另一独立浏览器会话以审阅者登录。查看固定正文和出处，填写意见，退回修改或选择“通过编辑审阅（不发布）”。强调编辑通过不等于中医师或药师签审。
5. 编辑重新加载草稿，检查状态、反馈和不可变历史；审阅者在资料页的备注为只读，写入权限也由服务端检查。
6. 正常停止服务，再用相同 ID 启动。登录或恢复未过期的会话，确认备注、草稿、固定来源和审阅状态仍在。
7. 对比匿名 `GET /api/v1/public/catalog`：新私有内容没有混入历史目录。`GET /api/v1/public/education/huang-qi` 返回 503，表示此演示固定关闭教育内容公开能力，而非已经发布。

不要在演示中输入健康档案、真实个人信息、模型密钥或真实专业证件。后台账号角色只是软件权限，不是职业资格。录屏前关闭凭据文件和登录密码输入页面。

## 隔离和失败处理

准备和启动使用明确的 SQLite 路径、账号模式和回环监听，不采用继承的 `DB_PATH`、`DATABASE_URL`、账号密钥、可信来源、TLS、发布或 AI 配置。AI provider 和额度也显式传入，避免从终端意外启用外部调用。`NODE_ENV=production` 仍会拒绝本机 HTTP 演示，不绕过项目生产 HTTPS 校验。

ID 只接受生成的格式，不接受文件路径。所有文件路径拒绝符号链接或 junction，包括目标已经不存在的悬空链接。准备成功后才写最终完成标记；启动前校验标记、固定目录摘要和数据库内的演示归属，并要求数据库和构建页面已经存在。缺文件、混用了另一个演示库、正文被篡改或启动失败时均报错，不自动创建替代库、不切换工作库。

归属标记用于防误用，不是抵抗本机文件管理员篡改的签名。启动错误不会删除目录、重置密码、修复数据或强制结束进程。中断准备留下的目录不可启动，可重新准备一个新演示；清理旧目录另行确认，不提供自动递归清理。

## 自动验收

```powershell
npm.cmd test
npm.cmd run demo:verify
```

第一条包含八项演示测试：独立数据库和随机账号、坏路径与替换数据库、端口占用后的重新打开、正常及悬空链接、生产模式拒绝、真实CLI进程的权限与数据重启、编译演示启动器拒绝非法参数/缺少构建，以及手动编译命令契约。另有 `tsconfig.local-demo-tests.json` 纳入统一类型检查，使用严格Node类型，不为响应JSON加入DOM或关闭检查。

第二条先执行完整 `build`，包含七组严格类型、React生产构建和后端编译，再用已安装的Edge依次验证源码CLI、编译正式服务和手动编译CLI三种运行方式。每条链路新建自己的106条演示库，经界面完成来源、草稿、提交和独立编辑通过，正常停止实际进程，再启动并检查持久化、只读界面和390px布局。额外复查专业审校查询失败、局部只读重试和详情失败时的输入保护；恢复期间零写请求、固定记录前后一致。最终正常关闭浏览器和应用，每条链路保留自己的 `browser-proof.json`、`desktop.png`、`governance-recovery.png` 和 `narrow.png`；凭据不写入报告或截图。

每条页面链路还在同一后端进程重启前后运行[原生六页任务链](../tests/mini-demo-flow.ts)：实际载入目录、详情、收藏、对照、咨询准备和隐私页的JS函数，主动读取同一SQL公开目录，验证拼音搜索与命中说明、来源复制、收藏与对照、清单及咨询复制、离线回退、红旗阻断和删除后返回。每次任务链仅一次真实GET，无请求体，应用仅设置Accept头；浏览、收藏、对照与复制不追加请求。检查全部模拟存储写入，不只检查删除后的空记录；合成健康名称不进入请求、持久记录、复制内容或返回后的页面。后台私有草稿和来源仍不得进入106条历史投影。

这段联调真实使用HTTP、SQL和实际服务进程，但`wx.request`传输、存储、剪贴板、确认及导航均为测试替身：公开地址只在模块内存中映射到本机回环服务，不改小程序网络配置，不关闭域名校验。详情和删除后的导航核对调用地址，不证明分包加载或微信渲染；服务重启后的第二轮重新运行用户任务，不宣称模拟本地记录跨调用持久化。报告仅保留计数及布尔结论，不保存健康测试内容。HTTPS、微信编译与三端真机须单独验收。

同一命令另执行一个手动编译CLI专项：真实编译准备命令为三条食材的测试目录准备专用库，在恶意继承配置下仍使用SQLite、账号模式与回环地址，拒绝非法ID/端口、生产模式和占用端口；服务端拒绝越权写入和过期修订，正常重启后保持记录及固定目录副本。三项浏览器演示与一项CLI专项分别留档，不替代完整Playwright套件、PostgreSQL、HTTPS或五组CI。

### 原生页面与同一演示后端联合验收

2026-10-10 01:04:47 CST，扩展后的`demo:verify`实际退出0，4/4通过，零失败、跳过或取消。没有新增另一套后端或改原生运行配置；本轮只扩展既有演示验收与任务辅助函数。

| 验收范围 | 最终报告与终态 |
| --- | --- |
| 源码CLI、React与原生JS | [源码链路](../.local/local-demo/demo-499c78b2-9c1d-4e99-9312-22aa9cacab64/browser-proof.json)，重启前后两轮原生任务通过，不声明编译后端通过 |
| 编译正式服务、React与原生JS | [编译服务链路](../.local/local-demo/demo-cde93906-c515-4646-bacb-adf38124bbb7/browser-proof.json)，真实编译入口、页面JS字节和两轮原生任务通过 |
| 编译CLI、React与原生JS | [编译CLI链路](../.local/local-demo/demo-f3951a9d-4f36-4ca7-9ca8-4ea43c1c7161/browser-proof.json)，实际手动编译入口、编辑协作、失败恢复、持久化和两轮原生任务通过 |
| 三条目录的编译CLI隔离专项 | [CLI专项](../.local/compiled-demo-cli/run-u5Zx6E/report.json)，四类启动拒绝、角色权限、过期写入和重启保留通过，与106条页面链路分开计数 |

三条页面链路各两次实际启动、两次正常停止，工作库摘要不变，测试浏览器及服务均已关闭。共六轮原生任务，每轮九类检查全真，均为一次真实HTTP读取、一次模拟断网失败、两次模拟复制、三次模拟持久写入和两次模拟导航。启动不自动联网，浏览和记录操作不追加请求；红旗阻断候选及复制；删除清空模拟存储、公开缓存、查询、收藏、对照和清单，不在返回时恢复旧健康内容。健康测试标记未进入所有写入记录；报告只保存计数。`wxTransportSimulated=true`、`deviceVerified=false`、`tlsVerified=false`明确保留。

已查看最终编译CLI的[桌面](../.local/local-demo/demo-f3951a9d-4f36-4ca7-9ca8-4ea43c1c7161/desktop.png)、[读取失败恢复](../.local/local-demo/demo-f3951a9d-4f36-4ca7-9ca8-4ea43c1c7161/governance-recovery.png)及[390px只读页面](../.local/local-demo/demo-f3951a9d-4f36-4ca7-9ca8-4ea43c1c7161/narrow.png)。错误时未提交文字保留且操作停用，审阅角色不可修改备注；这些仅为Edge管理端图像，不是原生页面或手机截图。

首轮[源码](../.local/local-demo/demo-2eff94a1-af53-4a88-b152-4b5ab08d83d1/browser-proof.json)、[编译服务](../.local/local-demo/demo-780344ab-daad-4860-b35d-1c7a863a6f0f/browser-proof.json)及[编译CLI](../.local/local-demo/demo-cb42d16c-a295-4eca-8f76-5063f90668ec/browser-proof.json)保留失败终态，均正常停止。原因是新增辅助函数错误假设详情存在`partReviewText`；实际待复核文字位于`identityFacts`。修正测试取值，不改产品字段、目录或规则；后续加入全程写入及导航核对后，以上四项完整重跑通过。中间一次完整通过和单项定位通过不冒充最终版本结果。

01:07:54 CST，[核心八阶段](../.local/ci-runs/core-583c010a-8176-4606-9207-b2b8f8e68959/report.json)实际退出0：七组严格类型、216项平台、42例离线、原生完整检查/26脚本、生产构建及[编译日志1/1](../.local/request-log-runs/run-3U6nTf/report.json)通过。独立演示仍单独计4项；核心后两种编译入口摘要与最终演示记录一致，专用日志服务正常停止、工作库未改、真实模型调用0。完整管理端页面套件、PostgreSQL恢复、HTTPS、容器、公网、远程CI及微信三端不能由此推导通过。

### 目录搜索时序回归

2026-10-10 01:49:19 CST，本轮`demo:verify`实际退出0，4/4通过。沿用同一三种服务入口、React协作及重启前后原生六页任务，不新增演示接口。原生搜索现在使用模板对应的当前事件版本；每轮另检查输入后立即清空、继续查看并等待旧延迟窗口，24条展开结果不收回；键盘确认立即应用黄芪查询，不追加HTTP。隐私删除后重复送达旧输入与确认，查询仍为空。

本轮独立证据：[源码CLI](../.local/local-demo/demo-34784e4c-6e0d-4337-b790-d7ac7957100c/browser-proof.json)、[编译正式服务](../.local/local-demo/demo-e1c36212-1ffe-49ba-98b1-ebbd907a4af7/browser-proof.json)、[编译CLI](../.local/local-demo/demo-09d61385-0424-47ce-8f73-0161a92b6a35/browser-proof.json)和[三条目录CLI隔离专项](../.local/compiled-demo-cli/run-Y3Ne0l/report.json)。各页面链路两次实际启动、两次正常停止，六轮各九类原生检查全真；每轮仍只有一次真实HTTP读取、一次模拟失败、两次模拟复制、三次模拟持久写入和两次模拟导航，工作库摘要不变，真实模型调用0。实际服务重启证明SQL协作记录持久化；每轮新的模拟wx存储不作跨进程持久化证明。

已查看最终编译CLI[桌面](../.local/local-demo/demo-09d61385-0424-47ce-8f73-0161a92b6a35/desktop.png)、[失败恢复](../.local/local-demo/demo-09d61385-0424-47ce-8f73-0161a92b6a35/governance-recovery.png)及[只读窄屏](../.local/local-demo/demo-09d61385-0424-47ce-8f73-0161a92b6a35/narrow.png)。仅为Edge管理端，不是小程序图像或手机输入法证据；小程序运行配置未变，仍明确`wxTransportSimulated=true`、`deviceVerified=false`、`tlsVerified=false`。

此前01:47:26 CST，[核心八阶段](../.local/ci-runs/core-b23a73ed-fb28-4e0f-b12a-1cdfd81b0824/report.json)实际退出0：七组类型、224平台、42离线、原生完整检查/26脚本、生产构建及[编译日志1/1](../.local/request-log-runs/run-iDysrY/report.json)。核心与独立演示分别计数；本轮未重跑完整管理端页面套件、PostgreSQL恢复、HTTPS或桌面小程序布局探针，没有微信编译、真机、容器、远程CI或公网部署证据。原生修正、复现基线及三端待验见[搜索状态保护](../../zhongyi/docs/catalog-search.md#搜索清空与返回状态保护)。

### 收藏搜索清空联合验收

2026-10-10 02:37:05 CST，`demo:verify`实际4/4通过、零失败/跳过/取消。三条真实服务链路在每次重启前后均调用原生收藏页函数：旧查询的清空按钮不能清掉新查询；无匹配后清空恢复全部收藏；清空后的旧输入不能恢复查询；重新输入同一名称后旧清空仍失效。未增加网络或持久写入，原详情、对照、咨询、安全阻断及隐私删除检查保留。

独立终态为[源码CLI](../.local/local-demo/demo-39517e44-2c52-4140-a3bd-767eb53629fa/browser-proof.json)、[编译正式服务](../.local/local-demo/demo-19cd3cc5-4e20-4f42-9342-a2921b16331d/browser-proof.json)、[编译CLI](../.local/local-demo/demo-d9c9e9ad-3529-4b07-8ebe-17c3be7cd202/browser-proof.json)及[CLI隔离专项](../.local/compiled-demo-cli/run-Jk8wPE/report.json)。三条页面链路各两次启动、两次正常停止，工作库未改、真实模型调用0；六轮原生九类检查全真，计数仍为每轮一次真实HTTP读取、一次模拟失败、两次模拟复制、三次模拟写入和两次模拟导航。编译服务与CLI入口摘要仍为`a87aa724d52ca1b354e6f104f9a8b2deb94a687398f14bfb936b8bd97d6f9a08`和`26822012ae6ed8efa209502c3c59234100d4f142d48078ecb0af38da94b57185`。

已查看最终编译CLI的[桌面](../.local/local-demo/demo-d9c9e9ad-3529-4b07-8ebe-17c3be7cd202/desktop.png)、[失败恢复](../.local/local-demo/demo-d9c9e9ad-3529-4b07-8ebe-17c3be7cd202/governance-recovery.png)及[窄屏](../.local/local-demo/demo-d9c9e9ad-3529-4b07-8ebe-17c3be7cd202/narrow.png)，以及编译服务窄屏截图。均为本机Edge，不是微信截图；wx接口和设备边界未变。

此前02:34:47 CST，[核心八阶段](../.local/ci-runs/core-2d12de20-55e6-459e-be40-dd1e4d870c90/report.json)通过：224平台、42离线、七组类型、原生完整检查/26脚本、构建及编译诊断1/1。此次不重跑完整管理端页面组、PG、HTTPS、桌面原生布局、远程CI或微信三端。原生102项与实际设备待办见[收藏搜索说明](../../zhongyi/docs/list-action-reliability.md#收藏搜索清空保护)，正式内容和安全制品未改。

### 专业审校刷新隔离联合验收

2026-10-10 02:05:15 CST，本轮`demo:verify`实际退出0，4/4通过，零失败、跳过或取消。三种真实服务入口均确认：列表搜索失败可单独重试且不清空未提交意见；当前固定审校记录读取失败或成功重读，均不触发列表GET。报告的`governancePickerReadsDuringDetailRefresh`均为0，失败截图在两类加载结束后保存，不把并行请求的瞬时状态解释为永久加载。

独立终态分别为[源码CLI](../.local/local-demo/demo-97520601-2347-4d90-a742-869e1f5d59b3/browser-proof.json)、[编译正式服务](../.local/local-demo/demo-c3aeb6d4-6b2c-4406-a871-860b736ef239/browser-proof.json)、[编译CLI](../.local/local-demo/demo-252a7f49-874f-49be-9068-e9086392e983/browser-proof.json)及[三条目录CLI隔离专项](../.local/compiled-demo-cli/run-E7NaT0/report.json)。三条页面链路各两次实际启动、两次正常停止，全部十类检查和六轮原生九类检查通过；工作库未改、真实模型调用0。编译入口SHA仍为正式服务`a87aa724d52ca1b354e6f104f9a8b2deb94a687398f14bfb936b8bd97d6f9a08`、CLI`26822012ae6ed8efa209502c3c59234100d4f142d48078ecb0af38da94b57185`。

最终编译CLI的[桌面](../.local/local-demo/demo-252a7f49-874f-49be-9068-e9086392e983/desktop.png)、[失败恢复](../.local/local-demo/demo-252a7f49-874f-49be-9068-e9086392e983/governance-recovery.png)及[只读窄屏](../.local/local-demo/demo-252a7f49-874f-49be-9068-e9086392e983/narrow.png)已查看。失败时当前对象仍为黄芪，搜索姜不改变对象，原文字保留且按钮停用；列表已完成加载，没有残留详情旧状态。截图仍只证明本机Edge，wx接口模拟和微信三端待验边界不变。

此前02:01:31 CST，[完整管理端页面](../.local/ci-runs/browser-da53b340-ca34-4e1c-a73d-4eef8504844b/report.json)56/56；02:03:28 CST，[核心八阶段](../.local/ci-runs/core-f1c06385-c3e4-482d-a18b-4c781b9d1f98/report.json)实际退出0：224平台、42离线、七组类型、原生完整检查/26脚本、生产构建及[编译日志1/1](../.local/request-log-runs/run-9tqFlD/report.json)通过。56项页面使用TypeScript API夹具，三条独立演示验证指定编译后端链路，两类范围不混用；本轮未重跑PG、HTTPS、容器、远程CI或微信编译，正式内容和小程序运行代码未改。

### 手动编译入口验收

2026-10-09 19:23:34 CST，本轮 `demo:verify` 实际退出0：三项106条目录的Edge演示及一项三条目录的CLI专项，共4/4、零失败/跳过/取消。新增手动编译CLI直接复用已有命令和安全检查，不创建另一套Express应用；没有改变正式内容、安全规则或工作数据库。

| 验收范围 | 独立终态 |
| --- | --- |
| 源码CLI与React | [源码页面报告](../.local/local-demo/demo-03593f93-ac96-4b63-a705-94fb6f4b6355/browser-proof.json)，两次启动/两次正常停止，不声明编译后端通过 |
| 编译正式服务与React | [编译正式服务报告](../.local/local-demo/demo-27d4ff88-e34b-475b-a76d-0ce57efb8a55/browser-proof.json)，两次启动/两次正常停止，编译入口与页面JS字节核对通过 |
| 手动编译CLI与React | [手动编译页面报告](../.local/local-demo/demo-88d8e9b6-4c0e-44dd-a85c-84d413ee3718/browser-proof.json)，两次启动/两次正常停止，资料协作、失败恢复及重启持久化通过 |
| 编译准备与CLI隔离 | [CLI专项报告](../.local/compiled-demo-cli/run-bJW3BS/report.json)，真实编译准备命令、四类启动拒绝、越权403、过期修订409、目录副本与会话重启保留，应用两次正常启停 |

三条页面链路另存九张PNG；已查看新增手动编译入口的[桌面](../.local/local-demo/demo-88d8e9b6-4c0e-44dd-a85c-84d413ee3718/desktop.png)、[读取失败恢复](../.local/local-demo/demo-88d8e9b6-4c0e-44dd-a85c-84d413ee3718/governance-recovery.png)和[只读窄屏](../.local/local-demo/demo-88d8e9b6-4c0e-44dd-a85c-84d413ee3718/narrow.png)。390px自动断言无整页横向溢出，未保存说明保留且停用，错误时不残留专业结论；仍是Edge而非微信真机证据。

[CLI专项](../tests/compiled-demo-cli.test.ts)仅在自己的新目录操作测试资料，不删除旧证据。它故意继承不可用的PostgreSQL地址、工作库哨兵路径、本地密钥模式、网络监听、TLS和模型开关，实际演示仍只用专用SQLite、账号模式与回环地址，AI和教育发布保持关闭；密码及注入的秘密均未进入捕获输出。正常停止后仅将自有项目目录种子改为无效内容，再启动仍使用演示准备时的副本。这不同于编译正式服务要求当前项目目录与演示库目录相符的约束，不将两种入口混用。

测试观察包装器只加载固定编译文件并触发应用既有SIGTERM处理程序，不增加生产关闭接口。该范围不证明终端Ctrl+C键盘事件、实际容器、远程CI、公网部署、真人专业批准或微信双端已经通过；本人复演与外部条件仍需分别落实。

19:26:54 CST，[本轮核心八阶段](../.local/ci-runs/core-3ca052c8-9270-42dd-b068-45f210642b80/report.json)实际退出0：七组严格类型、207项平台、42例离线、原生完整检查/26脚本、生产构建及[编译日志1/1](../.local/request-log-runs/run-kl63hY/report.json)通过。新增一项手动命令契约进入207项，独立演示4项不并入平台。核心后九张截图摘要全部不变，手动编译CLI入口SHA256仍为`26822012ae6ed8efa209502c3c59234100d4f142d48078ecb0af38da94b57185`，正式服务入口摘要保持上轮值。

小程序完整检查再次退出0：12件正式制品、规则1.6.0、360638上传源码字节及正式照片目录摘要不变；19个照片候选、三个缺口、零公开照片及零可发布整方不变。当前手动演示可以用于亲自复演，不能将自动验收替代本人掌握、真人签审或手机体验；下一阶段继续补齐实际食用部位和加工形态的真实照片资料。

### 编译后端与源码入口的联合验收

2026-10-09 19:11:37 CST，最终 `demo:verify` 实际退出0：两项均通过，零失败、跳过或取消。源码入口与编译入口各启动两次、正常停止两次，独立库和浏览器均正常关闭，全部八类检查为真。

| 运行方式 | 完整终态 | 已查看截图 |
| --- | --- | --- |
| TypeScript演示CLI | [源码链路报告](../.local/local-demo/demo-82fed79d-0ad3-444a-83a0-7afa96b895eb/browser-proof.json)，不声明编译后端通过 | [桌面](../.local/local-demo/demo-82fed79d-0ad3-444a-83a0-7afa96b895eb/desktop.png)、[失败恢复](../.local/local-demo/demo-82fed79d-0ad3-444a-83a0-7afa96b895eb/governance-recovery.png)、[只读窄屏](../.local/local-demo/demo-82fed79d-0ad3-444a-83a0-7afa96b895eb/narrow.png) |
| 实际编译Node服务 | [编译链路报告](../.local/local-demo/demo-8dc54c5a-8d7e-4862-98e6-272426acda8c/browser-proof.json)，`compiledBackendVerified=true` | [桌面](../.local/local-demo/demo-8dc54c5a-8d7e-4862-98e6-272426acda8c/desktop.png)、[失败恢复](../.local/local-demo/demo-8dc54c5a-8d7e-4862-98e6-272426acda8c/governance-recovery.png)、[只读窄屏](../.local/local-demo/demo-8dc54c5a-8d7e-4862-98e6-272426acda8c/narrow.png) |

[编译启动器](../tests/compiled-demo-process.ts)不加载tsx，也不创建替代应用；测试专用IPC启动包装器导入真实`build/server/index.js`，仅用于等待模块就绪后正常关闭，不增加生产HTTP关闭接口。启动前核对私有目录、完成标记、数据库归属和项目/演示目录一致性；拒绝符号链接或junction。子进程只使用明确的SQLite路径、回环地址和账号模式，清除继承的数据库、模型、TLS和Node预加载配置，固定关闭发布和AI。

[浏览器验收](../tests/local-demo-browser.test.ts)确认页面加载的生产JS字节与本地dist摘要相同；编译入口SHA256在前后均为`a87aa724d52ca1b354e6f104f9a8b2deb94a687398f14bfb936b8bd97d6f9a08`。实际编译服务承载HTTP、Cookie会话、编辑协作和SQLite持久化，不靠源码API夹具替代；SQL就绪后才开始操作。观察超时不重启服务或强杀，始终等待同一自有进程正常退出。

首轮[源码失败报告](../.local/local-demo/demo-e04fe0b2-5143-433e-a9bb-a5666aeb6af6/browser-proof.json)与[编译失败报告](../.local/local-demo/demo-f3c824ec-efae-4122-89d8-ec012e5eb347/browser-proof.json)均保留：两条链路已完成编辑协作，但新增测试错误假设真实目录名称为“姜”，实际为“姜（生姜、干姜）”，未完成后续恢复与重启验收。测试改为使用固定目录原名，没有改目录、放宽业务断言或提高等待上限；首次失败不是产品缺陷结论。后续增加启动归属保护及AI关闭断言后，以上最终两条链路完整重跑通过。

该轮结果只证明本机Edge、HTTP和SQLite的指定协作闭环。公开目录仍为8月历史快照，演示草稿没有公开；无专业资格、真人签审或真实模型调用。完整53项页面组、完整PG恢复、双库编译HTTPS、实际容器、远程CI、公网和微信双端都不能由这两项推导通过。当时手动`demo:start`仍只有源码CLI；现在新增的手动编译CLI使用上方独立命令，不把两轮证据混用。

19:13:47 CST，[该轮核心八阶段](../.local/ci-runs/core-a592ace2-7753-4be5-a7a9-4701a5cd20af/report.json)实际退出0：206项平台、42例离线、七组类型、原生完整检查/26脚本、生产构建和[编译日志1/1](../.local/request-log-runs/run-TlYqoj/report.json)通过。核心完成后，以上六张图与编译入口摘要全部不变。该阶段提出的手动编译入口现已接入上方准备和启动命令；不授权部署或使用工作库。

2026-10-08 初建阶段实测（历史）：完整 Node 回归 129/129 通过，无失败、跳过或取消；统一类型检查四个入口全部通过，`catalog:check` 验证 106 条目录及 release。`demo:prepare` 命令实际成功，终态为退出码 0，未输出密码。独立 Edge 闭环 1/1 通过，实际进程启动两次、正常停止两次，工作库文件摘要不变。最终 [浏览器报告](../.local/local-demo/demo-5aeff8b6-9201-4c6e-a5ec-51d1dff68283/browser-proof.json)、[桌面截图](../.local/local-demo/demo-5aeff8b6-9201-4c6e-a5ec-51d1dff68283/desktop.png) 和 [窄屏截图](../.local/local-demo/demo-5aeff8b6-9201-4c6e-a5ec-51d1dff68283/narrow.png) 保存在本机忽略目录，跨电脑需要重新执行，不能假定这些路径随仓库交付。截图已检查；第二轮等待来源和摘录加载结束再留档。

同日 23:54 CST 再次运行 `demo:verify`，真实 Edge 闭环 1/1 通过，零失败/跳过/取消。实际 CLI 启动两次、正常停止两次，私有边界、重启持久化、只读权限、窄屏与工作库摘要不变检查均通过，夹具已停止。新证据为[本轮报告](../.local/local-demo/demo-23a8a6b3-066f-49c3-956d-ab4baa155821/browser-proof.json)、[桌面截图](../.local/local-demo/demo-23a8a6b3-066f-49c3-956d-ab4baa155821/desktop.png)和[窄屏截图](../.local/local-demo/demo-23a8a6b3-066f-49c3-956d-ab4baa155821/narrow.png)，截图已检查。本轮只重跑此演示，不宣称再次执行完整核心；此前最新核心为 141 项、五组类型检查，见[独立核心记录](continuous-integration.md#当前七阶段核心验收)。编译后端、生产部署、专业审校与手机结果仍不属于本次演示范围。

首次隔离测试为 3/4，通过诊断发现继承生产模式触发既有安全保护，改为在开库前明确拒绝，并添加专项测试。随后五项通过，加入悬空链接检查后完整回归为 129 项。新增严格测试配置最初指出 IPC 管道的可空声明，已按固定 `pipe` 选项明确类型；没有降低严格检查。这些早期失败不作为最终通过证据。

## 求职讲解的证明范围

| 能力 | 可现场展示的证据 | 不应扩大的说法 |
| --- | --- | --- |
| React 和 TypeScript | 管理端表单、加载/失败处理、只读角色和实际多会话协作 | 原生微信用户端本身使用 React |
| Node.js 和 Express | 同源 API、Cookie 会话、CSRF、服务端角色权限、冲突响应 | 仅凭隐藏按钮保证权限，或已具备高并发能力 |
| 关系型数据库 | 固定引用、修订历史、事务、重启保留记录 | 本次 SQLite 演示证明新增 PostgreSQL 发布接口通过 |
| 测试与工程交付 | [最新核心](continuous-integration.md)与三种入口的真实Edge演示分别计数，同一后端重启前后另运行原生六页JS任务链，CLI隔离专项单独留档 | 模拟wx能力等于微信内运行，或这些演示代表完整页面套件、远程CI、容器、公网HTTPS和三端已完成 |
| 内容安全 | 私有草稿、独立编辑通过和公开目录隔离 | 已完成真人专业审校，或演示内容可以食用、治疗或发布 |

沿着 `web/ContentEditor.tsx → server/workflow-http.ts → server/workflow.ts → SQLite → JSON → React` 讲清一次保存或审阅。解释正文修订号与协作版本的区别、过期写入为什么返回 409、来源更新为什么不改旧引用，以及为什么正常重启后未过期会话仍有效。账号权限更改会撤销会话，业务恢复也会主动撤销，不能将其与普通重启混淆。

用户端则沿着 `小程序主动读取 → 公开目录API → SQL固定投影 → 本地版本校验 → 原生页面` 讲解。后台编辑通过的草稿不自动成为公开目录；来源日期等完整资料仍与本地固定版本绑定。不要把该联调辅助函数当作可以直接在手机运行的启动入口，也不要为复演将本机HTTP地址填入正式小程序配置。

这组证据可支持“在 AI 辅助下完成并验证食养教育全栈管理协作流程”的项目描述；个人编码熟练程度、独立设计与排错能力需要本人能解释和修改对应代码，不能从自动测试通过直接推出。候选描述、招聘要求对应和本人实操清单见[全栈求职证据](career-evidence.md)。未测量用户量、吞吐、线上可用率或真实模型质量，不编造指标。其他证据与待验证项分别见 [工程架构](architecture.md)、[发布治理](publication-lifecycle.md)、[CI](continuous-integration.md)、[容器部署](container-deployment.md) 和 [HTTPS](https-runtime.md)。
