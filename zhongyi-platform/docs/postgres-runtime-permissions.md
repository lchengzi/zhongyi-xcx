# PostgreSQL 运行账号与迁移账号隔离

应用运行账号可以读取目录、维护会话和编辑资料，但不需要拥有业务表或修改结构。当前授权工具为 PostgreSQL v9 的33张表（31业务表及2个PG迁移表）和3个序列提供明确授权与有效权限检查；photo_notes、photo_submissions和photo_rights_reviews均仅SELECT/INSERT。旧库显式升级v9后需重新应用并核验授权，不能把旧v8及更早权限证明用于新版服务。生产业务仓储使用自身连接执行只读权限检查，合格后才启动服务。检查不需要迁移账号密码，不创建角色、设置口令、授权、撤权或切换工作库。HTTPS联合夹具已改用独立运行角色；[容器凭据分离](container-credential-separation.md)进一步按命令限制秘密文件，并提供独立生产模式编排，实际Docker运行仍待验。当前图片权利模块仅有数据层，真实PG各轮结果见根`.refactor/evidence/photo-rights-20261012/RUNTIME.md`，不据此宣称当前全量验收通过。

## 权限范围

| 对象 | 运行账号权限 | 用途 |
| --- | --- | --- |
| 目录、元数据、两类迁移历史及迁移记录共5表 | SELECT | 读取历史目录及启动版本校验，不修改基线 |
| 备注、用户、来源头、草稿、审阅任务 | SELECT INSERT UPDATE | 保存当前状态，不删除历史 |
| 会话 | SELECT INSERT DELETE | 登录、过期清理、退出与撤权 |
| 登录计数 | SELECT INSERT UPDATE DELETE | 持久化限流及过期清理 |
| 其余20表，包括审计、修订、专业、发布及图片核对/送审/权利历史 | SELECT INSERT | 追加记录，不授权 UPDATE DELETE TRUNCATE |
| 三个审计序列 | USAGE | 分配新编号，不授权重置序列 |
| 专用 schema | USAGE | 查找业务对象，不授权 CREATE 或所有权 |

逐表清单位于 [权限策略](../server/postgres-permissions.ts)。不使用 `GRANT ALL`、`ON ALL TABLES` 或未来对象的宽泛默认授权。新增表或迁移版本需要重新审查清单，不自动把权限扩展到新内容。表所有者能修改结构，单纯撤销表级写权限不能限制所有者，因此运行账号不能持有所有权。[PostgreSQL 18 权限说明](https://www.postgresql.org/docs/18/ddl-priv.html)

数据库角色与应用内的 admin、editor、reviewer 不是同一层：全部 API 使用同一个运行账号连接数据库，用户角色隔离仍由服务端会话与事务内校验实现。受限数据库账号不等于按最终用户配置了数据库行级权限，也不能防止持有运行凭据的人读取该工作台的全部私有表。

## 检查与拒绝条件

工具要求当前连接者是专用 schema、表、序列和历史保护函数的所有者，且不是超级用户或具备建库、建角色、复制、绕过行级权限的角色。目标运行角色必须存在、允许登录、NOINHERIT，且无上述高权限。它不能等于连接者，也不能拥有业务对象或加入任何角色成员关系；NOINHERIT 本身不能阻止 SET ROLE，因此成员关系单独检查。[PostgreSQL 18 角色成员关系](https://www.postgresql.org/docs/18/role-membership.html)

有效权限检查覆盖 PUBLIC、列级授权、转授权限及序列权限，而不只比较一份授权字符串。运行角色不能在当前数据库创建 schema 或临时表，不能在用户 schema 创建对象，不能访问另一个业务 schema 的表/序列或执行其中的自定义函数。目标 schema 必须恰好包含已知业务对象及一个非 SECURITY DEFINER 的历史保护函数。未审查的新对象、额外写权限、转授权限和缺少必需权限均会拒绝。

PostgreSQL 默认向 PUBLIC 授予数据库 CONNECT 和 TEMPORARY，旧版本升级库还可能保留 public schema 的 CREATE。工具不会静默撤销这些共享权限；数据库管理员需先评估其他应用影响并完成专用环境准备。自定义扩展函数或共享业务 schema 也可能使此严格检查失败，不能为通过检查而直接删除它们。[默认权限](https://www.postgresql.org/docs/18/ddl-priv.html)、[schema 使用边界](https://www.postgresql.org/docs/18/ddl-schemas.html)

检查范围是当前数据库中的业务对象及目标角色成员关系，不是整个 PostgreSQL 集群的安全审计。其他数据库、扩展、内置函数、服务器地址规则、操作系统访问和凭据泄漏仍需独立审查。数据库管理员在工具事务之外改变权限也需协调；应用锁不能约束任意外部管理员操作。

## 操作者流程

仅在管理员已经准备好的专用数据库中执行。真实工作库迁移、已有共享权限调整和生产切换仍须事先确认，不因工具存在获得自动操作授权。

1. 通过受控管理渠道建立两个不同角色，使用不同凭据。迁移角色拥有目标 schema 与对象，允许在专用数据库创建新 schema；运行角色使用 LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS，不加入迁移角色或其他角色。
2. 明确给予两者目标数据库 CONNECT。由管理员检查 PUBLIC 与 public schema 的默认权限，使运行角色不具有 CREATE 或 TEMPORARY；不要直接在共享生产库复制撤权操作。
3. 使用迁移角色连接，按既有流程初始化或迁移到新 schema，保留版本和摘要校验；不覆盖已有目标。
4. 在相同操作者环境设置迁移角色的 `DATABASE_URL`，显式运行授权，再独立检查：

```powershell
npm.cmd run db:runtime-role:postgres -- --apply --schema food_education --role food_runtime
npm.cmd run db:runtime-role:postgres -- --verify --schema food_education --role food_runtime
```

5. 启动服务时改用运行角色的连接秘密；初始化、结构升级与恢复使用迁移角色的独立秘密，不能把迁移凭据挂载给常驻服务。账号 bootstrap 是业务写入，可使用运行角色，不需要结构所有权。

`--verify` 不授予权限；`--apply` 只补齐明确的必需权限，遇到越权配置会拒绝，不撤权、不修改角色属性或共享默认权限。全部 GRANT 在同一事务内执行，最终复查失败也回滚。操作错误只输出固定错误码，不输出原始 SQL 错误或连接字符串。生产操作者仍受共享连接池 `sslmode=verify-full` 强制约束；本次权限专项只证明数据库 TLS 下的本机 HTTP API，不替代双段 HTTPS 联合验收。

支持范围以项目实际使用的 PostgreSQL 18 为准；权限检查包含 MAINTAIN，不据此宣称兼容所有旧版本或所有托管服务。

## 生产启动门禁

`NODE_ENV=production` 的 PostgreSQL 业务仓储在提供服务前执行 `REPEATABLE READ READ ONLY` 事务，以当前连接自身身份核对同一清单。审计事务固定 `search_path=pg_catalog`，不受账号默认搜索路径影响；操作者授权事务也使用同一保护。显式传入生产环境的仓储强制检查，不依赖修改全局环境；全局生产模式不能由调用方传入宽松参数关闭。非生产演示默认保持原行为，不为通过门禁而降低生产环境标识。

检查拒绝超级用户、结构所有者、角色成员关系、额外权限、缺少必需权限和未知对象；还要求 `current_user` 与 `session_user` 相同，拒绝高权限认证账号先 SET ROLE 到受限角色的替代方案。权限不符返回固定 `unsafe_database_permissions`，关闭连接池，不监听HTTP，也不回退SQLite或自动修复。共享连接池的严格TLS检查仍先于权限校验。

初始化、迁移/升级和恢复仍由操作者使用独立所有者连接完成，不把运行门禁用于禁止必要结构操作。账号bootstrap使用业务仓储，生产环境因此也需合格运行账号。检查是启动时快照，不是持续监控；管理员之后变更权限仍需受控流程及重新验收。

## 复现与证据

```powershell
npm.cmd run test:postgres:permissions
```

专项先编译服务与操作者工具，再新建只监听本机、使用临时 CA 和 SCRAM 的 PostgreSQL 集群。在独立数据库内建立非超级用户迁移角色与运行角色，初始化真实106条历史种子；不使用工作数据库。九项权限/恢复行为与四项真实 TLS 检查必须全部通过，不能跳过、取消或替代完整恢复套件。已有 OpenSSL 3+ 路径可通过 `HTTPS_TEST_OPENSSL` 指定，脚本不安装工具或修改系统信任。

原八项行为覆盖：编译授权/复验/重复授权；受限账号下编译 API 的登录、备注、草稿、审计、退出与私有隔离；全局/显式生产门禁及认证身份检查；结构操作、触发器禁用、所有者切换和序列重置被拒绝；逐表历史改写被拒绝；角色/PUBLIC/列级/转授漂移被拒绝；真实部分 GRANT 后注入失败并完整回滚；默认临时表权限或新表导致授权前拒绝。新增第九项通过编译容器入口及独立密钥文件，完成真实加密导出、新数据库恢复、旧会话撤销、发布冻结，以及显式授权后受限仓储读写；详见[备份密钥与归档](container-backup-recovery.md)。

2026-10-09 17:23:22 CST，[当前完整PG终态](../.local/ci-runs/postgres-5c8b6548-bb25-401b-b5df-f7bab61f5226/report.json)实际退出0：61/61、零失败/跳过/取消，六次真实数据库重启、四项TLS及正常停止。[原始终态](../.local/postgres-tests/cluster-YQIvma/result.json)保留本轮范围。17:19:16的[独立专项](../.local/postgres-tests/cluster-UbIfNY/result.json)13/13另验，不重复计入61项。新恢复用例没有声称其新数据库本身另经重启；六次重启属于完整套件已有恢复场景。以下60项与11项记录保留原历史范围。

这八项也已接入完整 PostgreSQL 测试入口，四项 TLS 共用模块只注册一次。完整套件由原52项扩展为60项；2026-10-09 16:39:01 CST，[最终代码完整PG终态](../.local/ci-runs/postgres-8c5add0e-31a6-4d0a-9510-35dea860e465/report.json)实际退出0，60/60、零失败/跳过/取消、六次实际数据库重启。[数据库原始终态](../.local/postgres-tests/cluster-2z204F/result.json)确认TLS四项与正常停止，工作库未迁移。生产门禁用例同时观察真实事务为只读且搜索路径固定。五组远程 CI 配置不变，远程实际运行尚未发生。

每轮报告位于独立 `.local/postgres-tests/cluster-*/result.json`，共享 latest 只用于定位，不作为历史链接。临时集群保留原始证据；不得上传整个目录，其中包含测试数据库、证书私钥和服务器日志。

2026-10-09 15:55:22 CST，[本轮专项终态](../.local/postgres-tests/cluster-CIdWcX/result.json)实际退出0：11/11，零失败/跳过/取消，`runtimeRoleSeparationVerified=true`、`compiledBackendVerified=true`、`databaseTlsVerified=true`，服务和数据库正常退出，系统信任及工作库未改。运行环境为 Windows、PostgreSQL18.4、Node22.15.1；实际受限账号 SQL 会话确认 TLS1.2或1.3、至少128位，测试不把客户端配置对象当作真实连接。

首轮于15:53:20结束的[失败终态](../.local/postgres-tests/cluster-z9tEVt/result.json)为9/10，夹具正常停止。越权操作均被拒绝，但目录数量的末尾断言把实际数字106误作字符串比较；修正数字断言后，在新集群完整重跑，并新增部分 GRANT 后真实回滚检查。旧失败报告不覆盖，也不改成当前11项已执行的记录。

15:58:53 CST，[本轮核心终态](../.local/ci-runs/core-8c89f6bd-c44c-4c08-a8b5-4f4767e3d5d3/report.json)八阶段实际退出0：196项平台、42例离线、原生完整检查/26脚本、七组类型、生产构建和[编译日志1/1](../.local/request-log-runs/run-YHGdOY/report.json)通过。新增三项策略检查和一项专项证明检查进入平台总数；专项不重复计入196项。本轮正式内容/规则、照片候选和小程序运行代码未变。

## 后续接入

16:45:04 CST，[最终代码核心终态](../.local/ci-runs/core-87a6639f-408c-4554-b281-8d377060821c/report.json)八阶段通过：197项平台、42例离线、原生完整检查/26脚本、七组类型、生产构建及[编译日志1/1](../.local/request-log-runs/run-WmVNlD/report.json)。16:43:09 CST，[固定系统搜索路径后的HTTPS终态](../.local/ci-runs/https-de4e7474-7bff-4c9e-a4d5-b831d6d85291/report.json)两库各6/6、七次PG受限角色加密连接与全部正常停止通过；上方60项完整PG为同一最终代码的独立验收。三类检查不互相替代，不代表远程、容器或公网实测。

16:19:35 CST，[生产权限与HTTPS联合终态](../.local/ci-runs/https-27e6bbc2-1786-4760-83fa-54394154e454/report.json)实际退出0：两库各6/6并正常停止，PG七次编译应用均用独立受限账号与TLS1.3/256位SQL连接；高权限、额外权限及缺少权限的编译入口均拒绝启动，详见[联合验收](https-runtime.md#生产权限门禁与受限角色联合验收)。历史11项专项不因此倒填为HTTPS证据。

容器入口和独立编排现已区分运行/迁移秘密，见[凭据分离专项](container-credential-separation.md)；原有HTTP演示不变。实际秘密挂载、TLS数据库及引擎内恢复仍需验证。公网、真人专业审校和安卓/iOS微信体验仍分别验收；本轮不改正式内容、规则或照片候选。
