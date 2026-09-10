# deck.js 正式语法说明

本文解释 deck.js 的组织方式和字段语义。精确工厂签名、节点属性与联合类型以 [`layoutPrimitives.d.ts`](./layoutPrimitives.d.ts) 为准；完整写法从 [`examples/`](./examples/) 中选择经过检查的 `.js` 起点。

## 1. Source 与 deck 顶层

deck.js 是 sandbox 中执行的 plain JavaScript，不是 TypeScript 或模块：

- 不使用 `import`、`require`、类型注解、`interface`、`type` 或 `as Type`；
- 可直接使用 sandbox globals，例如 `SLIDE_W`、`SLIDE_H`、`DECK_DESIGN`、`CHART_PRESETS`、各类 `create*` 工厂和 `compose`；
- 顶层显式创建每一页；一个顶层 `createSlide()` 对应一页；
- 最后只调用一次 `compose({ title, layout?, theme?, slides })`，并把所有页面按顺序传入 `slides`；
- 不用 helper、循环或回调间接制造顶层页面，否则源码页定位与诊断边界会失真。

每个示例都是一份可独立提交的完整 source。多个示例都有自己的顶层声明与 `compose()`，不能直接拼接；组合多页时，应在一份 source 中重新组织共享常量、页面变量和唯一的 `compose()`。[`complete-deck.js`](./examples/complete-deck.js) 展示多页结构。

## 2. 两种写法与它们的硬性区别

节点既可以用工厂的 config 参数创建，也可以先创建再逐个赋值属性：

- config 写法：`createShape({ fill: "#123456", width: 2 })`
- 属性写法：`const s = createShape(); s.fill = "#123456"; s.width = 2;`

正式主路径仍是“创建节点、设置属性、显式挂载、唯一 compose”，不会整体切换为 config-first。config object 是同一节点合同的兼容写法，适合把一个自包含节点集中成可精确替换的源码块；两种写法进入同一个 parser/compiler，不形成第二套 DeckSpec。同一节点尽量选择一种风格，不做无意义混写。

**两者在一处不等价，而且这一处会直接导致写入失败。**

deck.js 按 JavaScript 检查。在 JavaScript 中，对象字面量**赋值给属性**时，其中的字符串会被放宽成 `string`，无法再匹配 `"linear"`、`"polygon"`、`"dash"` 这类字面量类型；而**作为函数参数**传入时不会被放宽。因此：

| 目标字段 | config 参数 | 属性赋值 |
|---|---|---|
| 值是字符串、数字、布尔 | 可用 | 可用 |
| 值是对象，且内部**不含**字面量联合字段 | 可用 | 可用 |
| 值是对象，且内部**含**字面量联合字段 | 可用 | **报错** |

含字面量联合字段的对象包括：gradient（`type: "linear" \| "radial"`）、`geometry` 的对象形式（`type: "polygon"` 等）、`border` 带 `dash`、`src` 的对象形式（`kind: "external_url"` 等）、`background` 带 `gradient`。这些**必须**写在工厂的 config 参数里：

- 对：`createShape({ fill: { type: "linear", angle: 90, stops: [...] } })`
- 错：`const s = createShape(); s.fill = { type: "linear", ... };`
- 对：`createSlide({ background: { gradient: { type: "linear", ... } } })`
- 错：`const s = createSlide(); s.background = { gradient: { type: "linear", ... } };`

同理，把这类对象先存进变量再传进 config 也会失败，因为放宽在赋值给变量时就已经发生：

```text
错：const g = { type: "linear", ... };  createShape({ fill: g })
对：function band(a, b) { return createShape({ fill: { type: "linear", angle: 90, stops: [
      { color: a, position: 0 }, { color: b, position: 1 } ] } }); }
```

需要在多处复用同一套渐变或几何时，**复用返回节点的工厂函数，而不是复用配置对象**。`media-and-paint.js` 的每个 helper 都是这个写法。

其余字段（`fontSize`、`color`、`flex`、`padding`、`position = "absolute"`、`textAlign`、`maskShape` 等裸字面量）两种写法都可以，按可读性选择即可。

## 3. 页面、容器与父子关系

`createSlide()` 创建页面，`createFrame()` 创建容器。两者都是 Flex 容器；子节点只有经过父级 `.add(...)` 才属于文稿。

Slide 的 `background` 支持纯色、图片或 gradient 三选一，`notes` 用于演讲者备注。Frame/Slide 的 `backgroundColor`、`border`、`borderRadius` 会生成容器装饰 Shape，`opacity` 只作用于这层装饰的 fill；它们不影响页面 background、子节点或 `.add(...)` 关系。

常用容器字段包括 `flexDirection`、`justifyContent`、`alignItems`、`gap`、`padding`、`flex`、固定宽高、背景和边框。先用 Flex 表达主结构，例如页头、内容区、卡片行列和页脚；只有确实要脱离文档流的装饰、角标或精确覆盖层才用 absolute。

节点的声明顺序不等于挂载关系。写入自检出现 `LAYOUT_UNATTACHED_*` 时，先检查是否遗漏 `.add(...)`，不要机械地把节点改为 absolute。

## 4. 坐标、尺寸与布局

Flex 子项可以使用 `flex`、`width`、`height`、margin 与父容器的 gap/padding。尺寸可使用英寸数值或类型声明允许的百分比字符串。

绝对定位节点把 `position` 设为 `"absolute"`，再使用 `x/y/w/h` 或 `left/top/right/bottom/width/height` 中与目标约束一致的一组字段。数值单位为英寸；百分比字符串相对父容器。不要同时维护互相冲突的两套边界。

需要循环计算“坐标 + 文本 + 颜色”等混合记录时，使用 `[{ x: 1, label: "阶段 A", color: "#..." }]` 这类具名对象；不要用 `[1, "阶段 A", "#..."]` 异构 tuple 再解构做算术，plain JavaScript typecheck 会把元素推断为联合类型。页面内循环创建叶子节点是支持的，`timeline.js` 是可执行示例；只有顶层页面必须逐个显式 `createSlide()`。

`compose({ layout })` 接受 `"16x9"`、`"16x10"`、`"4x3"`，也接受文稿级自定义物理尺寸 `{ width, height, unit: "in" }`。自定义宽高各为 1–56 英寸；整份文稿共用一个尺寸，不支持逐页混用。需要海报、竖版报告或方形画布时应直接声明真实尺寸，不要用比例字符串猜测物理大小。

`SLIDE_W = 10`、`SLIDE_H = 5.625` 是 sandbox 注入的 **16:9 参考常量**，不是由本次 `compose({ layout })` 预先计算的当前画布。非 16:9 文稿优先用 Flex、百分比和父容器约束；不要拿这两个常量铺满页面。若必须做全页 absolute 布局，应使用所声明 layout 的真实英寸宽高，并在整份 source 中保持一致。

## 5. 内容节点地图

| 节点 | 工厂 | 适用场景 |
|---|---|---|
| Text | `createText(text)` | 标题、正文、标签、数字和说明 |
| Shape | `createShape(config?)` | 色块、分隔线、几何图形和装饰 |
| Image | `createImage(src)` | 图片、背景图和图标资产 |
| SVG Graphic | `createSvgGraphic(sourceOrConfig)` | 复杂流程、架构和机制示意图 |
| Brush Artwork | `createBrushArtwork(config)` | 手绘笔触、纸面边框和水彩色块 |
| Formula | `createFormula(latexOrConfig)` | 独立、可在 PowerPoint 中编辑的原生数学公式 |
| Chart | `createChart(preset?)` | 结构化数据图表 |
| Table | `createTable()` | 表头与二维 rows 数据 |
| Frame | `createFrame()` | 分组、Flex 布局和卡片容器 |
| Spacer | `createSpacer()` | 在 Flex 流中分配空白 |

节点的精确属性不在本文复制。需要修改不熟悉的字段时，先读 `.d.ts`，不要根据 CSS、DOM、PptxGenJS 或旧示例猜属性。

### 5.1 公开能力边界

| 等级 | 字段或写法 | Agent 行为 |
|---|---|---|
| 正式 | 本文与 `.d.ts` 中的 `Layout*Config`、`compose()`、`create*()` | 新代码使用；会被 typecheck 与 compiler 验证 |
| 兼容 | `chartData`、`tableData`、`datasets`、`xLabels`、Text 的 `bold/italic/underline/align/valign/lineSpacing` 旧别名 | 只用于理解和维护旧 source；不要主动生成 |
| 内部/不支持 | `_type`、`children`、`_sourceSpan`、`styleDecision`、`chartOptions`、`tableOptions`、`editPresentation` | 不要写；工厂 config 不接受，部分字段也不可赋值 |
| 猜测式语法 | `style`、`style.gradient`、`shapeType`、`zIndex`、Text 的 `padding/opacity/transparency`、任意 CSS/PptxGenJS 字段 | 不支持；改用本文对应的正式字段 |

工厂返回节点上的 `_type` 与 `children` 由运行时创建，`_sourceSpan` 由源码定位链维护。它们出现在 node 类型中是为了让编译器理解运行时对象，不是 authoring 输入。`Layout*Config` 才是可传给工厂的字段全集。

## 6. Text

Text 的核心语义是内容、排版和盒子。常用字段包括字体族、字号、粗细、字体样式、颜色、对齐、行高、字间距（`letterSpacing`，单位 pt）与尺寸。Text 没有 `padding`、`opacity` 或 `transparency`；需要内边距、底色或整体透明效果时，用 Frame/Shape 承载。

Text 的宽度语义与 PowerPoint 一致：

- 放在 Flex 流中，或显式设置 `width` / `w` / `maxWidth` / 左右边界时，文本框宽度固定，超出后自动换行；正文、标题和段落使用这种写法。
- 绝对定位且不设置任何横向宽度约束时，文本框按内容自动变宽，不自动换行；页码、`01` 这类序号和短标签优先使用这种写法。靠右放置时设置 `right`，不要为它猜一个很窄的 `width`。
- 文本中的 `\n` 始终是作者主动换行；需要固定断行位置时直接写入内容。

无论哪种模式，显式设置高度时都要给实际行数留下足够空间；不确定时可以让系统测量高度。

`createText()` 也接受 run 数组，用于在一段文字内混合样式：`createText([{ text: "结论：", style: { bold: true } }, { text: "…" }])`。文字 run 只能有 `text` 与可选的 `style`；把 `bold/color` 等写在 run 顶层不支持。run style 的精确字段见 `.d.ts`，行距使用 `{ kind: "multiple", value }` 或 `{ kind: "exactPt", value }`。

Text 可以用 `backgroundColor` 和纯色 `border: { color, width, dash? }` 装饰自己的盒子，但仍没有 padding。需要可靠的文字内边距、圆角底或卡片阴影时，使用 Frame 包住 Text。

主题字体放在 deck theme 中，局部字体只用于明确的层级或语言需求。不要在每个节点重复同一个全局字体。字体是否真实可用要通过 CLI `fonts check/list` 查询，不凭经验猜系统字体。

### 6.1 原生数学公式

独立公式使用 `createFormula()`。输入是受控 LaTeX，前端以同源矢量投影预览，导出 PPTX 后是可双击编辑的 Office Math，不是图片：

```text
const equation = createFormula({
  latex: "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
  fontSize: 30,
  color: "#173B57",
  align: "center",
  altText: "一元二次方程求根公式",
});
```

段内公式必须写成明确的 formula run，不扫描 `$...$`：

```text
const sentence = createText([
  { text: "由质能方程 " },
  { formula: { latex: "E=mc^2", altText: "质能方程" }, style: { fontSize: 24, color: "#173B57" } },
  { text: " 可知质量与能量等价。" },
]);
```

首期闭集覆盖常用符号、希腊字母、分式、二项式、根式、上下标、积分/求和、定界符、重音、矩阵、cases 和 aligned。不要使用 TeX package、用户宏、任意环境、MathML 或 OMML；不支持的命令会明确失败，不会显示 raw LaTeX 或降级成普通文本/图片。公式 atom 内部不可断行；过宽时应缩短公式、加宽文本框或把它改成独立 `createFormula()`，不要拆成多个 shape。

## 7. Shape、Paint 与层级

Shape 可表达填充、边框、透明度、旋转和几何类型。

**Paint 能力矩阵**（详见 §2 的写法约束，渐变必须写在 config 参数里）：

| 挂载位置 | 纯色 | 半透明纯色 | linear | radial |
|---|---|---|---|---|
| slide background | 是 | **无直接写法** | 是 | 是 |
| shape fill | 是 | 是 | 是 | 是 |
| shape border / 描边 | 是 | **无直接写法** | 是 | **否** |

- 纯色：`fill: "#123456"`；半透明纯色：`fill: { color: "#123456", transparency: 40 }`。Shape fill 的 `transparency` 是 0–100；Image 的同名字段是 0–1，不要混用。
- slide background 与纯色 border 没有半透明纯色对象。需要类似效果时，用带 stop opacity 的 gradient，或额外叠加 Shape；不要写 `{ color, transparency }` 猜测字段。
- 渐变至少两个 stop，`position` 在 0–1 之间非递减；stop 上还可以带 `opacity`（0–1）。重复 position 用于硬切色。
- `linear` 的 `angle` 以 0° 向右、90° 向下为基准，顺时针增长。
- `radial` 的 `center` / `radius` 是元素边界框内的归一化坐标，默认都是 0.5。
- 渐变描边写成 `border: { paint: { type: "linear", ... }, width: N }`；`border` 的纯色形式是 `{ color, width }`。radial 描边是明确不支持的能力边界，不要试图绕过。
- shape 的 `opacity` 只与 fill 相乘，不影响描边。
- Shape 的 `opacity` 使用 0–1。`content` 可以是字符串或 rich runs；它适合形状内的短标签。需要独立对齐、内边距或复杂排版时，使用单独的 Text 覆盖在 Shape 上；含 Chart/Table 的页面仍会把 runs 展平。
- 正式颜色建议使用 `#RGB` / `#RRGGBB`；支持 `rgb(...)` / `rgba(...)` 的位置会在 admission 时归一化。不要使用 CSS 命名色、HSL、`#RRGGBBAA` 或 CSS `linear-gradient(...)` 字符串。需要 alpha 时使用该字段正式提供的 `transparency`、`opacity` 或 gradient stop opacity。

**几何**（`geometry`，同样必须写在 config 参数里）：

- preset 简写：`geometry: "star5"`。可用名称见 `.d.ts` 的 `PresetShapeName`，含 `rect`、`roundRect`、`ellipse`、`triangle`、`rightTriangle`、`diamond`、`pentagon`、`hexagon`、`star5`、`rightArrow`、`line`、`callout`、`parallelogram`、`trapezoid`、`nonIsoscelesTrapezoid`、`chevron`。
- preset 完整形式：`geometry: { type: "preset", name: "chevron" }`。
- 参数化：`{ type: "regularPolygon", sides: 6, rotation? }`、`{ type: "trapezoid", topLeftInset, topRightInset }`、`{ type: "parallelogram", slant, direction? }`。inset 与 slant 都是相对宽度的比例。
- `{ type: "polygon", points: [...] }`：顶点使用 shape 内的归一化坐标（0–1），最多 256 点。
- `{ type: "path", viewBox, commands }`：需要曲线时使用，坐标属于自定义 viewBox，最多 512 条命令；命令类型为 `moveTo` / `lineTo` / `quadraticTo` / `cubicTo` / `close`。
- 未提供 geometry 时默认为 `rect`。写错的 preset 名不会降级成矩形，会直接失败。

absolute 节点按父容器内的添加顺序形成层级。需要让装饰位于内容后方时，先添加装饰，再添加正文；不要依赖未声明的 z-index 字段。

## 8. Image

`createImage(src)` 的 source 必须是当前运行时能够读取的真实本地内容。可用形式：

- data URI：`"data:image/png;base64,…"`，或 `{ kind: "data_uri", dataUri }`；
- 绝对本地路径：`"/绝对/路径.png"`，或 `{ kind: "local_path", path }`；
- 本次对话产出的文件：`"conversation:/相对/路径.png"`，或 `{ kind: "generated_asset", assetId }`。

需要网络图片时，先用现有网络或 Shell 能力下载为本地文件。默认推荐写入当前 conversation
工作目录：Shell 省略 `cwd`，以 `assets/...` 等相对 OS 路径写入并传
`requires_write_access: true`，随后通过 `conversation:/assets/...` 引用。用户指定其他落点，
或当前任务已有其他目录的写入权限时，可以使用对应真实路径；显式 `cwd` 和
`requires_write_access` 本身不扩大权限。其他位置已有且允许读取的文件也可作为绝对本地来源。
不要在 deck.js 中使用 HTTP(S) URL；`external_url` 形式只为兼容常见模型输入而被识别，
编译时会明确要求先下载。

Workspace 虚拟路径不是图片二进制地址。不要捏造 locator；图片首次成功编译时会自动复制为 presentation-owned 受控资产，之后不依赖原文件。

**图片来源与预处理**：图片可以来自 `generate_image` 工具的产出、用户提供的素材，或用命令行处理后的结果。deck.js 本身不做像素级裁切——`fitMode` 只是把图放进给定的盒子。需要真正改变图片本身（按比例裁切、缩放、导出特定尺寸、转格式）时，在写 deck.js 之前用命令行处理，再引用处理后的产物。macOS 自带 `sips`，例如裁成 16:9 或缩到指定宽度；处理前用 `sips -g pixelWidth -g pixelHeight` 读取原始尺寸，不要凭猜测传参。产生新文件的命令遵循上面的 conversation 落盘合同，并用产物的真实 locator 引用它。

**图片视觉字段**：

- `fitMode`：`"cover"` 铺满并裁掉溢出（构图优先）、`"contain"` 完整放下（可能留边）、`"crop"` 与 cover 等价但表达"有意裁切"的语义。
- `maskShape`：`"rect"` 或 `"circle"`，后者适合人像。
- `transparency`：0–1，把图片压成背景层。
- `shadow`：`{ color, blur, angle, distance, opacity }`。
- 还有 `rotate`、`flipH`、`flipV`、`rounding`、`alt`。

拉伸变形会被诊断为质量问题：盒子宽高比与原图差异过大时应改盒子尺寸或改用 cover，不要靠拉伸填满。

背景图仍是需要 `.add(...)` 的 Image 节点；要铺满页面时使用 absolute 尺寸并先于前景内容添加。页面级背景图也可以写成 `createSlide({ background: { image: "…" } })`。在照片上放文字时，先加一层半透明渐变遮罩再放文字，否则对比度会不达标。

### 8.1 SVG Graphic

`createSvgGraphic()` 用于复杂、整体编辑即可接受的矢量示意图。不要用它替代标题、正文、Chart、Table、照片或几个简单可编辑 Shape，也不要把整页内容压进一个 SVG。

创作 source 有三种正式形式：

- inline：直接传自包含的 `<svg>…</svg>` 字符串，或 `{ kind: "inline_svg", svg }`；
- 本地文件：`{ kind: "local_path", path: "/绝对/路径.svg" }`；
- 当前对话文件：`{ kind: "conversation_file", locator: "conversation:/相对/路径.svg" }`。

元素必须提供非空 `altText`，或声明 `decorative: true`，不能同时写。`fit` 只支持
`"contain"`（默认，保留 viewBox 比例）和 `"stretch"`；`opacity` 为 0–1，`rotate`
为有限角度。尺寸和布局使用其他叶子节点相同的 `width/height`、Flex 或 absolute 字段。

公开 SVG 是严格的无文字子集：可使用基础几何、path、局部 gradient、marker 与有限的
translate/scale/rotate；必须有从零开始、宽高为正的 `viewBox`。不要写 `text/tspan`、CSS、script、事件、外部引用、嵌入图片、filter、mask、clipPath、animation、`use/symbol`
或任意未知元素/属性；这些输入会明确失败，不会降级成 PNG。diagram 标签、标题和关键数字使用单独的
Text，并在添加 SVG 之后挂载以形成覆盖层。

inline 的最小结构是：`createSvgGraphic({ source: '<svg viewBox="0 0 100 50">…</svg>', width: 6, height: 3, altText: '流程关系示意图' })`。精确 source 联合、工厂签名与字段以生成的 `.d.ts` 为准。

### 8.2 Brush Artwork

`createBrushArtwork()` 把受控声明式绘制生成为普通图片资产，适合手绘插画、笔触、纸面边框、水彩、
粉彩和炭笔质感。它不参与布局，也不替代照片、SVG、Chart、Shape 或 Text。

作者输入由 `seed + backgroundColor + quality? + layers` 组成。每个 layer 有非空 `marks`，并声明至少
一种 `stroke`、`fill` 或 `hatch`；可选 `field` 让笔触随内置流场弯曲。进入下一 layer 前运行时会清空
上一层的绘制状态，因此每层必须自包含。

| 能力 | 可用值 / 字段 |
| --- | --- |
| brush | `pen`、`rotring`、`2B`、`HB`、`2H`、`cpencil`、`pastel`、`crayon`、`charcoal`、`spray`、`marker` |
| field | `hand`、`curved`、`zigzag`、`waves`、`seabed`、`spiral`、`columns` |
| fill | `watercolor`（bleed/texture）、`wash`（快速平涂）、`mass`（多层手工铺色） |
| mark | `line`、`spline`、`arc`、`rect`、`ellipse`、`polygon`、`flowLine` |

几何使用元素自身的 0–100 局部坐标；横纵坐标分别随最终 Image 盒缩放，stroke weight、hatch spacing、
arc radius 和 flowLine length 按元素短边百分比解释。需要重复花瓣、树叶或波纹时，用普通 deck.js 循环
构造 marks 数组，不要寻找 recipe，也不要把循环或 JavaScript 字符串写进 Brush 输入。对象 mark 存入变量
数组时，JavaScript 会把 `type: "ellipse"` 这类字面量放宽为 `string`；应像示例一样用 JSDoc 标明该数组的
具体 mark 形状，或直接在 layer 的 `marks` 中写对象字面量，不要用 TypeScript `as` 断言。精确字段、范围、
联合类型和默认值以生成的 [`layoutPrimitives.d.ts`](./layoutPrimitives.d.ts) 为准；完整可执行写法见
[`brush-artwork.js`](./examples/brush-artwork.js)。

`backgroundColor` 和所有颜色必须写成 `#RRGGBB`；`seed` 是 0–4294967295 的整数；`quality` 可选
`draft | standard | high`，省略时为 `standard`。像素尺寸由最终元素盒与 quality 派生，不要写
`widthPx/heightPx`、Brush 版本、raw p5 命令、自定义笔刷或自定义 field。

当前 Brush 上游不支持透明输出，因此 `backgroundColor` 是必填事实，产物始终不透明。它应覆盖完整目标
区域，或与下方容器/页面的纯色底完全一致；不要把它叠在照片、渐变、纹理或需要透出下层的区域上，也不要
尝试用白底抠图、色键或亮度转透明。需要真正透明的装饰时，使用 Shape 或受控 SVG。

## 9. Chart

优先用 `createChart(preset)` 选择已注册的图表基线；完整 preset 见生成的 [`chart-presets.md`](./chart-presets.md)。正式数据结构是 `categories: (string|number|boolean)[]` 与 `series: [{ name, values, labels? }]`，每个 series 的 `values` 应与 categories 对齐。可用语义字段包括 `chartType`、`showDataLabels`、`dataLabelFormat`、`legendPosition: "top"|"bottom"|"left"|"right"|"none"`，以及跨预览/PPTX 共同生效的 `chartStyle`：

```typescript
chartStyle: {
  axisLabelColor: '#64748B',
  categoryAxisLabelColor: '#334155',
  valueAxisLabelColor: '#475569',
  dataLabelColor: '#0F172A',
  gridlineColor: '#CBD5E1',
}
```

`axisLabelColor` 是两个坐标轴的共同兜底，单轴字段可以覆盖它；`gridlineColor` 同时设置类目网格线和数值网格线。只写真实需要的字段，不要为了“统一”复制同一个颜色。不要写原始 `chartOptions`。

`chartData`、`datasets`、`xLabels`、`xAxisLabels` 是旧 source 的兼容入口；`series.data` 不是正式写法。新代码只写顶层 categories/series。需要运行时尚未公开的轴、标记线或 PptxGenJS option 时，应当把它视为 Slides 模块缺失的跨端能力，而不是绕过 authoring contract。

图表配色由 `compose()` 的 `theme.chart.palette` 决定，它是一个颜色数组，按 series 顺序取用；不写则使用运行时默认调色板。整份 deck 的图表应共用同一份 palette。

图表用于表达比较、趋势、构成、关系或分布，不用于装饰。图表标题、关键结论和数据来源应由相邻 Text 节点承担，不把整段解释塞进图内。

## 10. Table

Table 的正式结构是顶层 `headers + rows`。每一格既可以是字符串、数字、布尔，也可以是 TableCell 对象：`{ text, style?, fill?, colspan?, rowspan? }`，其中 `style` 接受 run 同族的排版字段。`colspan/rowspan` 必须是正整数，跨行后的下一行只写尚未被占用的单元格。需要统一设置表格边框时，在表格顶层写 `{ color, width }`：

```typescript
createTable({
  headers: ['指标', '结果'],
  rows: [['收入', '增长']],
  border: { color: '#CBD5E1', width: 0.75 },
})
```

`width` 单位为 pt；当前语义是整张表的外框和内部网格线，前端预览与 PPTX 导出使用同一描边事实。第一版不开放逐单元格边框、`tableOptions`、`colW` 或 `rowH`，也不把底层 PptxGenJS/ECharts 参数泄漏到 deck.js。用逐格 `fill` 与 `style` 表达表头、强调列和结论行，比在表格外另加色块更可靠。

`tableData/body/data` 只用于兼容旧 source。原始 `tableOptions`、`colW`、`rowH` 不是 deck.js 正式语法；当前列宽与行高由表格布局链计算，不能借 PptxGenJS 参数绕过。

表格适合需要精确读取数值或分类对照的内容；若核心结论是趋势或差异，优先使用图表并保留必要数据标签。

## 11. 主题、设计系统与局部覆盖

`compose()` 的 `theme` 是整份 deck 视觉系统的**唯一落点**，结构为 `{ colors?, fonts?, chart? }`：

- `colors`：字符串键值对，常用键为 `accent1`、`accent2`、`accent3`、`background`、`text`、`muted`；
- `fonts`：`{ major, minor }`，**两者必须同时提供**，只给一个会报错；
- `chart`：`{ palette: [...] }`，见 §9；

`theme.logo` 当前虽可能被旧 parser 接受，但没有进入预览/PPTX 的稳定渲染消费链，因此不是公开视觉能力。Logo 请作为真实 Image 节点放进需要的页面；不要写一个不会显示的 theme 字段。

`DECK_DESIGN` 是把已有 deck 的 theme 回注到 sandbox 的结果，供后续编辑读取 `palette.accent1/accent2/accent3/background/text/muted` 与 `fonts.major/minor`，避免跨页漂移。新建文稿必须先从内容和受众确定 source 常量，再把同一组值写进 `compose({ theme })`；后续编辑优先读取 `DECK_DESIGN`，缺失项才从现有 source 判断。不要假设 `DECK_DESIGN` 在新建空文稿时已经有值。

页面与节点属性用于局部覆盖。`ppt_plan.visualDirection` 只审批整稿的设计理念、构图节奏和唯一记忆点；具体颜色、字体、图表调色板、留白和组件样式仍属于最终 deck.js，并在批准后落实到 `compose({ theme })` 与各节点。不要把已删除的 `styleDecision` 当成计划或 authoring 字段。

## 12. 编辑与诊断

- 用 `grep` 定位页面变量、标题、数据或 marker，再用 `read_file` 读取足够上下文。
- 精确小改使用 `edit_file`；调整页面结构或多处共享 token 时整体重写更清楚。
- 写入失败按可见错误消息修复；不要按内部数字错误码分支。看到 `Type 'string' is not assignable to type '"linear" | …'` 这类消息时，先回到 §2 检查是不是把含字面量字段的对象写成了属性赋值。
- 写入成功后先处理 observation 中带 code、line、message 的 document diagnostics，再运行整份 deck 的 inspect。
- 当字段不确定时读 `.d.ts`；当结构不确定时读最接近的 example；当审美取舍不确定时读 `design.md`。
