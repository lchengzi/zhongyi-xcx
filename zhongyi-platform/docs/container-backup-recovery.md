# 容器备份密钥与归档恢复

备份/恢复入口现在要求独立密钥文件和专用归档目录，常驻服务、账号初始化和普通迁移入口拒绝这些配置。真实PostgreSQL已验证编译入口的加密导出、恢复到新数据库、旧会话撤销及发布冻结；这仍是本机进程演练，不是Docker卷或生产灾备证明。

## 密钥与目录边界

在[独立受限账号编排](../compose.restricted.yaml)上增加[备份操作配置](../compose.backup.yaml)，不与旧HTTP演示合并。配置仅新增两个需显式调用的一次性服务：

| 服务 | 秘密与挂载 | 操作范围 |
| --- | --- | --- |
| backup-export | 所有者连接、数据库CA、独立备份密钥；可写/archive-output | 明确已有schema与全新输出文件 |
| backup-restore | 所有者连接、数据库CA、独立备份密钥；只读/archive-input | 明确输入文件与全新目标schema |

app、bootstrap和普通operator不挂载备份密钥或归档目录。两个备份服务无主机端口，根文件系统只读、禁止提权且不启用容器持久日志驱动；报告仍由受控终端接收。默认命令缺少文件/schema会拒绝，不自动导出、恢复、切流或删除归档。

容器命令要求 `BACKUP_ENCRYPTION_KEY_FILE`，拒绝直接密钥环境值或同时配置两者。密钥只从绝对普通文件读取，路径无链接、上限128字节，并验证32字节密钥的规范标准Base64；允许文件末尾换行。非备份命令拒绝密钥及归档配置。宿主独立CLI保留既有安全环境密钥接口，不把它误写成所有入口都接受文件变量。

`BACKUP_OUTPUT_DIRECTORY`与`BACKUP_INPUT_DIRECTORY`只允许选择当前操作需要的一种。文件必须是专用目录内的直接子文件，拒绝相对路径、父级逃逸、嵌套子目录及目录本身；密钥和数据库连接文件必须在归档目录之外。实际读写继续执行无链接、独占创建、大小和认证检查，不以预检替代操作时检查。密钥缓冲区在验证和操作者退出时清理，但不宣称JavaScript字符串或宿主内存已完全擦除。

## 部署准备与操作

先完成[凭据分离](container-credential-separation.md)中的TLS数据库、角色及CA准备。由操作者在受控位置建立两个不同的专用归档目录，并设置访问权限；不要使用仓库根目录、整个用户目录、系统目录或秘密文件夹。

- `CONTAINER_BACKUP_KEY_FILE`：独立的32字节随机密钥Base64文件；不要把真实值写入源码、命令、日志或聊天。
- `CONTAINER_BACKUP_OUTPUT_DIRECTORY`：已经存在、可写且限制访问的加密归档输出目录。
- `CONTAINER_BACKUP_INPUT_DIRECTORY`：已经存在的恢复输入目录，容器按只读方式挂载。

密钥文件必须在两个归档目录之外，归档文件与密钥分开保管。绑定挂载配置 `create_host_path=false`，不自动创建宿主路径。Unix文件模式请求不等于Windows ACL或非root容器已经可读写；实际宿主权限与挂载需另验。密钥轮换仍需保留旧归档所需旧密钥，不自动生成生产密钥、上传异地归档或制定保留期限。

以下步骤只用于已经批准的专用环境，本轮未对工作库执行：

```powershell
docker compose -f compose.restricted.yaml -f compose.backup.yaml --profile backup --profile restore config --quiet
docker compose -f compose.restricted.yaml -f compose.backup.yaml run --rm backup-export backup --schema food_education --output /archive-output/food-education-001.zfbackup
docker compose -f compose.restricted.yaml -f compose.backup.yaml run --rm backup-restore backup --restore --input /archive-input/food-education-001.zfbackup --schema food_education_recovered
```

schema名称和文件名必须替换为已确认的值。先通过受控流程将加密归档复制到输入目录，不复制密钥或覆盖原文件。恢复不授予运行角色权限，所有者随后需对新schema显式授权并独立复查；如果把目标放在同一数据库，既有schema、函数或跨schema权限可能触发严格隔离检查，不能为通过检查任意撤销共享权限。演练使用独立的新数据库避免这一影响。

备份报告的 `recoveryVerified=false` 仍表示尚未恢复。只有恢复报告逐表/历史/序列核验通过，并确认旧会话撤销与新冻结状态后，才能进行受限运行账号的重新登录、目录/私有记录读写与审计验收。公开接口保持默认关闭，不会恢复旧批准或自动发布。人工确认差异、备份时点与权限后才能切流，当前工具不执行切流。

## 本机验收

2026-10-09 17:19:16 CST，[权限与恢复专项终态](../.local/postgres-tests/cluster-UbIfNY/result.json)实际退出0，13/13、零失败/跳过/取消，应用与数据库正常停止。原八项权限行为及四项TLS保留，新增一项通过真实编译容器入口，以非超级用户所有者和独立密钥文件导出28张业务表及迁移历史/序列，再恢复到新数据库。

演练确认重复输出不覆盖原加密文件；错误密钥未创建目标；正确恢复核验通过、旧会话撤销、发布冻结；重复恢复拒绝已有目标。恢复后未授权运行角色不能启动，显式授权后正常登录、读取原私有备注和写入新修订，旧会话仍失效，原库及输入/输出加密文件不变。临时密钥与归档文件只在自有夹具内清理，没有操作工作数据库。

五项新增核心回归覆盖共享参数解析、规范密钥与用途隔离、归档路径/秘密目录分离、导出/恢复编排及真实CLI早拒绝；与原部署/加密测试合计24项针对性检查通过。七组严格类型检查通过。17:23:22 CST，[完整PG终态](../.local/ci-runs/postgres-5c8b6548-bb25-401b-b5df-f7bab61f5226/report.json)61/61、六次真实数据库重启、TLS及正常停止通过；新增恢复目标自身没有另做重启，不把全套六次重启倒填到新用例。双库HTTPS与核心独立结果见[持续集成](continuous-integration.md)，专项不替代完整恢复套件。

Docker Compose v2.39.4实际合并解析五服务通过，app/普通operator/bootstrap没有新增密钥或归档挂载，导出可写与恢复只读、禁止自动创建路径的配置均保留。引擎仍未验收，因此不能称Linux秘密挂载、非root读写、真实卷持久性、容器恢复或生产RPO/RTO通过。远程CI、公网、专业审校和微信双端仍分别验收。
