# 来源查询失败恢复与单次提交

来源登记列表、草稿来源选择器和待编辑食材列表在搜索或分页变化时清除上一批结果。读取失败显示“数量暂不可用”，不显示旧行或“没有匹配”的空结果；分页暂停，明确重试成功后才恢复。来源选择器失败时不会继续提供上次查询的引用按钮。

## 编辑输入与版本

列表状态与右侧编辑状态分开保存。列表刷新、搜索失败或成功返回空结果，不卸载已打开的来源编辑器或内容草稿，也不覆盖未保存输入。明确重载来源时，取消确认保留输入；读取失败仍保留输入与原修订，成功才采用最新版本。

来源保存和明确重载共用处理函数内的同步进行中标记，不能只依赖按钮禁用和异步状态渲染。请求等待期间，重复表单提交不会发出第二次保存；既有工作台活动保护继续阻止标签切换和退出。失败后保留输入并释放标记，仍由用户明确核对或重试，不增加自动写入或自动重发。

[Sources](../web/Sources.tsx)处理来源列表、固定来源选择和来源编辑；[ContentEditor](../web/ContentEditor.tsx)只调整左侧条目查询，不改变草稿模型、审阅状态或引用校验。三个读取入口取消旧请求，并检查当前请求未取消后才写入列表状态。后端乐观锁、网址唯一性和固定版本引用保持原样。

## 修复前证据

[修复前完整浏览器报告](../.local/ci-runs/browser-d01e3617-387c-4c80-bab4-66925132868f/report.json)实际退出1：41项中原有37项通过、新增4项失败，零跳过或波动。运行的是修复前构建的React页面，后续源代码编辑未替换该轮构建产物。

前三项均观察到查询失败后旧行仍存在：来源库旧记录、来源选择器旧引用按钮和待编辑食材旧条目。第四项在第一次创建已提交、响应暂被扣留时，通过表单事件再次发出了POST；后端因重复网址返回409，不能将此问题描述成数据库创建了两条来源。

基线在首个失败断言处停止，不声称旧版完成了后续输入保留、明确重读或保存引用断言。失败截图、错误上下文及原始浏览器JSON保留在该轮独立目录。

## 验收方法

[四项新增专项](../tests/browser/source-recovery.spec.ts)使用真实React、HTTP和隔离SQL。读取失败及响应延迟由浏览器拦截注入，真实保存通过服务器执行，并回读数据库结果：

- 来源库失败后隐藏旧行；未保存来源标题在列表重试和明确重读失败后仍保留，版本未被改写。
- 来源选择失败后无旧引用按钮；恢复后保存所选来源的精确ID、修订和定位，草稿保持私有待专业审校，公开目录不变。
- 待编辑条目查询失败后无旧行；恢复后的空结果和有效结果都保留已打开的未保存草稿，未产生后台保存。
- 首次来源创建真实提交后扣留响应，再派发表单提交事件；只允许一次POST和一条来源，标签、退出与页面离开保护保持有效。

独立测试账号只在SQLite和PostgreSQL浏览器夹具中创建，不进入生产初始化。没有清空登录尝试、放宽限流或降低旧测试断言。合成`beforeunload`事件只验证监听器，不代表实际浏览器退出提示或微信真机行为。

新专项已通过独立严格TypeScript检查。完整验收使用现有入口依次执行，避免构建和端口互相覆盖：

```text
npm run ci:browser
npm run ci:postgres:browser
npm run ci:verify
```

## 双库完整页面结果

2026-10-09 12:44:27 CST，[修复后完整SQLite报告](../.local/ci-runs/browser-3ffc6879-a92d-454a-8948-193d44c4636a/report.json)实际退出0，构建和41项页面全部通过，零失败、跳过、波动或框架错误，`forbidOnly=true`。原有37项与四项新增专项同时执行，不是只运行新测试。

本轮32张PNG位于独立目录，已查看[来源输入恢复窄屏图](../.local/ci-runs/browser-3ffc6879-a92d-454a-8948-193d44c4636a/browser-artifacts/source-recovery-source-reg-755aa-d-editor-input-across-retry/source-registry-recovery-mobile.png)和[来源选择失败窄屏图](../.local/ci-runs/browser-3ffc6879-a92d-454a-8948-193d44c4636a/browser-artifacts/source-recovery-failed-sou-a3c04-ts-the-exact-chosen-version/source-picker-failure-mobile.png)。来源编辑输入保留；选择器显示读取失败、不可用数量和重试，不提供旧引用按钮。390px整页无横向溢出仅为Edge页面结果，不是Android或iPhone微信实测。

12:47:51 CST，[真实PostgreSQL完整页面报告](../.local/ci-runs/postgres-browser-1edd27d2-9fd2-42d9-a9f6-b75b6c9361df/report.json)实际退出0，41/41通过，零失败、跳过、波动或框架错误，`forbidOnly=true`。[集群终态](../.local/postgres-tests/cluster-YCHb8g/result.json)确认PostgreSQL18.4、`scope=react-browser`、零重启且正常停止；未使用工作库。

PG独立保留32张PNG，已查看对应[来源输入恢复图](../.local/postgres-tests/cluster-YCHb8g/browser-artifacts/source-recovery-source-reg-755aa-d-editor-input-across-retry/source-registry-recovery-mobile.png)和[来源选择失败图](../.local/postgres-tests/cluster-YCHb8g/browser-artifacts/source-recovery-failed-sou-a3c04-ts-the-exact-chosen-version/source-picker-failure-mobile.png)。PG停止后逐张核对，SQLite该轮32张截图SHA-256全部不变。两库都使用同一修复后的React和TypeScript API夹具；不将页面验收当作编译后端、数据库完整迁移恢复或公网HTTPS验证。

## 核心回归与交付边界

12:51:13 CST，[核心八阶段报告](../.local/ci-runs/core-f755c405-f16a-4e20-930c-d8e3cd781318/report.json)实际退出0：七组类型、165项平台回归、42例离线辅助契约、原生完整检查/26脚本、Web/API生产构建及编译日志1/1。[编译后端夹具](../.local/request-log-runs/run-jcDTNf/report.json)四个实际请求匹配并正常停止；没有使用工作库或真实模型。来源专项的独立严格TS检查不计为第八组类型配置。

12件正式制品的SHA-256逐件不变，原生仍为62个上传候选文件、360638源码字节，不是微信实际编译包大小。本阶段改动仅为两个React模块、新浏览器专项及两类数据库的测试账号夹具；数据库结构、正式食材内容、安全规则和照片审核状态不变。

本轮没有重跑完整PostgreSQL迁移恢复、双库HTTPS或独立演示；既有证据分别保留。远程CI、容器、公网部署、真人专业签审和微信双端真机仍待验证。测试来源与草稿不用于食用指导，工程通过不代表医学审校或允许发布。
