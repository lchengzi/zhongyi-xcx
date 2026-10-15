# 管理端目录与审阅队列的读取恢复

2026-10-09，管理端修复了读取失败后残留旧列表、详情返回无效，以及审阅队列错误与空结果混淆的问题。改动只影响界面读取与恢复，不修改后端权限、数据库结构、发布条件或原生小程序内容。

同日后续[来源查询恢复](source-lookup-recovery.md)补齐来源库、草稿来源选择器和待编辑食材的相同问题，并增加来源处理中防重复提交。下文29项统计保留为本阶段历史；后续完整双库41项及核心八阶段证据另见该记录。

同日进一步补齐[编辑记录读取与重试](audit-read-recovery.md)：共同读取开始即隐藏旧统计、快照和修订记录，失败不假报无记录，明确重试不修改备注；未保存输入独立保留。该阶段另有三项真实浏览器回归，历史计数不倒填为新范围。

## 用户可见行为

| 场景 | 修复后的行为 | 保留的边界 |
| --- | --- | --- |
| 新搜索或刷新失败 | 清除旧结果，显示目录读取失败、数量暂不可用；停用分页，可保留关键词重试 | 请求失败不等于查询结果为零；正常空结果仍单独显示 |
| 食材详情读取失败 | 可重试同一食材，或返回未选择状态；返回后错误提示不残留 | 两种恢复都不保存或清空数据库备注 |
| 审阅队列筛选或刷新失败 | 清除旧列表，不将旧任务放在新筛选条件下；数量暂不可用，可重试 | 已选择的固定版本详情独立于队列，未提交意见不因列表刷新而丢失 |

目录、详情和队列的异步读取在写入界面前检查请求是否已取消；旧请求不应覆盖新请求状态。取消读取不等于取消服务端写入，本次没有为备注或审阅决定增加自动重试。

## 实现与回归范围

[App.tsx](../web/App.tsx)处理目录与详情：新读取清除旧目录结果；失败、加载和正常空结果分别展示；清空选择时重置详情错误、加载与草稿状态；详情重试只推进读取轮次，不调用写接口。[ReviewQueue.tsx](../web/ReviewQueue.tsx)只清除队列数据，保持所选固定任务组件与未提交意见，不降低独立审阅限制。

[目录浏览器测试](../tests/browser/workbench.spec.ts)新增两项，[协作浏览器测试](../tests/browser/workflow.spec.ts)新增一项。测试通过真实 React、API 和隔离 SQL 数据，使用浏览器请求拦截注入网络故障，而不是切换页面上的演示标志。断言覆盖旧行隐藏、未知数量、分页停用、空结果不误报、详情返回/重试、备注前后相同且零写请求、审阅意见保留且零决定提交，以及 390px 布局没有横向溢出。原有协作、权限、自审拒绝和私有隔离流程保留。

## 修复前证据与失败轮次

修复前独立运行目录与协作两个测试文件，共八项：原有五项通过，新增三项均失败，零跳过或波动，进程退出 1。[完整基线结果](../.local/browser-tests/workbench-recovery-baseline-20261009.json)另存，失败截图与上下文保留在各自独立目录，不依赖可覆盖的 latest 文件。

三处失败分别是搜索姜后仍显示黄芪行、详情返回后未出现未选择提示，以及已通过筛选下仍显示待审橘皮任务。测试在修复前构建的 React 页面上运行，之后才重建修复后的页面；不是修复后回写失败结论。

修复后第一次全量运行为 28/29，通过的两个新增用例已验证目录和详情恢复；新队列用例在登录前置条件处触发共用编辑账号的十次登录限制，尚未执行其恢复断言。该[失败轮次](../.local/ci-runs/browser-02777b91-3b79-4c26-9a75-2ce8bc408d97/report.json)及截图保留，不算验收通过。新用例改为由实际管理 API 创建专属编辑和审阅账号，沿用正常登录及 CSRF，不清空计数、不扩大限额，也不改业务权限；修复前基线的三处界面失败证据保持不变。

PostgreSQL 首轮同为 28/29，[失败报告](../.local/ci-runs/postgres-browser-c5a1c11c-4bd8-46b5-b51d-570461e23ae9/report.json)和[集群终态](../.local/postgres-tests/cluster-mMkZYT/result.json)保留，数据库已正常停止。新队列用例点击退出后立即导航，等待新账号登录框超时，错误快照仍显示原管理员；该轮尚未执行队列恢复断言。专属账号登录助手改为等待真实登录页出现，不在退出请求尚未完成时刷新，不增加固定睡眠、测试超时或自动重试。此为测试同步修正，不改生产登录、会话或 SQL 逻辑。

第二轮 PostgreSQL 的三项新增恢复用例均通过，但[完整报告](../.local/ci-runs/postgres-browser-95b442a4-8727-4b8a-bc14-916e70de8258/report.json)为 27/29，原有账号登录和摘录回读用例分别在“正在登录”和“正在读取原文摘录”时超过原 5 秒断言门限；不将其归因为本次修复，也不宣称已确定根因。[第二轮集群](../.local/postgres-tests/cluster-aycf9m/result.json)已正常停止，失败截图与原始结果保留；没有修改原有用例、业务超时或门限来获得通过。

## 验收与未验证项

2026-10-09 01:11 CST，[SQLite 全量页面报告](../.local/ci-runs/browser-1675fbae-ae1f-44d0-80a6-11136fa04f33/report.json)实际退出 0，生产构建及全部 29 项浏览器测试通过；零失败、跳过、波动或框架错误，`forbidOnly=true`。其中三项是本次新增回归，原有 26 项继续完整执行；不是仅跑新增测试后推算全量通过。

本轮单独保留 23 张 PNG，已查看新增的[目录失败窄屏图](../.local/ci-runs/browser-1675fbae-ae1f-44d0-80a6-11136fa04f33/browser-artifacts/workbench-failed-search-ne-054ee-he-new-query-retry-recovers/workbench-search-failure-mobile.png)与[队列失败窄屏图](../.local/ci-runs/browser-1675fbae-ae1f-44d0-80a6-11136fa04f33/browser-artifacts/workflow-review-queue-fail-5fd77-ected-task-opinion-on-retry/review-queue-failure-mobile.png)。两页错误提示与恢复入口可读，队列详情中的未提交意见保留，自动检查确认 390px 无整页横向溢出；这不是 Android/iOS 微信实测。

01:30 CST，[最终 PostgreSQL 全量页面报告](../.local/ci-runs/postgres-browser-0ae00b50-5cae-48e4-8739-c5015e8bfc6b/report.json)实际退出 0，全部 29 项通过，零失败、跳过、波动或框架错误，`forbidOnly=true`。[集群终态](../.local/postgres-tests/cluster-iQ9g8T/result.json)确认真实 PostgreSQL 18.4、`scope=react-browser / restarts=0 / fixtureStopped=true`。前一轮两项原有超时用例未改断言即通过，但间歇性等待超时的根因仍未确定；不能以这次通过宣称性能稳定性已解决。SQLite 的全量通过轮次在退出同步修正之前，生产界面代码未再变化，不冒称两种数据库在同一时刻或同一测试夹具版本运行。

PG 本轮另有 23 张 PNG；已查看其中[目录失败窄屏图](../.local/postgres-tests/cluster-iQ9g8T/browser-artifacts/workbench-failed-search-ne-054ee-he-new-query-retry-recovers/workbench-search-failure-mobile.png)与[队列失败窄屏图](../.local/postgres-tests/cluster-iQ9g8T/browser-artifacts/workflow-review-queue-fail-5fd77-ected-task-opinion-on-retry/review-queue-failure-mobile.png)。PG 结束后逐张核对 SQLite 该轮 23 张 PNG 的 SHA-256 均未改变，不用新截图覆盖旧轮次证据。

完整浏览器与核心回归结果分别记录在[持续集成记录](continuous-integration.md)。截图是本机 Edge 页面证据，不是微信手机实测；本机数据库、远程 CI、容器、公网部署和专业签审仍按各自范围验收。

2026-10-09 01:26 CST，[本轮核心终态](../.local/ci-runs/core-95028b67-9bba-4cdf-9089-a37add9f90fe/report.json)实际退出 0，全部七阶段通过：106 条历史目录只读核对、五组类型检查、141 项平台 Node 回归、42 例离线契约、原生完整检查/21 个回归脚本和前后端生产构建。离线契约没有真实模型调用，不是模型质量或医学审校；浏览器页面使用 TypeScript API 夹具，也不能由构建通过推断实际使用编译后端。

本阶段重跑核心与两种数据库页面；完整 PostgreSQL 48 项/六次重启、双库编译 HTTPS 各六项和独立演示 1/1 仍引用此前独立轮次，没有在本阶段重跑。三个浏览器失败轮次和修复前基线均保留，不计入绿色验收。

原生 `.10` 的内容、安全规则、正式照片候选、整方和审校包均不因本次界面修复晋级。地黄加工图的本轮图像/PDF 页面读取仍未返回可审阅像素，沿用[私有照片追溯](../../zhongyi/docs/photo-followups-2026-10-09.md)中的未审阅状态，没有新增正式候选或关闭照片缺口。
