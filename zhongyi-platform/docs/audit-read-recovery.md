# 编辑记录读取与重试

编辑记录现在区分正在读取、读取失败和成功空结果。刷新或搜索触发工作台共同读取时，旧统计、来源快照和编辑记录不再作为当前结果展示；已打开食材的未保存备注独立保留。改动不调整权限、数据库结构、内容发布或小程序运行代码。

## 页面状态

| 读取状态 | 编辑记录 | 统计和来源快照 |
| --- | --- | --- |
| 进行中 | 显示正在读取，隐藏旧表格 | 三项动态数量为破折号，不显示旧快照 |
| 失败 | 显示暂不可用，可明确重试，不假报没有记录 | 数量未知，隐藏旧快照 |
| 成功 | 有记录显示修订表格，空数组才显示没有记录 | 使用本次完整响应 |

[工作台](../web/App.tsx)仍共同读取目录、摘要及记录；任一请求失败，本次共同结果不可用，不展示部分成功数据。这不等于历史记录已删除，也不表示服务器没有记录。只清除共同读取状态，不清除食材详情和备注输入；读取的取消检查保留，旧轮次不能覆盖新轮次。

重试只重新读取，不保存、清空或自动重发备注。已有写入结果未知、版本冲突、只读角色及退出确认处理不变；固定的独立发布批准提示不是动态数量，不因统计未知而变成发布许可。

## 浏览器复现

[真实浏览器用例](../tests/browser/workbench.spec.ts)新增三项：首次记录读取失败、已有记录刷新失败、延迟真实读取期间的加载状态。通过实际React、HTTP和隔离SQL数据，断言旧行隐藏、未知不等于空或零、快照隐藏、只读重试、未保存输入保留及数据库备注前后一致。延迟测试只发出一次记录读取；故障恢复阶段均没有写请求。

旧界面的[首轮基线](../.local/audit-baseline-cd6f0e6b-bc43-4667-94a0-392cadc694a7/browser-results.json)为原有四项通过、新增三项失败。该轮加载用例的失败清理还发生请求已处理错误；先等待拦截处理结束再移除路由后，在界面未修改时[独立复核三项](../.local/audit-baseline-786993b5-35a6-4305-9bdf-9c5f436201bf/browser-results.json)仍全部失败，且无清理错误。两轮报告均保留，不计入通过记录，也没有放宽产品断言。

2026-10-09 17:44:49 CST，[修复后SQLite全量终态](../.local/ci-runs/browser-a9ccb0bc-a0a3-4cae-b413-4c1dd821a9f8/report.json)实际退出0，44/44、零失败/跳过/波动/框架错误，原41项保留。构建和七组严格类型检查通过；三项新增测试属于浏览器组，不并入205项平台回归。

该轮34张PNG独立保存，已查看新增[刷新失败窄屏图](../.local/ci-runs/browser-a9ccb0bc-a0a3-4cae-b413-4c1dd821a9f8/browser-artifacts/workbench-audit-refresh-fa-864dc-the-unsaved-ingredient-note/audit-refresh-failure-mobile.png)和[加载窄屏图](../.local/ci-runs/browser-a9ccb0bc-a0a3-4cae-b413-4c1dd821a9f8/browser-artifacts/workbench-audit-pending-re-6f464-the-held-real-read-finishes/audit-loading-mobile.png)。390px下提示与重试入口可读，自动断言无整页横向溢出；这是Edge证据，不是微信真机验证。

17:48:40 CST，[真实PostgreSQL全量终态](../.local/ci-runs/postgres-browser-72a841b7-989e-469b-abeb-9d606cf3c893/report.json)实际退出0，同样44/44、零失败/跳过/波动/框架错误。[数据库终态](../.local/postgres-tests/cluster-NlozRh/result.json)确认正常停止、工作库未改，范围为react-browser、数据库重启次数为0，不作为完整迁移恢复或生产权限/TLS证明。

PG另存34张PNG，已查看新增[失败窄屏图](../.local/postgres-tests/cluster-NlozRh/browser-artifacts/workbench-audit-refresh-fa-864dc-the-unsaved-ingredient-note/audit-refresh-failure-mobile.png)和[加载窄屏图](../.local/postgres-tests/cluster-NlozRh/browser-artifacts/workbench-audit-pending-re-6f464-the-held-real-read-finishes/audit-loading-mobile.png)。复测结束后，逐张核对SQLite34张图的SHA-256均未改变，没有覆盖前一轮证据。

17:51:10 CST，[最终核心终态](../.local/ci-runs/core-829e4764-9c2d-4815-a523-bdc99b26fcff/report.json)八阶段实际退出0：七组严格类型、205项平台、42例离线、小程序完整检查/26脚本、生产构建及[编译日志1/1](../.local/request-log-runs/run-9IAqyT/report.json)通过，编译夹具正常停止。12件正式制品、360638上传源码字节与正式照片目录摘要均未改。

本次页面测试使用TypeScript API夹具，不把前端生产构建称为编译后端、真实容器或公网部署验收。编译日志是独立范围，不证明新页面走过编译后端；完整PG迁移恢复、双库编译HTTPS和独立演示本阶段未重跑。其他独立证据见[持续集成记录](continuous-integration.md)。工作数据库未操作，专业批准、远程CI及安卓/iOS验收仍单独进行。
