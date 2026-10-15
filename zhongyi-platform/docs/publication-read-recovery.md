# 发布管理读取与失败恢复

发布管理页把当前发布状态与未提交输入分开处理：加载、操作核对中或报错时，隐藏旧的发布状态、批准记录、快照及事件；已填写说明、核对编号和勾选保留。请求失败不表示没有记录，也不表示内容已经撤回。改动限于 React 页面与浏览器回归，不改变服务端发布条件、数据库结构或小程序内容。

## 页面行为

[Publication.tsx](../web/Publication.tsx)仅在本次读取成功、没有待完成操作且没有错误时展示发布依据。首次读取失败、历史版本读取失败、刷新失败及写入后核对失败，都不能把上一份资料显示为当前授权。已保留的输入不具备提交许可，操作按钮仍停用；用户须明确重读最新状态，不自动重发写入。

刷新之前仍确认是否放弃未保存输入；取消确认不发请求，读取失败时输入继续保留，成功后才由重新读取的资料替换。新读取清除上一轮错误，旧轮次的取消检查保留。写入后刷新失败仍明确区分“已记录”和“未能确认成功”，不把停止等待当作服务器回滚。

发布食材列表开始读取即清除旧结果。加载中显示正在读取数量；失败显示数量暂不可用并停用分页；只有成功的空结果才显示零条和没有匹配食材。列表重试只读，不操作选中食材的发布历史。

## 浏览器回归与失败证据

[publication.spec.ts](../tests/browser/publication.spec.ts)新增三项：列表初始与后续读取失败、详情首次读取失败、延迟刷新及失败期间的状态隐藏与输入保留。通过真实 React、HTTP 与隔离数据库检查零写请求、重读前后记录一致、取消重读不发请求、明确重试及390px布局。既有“全局操作已提交但刷新失败”用例新增旧批准与旧快照隐藏断言，其数据库核对和不重复追加记录断言保留。

旧构建的[四项基线](../.local/publication-read-baseline-61b9743d-5cb1-4940-b710-b0d0e4c150bb/browser-results.json)全部失败，无框架错误；其中加载与提交后刷新两项均实际找到不应继续展示的旧发布状态。列表首项最初定位到新增无障碍标签缺失，随后改为读取已有数量元素，在未重建页面的[独立数量基线](../.local/publication-count-baseline-4c8643fa-23bd-4aed-afff-21a69b603fa1/browser-results.json)直接证实失败被显示为“共0条”。

修复后[首轮完整结果](../.local/ci-runs/browser-8ffdce5c-ff22-41e4-9101-4f3c114f823f/report.json)为46/47、退出1。唯一失败是新增列表用例把专用发布夹具的3条记录误当成106条历史目录；测试现先从真实接口核对该夹具数量，成功恢复后与之比较。未增添假数据、放宽请求超时、跳过用例或修改业务权限。该轮失败与两份旧构建基线均保留，不计为全量通过。

## 本机验证

2026-10-09 18:26:00 CST，[SQLite完整终态](../.local/ci-runs/browser-ffefadde-fb73-4cbe-b5fd-5defeb414829/report.json)实际退出0：47/47，零失败、跳过、波动或框架错误，禁止聚焦单项运行。七组严格类型检查及生产构建通过；三项新增属于浏览器组，不并入205项平台回归。原44项仍完整执行，包括独立批准、发布、撤回、回滚、冻结、并发冲突和账号撤销。

本轮36张PNG独立保存；已查看新增[加载窄屏图](../.local/ci-runs/browser-ffefadde-fb73-4cbe-b5fd-5defeb414829/browser-artifacts/publication-publication-pe-135e6-eliberate-successful-reload/publication-refresh-loading-mobile.png)及[失败窄屏图](../.local/ci-runs/browser-ffefadde-fb73-4cbe-b5fd-5defeb414829/browser-artifacts/publication-publication-pe-135e6-eliberate-successful-reload/publication-refresh-failure-mobile.png)。390px下加载、错误、状态未确认及输入保留清晰可读，自动断言无整页横向溢出。这是本机Edge证据，不是微信手机实测。

18:30:49 CST，[真实PostgreSQL完整终态](../.local/ci-runs/postgres-browser-deb1e59f-2f45-4232-a19d-2ea7ed137beb/report.json)也实际退出0：47/47，零失败、跳过、波动或框架错误。[数据库终态](../.local/postgres-tests/cluster-qYY46R/result.json)确认正常停止、工作库未改，范围是react-browser，数据库重启为0；不能当作完整迁移恢复、生产权限或数据库TLS的本轮证明。

PG另存36张PNG；新增[加载图](../.local/postgres-tests/cluster-qYY46R/browser-artifacts/publication-publication-pe-135e6-eliberate-successful-reload/publication-refresh-loading-mobile.png)和[失败图](../.local/postgres-tests/cluster-qYY46R/browser-artifacts/publication-publication-pe-135e6-eliberate-successful-reload/publication-refresh-failure-mobile.png)均已查看。PG结束后逐张核对SQLite36张图的SHA-256全部未变。两组页面使用TypeScript API夹具；前后端构建通过不等于浏览器使用编译后端，更不等于实际容器或公网部署。

18:32:48 CST，[最终核心八阶段](../.local/ci-runs/core-f5194094-196f-4560-b928-b92fade75a39/report.json)实际退出0：七组严格类型、205项平台、42例离线契约、小程序完整检查及26脚本、生产构建、[编译日志1/1](../.local/request-log-runs/run-4cOfhe/report.json)全部通过，编译夹具正常停止。离线契约没有真实模型调用；编译日志是独立验证，不证明新发布页面使用编译后端。

12件正式制品、历史来源日期、360638上传源码字节及正式照片目录摘要未改；上传源码字节不是微信实际包体积。完整PG迁移恢复、双库编译HTTPS和独立演示本阶段未重跑；实际容器、远程CI、公网部署、专业签审与安卓/iOS微信仍分别待验。下一步继续检查协作记录及审校页面的读取恢复，不因页面测试通过公开待审内容。
