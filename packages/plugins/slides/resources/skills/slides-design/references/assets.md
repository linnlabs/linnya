# 素材：要什么、去哪找、怎么记许可

计划时先定每页靠什么说话（见 [`design.md`](./design.md#视觉材料)），再按本文找素材。本文只是参考：表里没列的来源，只要许可明确允许当前用途，同样可以用。

## 按题材要什么

| 题材 | 主要素材 | 先去哪找 | 注意 |
|---|---|---|---|
| 品牌、发布、营销 | 产品图、场景图、去背主体、质感背景、装饰字 | 用户提供的素材；场景和质感可以生成 | 不编造 logo、评价和数据 |
| 文化、历史、博物 | 文物和书画实物、拓片、古籍书影、纹样、书法字 | 博物馆开放资料；书法字体见 [`style-cultural-imagery.md`](./style-cultural-imagery.md) | 逐件署名；不自绘中国地图 |
| 科学、技术、课件 | 准确的图解、实验和显微照片、数据图 | Wikimedia Commons、Openverse、NASA；图解用原生形状或 SVG 画 | 准确第一，生成图不能冒充科学图 |
| 投研、咨询、汇报 | 图表、少量现场或产品照片 | 原生图表；Commons、Openverse | 数字要有来源 |
| 知识卡片、方法论 | 简单图标、示意图、大数字 | 原生形状或 SVG 画；一份稿只用一种线宽和风格 | 图标画能看出来的东西，例如灯泡，而不是“创意” |
| 纪实、自然、公益 | 纪实照片、档案图、地图 | Commons、Openverse；用户素材 | 地图用标准地图服务的图并保留审图号，或用用户提供的 |
| 政企、行业方案 | 行业场景照片、设备图、示意图 | Commons、Openverse；场景可以生成；用户素材 | 不用来路不明的图 |

## 去哪找

都能直接用 Shell 查询，下载到 `assets/` 再引用（见 SKILL.md 的资产路径说明）。

| 来源 | 查询 | 逐件核对 |
|---|---|---|
| The Met、Cleveland Museum of Art | 查询写法见 [`style-cultural-imagery.md`](./style-cultural-imagery.md#素材) | 公有领域 / CC0 |
| Art Institute of Chicago | `https://api.artic.edu/api/v1/artworks/search?q=<词>&query[term][is_public_domain]=true&fields=id,title,image_id,is_public_domain&limit=20`；图片 `https://www.artic.edu/iiif/2/<image_id>/full/1686,/0/default.jpg` | `is_public_domain` 为 true |
| Openverse | `https://api.openverse.org/v1/images/?q=<词>&license_type=commercial&page_size=20` | 结果里的 `license`、`creator`、`foreign_landing_url`；BY、BY-SA 要署名 |
| Wikimedia Commons | 查询写法见 [`style-cultural-imagery.md`](./style-cultural-imagery.md#素材) | `extmetadata.LicenseShortName`；NC、ND 不用 |
| NASA Image Library | `https://images-api.nasa.gov/search?q=<词>&media_type=image` | NASA 自己的图一般无版权限制，但含第三方的图要看说明 |

找不到合适的真实图时：

- 装饰性素材（纹样、飞鸟、水墨飞溅、质感）可以生成。一次生成一张纯色底的宫格图，再用 Shell 抠掉底色、切成透明小图，比逐张生成省。
- 内容必需的对象（这件器物、这台设备、这位人物）不要用生成图冒充，换讲法或请用户提供。

## 许可

- 只用许可明确允许当前用途的素材，逐件核对，不凭网站整体印象。CC BY-NC、ND、“仅供个人学习”或来源不明的不用；看不出用途时按商用处理。
- 每张外部图的来源、作者、许可写进演讲者备注或末页致谢。CC BY 和 BY-SA 必须署名。
- 不用 unDraw 等禁止打包分发或嵌入应用的素材库。
