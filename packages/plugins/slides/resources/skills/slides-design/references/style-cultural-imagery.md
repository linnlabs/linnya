# 人文意象风：按需流程

用户要的是文化、历史、节气、非遗、博物馆、地方风物这类主题，并希望“有书法、有实物、像杂志或展览画册”时读本文。这是一种做法，不是模板：颜色、字体和版面仍由主题决定，不要照抄本文的任何具体值。

## 这种风格靠什么成立

- **一个贯穿全稿的主题实物**：一只茶盏、一条鱼、一块漆片。每页都和它有关，而不是每页换一张好看的图。
- **书法字是图，信息字是文本**：大字用书法图片做视觉主角；标题、正文和说明用原生 Text，可编辑。
- **去背主体压住版面**：主体越过色块边界、压住大字、伸出画框，形成前后层次。这是和“图片摆在格子里”最大的区别。
- **极少的点缀**：一枚朱印、一条金线、一组窗格，选一到两种贯穿全稿。
- **低密度**：内容页一个主体加三五行字。放不下就拆页，不缩字号。
- **页面上的字都有来源**：讲次、时长、页数、日期这类用户没给的信息不要印上去；需要提示讲者的写进备注。
- **明确的章节节奏**：封面、目录、章节页、内容页，章节页用满版素材换气。

计划阶段的 `visualDirection.signature` 就写这只“主题实物”和它在各页的变化方式。

## 素材

先定主题实物，再按它搜图；搜不到高质量原图时换实物，不要硬用低清图。

只用许可明确允许当前用途的素材。逐件核对，不凭网站整体印象；CC BY-NC、“仅供个人学习”或来源不明的素材不能进入可能商用的文稿，看不出用途时按商用处理。把来源和许可写进演讲者备注或末页致谢。

| 来源 | 查询 | 逐件核对字段 |
|---|---|---|
| Cleveland Museum of Art | `https://openaccess-api.clevelandart.org/api/artworks/?q=<词>&cc0=1&has_image=1&limit=20` | `share_license_status` 为 `CC0`；图在 `images.print.url` |
| The Met | `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&isPublicDomain=true&q=<词>&limit=20`，再取 `/public/collection/v1/objects/<id>` | `isPublicDomain` 为 true；图在 `primaryImage` |

下载到 conversation 工作目录（`assets/...`），再用 `conversation:/assets/...` 引用。下载的文件先放进单独目录，脚本放在别处。

## 去背

优先选纯色或暗色背景的器物照片，边缘越清楚越省事。不要在 Slides 内置能力里找抠图；用 Shell 在 conversation 的虚拟环境里完成。

macOS 14 起可调用系统 Vision，只需两个小依赖，不用 Xcode：

```bash
python3 -m venv .venv && .venv/bin/pip install pyobjc-framework-Vision pyobjc-framework-Quartz
```

```python
import sys, Quartz, Vision
from Foundation import NSURL
src, out = sys.argv[1:3]
ci = Quartz.CIImage.imageWithContentsOfURL_(NSURL.fileURLWithPath_(src))
handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(ci, {})
req = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
ok, err = handler.performRequests_error_([req], None)
if not ok or not req.results(): sys.exit(f"no subject: {err}")
obs = req.results()[0]
buf, err = obs.generateScaledMaskForImageForInstances_fromRequestHandler_error_(obs.allInstances(), handler, None)
f = Quartz.CIFilter.filterWithName_("CIBlendWithMask")
f.setValue_forKey_(ci, "inputImage")
f.setValue_forKey_(Quartz.CIImage.imageWithCVPixelBuffer_(buf), "inputMaskImage")
f.setValue_forKey_(Quartz.CIImage.emptyImage(), "inputBackgroundImage")
cs = Quartz.CGColorSpaceCreateWithName(Quartz.kCGColorSpaceSRGB)
ok, err = Quartz.CIContext.context().writePNGRepresentationOfImage_toURL_format_colorSpace_options_error_(
    f.outputImage(), NSURL.fileURLWithPath_(out), Quartz.kCIFormatRGBA8, cs, {}, None)
if not ok: sys.exit(str(err))
```

Windows、Linux 或旧版 macOS 用 rembg。依赖约 450MB，首次运行还要下载约 180MB 的模型，先告诉用户再装：

```bash
python -m venv .venv
```

```bash
.venv/Scripts/pip install "rembg[cpu]"
```

```python
import sys
from PIL import Image
from rembg import new_session, remove
remove(Image.open(sys.argv[1]).convert("RGB"), session=new_session("isnet-general-use")).save(sys.argv[2])
```

两种方式都要把结果裁到透明边界（`im.crop(im.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox())`，rembg 的透明通道有微弱噪声，不取阈值裁不掉），否则盒子比主体大，定位和压叠全会偏。放进文稿前，放到与页面反差大的纯色底（如品红）上放大看一次，重点看底部、镂空和阴影处有没有残留背景，以及被吃掉的边；浅色残留压在米色页面上不显眼，放映时才会露出来。整张去背失败时换图，不要交付毛边。

## 书法字

**字体只用来生成图片**：观众的电脑没有这些字体，原生 Text 打开就会被替换。生成前必须读字体内嵌的 name 表或来源仓库确认许可，聚合站标注的“免费商用”不算证据。

| 字体 | 许可 | 特点 |
|---|---|---|
| Ma Shan Zheng（Google Fonts） | OFL 1.1 | 简体；笔画本身够粗，不要加粗 |
| Zhi Mang Xing、Liu Jian Mao Cao、Long Cang（Google Fonts） | OFL 1.1 | 简体；笔画偏细，大字可少量加粗 |
| Bakudai 莫大毛筆（max32002/bakudaifont） | OFL 1.1 | 笔画粗；以繁体和日文字形为主 |

没有内置许可、也找不到作者原始声明的字体不用；用户明确提供授权时除外。

**先查字符覆盖，再渲染**。缺字不会报错，只会画出方块或错字。粗笔字库常缺简体（如 录、风、盏），这时改写繁体形式，或整份换字体，不要一页混两种书体：

```python
from fontTools.ttLib import TTFont
cmap = TTFont(path, lazy=True).getBestCmap()
missing = [c for c in text if ord(c) not in cmap]
```

用下面的函数画到透明底（封面主字 `size` 取 1000 以上），边缘是字体轮廓本身，放大后仍然锐利：

```python
from PIL import Image, ImageDraw, ImageFilter, ImageFont

def glyph(font_path, ch, size, rgb, stroke=0):
    mask = Image.new("L", (size * 2, size * 2), 0)
    font = ImageFont.truetype(font_path, size)
    ImageDraw.Draw(mask).text((size // 3, size // 3), ch, font=font, fill=255, stroke_width=stroke, stroke_fill=255)
    if stroke:  # 只磨掉外扩的接缝；阈值区间要窄，否则边缘发虚
        mask = mask.filter(ImageFilter.GaussianBlur(size * 0.002))
        mask = mask.point(lambda v: 0 if v < 110 else 255 if v > 145 else (v - 110) * 255 // 35)
    out = Image.new("RGBA", mask.size, rgb + (0,))
    out.putalpha(mask)
    return out.crop(mask.point(lambda v: 255 if v > 20 else 0).getbbox())
```

默认 `stroke=0`。只有细笔字体压不住版面时才加粗，`stroke` 不超过字号的 0.6%。先把不加粗和加粗的结果并排看一次：字内的小空隙被糊上、笔画变成圆润的墨团，就退回不加粗或换字体。不要自己叠加噪点假装飞白。竖写大字逐字向下排，字距按字形实际高度微调。

做完放在实际背景上读图：笔画有没有糊成一团、缺字、字义是否对。书法字是这种风格的门面，看着普通就换字体或换字。

## 版面落地

- **画布**：想要 13.333in 宽就写 `layout: { width: 13.333, height: 7.5, unit: "in" }`，并在源码里自定义宽高常量；`SLIDE_W` 不随它变化，`"16x9"` 是 10in 宽。
- **竖排小字**：副题、落款、章节号用原生 `writingMode: "vertical-rl"`，配系统字体，导出后仍是 PowerPoint 竖排文本框。不要逐字换行。书法大字仍用图片。
- **图片盒子**：比例必须等于 PNG 比例，用 `fitMode: "contain"`；只给一边时另一边按比例算出来。
- **落影**：透明 PNG 不要用 `shadow`，它按矩形盒子画。在主体下方垫一个径向渐变椭圆（中心不透明，边缘 `opacity: 0`）。
- **印章**：Frame 底色加居中原生 Text，字号要算上文字默认的左右各 0.1in 内边距，否则会折行。
- **贴边**：Text 默认有 0.1in 内边距，要和图片或色块对齐时减去它。
- **西文与正文字体**：用 `linnya-slides fonts check` 确认后再定。Mac 专属字体（Baskerville、Songti SC 等）到 Windows 会被替换；要跨平台就选 Georgia、Times New Roman，或提前说明。
- **换图**：图片按来源路径绑定。字节变了要换新文件名，同名覆盖不会生效。

## 检查

`inspect` 对压叠报 `element_overlap` 是预期内的，确认是有意压叠后不用改；真溢出和越界照常修。像素复核时重点看：

- 去背主体确实压住了什么，而不是漂在空白里；
- 书法字读得出来，没有方块；
- 每页都能看出和主题实物的关系，目录页也不例外；
- 深色底上的小字仍读得清，封面以外的页面没有被装饰挤占。
