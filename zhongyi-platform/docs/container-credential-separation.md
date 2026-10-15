# 容器运行与迁移凭据分离

常驻服务不需要结构所有权。容器入口现按命令选择运行或迁移连接，生产模式不再接受旧的共用 `DATABASE_URL_FILE`；独立的 [受限账号编排](../compose.restricted.yaml)将两份连接文件分别授予必要服务。编译入口已在本机真实PostgreSQL上验证，但Docker引擎当前不可连接，不能把配置解析或主机进程测试写成容器部署完成。

## 命令与秘密范围

| 入口或服务 | 接收的连接文件 | 职责 |
| --- | --- | --- |
| server及app服务 | DATABASE_RUNTIME_URL_FILE | 生产只读权限自检后提供业务API |
| bootstrap服务 | DATABASE_RUNTIME_URL_FILE | 仅在空账号库创建首个管理员，无结构权限 |
| init、migrate、backup、runtime-role及operator服务 | DATABASE_OWNER_URL_FILE | 显式初始化、迁移、恢复/备份及授权复查 |

生产入口拒绝共用文件、直接 `DATABASE_URL`、缺少所需文件，以及同时传入两类或错误用途的文件路径；错误在导入操作者或开启数据库前结束。非生产原有演示仍可使用共用文件，不能以降低环境标识绕过生产要求。读取限制8KiB、绝对普通文件和无链接路径；载入后移除文件路径变量，不把秘密写入参数或日志。

文件命名不是数据库授权证明。生产业务仓储仍使用实际连接身份检查31表、3序列、成员关系与有效权限，拒绝结构所有者或越权运行角色；不会自动授权、撤权、修复或回退SQLite。详见[数据库权限策略](postgres-runtime-permissions.md)。主机测试只证明向进程注入的配置范围；文件挂载、宿主权限和实际容器隔离仍需引擎验证。

## 部署前准备

独立编排不是原有HTTP演示的覆盖文件，不与 `compose.yaml` 或 `compose.https.yaml` 合并。Compose对序列和秘密资源有合并规则，不能假设新增秘密就会移除旧秘密。[Docker合并规则](https://docs.docker.com/reference/compose-file/merge/)

由受控管理员在专用环境准备TLS PostgreSQL、非超级用户结构所有者及独立LOGIN NOINHERIT运行角色，按权限说明评估PUBLIC/default权限；不得直接复制到共享生产库。设置以下宿主环境变量，它们只传文件路径、schema、角色名或来源，不传连接内容：

- `CONTAINER_RUNTIME_DATABASE_URL_FILE`与`CONTAINER_OWNER_DATABASE_URL_FILE`：两份不同凭据的只读连接文件。两者均使用正确数据库主机名、`sslmode=verify-full`及`sslrootcert=/run/secrets/database_ca`。
- `CONTAINER_DATABASE_CA_FILE`：验证数据库的CA证书文件。
- `HTTPS_CERT_FILE`、`HTTPS_KEY_FILE`、`HTTPS_CA_FILE`：HTTPS证书链、私钥和就绪探针使用的CA；探针名称需与首个允许来源及证书匹配。
- `DEPLOYMENT_DATABASE_SCHEMA`、`DEPLOYMENT_DATABASE_RUNTIME_ROLE`：已经审查的专用schema及运行角色。
- `HTTPS_ALLOWED_ORIGINS`：与证书匹配的精确HTTPS来源，不能填写通配符。

app只挂载运行连接、数据库CA与HTTPS文件；operator只挂载所有者连接和数据库CA；bootstrap只挂载运行连接及数据库CA。所有者角色由外部管理员准备，不由应用创建。教育公开与外部AI固定关闭，应用端口仅绑定主机回环。

## 操作者顺序

下面仅为已准备好专用环境后的操作步骤。本轮未执行镜像构建、容器启动、工作库迁移或对外发布；生产操作仍须确认。

```powershell
docker compose -f compose.restricted.yaml --profile operator --profile bootstrap config --quiet
docker compose -f compose.restricted.yaml build
```

初始化只用于新schema。已有数据按备份/升级流程处理，不重跑init或覆盖：

```powershell
docker compose -f compose.restricted.yaml run --rm operator init --schema food_education
docker compose -f compose.restricted.yaml run --rm operator runtime-role --apply --schema food_education --role food_runtime
docker compose -f compose.restricted.yaml run --rm operator
docker compose -f compose.restricted.yaml run --rm bootstrap bootstrap demo-admin
docker compose -f compose.restricted.yaml up app
```

示例名称必须替换为已审查环境变量的同一值。operator默认仅复查，不自动初始化或授权；apply须显式指定。bootstrap保留既有一次性密码显示行为，应在受控终端保存且不录屏、分享或提交输出。它拒绝已有账号库，不重置管理员。运行服务不会获得所有者连接；迁移/恢复以后需再次授权复查再启动。

备份/恢复现使用独立的[密钥文件与归档配置](container-backup-recovery.md)，只扩展两个一次性服务，不给app、bootstrap或普通operator追加备份秘密。恢复仍需明确新目标及受控操作窗口；配置与编译入口演练不表示真实Docker挂载、卷或灾备已就绪。

## 当前验证

2026-10-09 16:56:15 CST，[编译容器入口权限专项](../.local/postgres-tests/cluster-6h6mPN/result.json)实际退出0，12/12、零失败/跳过/取消且数据库正常停止。初始化及逐表授权使用所有者文件；bootstrap和真实HTTP登录、备注/草稿/审计及退出使用运行文件，保留越权拒绝、授权回滚与四项真实TLS检查。夹具只注入所需连接文件路径，临时秘密文件用后清理，工作数据库未迁移。

新增三项核心回归检查命令凭据边界、真实CLI早拒绝与独立编排授权范围。专项首次在受限环境因子进程spawn EPERM未执行行为用例，不计通过；获准隔离复跑后，部署与CI两文件共30项通过。首次类型检查发现新环境变量字段推断过窄，已改为明确的ProcessEnv类型；以后续完整类型检查和运行终态为准，不降低类型要求。

Docker Compose v2.39.4实际执行 `config --no-interpolate --format json` 通过，三服务的命令、生产环境和秘密分配与上表一致；未读取连接内容或启动容器。随后独立引擎查询返回Linux引擎命名管道不存在，因此镜像构建、实际秘密挂载、非root读权限、CA路径、Linux信号、健康检查、日志轮转与卷/恢复均仍待验。

17:02:59 CST，[本轮完整PG终态](../.local/ci-runs/postgres-b766a80b-0a49-43ab-8554-09869c5d1792/report.json)实际退出0，60/60、六次真实数据库重启及正常停止；原迁移/API/恢复与旧非生产容器演示兼容检查保留，八项权限行为使用新的编译容器入口。此结果独立于12项专项，不相加计数，也不是Docker恢复证明。[数据库终态](../.local/postgres-tests/cluster-8vrfFA/result.json)确认工作库未操作。

16:58:28 CST，[本轮双库HTTPS](../.local/ci-runs/https-a6384d84-1ab4-4dca-bd1f-58a9035b47ba/report.json)实际退出0，两库各6/6、零失败/跳过/取消并正常停止。PG七次应用启动经过编译容器入口、只注入运行连接文件路径，真实角色/TLS与应用退出均检查；逐次证据在[HTTPS目录](../.local/https-tests/run-oUXX4h/result.json)同级application记录中。生产明文操作者保护保留，截图本轮未目视复查。

17:05:02 CST，[本轮核心终态](../.local/ci-runs/core-3b8d78d7-4261-43b9-9a6c-2fa6f21ab9b1/report.json)八阶段实际退出0：200项平台、42例离线、原生完整检查/26脚本、七组类型、生产构建及[编译日志1/1](../.local/request-log-runs/run-GuDMhH/report.json)。三项新增边界检查进入平台总数，独立12项与完整PG60项不重复计入。正式内容/规则、照片候选与工作库未变。

各轮完整证据见[持续集成](continuous-integration.md)。远程CI、公网、专业审校和微信双端仍独立验收，不因本机编译入口通过而满足。
