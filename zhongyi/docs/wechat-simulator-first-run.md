# 微信模拟器首次运行记录

2026-10-11，现有项目首次通过微信开发者工具的受授权接口完成实际页面检查。首页启动异常已修复；首页、搜索、详情分包、收藏同步及撤销取得模拟器证据。安卓、苹果和鸿蒙真机结果仍需单独验收。

## 环境与启动修复

工具为2.02.2608080，实际运行日志标注基础库3.17.4；项目私有配置也选择3.17.4，公共配置中的3.7.6仅为原工程基线。服务端口及Codex访问授权均已生效，接口版本0.3.11相符。本记录不保存登录用户标识或访问令牌。

原首页出现 `module 'config/public-api.json.js' is not defined`，原因是运行代码直接require JSON；另一处版本JSON引用存在同类问题。现在改为[公开服务配置模块](../config/public-api.js)和[运行版本模块](../data/version-runtime.js)，原JSON仍为配置与版本依据。[项目检查器](../tools/check-project.js)逐字校验两份脚本投影，并拒绝运行代码require非JavaScript文件；版本模块只投影releaseId与releaseDigest。

首次修复时尚无自动生成步骤，检查不一致即失败。后续已补充 `npm run build:runtime`，接入构建、初始化与回滚，详见[对照与版本同步记录](wechat-compare-runtime.md)。修改服务域名或经正式流程激活版本后应生成投影再检查，不能只修改脚本中的版本标识。首次模拟器检查没有执行版本切换或回滚，12件正式内容与规则制品摘要保持不变。

## 实际检查

| 操作 | 观察结果 | 证据 |
| --- | --- | --- |
| 首页恢复 | 实际页面resultCount为106，原生导航和卡片可见 | [首页截图](../.local/wechat-20261011-first-run/home.jpg) |
| 搜索框输入百合 | 真实input操作后resultCount为1，页面显示百合 | [搜索截图](../.local/wechat-20261011-first-run/search-baihe.jpg) |
| 独立导航到百合详情 | 食材分包页面显示身份、来源状态、安全提示和底部操作 | [详情截图](../.local/wechat-20261011-first-run/detail-baihe.jpg) |
| 百合临时收藏 | 初始isFavorite为false，点击后为true；切换收藏页rows.length为1 | [测试收藏截图](../.local/wechat-20261011-first-run/favorites-test.jpg) |
| 撤销测试收藏 | 详情isFavorite恢复false，最终首页favoriteCount为0 | [操作摘要](../.local/wechat-20261011-first-run/report.json) |
| 对照页导航 | 页面打开，ingredients.length为0；未取得成功加入对照证据 | [对照空态截图](../.local/wechat-20261011-first-run/compare-empty.jpg) |
| 恢复首页 | 清除本轮搜索词，resultCount重新为106 | [操作摘要](../.local/wechat-20261011-first-run/report.json) |

截图由微信工具的simulator_screenshot生成，353×762；图中的手机外观来自电脑模拟器，不是iOS或安卓实机。测试只使用公开条目，不填写健康信息、不复制剪贴板内容、不清空已有本地数据。

## 未通过的工具步骤

首次simulator_refresh返回timeout，未记为编译通过。之后热重载页面可读，首页、搜索、详情及收藏取得实际数据与截图；这不替代独立冷启动和包分析。热重载后的完整日志只有基础库、分包、懒加载信息和一条69ms onShow提示。

卡片内部选择器未找到元素；详情的nth-child定位返回成功却实际命中了收藏，已撤销这条测试新增收藏。页面方法toggleCompare返回 `No context found for objectId 5`，之后inCompare仍为false。对照新增、多项表格及搜索结果卡片点击链不标记通过；工具定位问题与产品按钮问题尚需分别核对。后续错误日志查询一度返回 `socket hang up`、`APPID_ERROR`；确认现有AppID非空且非游客后，同参数重试一次成功，当前缓冲区没有error匹配行。没有改AppID、重新登录或清日志，不将当前结果扩大成全时段无异常。

## 本地回归

[完整核心八阶段](../../zhongyi-platform/.local/ci-runs/core-0624e4ba-4727-45d9-9071-77baff92d6d9/report.json)于2026-10-11 00:14:49 CST通过，实际退出0：235项平台、42项离线契约、七组类型检查、原生检查及26个测试脚本、生产构建与编译服务日志1项。新增JSON脚本投影与JavaScript-only加载检查纳入公开目录专项，现11组通过；第一次专项的测试夹具先误命中Node模块导入，修正夹具后完整通过，没有放宽运行代码限制。

[编译服务夹具](../../zhongyi-platform/.local/request-log-runs/run-KIEAHt/report.json)正常停止，工作数据库未修改，真实模型调用0。平台跨工程测试已改为注入实际JavaScript配置模块，仍验证真实SQL和HTTP，不将其视为微信联网验收。本轮不重标此前浏览器排版、管理端浏览器、PostgreSQL或HTTPS结果。

当前内容服务地址仍为空；此次没有生成手机预览码、上传或发布。实际设备、弱网、压缩包大小、完整分包下载、专业审校与公开照片各自保持待验状态，下一步按[设备矩阵](p4-device-test-matrix.md)安排安卓预览。
