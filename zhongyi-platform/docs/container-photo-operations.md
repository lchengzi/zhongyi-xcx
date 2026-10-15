# 图片文件的容器运维入口

`compose.photos.yaml` 是独立的文件运维配置，不与 HTTP 演示或数据库备份配置合并。导出、校验、恢复三项均使用一次性 `photo-backup` 入口，禁用网络、没有端口、不接收任何数据库连接凭据。它们只核对已经取得的数据库归档文件摘要，不能连接或恢复 SQL。

当前已通过宿主机实际编译入口的加密导出、校验、新目录恢复、资源字节核验和提前拒绝检查；Compose v2.39.4 的配置解析也通过。2026-10-13 检查时 Docker Linux 引擎管道仍不存在，没有构建/运行本次镜像，也未证明 Linux 非 root 挂载权限。引擎条件见 [部署边界](container-deployment.md)。不要为运行这些命令绕过系统组件/重启审批。

## 前提和挂载

先按 [图片备份维护流程](photo-resource-backup.md) 停止相关写入，准备匹配且已经验证的数据库归档。原件、展示图和日志必须完整；没有审核批准的图片仍是私有材料，不能因为备份成功而公开。

使用已经构建的 `food-education-demo:local` 运行镜像。Dockerfile 现在包含编译后的图片备份 CLI，沿用 `USER node`；不把原件、密钥、归档或测试产物加入构建上下文。服务默认命令缺少必要参数，不能自行导出或恢复。

| 宿主变量 | 容器路径及用途 |
| --- | --- |
| `CONTAINER_PHOTO_BACKUP_KEY_FILE` | `/run/secrets/photo_resource_backup_key`，独立随机32字节密钥的标准Base64普通文件，不在下列目录内 |
| `CONTAINER_PHOTO_DATABASE_DIRECTORY` | `/database-archive`，只读，已验证数据库归档所在的专用目录 |
| `CONTAINER_PHOTO_ORIGINALS_DIRECTORY` | `/photo-originals`，导出只读原图库，包含清单及其引用文件 |
| `CONTAINER_PHOTO_DERIVATIVES_DIRECTORY` | `/photo-derivatives`，导出只读展示图库及bundle |
| `CONTAINER_PHOTO_JOURNAL_DIRECTORY` | `/photo-journal`，导出日志目录；仅为协作锁需要可写，必须停止发布写入 |
| `CONTAINER_PHOTO_OUTPUT_DIRECTORY` | `/photo-archive-output`，导出可写，输出必须是全新文件 |
| `CONTAINER_PHOTO_INPUT_DIRECTORY` | `/photo-archive-input`，校验/恢复只读，不与输出目录混用 |
| `CONTAINER_PHOTO_RESTORE_DIRECTORY` | `/photo-recovery`，恢复可写父目录，每次在其中新建UUID子目录 |

所有宿主路径需要事先建立、限制访问且互不重叠；不使用整个盘、仓库根、家目录或秘密文件夹作资源挂载。绑定配置明确 `create_host_path:false`，不自动创建缺失路径。Unix 文件模式不能代替 Windows ACL，真实非 root 可读/可写需要另验。不要为解决权限错误改成 root 或关闭链接校验。

目前单份 Compose 的三个服务共享必填插值变量，所以配置解析要求八个变量全部明确设置；不是每个服务都挂载全部目录。校验服务只有两个只读目录，恢复服务额外挂新目录父级，导出才挂原件/展示/日志。使用现有明确空白环境文件或经核对的运维环境，避免意外加载工作目录中的 `.env`。真实值不提交仓库或聊天。

## 明确操作

以下在 `E:\xiaochengxu\zhongyi-platform` 执行，仅适用于获得批准的独立环境。`manifest.json`、`database.zfbackup`、`photos.encrypted.json` 是待替换文件名，不是本项目自动提供的生产备份；容器入口限制它们为相应挂载内的直接子文件。普通宿主CLI的既有绝对路径契约没有缩减。

```text
docker compose -f compose.photos.yaml --profile photo-operations config --quiet
docker compose -f compose.photos.yaml run --rm photo-export photo-backup export --originals-root /photo-originals --manifest /photo-originals/manifest.json --derivatives-root /photo-derivatives --journal-root /photo-journal --database-backup /database-archive/database.zfbackup --output /photo-archive-output/photos.encrypted.json --confirm-maintenance
docker compose -f compose.photos.yaml run --rm photo-verify photo-backup verify --input /photo-archive-input/photos.encrypted.json --database-backup /database-archive/database.zfbackup
docker compose -f compose.photos.yaml run --rm photo-restore photo-backup restore --input /photo-archive-input/photos.encrypted.json --database-backup /database-archive/database.zfbackup --target-parent /photo-recovery --confirm-maintenance
```

受控地复制归档到输入目录时不覆盖已有归档、不复制密钥，不把工作原图放入输出目录。程序拒绝内联密钥、SQL密码文件、混合/多余挂载配置、根目录、路径逃逸、嵌套归档及重叠目录；常驻服务和普通数据库命令拒绝图片备份设置。错误消息不输出原始秘密或异常栈。

恢复结果 `publicationEnabled:false`，不会改服务配置、SQL、权限或工作文件。先核对数据库、资源、近期撤回及资格，再按既有流程切换到新目录、明确冻结/恢复和逐项手动重发。共享发布控制也影响教育内容。原子配对、异地托管、自动保留/轮换、异常断电和生产 RPO/RTO 未验收；这些操作不能以加密认证或配置解析替代。

## 可复现验证

- `npm run test:container-photos`：编译后执行四组边界、配置和实际入口拒绝验证。
- `npm run test:photo-publication`：包含合成JPEG的完整资源导出/校验/恢复链路，编译入口无需数据库秘密；恢复后重新打开注册库，核对原图/展示字节及隔离标记。
- `E:\xiaochengxu\.refactor\evidence\container-photo-operations-20261013\verify-config.ps1`：仅用不存在的非秘密占位路径解析配置，不创建容器/文件挂载或生产密钥。

本轮结果见 `E:\xiaochengxu\.refactor\evidence\container-photo-operations-20261013\RUNTIME.md`。CI 已接对应步骤和合成报告/截图白名单，远程尚未运行；不归档原件、密钥或加密包。
