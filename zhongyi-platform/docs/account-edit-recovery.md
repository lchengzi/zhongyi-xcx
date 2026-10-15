# 账号权限输入保护与并发恢复

账号创建输入和逐行权限修改只保留在当前页面内存。刷新整个内容工作台、切换主区域或退出时，未保存的账号输入需要明确确认放弃；取消保留输入。账号请求等待期间禁止这些离开操作，创建和逐行操作还在处理函数内检查进行中的操作，避免只依赖按钮禁用。浏览器关闭或刷新使用标准离开提示；实际提示是否出现由浏览器决定，不能保证阻止强制退出。

## 读取与权限修订

“刷新账号列表”只重新读取账号，不卸载逐行编辑器，也不清空创建表单。安全记录有独立的读取/重试入口，一方失败不会被另一方刷新掩盖。账号读取失败时标注保留的是上次账号及本行输入，当前数量/权限不能确认，暂停创建与权限修改并提供“重新读取账号”。恢复后，未保存的角色和启用状态仍保留；旧安全记录在读取或失败时隐藏，不当作空记录。

每行记录输入所依据的权限修订。更新其他行或创建账号后的列表刷新不会清空本行输入；服务端出现更高修订时，未保存行保留原修订并提示核对，不自动将输入套到新修订。提交仍携带原 `expectedRevision`，真实并发变更返回409。“重新加载权限”须先确认放弃本行修改，然后通过API重新读取；失败保留原输入，成功才替换角色、状态和基准修订。没有增加自动写入、自动重试或新的管理权限。

[Accounts](../web/Accounts.tsx)汇总创建表单与各行的未保存/请求中状态，只向[工作台](../web/App.tsx)传递两个布尔值，不传递用户名、密码或权限正文。成功创建清除用户名、密码并恢复默认角色；更新成功以服务端返回的账号修订作为新基准。密码、草稿和活动状态不写浏览器本地存储。

## 严格响应与未知写入（2026-10-11）

`shared/account-response.ts` 明确投影账号和安全记录，创建回执绑定规范化用户名、角色、启用状态、初始修订及非既有身份；更新绑定同一ID/用户名/创建时间、本次角色/启用状态及预期修订+1。权限重读不能返回别的账号、倒退修订或在相同修订下悄悄改权限。全量列表刷新须包含此前已知账号并保持不可变身份，不能用遗漏行的成功JSON卸载编辑器丢弃输入。首次列表也绑定当前账号；原接口没有账号删除能力，未来若改变协议需显式设计删除/分页语义。

安全事件只接受明确字段、有限动作、有效时间、最多50条且ID严格递减。PG序列回滚可能留间隙，不强求连续ID。新字段带有密码、盐、令牌等不能通过投影检查，也不回显原始无效数据。账号/安全事件的结构与关联校验不证明真实性、权限或专业资格；服务端仍独立检查会话、Origin/CSRF、管理员和事务内修订。

同页创建/逐行读写使用同步共享在途门禁，不仅依赖按钮或活动状态的异步更新。未知权限更新保留输入并暂停该行写入，普通列表刷新、修改输入或失败的权限重读都不解锁；仅明确确认后、所选账号完整重读成功才替换本行基准。其他行的未保存输入继续保留。

未知创建保存原提交的非秘密用户名/角色意图，不自动重试或借修改表单换一个对象重发。“核对账号创建结果”先确认，仅GET全量列表：失败保留输入并继续锁定；找到同名账号只说明当前列表存在该账号，不证明本次创建归属或密码可用，清除创建表单密码并提醒勿重复创建。未找到也不证明原请求没有或不会稍后提交，输入保留，下一次创建须另行人工确认；服务器用户名唯一性仍执行，不新增自动重试或幂等承诺。不同登录账号不继承私有表单，会话变更取消旧等待，不把取消当成服务端回滚。

新增 `tests/account-response.test.ts` 六项和 `tests/browser/account-response.spec.ts` 四项；页面用4314独立账号服务，使用既有专门测试管理员，不增生产账号、不修改限流或假造IP。覆盖实际创建/权限更新落库后破坏回执、单次提交、失败/取消重读、其他行输入保留、真实旧会话撤销、遗漏行防护和未找到后的明确新操作。专项失败和各轮终态见工作区根 `.refactor/evidence/account-response-20261011/RUNTIME.md`；不能沿用下面历史37项作为本次证明。

## 修复前浏览器基线

[修复前整轮](../.local/ci-runs/browser-500904a7-7f41-4390-bcd3-33866490b74c/report.json)实际退出1：37项中32通过、5失败。运行的是修复前构建的React页面；生产代码的后续编辑没有重建或替换该轮页面产物。

[四项新增专项](../tests/browser/accounts-recovery.spec.ts)全部失败，分别观察到刷新丢失用户名、真实账号已经创建但等待响应时退出仍可用、更新一行后另一行角色恢复为旧值，以及缺少独立账号列表重读入口。最后一项属于新增恢复能力的验收，不声称在旧版执行过后续409断言。

第五项失败属于原有审阅队列用例：新专项增加了共用管理员登录次数，触发10次/15分钟限制，未进入队列断言。失败页面明确显示登录尝试过多。后续在两种数据库的专用测试夹具中增加独立管理员供四项专项使用；未清空计数、放宽限额或修改原有队列断言。测试账号只由测试入口创建，不进入生产初始化。

## 验收范围

新增专项使用真实React、HTTP和隔离SQL：放弃确认及取消、页面内存边界、真实创建已提交而浏览器响应延迟、零重复提交、另一行输入保留、真实409与明确重读。网络失败和延迟由浏览器请求拦截注入，不是实际服务故障；合成的`beforeunload`事件只验证监听器阻止默认行为，不代表已验证浏览器原生退出提示。

2026-10-09 04:29:06 CST，[首轮修复后SQLite](../.local/ci-runs/browser-75f41452-5d7d-4778-83b6-b00faade813a/report.json)37/37通过，构建与测试退出0。随后加强原四项专项：等待列表完成再核对另一行输入，增加权限重读失败保留输入，并保存横向滚动后的操作区截图；应用代码未再修改。

04:32:30 CST，[最终SQLite报告](../.local/ci-runs/browser-c7c98fcf-f4b0-4d37-8f11-73011e092740/report.json)完整终态为通过，两个子步骤退出0；37/37、零失败/跳过/波动/框架错误，`forbidOnly=true`。该轮30张PNG独立保留，已查看新增的[冲突说明](../.local/ci-runs/browser-c7c98fcf-f4b0-4d37-8f11-73011e092740/browser-artifacts/accounts-recovery-failed-a-03eb9-l-409-until-explicit-reload/account-revision-conflict-mobile.png)与[权限操作区](../.local/ci-runs/browser-c7c98fcf-f4b0-4d37-8f11-73011e092740/browser-artifacts/accounts-recovery-failed-a-03eb9-l-409-until-explicit-reload/account-revision-controls-mobile.png)。390px整页无横向溢出；账号表格内部需横向滚动，不能据此声称所有列同时可见或手机已验收。

11:09:10 CST，[PostgreSQL完整页面](../.local/ci-runs/postgres-browser-adaeb5dc-3972-4700-bcf0-3a4d7d27cc38/report.json)实际退出0，37/37、零失败/跳过/波动/框架错误；[集群终态](../.local/postgres-tests/cluster-GHovTN/result.json)确认真实PostgreSQL18.4及正常停止。两库都运行加强后的四项专项，保留原有33项；不是只跑新增测试。页面使用构建后的React和TypeScript API夹具，不能替代编译后端或完整迁移恢复验收。

PG另存30张PNG，新增[冲突说明](../.local/postgres-tests/cluster-GHovTN/browser-artifacts/accounts-recovery-failed-a-03eb9-l-409-until-explicit-reload/account-revision-conflict-mobile.png)与[权限操作区](../.local/postgres-tests/cluster-GHovTN/browser-artifacts/accounts-recovery-failed-a-03eb9-l-409-until-explicit-reload/account-revision-controls-mobile.png)已查看。PG停止后核对，SQLite该轮全部30张截图的SHA-256均未变；两轮证据不共用目录。专项文件另经严格TypeScript检查退出0，不将这次独立命令计为CI新增第八组类型配置。

11:11:10 CST，[核心八阶段](../.local/ci-runs/core-e37c4885-7649-4bfe-9af8-2cb608bf8904/report.json)实际退出0：七组类型、165项平台、42例离线契约、原生完整检查/26脚本、生产构建和编译日志专项1/1。[实际编译服务](../.local/request-log-runs/run-kZiDZH/report.json)四次HTTP请求对应日志、正常停止。原生62个上传候选文件仍为360638源码字节，`.10`的12件正式制品未改。此次没有重跑完整PG迁移恢复、双库HTTPS或独立演示，也没有远程、容器、公网或微信真机验收。

复验使用现有隔离入口，按顺序执行，避免共用端口和构建产物：

```text
npm run ci:browser
npm run ci:postgres:browser
npm run ci:verify
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --types node tests/browser/accounts-recovery.spec.ts
```

每轮完整结果分别记录在[持续集成](continuous-integration.md)。本机页面、生产构建、完整数据库迁移恢复、HTTPS、远程CI、线上部署和微信真机各自验收；账号角色与本次工程测试不能作为专业资质或内容发布批准。原生正式内容、安全规则及照片发布状态不因账号界面修复改变。
