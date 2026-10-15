# 源码副本启动与交接

源码包用于复现微信小程序、React管理端和TypeScript API。它保留历史目录、公开协议、测试、两份依赖锁文件及构建工具；不包含依赖、数据库、账号凭据、待审照片、私有研究原件或本机微信配置。

请解压到一个新的空目录，不覆盖原工程。`SOURCE_MANIFEST.json`列出打包时的源码路径、字节数与SHA256，属于完整性清单，不是数字签名、内容授权或专业批准。本机持续执行计划、运行证据和待审材料留在原工作目录；部分历史文档对这些本机材料的引用不会随源码包提供。

## 安装与检查

当前开发验证环境为Windows、Node.js 22.15.1。工程要求Node.js 22.13以上、npm和Git；真实浏览器测试另需本机Edge。微信预览另需微信开发者工具和自己的开发者配置。

在解压目录的PowerShell执行：

```powershell
npm.cmd ci --no-fund
npm.cmd --prefix zhongyi-platform ci --no-fund
npm.cmd run catalog:check
npm.cmd run typecheck
npm.cmd test
```

两份锁文件需要分别安装，可能访问依赖仓库。不要只复制`apps`目录，历史目录校验仍会使用`zhongyi/data`、`utils`和`tools`。默认图片研究测试使用明确标记的合成记录；真实原件检查`test:photo-research:local`与`photo-research:check`不适用于此包，缺资料时应失败，不能为通过而删除校验。

## 打开管理端和 API

```powershell
npm.cmd --prefix zhongyi-platform run build
npm.cmd --prefix zhongyi-platform run demo:prepare:compiled
```

准备命令会输出专用演示ID、凭据文件位置及启动命令。使用实际ID执行：

```powershell
npm.cmd --prefix zhongyi-platform run demo:start:compiled -- 实际演示ID
```

打开终端输出的本机地址，在本机查看新生成的凭据并登录。此入口只使用专用演示库，外部AI和教育内容发布固定关闭。停止时按Ctrl+C，看到正常停止结果后再关闭终端；重启使用原ID，不重新准备。凭据和数据库不要录屏、上传或随源码再次打包。完整流程见[独立本地演示](../zhongyi-platform/docs/local-demo.md)。

## 构建和预览小程序

在新解压目录执行：

```powershell
npm.cmd run build:mini
```

该命令生成`apps/miniprogram/dist`；不要在正在预览的原工作目录里直接覆盖产物。`build:mini:verify`是另存验证产物的入口，不会自动激活到`dist`。

微信开发者工具导入`apps/miniprogram`，小程序目录使用`dist/`。包内[空配置模板](../apps/miniprogram/project.config.example.json)不含AppID；仅在目标配置不存在时，复制为同目录的`project.config.json`并填写自己的有效AppID。已有配置应保留，或由开发者工具正常创建，不能覆盖其他账号的设置。保持`urlCheck=true`，不要填写AppSecret或为预览关闭域名校验。

干净副本中没有原生工程的私有配置，所以`wechat:prepare`不能直接复制旧AppID。源码包也不包含旧二维码；使用自己的配置编译后生成预览。当前默认在线来源关闭，历史目录可本地浏览，待审照片没有进入公开用户端。

## 再次生成交付包

打包工具使用Node内置能力和PowerShell 7，不依赖现有`node_modules`。在原工程或已解压源码根目录执行：

```powershell
npm.cmd run test:source-archive
npm.cmd run source:export
```

每次创建新的交付目录和临时副本，不覆盖旧包，不递归清理。成功时输出`.refactor/deliveries/source-随机ID/food-education-source.zip`，同时保存清单、ZIP摘要和解包核对结果。它按明确白名单选择文件，并验证每个压缩项和解包后的源码；失败时保留副本与日志，不将未通过的ZIP当作交付成果。

## 当前验收范围

每个交付包的实际安装、类型、测试、构建和运行结果，以该包配套的验收摘要为准；清单或解包检查通过，不代表这些步骤都已运行。图文工作台和对应测试属于源码，真实待审原图、授权材料及私有研究记录不在此包，缺少这些资料时不能声称已核对实拍。

此前交付包已有本机同次完整链通过的独立记录，不自动覆盖之后的源码改动。更早一轮首次API约16秒才监听、超过15秒门禁的失败仍保留，根因未定；后续通过不能作为该波动根因已修复的证据。

安卓已确认新版首页、百合搜索和详情；完整收藏/对比、iOS与鸿蒙、正式HTTPS部署、远程CI、获准实拍公开、真人专业审校及授权真实AI评测仍分别验收。源码交付不改变这些状态，也不代表接收者本人已经掌握相关技术。
