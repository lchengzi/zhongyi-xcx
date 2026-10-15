# 小程序公开资料联网配置

默认构建不访问在线资料服务，已有目录、安全规则、收藏和对比继续在本地工作。在线资料仍须经过现有后台来源核对、专业审校、独立批准和发布；配置地址不会发布任何内容。

## 构建配置

唯一配置项为构建进程中的 `FOOD_EDUCATION_PUBLIC_ORIGIN`。未设置或空字符串表示停用。只接受单一 HTTPS origin，例如域名本身，不接受路径、尾部斜线、查询、片段、账号密码或非标准端口。标准 443 会归一化；显式 IP、单标签主机和常见本地/测试保留域名拒绝构建。

这个检查只检查地址形态，不能证明域名属于你、DNS 指向公网、证书受信、接口已部署或微信后台已经配置。不要为了通过检查随便填入第三方域名。当前没有选择或启用真实地址。

在确认部署地址和对外接入授权后，于独立 PowerShell 窗口设置真实值，再执行：

```powershell
# 先设置该窗口的 FOOD_EDUCATION_PUBLIC_ORIGIN 为已确认的真实 HTTPS origin。
npm run mini:config
npm run build:mini
```

`mini:config` 只读检查，不发网络请求；输出中的外部验收项始终为 false，不能作为上线证明。请通过 npm 构建入口运行：其预检查会在 Taro 启动之前以非零状态拒绝非法配置。Taro 自身会捕获配置加载异常，直接绕过 npm 调用 CLI 不能替代此门禁。

不要将服务端 `.env`、数据库 URL、账号密钥或 AI 密钥放入小程序工程。这里只将一个公开地址编译为常量，没有展开整个环境对象；该项不使用 `TARO_APP_` 前缀，也不从存储、页面输入或 API 响应学习地址。Taro 其他已有环境注入能力不在此检查的完整安全审计范围内。

## 产物与回退

微信模拟器还在运行、或暂时无法完成接管授权时，先使用独立验证构建，避免直接覆盖它当前加载的编译文件：

```powershell
npm run build:mini:verify
```

入口先检查目录投影及公开地址，再由工具创建全新的 UUID 目录 `apps/miniprogram/.verification-builds/<id>`，检查真实路径、产物结构、包体和当前 `dist` 的前后文件摘要。结果写入该目录的 `verification-report.json`；它不是手机预览或微信运行结果，不会自动把产物切换到当前项目。`FOOD_EDUCATION_VERIFICATION_ID` 是此工具内部使用的构建目标参数，不要手工复用旧目录编号。

阅读布局可用 `npm run test:mini-reading` 检查。须先安装根工作区与 `zhongyi-platform` 的锁定依赖，并有本机 Edge；使用实际小程序 React 页面/Sass 和测试专用 DOM/Taro 适配，测试记录仅在内存中。报告与截图写入新的 `.refactor/evidence/reading-layout-runs/run-*`；测试中不会访问真实微信记录、健康问项、数据库或在线资料。浏览器的大字号和窄屏结果不能代替微信原生控件、系统字号及手机验收。

公开补充资料的断网恢复可用 `npm run test:mini-education` 检查，依赖与 Edge 要求同阅读布局检查。直接编译实际详情/关于页、生产 hook 和纯 TS 客户端，仅使用内存记录、测试网络/生命周期/确认弹窗及拦截的测试域名响应；报告写入新的 `.refactor/evidence/education-recovery-runs/run-*`。涵盖重连、原期限过期、撤回、隐藏、清理、红旗及切换食材的晚到请求保护，不连接真实后端或微信。真实后端联调入口为 `npm run test:publication-client`，仍只使用隔离工程库；两类测试都不能替代微信/手机断网验收。

本地记录失败可用 `npm run test:mini-storage` 检查：使用实际详情/收藏/关于页与生产hook/核心，只有内存故障存储和受控确认，全部外部请求被拦截。涵盖读写与读回失败、部分删除、取消、隐藏、重复确认和记录/安全会话变化；报告写入新的 `.refactor/evidence/storage-recovery-runs/run-*`。不会读取/删除真实记录，不是微信原生存储或弹窗验收。

`mini-reading-browser` CI job分别执行严格类型、CI定义检查及上述三类浏览器测试，归档限于具名报告/截图，不包含浏览器夹具脚本或数据库。定义检查入口 `npm run test:mini-browser-ci` 也纳入根测试，依赖平台锁定的YAML解析器；运行根测试前需完成根与 `zhongyi-platform` 两处锁定依赖安装。CI定义本地通过不等于远程执行、上传或上线。

每次编译由同一配置值同时生成客户端常量与 `dist/public-content-build.json`：

```json
{"schemaVersion":1,"protocolVersion":1,"mode":"disabled","origin":null}
```

已配置地址时 mode 为 `configured`，origin 为归一化地址。该公开文件不放任何密钥。包体检查要求文件存在、字段精确且模式/地址一致，并把它记入唯一构建报告。它不证明包已经上传、微信已经运行或服务可信，也不是签名发布证明。

要停止联网，在构建窗口清除配置并重新构建：

```powershell
Remove-Item Env:FOOD_EDUCATION_PUBLIC_ORIGIN -ErrorAction SilentlyContinue
npm run build:mini
```

修改构建环境不会改变已安装版本；重新构建后的包仍需按对应预览/发布流程生效。停用在线资料不删除用户记录，也不改变离线安全规则。服务端撤回仍通过公开接口失效，不要以构建配置替代撤回流程；离线设备不能承诺即时收到撤回。

## 联网交付仍须完成

1. 明确实际服务与域名的所有权及对外接入范围，配置受信 HTTPS、数据库和运行环境。
2. 核对现有后端 HTTPS 指引 `zhongyi-platform/docs/https-runtime.md`；其本机私有 CA/浏览器测试特例不用于手机或生产。
3. 在微信后台配置相应 request 合法域名，保持工具域名校验开启；不要以关闭校验作为交付。
4. 核对客户端基础发布版本与服务端一致，验证匿名公开接口不返回私有审校记录或健康输入。
5. 在微信实际验证读取、新版发布、撤回、冻结、超时和断网；分别记录安卓、iOS 以及可获得的鸿蒙设备。
6. 验证独立进程运行、数据库恢复及远程 CI。旧后端的历史证据不能直接替代新客户端验证。

本轮没有申请域名、创建云资源、上传小程序、安装 CA、修改防火墙、启动付费模型或对外发布。

2026-10-11 补充：新纯 TS 客户端已分别通过本机 SQLite/PostgreSQL 的真实 HTTPS/独立编译服务重启验证（各 21 次读取）；测试传输适配不等于微信请求适配。此前 PostgreSQL 目录 500/连接超时记录保留，新增阶段诊断后的新轮次通过，不能认定旧超时根因已消除；全部测试实例已正常停止。实际公开地址仍未启用，不能以此替代上方联网交付清单；详情见项目 `REFACTOR_STATUS.md`。
