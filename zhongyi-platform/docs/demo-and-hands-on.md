# 项目演示与本人复演

这份指引把“项目能运行”和“本人能解释、修改”分开。录像可以帮助熟悉流程，不能代替你独立完成操作。当前真实照片仍待审，新增教育内容和真实AI保持关闭。

## 先看本地演示

演示包解压后双击 `index.html`，无需启动服务即可观看两段录像。可以暂停、拖动进度条，配合 `report.json` 看本轮实际验证范围。

- 用户端：当前Taro/React页面的浏览器适配录像，搜索百合、详情、收藏、山药对比、字号与记录清理。导航、存储及确认是演示替身，不是微信或手机验收，也不是已交付H5；使用插画/部位示意，没有把待审实拍装入用户端。
- 后台：真实React生产页面、编译Express API和独立SQLite。登录在录制前完成，来源明确为演示占位；保存、固定引用、独立编辑审阅和同库重启均是实际操作，不是预填通过画面。编辑审阅不等于专业签审。

浏览器显示的操作时间包括人为停留和录制开销，不作为性能指标。录像不含密码、健康输入、模型密钥或专业证件。不要把 `.local/local-demo`、凭据、数据库或整个证据目录打包分享；只分享已检查的演示包。

## 亲自启动后台

在Windows终端进入 `E:\xiaochengxu\zhongyi-platform`，使用非生产环境：

```powershell
npm.cmd run catalog:check
npm.cmd run build
npm.cmd run demo:prepare:compiled
```

复制最后输出的 `demo:start:compiled -- demo-完整UUID` 命令，再打开其精确回环地址。三种角色的随机密码只在输出提示的本机私有文件查看，不截图、不复制到聊天。需要保留结果时用同一ID重启，不重新prepare冒充数据保留。

按 [本地演示](local-demo.md) 完成备注、演示来源、内容草稿和独立编辑审阅。暂不操作专业资格、最终发布、生产迁移或真实模型。结束时按Ctrl+C，确认服务正常停止。

## 五项本人练习

每完成一项，自己记录改动文件、操作/测试结果、遇到的问题以及如何定位；不要让助手代做后直接勾为掌握。当前本人完成状态均未验证。

### 一个可复现的用户端缺陷：旧记录占用对比名额

从项目根目录运行`npm.cmd run test:mini-storage`，在报告中查看`unavailable_compare_record_can_release_a_slot_without_clearing_other_records`：使用合成历史ID占满四项，展开旧记录并移出一项，名额恢复，收藏和其余记录不变。不要在手机真实存储里故意写入测试ID。完整测试还覆盖旧收藏分页、大字号、隐藏页、旧版本事件和保存失败；浏览器适配与微信原生分别验收。

走读`apps/miniprogram/src/components/unavailable-selections.tsx`、两个页面及`packages/catalog-core/src/selection.ts`，解释为什么未知ID在读取时保留、移除前重新读取并比较revision、写后读回，以及为什么不能直接全量清空来解决名额问题。再看失败复现与修复证据；只有本人能解释和修改后才作为个人掌握内容。详见[本轮记录](../../.refactor/evidence/unavailable-selection-removal-20261014/RUNTIME.md)。

### 一个可复现的图片缺陷：详情停留后图片消失

在整个项目根目录运行`npm.cmd run test:mini-catalog-photos`，检查报告中的`detail_expiry_rechecks_and_observes_withdrawal`和`detail_metadata_failure_has_explicit_retry_without_automatic_error_loop`。前者用工程色块和可控时钟验证到期重新核对及410撤回；后者验证错误不会自行反复请求、手动重试能恢复。完整运行还覆盖短有效期限速、排队与请求中隐藏、隐私清理及红旗取消；不要把工程图片装进手机或称为真实食材证据。

走读`packages/catalog-core/src/photo-client.ts`、`apps/miniprogram/src/features/photos.ts`和详情页，解释为什么到期、暂时失败和撤回是不同状态，为什么不能保留过期照片来掩盖加载问题，为什么续读前后都要检查页面和快照。修复前浏览器复现与当前构建证据见[记录](../../.refactor/evidence/detail-photo-renewal-20261015/RUNTIME.md)。这些代码和测试包含AI辅助，只有本人能独立解释、修改和复跑后，才算本人掌握；本地通过不等于手机或实际照片获准展示。

### 用真实来源的百合待审稿练习

在平台目录完成服务端构建后，可以准备一个**全新的**私有资料工作台：

```powershell
npm.cmd run build:server
node build/tools/prepare-editorial-review.js '..\zhongyi\content-private\research-refresh\2026-10-13-baihe-draft-pack.json'
```

它导入3条实际打开过的来源和1份百合草稿，只创建新的隔离SQLite及本地编辑账号，不修改工作库、历史目录、安全规则或手机包。新目录的`review-pack.html`可以直接打开，查看只读资料、来源限制与待审问题，不用登录；它是导入时快照，后续工作台编辑不会自动改写该文件。保存来源不是来源正式核验；科普/商品报道也不是食品范围批准。失败的大学网页/PDF线索未被包装为已读原文。

执行输出中的精确 `demo:start:compiled` 命令，在本机私有凭据文件查看编辑账号，打开对应回环地址。进入“内容协作 → 内容修订”，搜索“百合”，查看教育说明、安全边界中的待审问题及三个固定版本定位。可以练习一次修改和保存，再用同一个demo ID正常重启检查保留。不要重新prepare来冒充同库重启；不要共享凭据、数据库或整个目录。

这份稿件保留鳞茎/鳞叶、鲜干/粉类和不同来源适用范围的区别，不填未经确定的单一学名，不采纳功效、剂量、配方或个人推荐。导入不提交任务，不创建来源核验、专业资格或意见，不发布，也不发起AI调用。实际中医师/药师、当前有效原始标准和对应真实图片仍待补齐。

源码走读：`server/editorial-review-pack.ts`复用既有`validateSource`、`validateContent`和工作流，不另建发布协议；`tools/prepare-editorial-review.ts`仅操作新演示。合成边界测试随`local-demo.test.ts`进入正常平台测试；实际私有材料的浏览器检查是独立可选的`npm.cmd run test:editorial-review:browser`，要求本机持有指定私有材料，不把材料或截图加入远程CI附件。

### 1. 修改一个页面

阅读 `apps/miniprogram/src/components/catalog-cover.tsx`，只调整一处自然简洁的介绍文案，例如“名称 / 部位 / 加工”的分隔方式，不删插画标注、不改内容或安全边界。

在工作区根运行 `npm.cmd run typecheck --workspace @food-education/miniprogram`，再运行 `npm.cmd run build:mini:verify` 获取独立构建目录。独立构建不自动覆盖活动预览包；按已有项目指引核对并切换，不动AppID、代理或用户记录。解释React组件、TS类型、样式和Taro微信编译分别负责什么。

### 2. 讲清一次保存

从“保存备注”沿实际代码走读：

```text
web/App.tsx
  → web/useEditorialNote.ts、web/api.ts
  → PUT /api/v1/ingredients/:id/note
  → server/app.ts
  → server/database.ts（SQLite）或server/postgres-catalog.ts（PostgreSQL）
  → shared/note-response.ts 校验回执
  → React更新反馈
```

回答：`text`与`expectedRevision`分别是什么？TS编译为何不能校验网络里的JSON？隐藏按钮为何不能代替服务端权限？请求取消为何不等于服务器撤销写入？禁止在开发工具截图中展示Cookie、CSRF值或密码。

### 3. 亲自触发版本冲突

在两个独立浏览器会话中登录自己的演示编辑账号，同时读取同一条备注。A保存后，B保留旧版本编辑并提交，观察409与输入保留；不要自动重发。用“重新加载”明确核对当前记录，再决定如何合并文字和手动继续。

解释数据库为什么必须在事务内再次比较版本，而不能只在页面读取时比较。仅在专用演示库操作，不拿工作数据演练覆盖。

### 4. 跑一个对应测试

在平台目录运行以下已有备注协议与HTTP行为测试：

```powershell
node --import tsx --test tests/note-response.test.ts tests/api.test.ts
```

不要只看最后一行绿色。找到正常保存、旧版本冲突、权限不足或错误数据对应的具体用例，说明测试操作、预期结果与不能证明的范围。若修改实现，保留有效断言，不为了通过而删除反例。

### 5. 同库停止、重启并说明边界

在自己创建的演示中保存草稿和备注，正常停止，再用原ID启动，核对内容及审阅状态保留。说明为什么普通重启可保留未过期会话，而备份恢复会撤销会话、冻结发布。SQL备份不包含图片；文件归档摘要关联也不是原子快照。

之后用微信当前开发预览亲自完成搜索、收藏、另一项对比和返回。记录手机系统、日期和异常；浏览器录像、开发工具截图和安卓/苹果/鸿蒙真机结果分别说明。

## 重新录制

Windows需Node依赖、系统Edge和Playwright配套编码组件；先在平台目录执行完整build。当前电脑的编码组件位于 `E:\xiaochengxu\.refactor\playwright-video-20261013`，没有更改系统组件或旧浏览器。然后在工作区根：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'E:\xiaochengxu\.refactor\playwright-video-20261013'
npm.cmd run demo:record
```

每次生成新的 `product-demo-runs/run-*` 和独立后台演示库，不覆盖旧成果。报告必须为passed、两个视频实际播放验证通过、两次启动/正常停止和工作库未改，才作为本轮成功录像。失败记录保留，不对未知写入或登录重复发送。

换电脑时该私有组件目录不随源码交付。先选一个新的项目内工具目录为 `PLAYWRIGHT_BROWSERS_PATH`，再运行 `node zhongyi-platform/node_modules/playwright-core/cli.js install ffmpeg --no-remove`；需网络，仅安装配套组件，不安装系统依赖、不删除旧浏览器。非Windows还需另行配置可用的Chromium，不能假定本次Windows结果跨系统成立。

## 常见食材稿件与照片同页审阅

### 最新七图与国内现场帧（v10）

打开`E:\xiaochengxu\zhongyi\content-private\research-refresh\baihe-video-reference-20261014\review-v10\start.html`：七张已有清理展示图、一张央视72.031秒完整采挖帧、十来源和部位/待审问题同页。只有选定帧进材料，含脸、成品菜与功效字幕的其余抽样不装入；12文件可离线读取，保留台标，不含完整视频、摄影原件、账户、库或播放器临时参数。不是八张原照片，仍零批准/公开，未确认同颗连续剥片，未生成ZIP/外发。

干净v10后台入口：

```powershell
node build/tools/local-demo.js start demo-59cb6e9b-3898-45fb-b85f-cdf2d069542b --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v3.json
```

后台是v10正文+原有七图；新增PNG视频帧仅在独立待审材料，不冒称进入原图图库/批准流程。实际保存两启停、离线八画面双宽和严格类型通过，详见[本轮证据](../../.refactor/evidence/baihe-video-20261014/RUNTIME.md)。以下v9保留为视频核对前快照。

### 前版七图与食用部位材料（v9）

打开`.local/research-review-packets/run-2036ed4b-48ed-466d-8564-b64e3b4048c9/start.html`：新增央视兰州现场原文，整球鳞茎、肉质鳞片及七张图片逐项对应，十条正文来源与逐图出处/许可声明/问题同页。没有新增照片或取得视频/配对帧，不据现场文字给旧图补品种、产地或食品资格；仍私有待审、零批准/公开。新材料不含原件、账户或数据库，未生成新ZIP或外发。

最终干净后台入口（旧账号不混用，凭据仅在该演示私有文件查看）：

```powershell
node build/tools/local-demo.js start demo-4cad6f7f-1507-4ad0-9d37-ae391cce9027 --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v3.json
```

原网页广告编码错误没有修复：原件保留，正文唯一标记范围严格解码及摘要已核对。新版后台七图双宽、保存两启停及离线材料实际通过；详见[本轮证据](../../.refactor/evidence/baihe-edible-part-20261014/RUNTIME.md)。以下v8及旧包是历史版本。

### 前版七图待审材料（v8）

打开`.local/research-review-packets/run-b7478b66-4905-4907-81fc-434ba3e1691c/start.html`，新原件对应的甘肃百合干参考已加入，七图各有独立来源/许可声明/待审问题，另有十条稿件来源。原件含定位，仅私有保存；材料不含原件、账户或库，不据作者描述鉴定产地/基原，也不与其他图配成同批加工过程。当前未生成v8 ZIP或对外发送。

干净七图后台入口：

```powershell
node build/tools/local-demo.js start demo-d2dd57a0-1095-4c7d-8a3e-0d47ebcc0a5d --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v3.json
```

实际后台七图14双宽/保存两启停和离线七图/原件保留通过，两组类型通过；仍零批准/零公开。详见[新原件证据](../../.refactor/evidence/baihe-gansu-dried-20261014/RUNTIME.md)。以下v7/旧包是历史版本。

### 前版食品商品语境稿（v7）

前版六图/十来源材料可直接打开`.local/research-review-packets/run-8fa62214-6308-4784-8186-39f9c9870e9f/start.html`。当时新增宜兴官方报道的包装鲜品、包装净片和干品来源；净片不自动等于免洗/生食/即食，没有新增照片或批准。照片出处及旧v6保留；这里不声称已生成v7 ZIP或已向他人发送。

干净后台入口（平台目录运行）：

```powershell
node build/tools/local-demo.js start demo-c91a3e5e-9d84-419d-86a1-d438abb7c59d --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v2.json
```

离线材料直接生成入口已实际执行通过：

```powershell
node --import tsx photo-processing/research-packet.ts --pack E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-domestic-draft-pack-v7.json --references E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v2.json --browser edge
```

PowerShell/npm包装入口曾丢失flags并被严格参数校验拒绝，故这里推荐已验证的直接入口，不放宽校验。实际React保存/同库两启停及离线双宽均通过；未取得的2023标准和不适用产品的图片许可另列。详见[食品语境接续证据](../../.refactor/evidence/baihe-food-forms-20261014/RUNTIME.md)。以下v6入口与旧ZIP为历史版本，不要称最新版。

### 前版v6便携待审材料

可直接打开`.local/research-review-packets/run-c0a03dde-3e47-453e-81e9-a7e6381ebe81/start.html`；同级ZIP`百合-六图十来源-待审-20261014-c0a03dde.zip`为10文件、807593字节。解压后打开`start.html`，正文/十来源/六图及空白意见可离线查看，来源网站需联网。已实际解压到另一目录并在1200/390检查，六张图均可读；不要连同父目录、QA截图或本地库打包。

此包是本机内部待审快照：含未知转载许可的研究参考，不表示已获准公开或不特定分发。独立展示图依方向等比、sRGB JPEG重编码并清理附加元数据；不能因此认定可见隐私、许可或专业匹配通过。原件、完整标准PDF、含人脸现场、账户和数据库均不在包内；空白意见不自动进入工作台或产生批准。实际人员/资格/依据/意见仍按既有工作流登记。

本地生成工具已新增，保留旧包、生成新目录：

```powershell
npm.cmd run photo:research-packet -- --pack E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-domestic-draft-pack-v6.json --references E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v2.json --browser edge
```

工具不读数据库/网络，不初始化批准；依赖已安装的Node依赖和系统Edge。当前生成逻辑及参数校验、实际材料/浏览器验收已执行；没有将这一生成命令计作单独手动CLI验收。复现实际材料可显式运行`node node_modules/tsx/dist/cli.mjs --test tests/research-review-packet-browser.test.ts`；它需要本机私有资料，不作为远程CI附件。普通合成参数/HTML安全测试已接默认平台测试和`test:photos`，原Canvas方向/元数据等测试保留。详见[便携交付证据](../../.refactor/evidence/baihe-portable-review-20261014/RUNTIME.md)。

前版v6为六图/十来源：`../zhongyi/content-private/research-refresh/baihe-domestic-references-20261014/start-v6.html`与`2026-10-14-baihe-domestic-draft-pack-v6.json`，当时清单`2026-10-14-baihe-editorial-references-v2.json`补Commons官方宜兴整球缩略图。作者/CC BY-SA声明可定位，但旧原件仍校验失败，不叫修复原件、不给予批准。需使用当前平台构建，旧客户端不认识source-thumbnail会拒绝该数据，不应绕过校验。

新版干净稿与六图同页启动：

```powershell
node build/tools/local-demo.js start demo-5817a13a-1029-43ee-b3a4-eeb48b37ad9a --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references-v2.json
```

新干净库修订1，无演练输入或批准；实际保存/同库两次正常启停证据在独立测试库0b781f00。真实验收显式设置`$env:BAIHE_REVIEW_EDITION='domestic-yixing-thumb-20261014'`，执行`node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/baihe-domestic-materials-browser.test.ts tests/editorial-references-browser.test.ts`；需要本机材料/Edge，不作为远程CI附件。另存湖南现场图含人脸，仍不在六图清单。详见[宜兴独立缩略证据](../../.refactor/evidence/baihe-yixing-thumbnail-20261014/RUNTIME.md)。下面保留旧版入口，不覆盖既有演示。

最新百合稿为`2026-10-14-baihe-domestic-draft-pack-v5.json`，统一材料`../zhongyi/content-private/research-refresh/baihe-domestic-references-20261014/start-v5.html`：重新选编十来源，补两条POWO分类正文，分清unicolor异名链与viridulum接受条目；不解释标准笔误或样本身份，旧稿和来源保留。另取得湖南加工现场图，含人脸/许可未确认，只在统一材料链接到单独私有核对页，**不在下面后台五图清单**。

新版干净稿同页启动（原7275d72b仍为v4，不覆盖）：

```powershell
node build/tools/local-demo.js start demo-77db7ad0-d7b9-40a7-837d-58c45a6186ca --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references.json
```

实际保存/同库正常两启停在独立测试库eb8918eb；干净77db7ad0仍修订1，无演练文字/批准。复现当前数据验收时显式设置`$env:BAIHE_REVIEW_EDITION='domestic-taxonomy-20261014'`，再运行`node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/baihe-domestic-materials-browser.test.ts tests/editorial-references-browser.test.ts`。它需要本机私有材料/Edge，不作为远程CI材料附件；详见[当前稿与现场证据](../../.refactor/evidence/baihe-taxonomy-intake-20261014/RUNTIME.md)。下面保留原v4入口及同页实现说明。

百合最新五张研究参考已经接入真实内容编辑页，与正文、十条固定来源和待审问题同页查看。完成平台构建后，在平台目录明确启动：

```powershell
node build/tools/local-demo.js start demo-7275d72b-64e6-4e3e-928f-fcb389ff59b9 --research-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-14-baihe-editorial-references.json
```

打开终端显示的精确回环地址，用该演示目录自己的私有账号，进入“内容协作 → 内容修订 → 百合”。“研究参考”可切换中百1号、宜兴整球、独立干片、论文A1和干制/复水序列，展开对应疑点；未知许可与仓储缩放版仍明确标注。它们不是候选原件，没有送审、批准或发布按钮。切图/重新读取不会保存正文，失败不会当作没有资料；隐藏/退出会清理预览。不配置该显式参数时不读取这些主机文件，不能将研究目录直接公开托管。

实际同页验收为`demo-ae2c9a98-3e51-4ac0-a492-fd8fd9fe2ff7/research-browser-report.json`，五图双宽10次加载、失败/坏图/取消/隐藏/退出、保存/同库正常两启停、reviewer只读及公开边界通过，工作库/清单不变。该测试库含演练文字，干净库7275d72b不含。私有本地复现运行`node node_modules/tsx/dist/cli.mjs --test tests/editorial-references-browser.test.ts`；它依赖本机材料/Edge，不作为远程CI附件或默认材料测试。通用合成边界测试`tests/editorial-references.test.ts`已接默认平台测试。详见[研究同页证据](../../.refactor/evidence/baihe-research-workspace-20261014/RUNTIME.md)。

最新统一材料为`../zhongyi/content-private/research-refresh/baihe-domestic-references-20261014/start-v4.html`，五图十来源。新增Foods 2023图1B干制鳞片复水研究实拍，国内样本声明、七作者和CC BY声明可定位；是仓储缩放图，不是作者原图或整球拆片配对，不标普通鲜片商品照、不转家庭步骤。新稿干净演示为`demo-7275d72b-64e6-4e3e-928f-fcb389ff59b9`，正常`node build/tools/local-demo.js start demo-7275d72b-64e6-4e3e-928f-fcb389ff59b9`查看。实际保存/正常重启在独立测试库4ad624e2，演练文字不在干净库；详见[干制/复水证据](../../.refactor/evidence/baihe-drying-review-20261014/RUNTIME.md)。仍私有待审，不直接进入小程序。

前版`start-v3.html`四图九来源保留：2022版兰州百合区域产品标准原件已取得，14页完整渲染目视，鲜百合/鲜散片百合/百合干分类与正文页码已补；原文学名差异保留，不视为全部百合食品范围批准。旧干净演示`demo-3d5e78b2-9e11-41ec-8269-7fb873875456`仍在，详见[标准原件证据](../../.refactor/evidence/baihe-standard-text-20261014/RUNTIME.md)。

前版鳞片接续材料`start-v2.html`完整保留，四图八来源，含国内样本语境的论文A1参考片。只取得仓储缩放版，方法含清洗/消毒、拍摄时点未明；不叫未经处理鲜片或作者原图，不与整球/干片称同批。论文有CC BY声明但项目权利/专业意见待审，前两机构参考图仍无许可，不直接进入小程序。本轮没有新增照片或批准。

八来源干净演示为`demo-0dbec160-92a2-4dc6-a076-f233b0ced3cd`，正常`node build/tools/local-demo.js start demo-0dbec160-92a2-4dc6-a076-f233b0ced3cd`即可查看新稿。实际React保存/重启证据在独立测试库1ec5a87d，演练文字不在干净库。详情见[鳞片接续证据](../../.refactor/evidence/baihe-scale-review-20261014/RUNTIME.md)。

前版2026-10-14百合国内资料保留在`../zhongyi/content-private/research-refresh/baihe-domestic-references-20261014/start.html`：两张国内原页参考、旧干片、六条来源与待审问题。宽1200/390均实际离线加载通过。两张机构图尚无转载/商用许可，仅在该私有材料查看，未塞入CC限定图库；不直接复制为小程序资源。

可编辑干净库为`demo-19711082-0d5f-4bff-926d-1a7cb7a52044`，正常`node build/tools/local-demo.js start demo-19711082-0d5f-4bff-926d-1a7cb7a52044`后用对应独立私有账号查看百合六来源稿。后台中的旧候选图片与新国内研究参考层分开，来源登记和保存不等于专业/权利批准。实际保存/同库两次正常启停证据在另一个测试库196415c9，不把测试演练文字带入此干净库。

需要复现本轮私有材料验收时，先完成正常平台构建，再显式运行（依赖本机私有材料/系统Edge，不作为远程CI默认项）：

```powershell
$env:BAIHE_REVIEW_EDITION='domestic-drying-20261014'
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/baihe-domestic-materials-browser.test.ts tests/editorial-review-browser.test.ts
```

本轮执行、原件、失败及许可边界见[本轮证据](../../.refactor/evidence/baihe-drying-review-20261014/RUNTIME.md)，两项实际浏览器验收均通过。以下为前版三食材/五候选的独立同页预览，保留历史入口，不代表新国内参考图已通过发布。

已有百合/山药/莲子干净演示`demo-42437e2c-dc78-4a42-a0df-c2aec54eafe6`可继续使用。后台构建完成后，在平台目录显式启动私有照片预览：

```powershell
node build/tools/local-demo.js start demo-42437e2c-dc78-4a42-a0df-c2aec54eafe6 --photo-manifest E:\xiaochengxu\zhongyi\content-private\research-refresh\2026-10-13-private-preview-common-foods-v2.json --photo-derivatives E:\xiaochengxu\zhongyi-platform\.local\photo-derivatives\run-7ed21d9d-b89f-4a75-8557-b7fcd309d161
```

打开本机`http://127.0.0.1:4314`，使用对应演示目录中自己的独立账号，进入“内容协作 → 内容修订”，搜索百合/山药/莲子。教育说明、固定来源与对应待审展示图现在在同一编辑页；可切换照片、展开疑点。重读照片不重置内容输入，未保存离开仍需确认。页面隐藏、条目切换、会话核对和退出会关闭预览；不会自动读取含元数据的原件。

两个照片路径必须成对、绝对且位于既定项目私有目录。默认启动仍不读取主机继承的图片配置；错误路径、链接、坏摘要、缺图应停止而不是回退。预览不初始化发布日志、不启用AI/教育/图片发布，不产生专业批准。端口占用时按已有`--port`选择明确空闲端口，不结束未知进程。

最终实际验收：`.local/local-demo/demo-e2914578-9033-4000-b3b7-28de65905124/editorial-photo-browser-report.json`，三稿1200/390六状态、五张图双宽10次实际加载、未保存文字、坏摘要、列表失败不当作空集、受控隐藏和正常退出均通过，零原件读取/零批准。前两轮目录252502c5与abcd8b79保留。这是私有后台，不是小程序正式图文上线。复现真实私有材料验收可显式运行`npm.cmd run test:editorial-photos:browser`；它需要本机现有材料/系统Edge，不列为依赖私有资料的远程CI。

第二版离线包保持不变：`.local/photo-review-packets/run-b8d535d9-e23a-4060-a55b-f99939e6f7b1/start.html`，同级ZIP`常见食材-百合山药莲子-待审-v2-20261013-b8d535d9.zip`解压后打开start.html。含三稿九来源和五张候选；当时只验证独立材料与草稿读取，之后同页照片入口由上节接续。不把离线材料或私有后台写成已公开图文小程序。

百合/山药实际资料待审包已另行准备：在`.local/photo-review-packets/run-86e3e8a6-f36a-4fdf-803a-b32360eedc85`打开`start.html`，或解压同级`常见食材-百合山药-待审-20261013-86e3e8a6.zip`后打开。含两份稿、六条正文来源和三张展示候选，无原件/账号/数据库，保留未审状态；日本市场百合不默认匹配中国目录，宜兴原件处理失败及山药鲜品429不算配图完成。离线材料不是小程序公开版。

可编辑干净演示分别为百合`demo-6bf15411-0ad1-4726-a188-fe3683d40178`、山药`demo-3693e02e-ceb3-48bd-8a53-1c4355aa3ece`，按上文正常启动同ID，在本机对应私有目录自行读取独立账号，不共享凭据。材料HTML为导入时快照，不会自动带出后续修改；百合有实际React保存/同库重启证据，山药本次为导入/SQL/离线材料验证，不混同为已完成真人审校或本人实操。

## 面试描述

可以准确讲“项目在AI辅助下采用Taro/React/TypeScript、Express与SQL，已有本地完整编辑协作、版本冲突和恢复保护的实现与证据”。只有完成相应本人练习后，才把能解释与修改的部分写为个人能力。

不要写“独立完成全部架构”“正式上线”“生产灾备完成”“真实AI效果已验证”或“多系统真机全部通过”。相关候选描述及未验证部分见 [求职证据](career-evidence.md)。
