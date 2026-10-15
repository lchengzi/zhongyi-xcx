# 后端请求日志与故障定位

编译后端现在为进入 Express 的 API 请求生成 `X-Request-ID`，并向标准输出写入一行固定字段 JSON。响应编号与日志编号对应，便于定位错误状态和连接中断；不记录搜索内容、备注正文、账号标识或登录凭据。它是运行诊断，不替代数据库内的内容修订、安全事件和专业审校记录。

## 记录范围

日志中只有八个字段：

| 字段 | 含义 |
| --- | --- |
| `event` | 固定为 `api_request` |
| `timestamp` | 记录生成时的 UTC 时间 |
| `requestId` | 服务端独立生成的随机 UUID，不使用客户端传入值 |
| `category` | 固定分类：健康、就绪、公开读取、认证、账号、编辑、目录或其他，不含实际路径和条目编号 |
| `method` | 七种常用 HTTP 方法之一，其余统一为 `OTHER` |
| `status` | 完成响应时的 HTTP 状态码；响应未完成就中断时为 `null` |
| `durationMs` | 从进入诊断中间件到响应完成或中断的单调时钟耗时 |
| `outcome` | `completed` 或 `aborted` |

不记录原始 URL、查询参数、请求或响应正文、Cookie、Authorization、CSRF 值、IP、User-Agent、来源头、用户 ID、异常原文或堆栈。分类只是排障标签，不参与权限判断，也不证明某个接口实际存在。

中间件仅挂载在 `/api`，在正文解析和认证之前运行，所以认证拒绝、无效正文、正文过大及业务异常也能带编号。静态页面和资源不记录；在 HTTP 解析或 TLS 握手阶段被拒绝、尚未进入 Express 的连接不在本轮范围内。[Express 中间件顺序](https://expressjs.com/en/guide/using-middleware/)

## 完成和中断的区别

响应 `finish` 后记为 `completed`，提前 `close` 且响应尚未完成则记为 `aborted`；两事件都发生时也只记录一次，并移除观察监听器。中断不写默认状态 200，以免误报成功。日志写入器同步抛错或异步拒绝不会改变业务响应，也不打印其原始异常。

`completed` 只表示服务器完成响应输出，不证明手机已收到、用户已读或写入已提交；`aborted` 也不能证明数据库没有变化。写入结果不确定时仍应回读核对，不能依据日志自动重发。Node 的 `finish` 表示数据已交给操作系统，`close` 可能对应正常完成或提前断开。[Node 22 响应事件](https://nodejs.org/docs/latest-v22.x/api/http.html#event-finish_1)

## 本地复现

在平台目录运行：

```powershell
node --import tsx --test tests/request-log.test.ts
npm.cmd run test:request-log:runtime
npm.cmd run ci:verify
```

原有八项覆盖真实查询和备注写入、401/400/413/404/500/503、固定分类、静态排除、重复事件、真实 HTTP 断开、未知方法、日志写入故障以及不配置输出器的嵌入方式。另有八项HTTPS诊断收集与关联、三项登录计时代理，当前专项19项；三类实际停滞另在HTTPS套件中执行，见[请求阶段与超时定位](https-request-diagnostics.md)。断开用例使用独立测试路由，不添加业务停机接口。

编译入口专项先重新构建服务端，然后使用账号模式、独立 SQLite 文件和本机端口启动实际 `build/server/index.js`。就绪后发出四个带测试敏感值的请求，对照响应编号与真实标准输出，确认每个编号仅一条、状态对应、无测试秘密，并通过既有测试专用 IPC 协议正常停止。无强杀命令、默认账号或真实模型调用。独立报告位于 `.local/request-log-runs/run-*/report.json`，数据库仅为隔离夹具，不能当成业务数据。

当前夹具在启动前写入运行中摘要，正常结束或抛错后的清理记录监听输出、就绪/观察到期、停止请求、实际退出时间与码、探测次数和允许列出的错误类别。摘要不保存原始标准输出/错误、URL或凭据；测试中断而未完成时仍可能保留运行中状态，不能当作通过。就绪窗口仍为15秒，单次探测1秒，业务请求3秒，没有自动重启服务或重发写入。

2026-10-09 15:17:03 CST，[首轮核心失败](../.local/ci-runs/core-d59186be-10b0-469e-b279-9d6440c463f1/report.json)前七阶段通过，第八阶段0/1，15秒内未确认编译服务就绪；旧夹具只在成功时保存报告，无法倒填其启动时序。补齐上述诊断后，15:18:49 CST 的[独立复验](../.local/request-log-runs/run-CWtPsE/report.json)1/1、四个应用请求匹配、实际退出0。该次约13秒后才监听/就绪，不能把它等同于历史失败根因或吞吐测量；失败核心不被独立成功替代。

15:21:23 CST，[新的完整核心](../.local/ci-runs/core-a4cdb360-8048-42d7-a170-9903ce7e7eb9/report.json)八阶段实际退出0，190项平台、42例离线、原生完整检查/26脚本、七组类型和生产构建通过；[编译专项](../.local/request-log-runs/run-nfCkVb/report.json)1/1、四个请求匹配、正常退出0，本次约1秒内就绪。两次独立启动差异明显，仍不能归因于单一代码变化、磁盘负载或宣称启动性能保证；原窗口和生产逻辑未放宽。

该编译专项纳入核心入口的第八阶段，位于生产构建之后；七组类型检查包含新增日志测试类型，普通平台回归包含八项专项。远程工作流仅增加上述固定路径的摘要归档，不上传测试数据库、原始标准输出或任何凭据。配置不等于远程已运行。

2026-10-09 的首次独立编译验收为 1/1，四个应用请求匹配、夹具正常停止，见[独立运行报告](../.local/request-log-runs/run-QQK8VD/report.json)。受限运行曾出现 `fetch failed` 和断开用例等待超时，停止该失败进程后，经授权本机端口运行的八项专项通过；没有减少断言或把受限轮次计为通过。

2026-10-09 03:32:13 CST，[完整核心报告](../.local/ci-runs/core-e6cf2a9b-a584-47b1-a06d-e6e966b53beb/report.json)实际退出 0，八阶段全部通过：106 条历史目录核对、七组类型、158 项平台测试、42 例离线契约、原生完整检查/25 个脚本、生产构建及编译日志 1/1。[本轮编译夹具报告](../.local/request-log-runs/run-qriy97/report.json)确认四个应用请求匹配、正常停止。158 项不包含独立的编译专项，不合并计数冒充普通平台测试。

补齐独立测试首次运行的隔离目录创建与路径检查后，03:35:31 CST 的[最终核心报告](../.local/ci-runs/core-3ab1e368-b1f5-4162-9b7e-4b92561d8be9/report.json)再次实际退出0，八阶段、158项平台和编译专项1/1全部通过，计数及验证范围相同。[最终编译夹具](../.local/request-log-runs/run-peTmsY/report.json)四个请求对应、服务正常停止；上轮报告保留，不作为本次终态。

## 使用与部署边界

管理端错误提示现在会在原说明后显示“请求编号”，可选中文本复制并查找对应的 `api_request` 记录，再核对分类、状态、结果和耗时。尚未增加专用复制按钮；微信用户端未接入这一显示功能。响应未到达时客户端可能拿不到编号，不会自行生成替代编号。

## 管理端错误编号

共用请求层只接受响应头 `X-Request-ID` 中完整的 UUID v4，并统一为小写。缺失、重复合并值、非该格式或包含任意文字的值都忽略；不从响应正文读取编号，也不把原始响应头追加到提示。它是排障关联值，不是认证凭证，也不能仅凭格式认定它对应真实服务器记录。浏览器的响应头读取遵循 [Fetch 标准](https://fetch.spec.whatwg.org/#dom-headers-get)，UUID 筛选则是本项目自己的限制。

编号在收到响应头时保存到本次请求的局部变量，而不是全局状态。HTTP 错误和无效 JSON 提示可以带编号；取得响应头后正文一直不结束，等待截止时也能保留编号。不同并发请求不会串用编号，成功返回值不附加诊断字段。原有状态码、401 判断、15秒等待、页面主动取消、计时器清理和不自动重发均保留；无法确认写入结果时仍先回读，编号不是回滚或提交证明。

[请求层专项](../tests/web-request.test.ts)新增七项后为16/16，修改前同一组16项为12通过/4失败，见[控制台计数摘要](../.local/web-request-tests/20261009-request-id-summary.json)。该摘要不是原始TAP存档；专项使用受控传输和时钟，不证明实际弱网或模型性能。

浏览器新增真实401显示/恢复与读取故障显示/拒绝异常头两项，既有多人编辑409用例增加编号匹配、保留输入与窄屏检查。读取故障用例向真实服务取得编号后，仅把浏览器收到的状态和正文改为503；不能据此说服务器发生503或日志也记录503。真实401/409则对照实际拒绝响应头。页面验收以各数据库本轮报告为准，不以用例存在替代运行结果。

## 管理端编号页面验收

2026-10-09 03:42:06 CST，[SQLite全量页面报告](../.local/ci-runs/browser-70be8ef2-3ffd-4b0c-b9f3-98fb871a56f0/report.json)实际退出0，33/33通过，零失败、跳过、波动或框架错误，禁止聚焦测试。原有31项全部保留，新增两项；真实409的既有流程增加断言而不另计用例。原有两个15秒超时场景也完整执行，没有缩短等待或新增自动重发。

该轮28张PNG独立保留，新增的[登录拒绝](../.local/ci-runs/browser-70be8ef2-3ffd-4b0c-b9f3-98fb871a56f0/browser-artifacts/request-diagnostics-real-u-57194--narrow-screen-and-recovers/request-id-login-mobile.png)、[读取故障](../.local/ci-runs/browser-70be8ef2-3ffd-4b0c-b9f3-98fb871a56f0/browser-artifacts/request-diagnostics-inject-e291e-and-retries-without-a-write/request-id-catalog-mobile.png)和[真实冲突](../.local/ci-runs/browser-70be8ef2-3ffd-4b0c-b9f3-98fb871a56f0/browser-artifacts/workbench-connect-search-e-451fe-tabs-clear-and-view-history/request-id-conflict-mobile.png)三张390px窄屏图已查看，编号可读、自动换行，页面检查没有整页横向溢出。它们是本机Edge与测试后端的工程证据，不是微信双端或线上弱网验收。

03:45:53 CST，[真实PostgreSQL全量页面报告](../.local/ci-runs/postgres-browser-7d7e8de4-429f-4594-bb79-ef33595d7369/report.json)也实际退出0，33/33、零失败/跳过/波动/框架错误，禁止聚焦测试。[隔离集群终态](../.local/postgres-tests/cluster-j9U8fT/result.json)为PostgreSQL18.4、`react-browser`、重启0次、`fixtureStopped=true`；控制器等待同一数据库正常停止，没有第二次停机或强制结束。它使用TypeScript测试后端，不宣称编译服务部署完成。

PG另保留28张PNG，新增[登录拒绝](../.local/postgres-tests/cluster-j9U8fT/browser-artifacts/request-diagnostics-real-u-57194--narrow-screen-and-recovers/request-id-login-mobile.png)、[读取故障](../.local/postgres-tests/cluster-j9U8fT/browser-artifacts/request-diagnostics-inject-e291e-and-retries-without-a-write/request-id-catalog-mobile.png)和[真实冲突](../.local/postgres-tests/cluster-j9U8fT/browser-artifacts/workbench-connect-search-e-451fe-tabs-clear-and-view-history/request-id-conflict-mobile.png)三张窄屏图均已查看。PG结束后逐张重算SQLite本轮28张图的SHA-256，全部与PG前一致，见[两轮计数和截图摘要](../.local/web-request-tests/20261009-request-id-browser-summary.json)。两种数据库分别在独立轮次验证，不合成一次运行，也不替代微信手机验收。

## 管理端编号核心验收

03:47:49 CST，[本轮核心报告](../.local/ci-runs/core-0ad7c6dd-01be-4f98-b852-8163f23291f9/report.json)实际退出0，八阶段全部通过：七组类型、165项平台测试、42例离线契约、原生完整检查/25脚本、生产构建及独立编译日志1/1。平台新增七项从158增至165，原生回归不并入该计数。[本轮编译服务夹具](../.local/request-log-runs/run-7sQVuE/report.json)再次验证四个请求对应且正常停止；它不是浏览器测试后端，也不是线上部署。

## 日志保存与发布限制

新请求日志不含凭据，但不能因此直接分享整个进程输出。显式选择本地开发密钥模式且没有提供密钥时，既有启动流程仍会一次性显示随机编辑密钥；账号初始化工具也会显示一次随机密码。这些输出必须保密。默认账号模式不生成本地编辑密钥，本轮编译验收也使用账号模式。

当前输出到运行进程标准输出，没有新增外部日志平台、用户遥测或自动上传。部署者仍需落实日志访问权限、保存期限、轮转与磁盘容量。容器模板已有轮转配置，但镜像及容器未实际运行；不能据此宣布生产日志运维完成。日志耗时不是经过负载测试的性能指标。

后端日志阶段和管理端编号阶段都没有修改数据库结构、正式内容、安全规则或发布授权。双库编译 HTTPS、完整数据库迁移恢复与独立演示仍按各自历史轮次引用，不由请求层专项或页面编号验证替代。线上部署、真实 AppID、安卓/iOS 验收和真人专业审校仍须分别完成。
