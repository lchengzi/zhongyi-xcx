# 管理端请求超时与提交结果核对

2026-10-09，React 管理端共用请求层增加 15 秒等待上限，覆盖取得响应头和读取响应正文。读取超时会退出等待并提示重试；提交超时或连接中断则明确说明结果尚不能确认，应先重新读取核对，不自动重发写入。这是客户端等待策略，不是服务性能承诺或事务回滚机制。

后续增加错误请求编号后，请求专项扩展为16项，两种数据库的全量页面分别33/33；具体范围见[管理端错误编号与页面验收](request-diagnostics.md#管理端错误编号)。下文9项专项、31项页面及其轮次保留为等待策略阶段历史，不当作新增编号功能的验收结果。

## 请求与取消

[请求层](../web/api.ts)为每次调用建立自己的取消信号，转发页面已有取消信号，但不修改调用方控制器。页面取消仍以 `AbortError` 退出，不误报成连接错误或超时；调用前已取消时不发请求。若页面取消和等待截止先后发生，保留首先发生的原因。成功、HTTP 错误、解析失败或取消后均清理计时器与调用方监听器。

认证、CSRF、同源凭据、禁止缓存和既有 HTTP 错误提示保留。成功状态却无法解析提交响应时，同样不能认定未保存；显示提交结果不确定。明确的服务器 HTTP 拒绝仍保留对应错误与状态码，没有隐藏并发冲突、权限失败或字段错误。

客户端取消只停止本次等待，不能保证服务端、数据库事务或供应商任务被取消。服务端版本校验、并发控制和独立操作状态仍然必要。真实模型调用未开启；本批没有测量模型质量、耗时或费用，也不把等待上限当作付费任务自动终止策略。

## 专项与浏览器验收范围

[请求专项](../tests/web-request.test.ts)实际 9/9 通过，包括既有凭据/缓存契约、无响应读写、预先取消、进行中取消、正文停滞、HTTP/JSON 错误、连接中断及取消竞态。原实现运行新增测试为 0/9，通过前后的[控制台计数摘要](../.local/web-request-tests/20261009-summary.json)保留；最终 HTTP/JSON 测试另增加成功写响应无法解析的断言，不宣称两轮测试文件逐字相同。专项使用受控时钟和传输，不是实际网络或性能测量。

[新增浏览器用例](../tests/browser/request-timeout.spec.ts)保留真实客户端等待上限，不缩短生产超时值。读取用例截住目录响应，检查超时不误报为空，解除拦截后由用户重试。写入用例通过真实 HTTP/SQL 保存一条测试备注，再只截住返回浏览器的消息，核对服务端已有新修订、界面保留输入并提示结果不确定、写入仅一次，以及用户重新加载后获得已提交修订。实际执行结果须以本轮浏览器报告为准，不能由用例存在认定通过。

新增专项进入原有完整 `test` 入口，类型检查增加独立的 Web 请求测试配置，不改服务端数据结构或数据库迁移。不改变原生小程序、`.10` 内容制品、正式照片候选、审校状态或发布开关；远程 CI、容器、公网部署、真人审校与微信真机仍分别验收。

## 浏览器断言兼容与失败记录

首次[完整 SQLite 浏览器运行](../.local/ci-runs/browser-a32285e4-e45e-49a2-9fa6-e3d94f47b037/report.json)实际退出 1，28/31 通过、三项失败，零跳过、波动或框架错误。两项新增超时用例均通过；失败分别发生在退出登录、保存资格和保存来源核验的既有 POST 断连用例：页面已经显示新的“无法确认提交结果”，断言仍等待旧“无法连接”。原始结果、失败截图和上下文保留，不计作全量通过。

三处断言改为同时检查结果不确定和先重新读取核对，原有输入保留、会话撤销、权限隔离、409 冲突与撤销流程继续完整执行。读取请求的“无法连接”断言不变；没有删除用例、扩大既有等待门限或增加自动重试。最终验收须读取修正后的独立全量报告。

## SQLite 全量浏览器结果

2026-10-09 02:37:57 CST，修正后的[SQLite 完整报告](../.local/ci-runs/browser-c2527ca5-0210-4b87-b9bd-268f2462eaf9/report.json)实际退出 0，生产构建及全部 31 项浏览器测试通过。原有 29 项与新增两项完整执行，零失败、跳过、波动或框架错误，`forbidOnly=true`。

本轮 25 张 PNG 单独保留，新增的[读取超时窄屏图](../.local/ci-runs/browser-c2527ca5-0210-4b87-b9bd-268f2462eaf9/browser-artifacts/request-timeout-unanswered-1a736-ers-by-one-deliberate-retry/request-read-timeout-mobile.png)和[提交结果不确定窄屏图](../.local/ci-runs/browser-c2527ca5-0210-4b87-b9bd-268f2462eaf9/browser-artifacts/request-timeout-committed--f2e54-and-never-repeats-the-write/request-write-uncertain-mobile.png)已查看。错误提示、保留输入与重试/重新加载入口可读，两项自动检查确认 390px 没有整页横向溢出。它们是本机 Edge、构建后 React 与 TypeScript API 测试夹具的证据，不是微信双端、编译后端部署或线上弱网证明。

## PostgreSQL 全量浏览器结果

2026-10-09 02:43:23 CST，[PostgreSQL 完整报告](../.local/ci-runs/postgres-browser-85ad22f6-692b-466a-b116-ee701b0f1a58/report.json)实际退出 0，全部 31 项通过，零失败、跳过、波动或框架错误，`forbidOnly=true`。[隔离集群终态](../.local/postgres-tests/cluster-p8VBhJ/result.json)确认真实 PostgreSQL 18.4、`scope=react-browser / restarts=0 / fixtureStopped=true`。正常停机期间一次观察到期，控制器继续观察同一自有进程直到退出，没有第二次停机或强制结束；没有把观察到期当作测试已停止。

本轮另有 25 张 PNG，新增[读取超时窄屏图](../.local/postgres-tests/cluster-p8VBhJ/browser-artifacts/request-timeout-unanswered-1a736-ers-by-one-deliberate-retry/request-read-timeout-mobile.png)与[提交结果不确定窄屏图](../.local/postgres-tests/cluster-p8VBhJ/browser-artifacts/request-timeout-committed--f2e54-and-never-repeats-the-write/request-write-uncertain-mobile.png)已查看。结束后逐张重算 SQLite 本轮 25 张 PNG 的 SHA-256，均与 PG 运行前一致；[计数和截图摘要](../.local/web-request-tests/20261009-browser-summary.json)保留。两种数据库使用相同最终浏览器断言和前端实现，顺序在独立夹具执行，不合并为一次运行，也不计作微信手机验收。

完整 PostgreSQL 48 项/六次重启、双库编译 HTTPS 各六项与独立演示 1/1 仍为此前独立轮次，本阶段没有重跑。远程 CI、容器、公网部署、专业签审及真实 AppID/开发工具与双端测试仍分别待验；公开照片/整方仍为 0。

## 本轮完整核心结果

2026-10-09 02:46:05 CST，最终浏览器断言修正后的[完整核心报告](../.local/ci-runs/core-04921599-ff25-4ab8-a3c5-bb23030e9828/report.json)实际退出 0，七阶段全部通过：106 条历史目录核对、六组类型检查、150 项平台测试、42 例离线契约、原生完整检查/23 个脚本及生产构建。平台计数由原 141 项增加本批 9 项；原生详情 19 项和来源 23 项仍在原生链内，不并入平台计数。02:29:12 的[先前核心](../.local/ci-runs/core-e6dd2129-dfe2-40ba-801a-2f996a43524c/report.json)也通过，但早于三处浏览器断言修正；最终记录以本轮为准。

本轮原生运行代码及上传边界不变，总源码仍为 356679 字节、主包源码 303855 字节、目录分包源码 20805 字节；不是微信实际包大小。工作数据库未迁移，公开照片/整方仍为 0。完整 PostgreSQL、HTTPS、独立演示与真机不由核心报告替代。
