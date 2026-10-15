# 图形资源（2026-10-12）

此目录只含装饰插画和导航图标，不是已审核的实拍图，不参与食材身份、可食部位或加工形态鉴别。公开目录的 `image: null` 和私有候选边界不变。

- `illustrations/catalog-cover.jpg`：内置 imagegen 生成的水彩氛围插画，1024×683、151708字节。完整原件保留在本机私有素材目录，不随源码分发；本地脚本只按原比例缩小并压缩为 JPEG，无裁剪或内容改动。页面标注“插画”。
- `illustrations/{roots,leaves,fruits,seeds,flowers,archive}.png`：项目原创代码图形，由 `tools/render-mini-illustrations.mjs` 渲染；通用部位符号不是某种食材的外观。部位待核对时固定显示档案图形，不根据名称推断可食部位。
- `tabbar/`：沿用旧原生工程四组图标，新增同风格关于图标。

首页完整生成提示（内置工具，无 API 密钥调用脚本）：

> Use case: illustration-story. Asset type: decorative homepage banner for a Chinese food-education WeChat mini-program, not a specimen photograph, not a UI screenshot. Create a wide landscape premium editorial gouache and watercolor still-life illustration, about 3:2 landscape. Quiet ivory paper background (#f4f0e6), muted forest green, sage, ochre and terracotta. A shallow celadon ceramic bowl, a wooden spoon, a folded natural linen cloth, gently curving abstract leafy sprigs, and a few stylized generic grain shapes on a calm table. Tactile paper, delicate botanical line work, soft window shadows, warm thoughtful Chinese contemporary editorial design. Objects arranged on the right two thirds; upper left stays airy. No people, no hands, no food identity claims, no medicinal claims, no recognizable medicinal specimen, no bottles. Clear beautiful composition at small mobile size, not cluttered. No text, typography, logos, watermark, borders, UI, labels or lettering. This is explicitly a painted atmospheric illustration, never photorealism.

如需处理新的封面原件，使用 `tools/prepare-mini-cover.ps1 -SourcePath <本机PNG原件路径> -VersionName catalog-cover-v2`。路径由操作者提供，原件不改动，输出保留在工程插画目录；工具拒绝覆盖既有图片。真实食材照片需独立完成来源、权利和专业审校，再经公开流程提供。
