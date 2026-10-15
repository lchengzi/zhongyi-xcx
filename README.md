# 食养教育全栈工程

用户端采用 Taro、React 和 TypeScript，内容管理端采用 React、TypeScript 和 Vite，API 采用 Express 和 TypeScript，支持 SQLite 与 PostgreSQL。产品定位为非医疗食养教育，不提供诊断、处方或个体化用药指导。

当前安卓预览的首页、百合搜索和详情已获用户确认；收藏、对比与其他设备分别验收。百合、山药等实拍与部位资料仍在私有待审流程中，公开真实照片为零。源码副本的安装、演示和微信配置见[源码交接](docs/source-handoff.md)。本机持续执行记录`REFACTOR_STATUS.md`、`REFACTOR_PLAN.md`及私有运行证据留在原工作目录，不随源码包提供。

## 工程目录

- `apps/miniprogram`：微信小程序页面、交互与平台适配。
- `packages/catalog-core`：共享领域模型、规则与公开协议。
- `zhongyi-platform`：管理端、API、数据库与本地演示。
- `zhongyi`：保留的原生基线及历史数据。生成和核对目录仍会读取其中的数据与工具，不要只复制新应用目录。

## 安装和检查

需要 Node.js 22.13 或更高版本、npm 和 Git。在项目根目录的 PowerShell 执行：

```powershell
npm.cmd ci --no-fund
npm.cmd --prefix zhongyi-platform ci --no-fund
npm.cmd run catalog:check
npm.cmd run typecheck
npm.cmd test
```

根目录与管理端目前各有独立锁文件，需分别安装。默认测试使用明确标记的合成图片研究记录，并实际检查无私有资料时该组测试可运行；合成数据不是照片、来源或审校证据。以上不是整套工程在干净机器上已全部验收的声明。

仅在持有原始私有研究资料的本机另行执行：

```powershell
npm.cmd run test:photo-research:local
npm.cmd run photo-research:check
```

这两条命令核对真实记录与历史摘要；资料缺失会失败，不会自动生成、跳过或获得批准。

## 微信小程序

```powershell
npm.cmd run build:mini:verify
```

验证构建保存独立产物，不自动覆盖正在预览的 `dist`。确认验证结果并准备更新活动包后，普通构建命令为 `npm.cmd run build:mini`；它会写入活动 `dist`，不要把它当只读检查。

已有本机配置和有效 AppID 时，微信开发者工具导入 `apps/miniprogram`，小程序目录为 `dist/`。`npm.cmd run wechat:prepare` 只从已有原生工程配置复制 AppID，遇到不同的目标配置会拒绝覆盖；它不注册账号，也不能在缺少该私有配置的干净副本中直接使用。配置不随源码交付，新电脑需使用自己的开发者配置。手机操作见 [预览指引](zhongyi/docs/wechat-phone-preview.md)。

## 管理端与 API 本地演示

使用独立演示库，不连接已有工作库。在项目根目录执行：

```powershell
npm.cmd --prefix zhongyi-platform run build
npm.cmd --prefix zhongyi-platform run demo:prepare:compiled
```

首次准备会输出新演示 ID、凭据文件位置和启动命令。使用实际 ID 执行 `npm.cmd --prefix zhongyi-platform run demo:start:compiled -- 实际演示ID`，打开输出的本机地址；以后复演只启动原 ID，不重新准备。凭据仅在本机查看，不上传或录屏。按 Ctrl+C 正常停止，数据库与账号保留。详见 [独立本地演示](zhongyi-platform/docs/local-demo.md)。

## 源码交付与后续验收

私有待审资料、数据库、凭据、本机配置、依赖、缓存和运行证据已配置 Git 忽略规则。`npm.cmd run test:source-boundaries` 在独立临时仓库中检查这些规则，不修改工作仓库；忽略规则不能移除已经跟踪或已经外发的文件，实际交付前仍需审查清单。不要直接打包整个工作目录。

`npm.cmd run source:export`生成新的源码ZIP并验证解包后的清单和摘要，打包工具需要PowerShell 7。新电脑使用空微信配置模板填写自己的AppID，不复制旧账号设置。操作和范围见[源码交接](docs/source-handoff.md)。

远程 CI、完整 TS 工作区干净安装、正式 HTTPS 部署、获准实拍公开展示、真人专业审校和授权真实 AI 评测仍独立验收。本机测试、模拟器和扫码预览不能替代这些结果。

求职展示从 [演示与本人实操](zhongyi-platform/docs/demo-and-hands-on.md)和 [项目证据](zhongyi-platform/docs/career-evidence.md)开始，以本人能够解释和复演的功能为准。
