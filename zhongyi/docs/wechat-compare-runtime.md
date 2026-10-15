# 微信对照验证与运行配置同步

2026-10-11，微信模拟器已验证百合和山药加入对照，以及逐行阅读与横向表格切换。手机宽度下标题区留白已修复。运行配置增加自动生成与事务恢复，内容回滚会同步版本标识。本轮仍不是安卓、苹果或鸿蒙真机验收。

后续[手机预览](wechat-phone-preview.md)已返回工具端成功，真实预览包316170字节；手机送达与打开仍待用户确认。实际构建入口 `npm run build:release` 已运行通过，前后正式版本相同，运行配置updated为空。两项临时对照已逐项撤销，最终首页106条、收藏0、对照0。

## 实际微信检查

工具2.02.2608080，基础库3.17.4。详情底部三个按钮分别增加唯一ID，不依赖上轮未可靠工作的nth-child；对照阅读按钮也使用明确ID，现有安全阻断、事件处理和版本守卫不变。

百合初始inCompare=false、isFavorite=false，点击 `#detail-compare` 后inCompare=true，收藏仍为false。山药初始未加入，点击后加入。切换对照页后ingredients.length为2、readingMode为stacked、visibleRows为29；点击 `#compare-table` 后为table，再点 `#compare-stacked` 恢复stacked。页面导航由工具调用，不代表手动tabBar点击验收。

[逐行截图原貌](../.local/wechat-20261011-compare/stacked-before-spacing-fix.jpg)、[表格模式顶部](../.local/wechat-20261011-compare/table-before-spacing-fix.jpg)保留修复前标题留白；后者可见选中模式和提示，但未展示下方全部表格内容。新增compare-intro类，并在窄屏纵向布局下重置flex-basis后，[微信修复后截图](../.local/wechat-20261011-compare/stacked-after-spacing-fix.jpg)中多余留白消失。三张图均为实际微信模拟器353×762截图，哈希见[操作摘要](../.local/wechat-20261011-compare/report.json)。

“仅看差异”的自动化tap两次后读数仍为false，不记开关交互通过。直接触发change时先遇到Windows参数引号解析错误，改参数文件后仍发生automator超时；没有据此修改业务逻辑或宣称通过。期间日志记录 `appLaunch with non-empty page stack`，一次simulator_refresh返回success，随后重新进入详情可读；刷新成功只说明触发成功，不证明整包编译或冷启动。并行文件变化与热重载是上下文变化的可能因素，尚未确证。

## 差异开关延迟事件修复

2026-10-11，页面函数回归复现了另一项独立问题：离页再返回、更换食材、隐私删除后重新选择、读记录失败恢复或红旗状态恢复后，旧的差异开关事件仍能覆盖当前显示偏好，重复事件也能撤销后续选择。新增七项用例修复前0/7通过；[失败原始输出](../.local/compare-difference-20261011/before-fix.tap)保留。

差异开关现在和阅读按钮一样绑定当前显示版本；事件处理先刷新当前上下文，再核对版本、布尔值和至少两项食材。每次接受切换后递增显示版本，拒绝随后到达的旧事件。只修改页面事件与WXML绑定，不改变比较字段、已保存记录、安全规则或内容。专项117/117通过，涵盖现有阅读切换、隐私、红旗和读取失败路径。

07:15:39 CST，[本轮完整核心八阶段](../../zhongyi-platform/.local/ci-runs/core-1ea3b573-dd79-4223-b441-f2606beb4f93/report.json)退出0：237平台、42离线契约、七组类型、原生完整检查与26脚本、前后端构建及编译请求日志1项通过；[编译服务夹具](../../zhongyi-platform/.local/request-log-runs/run-yf3hsn/report.json)四个请求匹配并正常退出。正式12件制品和工具私有配置摘要不变。此前沙箱整套运行在本地HTTP连接失败后中止，最小探针也返回`connect EACCES`；旧控制器报告保留中止前的running状态，不充作成功报告。普通本机权限下新轮次独立通过，没有删除旧报告或放宽测试。

[本次验证摘要](../.local/compare-difference-20261011/report.json)分别记录两轮及源码摘要。这是实际页面函数配合模拟wx接口的回归，不是对上文微信自动化tap/change失败原因的定论，也不证明微信开关实操或手机验收通过。先前手机预览不含此修复，未重发；容器、公网、远程CI和专业签审状态不变。

## 配置生成和回滚

配置JSON和活动版本JSON仍是依据。修改合法公开服务地址或经正式流程激活版本后，运行 `npm run build:runtime`，再运行项目检查。生成器先校验正式版本、制品摘要和HTTPS配置，按事务生成 `config/public-api.js` 与 `data/version-runtime.js`，只对变化文件写入；无变化时updated为空。它使用独立的纯配置校验函数，不执行可能损坏的旧脚本投影，也不接收密钥等额外字段。

`build:release`在正式制品验证后调用生成器；初始化版本会创建运行版本投影；回滚把内容、活动JSON与运行版本放在同一事务中，保持当前环境的服务地址不变。事务只增加两个精确派生文件路径，不允许写任意项目文件；所有目标在暂存前检查，重复目标被拒绝。验证失败会恢复原文件。

隔离版本测试验证了两代版本、生成幂等、配置变更、损坏脚本修复、HTTP/凭据/额外密钥字段拒绝、未登记内容漂移拒绝、错误目标与重复目标拒绝、事务失败恢复，以及回滚后的JS与JSON一致。没有在实际工作内容上执行回滚或新发布，12件正式制品保持原摘要，公开照片0、可发布整方0。

## 回归结果

[完整八阶段报告](../../zhongyi-platform/.local/ci-runs/core-fc754129-4859-467b-88c6-343db561ada8/report.json)于00:41:12 CST通过并退出0：236项平台、42项离线契约、七组类型、原生检查及26个测试脚本、生产构建、编译服务日志1项。详情专项68/68、列表专项103/103、公开目录11组均通过。[编译服务夹具](../../zhongyi-platform/.local/request-log-runs/run-N0W8rZ/report.json)正常停止，工作数据库未修改，真实模型调用0。

首次完整回归因新增列表测试漏引入fs/path而失败，[失败记录](../../zhongyi-platform/.local/ci-runs/core-82fe664b-89e4-42db-8b3d-d541fdeabc72/report.json)保留。修正测试引用后重跑完整流程，没有放宽断言。版本专项初次在沙箱内重命名临时文件被EPERM阻止，获正常权限后在隔离目录运行通过。

[Edge阅读排版192组](../../zhongyi-platform/.local/mini-reading-layout-runs/run-ZkAw9M/report.json)全部通过，溢出、过小按钮、网络请求均为0。新增移动端标题与控制区间距检查，24个有控制区的窄屏场景间距为8.53125至11.453125px。浏览器模板转换检查与实际微信证据分别记录，不替代微信字体放大、横向滑动、原生开关、冷启动或手机验收。
