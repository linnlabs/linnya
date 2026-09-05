---
name: slides-design
description: Plan, create, edit, inspect, and visually verify Linnya Slides through Workspace deck.js files and the Slides CLI. Use for PPT, presentation, slide deck, or .slides tasks.
metadata:
  author: linnya
  pluginId: slides
  version: "7.12"
---

# Slides Design

Slides 是“代码及文件”：Workspace 中的 `.slides` 是正式文档，`deck.js` source 是唯一编辑事实。用通用文件工具读取页面组织、创建和修改 source；用 `linnya-slides` CLI 检查质量、字体和真实像素。专用 Slides 工具存在时只能作为加速器，不能成为完成任务的前提。

## 先判断任务类型

- 新建文稿，或重做整份文稿的叙事、页序、视觉系统：先提交逐页计划并等待批准。
- 已有文稿的局部内容、数据或样式修改：理解相关 source 后直接修改，不重复审批。
- 只查看、诊断或渲染：直接执行相应检查，不进入建稿审批。
- 导出 PPTX：产品界面的“更多”菜单支持导出，但 Agent 当前没有可调用的 PPTX export 工具或 CLI 子命令。用户要求导出时说明界面入口；不要虚构命令、工具结果或文件地址。

## Slides流程

### 调研与计划
1. 根据需要，深入研究/搜索相关信息。
2. 为了明确目的、受众、标题、视觉方向和逐页主要内容，向用户提交一份计划。视觉方向只回答三件事：`concept` 说明整稿遵循什么设计理念以及为什么，`composition` 说明构图、信息密度与页面节奏，`signature` 只声明一个整稿核心视觉记忆点。它不是最终 theme，不填写具体颜色值、字体名或逐页样式。
- 若你有 `ppt_plan` 工具：用它提交 `title`、可选 `audience`、`visualDirection: { concept, composition, signature }` 和逐页 `pages[{title, content}]`；页数由 `pages` 自动推导，不传 `pageCount`。
- 若无 `ppt_plan` 工具：直接在对话中按相同结构输出标题、受众、三项视觉方向、总页数和逐页计划，不能省略视觉方向或改用另一套自由格式。
- 两种分支都必须停止建稿，等待用户明确批准。
- 用户调整内容计划或视觉方向后，更新同一份计划并再次等待批准。

### 创建与编辑
1. 先了解现有材料与 source。普通文本部分读取使用 1-based 行号：`offset` 是起始行，`limit` 是最多行数；复制到 `edit_file.old_string` 时去掉展示行号与 `|`。只有显式 `view="document"` 的结构化读取才使用 `offset_chars/max_chars`。
2. 按任务读取下表中的最少资源，了解Slides的语法。不要一次加载全部 reference。
3. deck.js 必须是 plain JavaScript；不写 `import`、`require`、TypeScript 注解或类型声明。每个顶层 `createSlide()` 对应一页，页面必须显式放进 `compose({ slides: [...] })`，整份 source 只调用一次 `compose()`。
4. 新建文稿或整体改版时，把用户已批准的 `visualDirection` 落实为页面设计，再确定颜色、字体和图表调色板并写进 `compose({ theme })`。`visualDirection` 约束方向，`theme` 保存实际视觉常量；后者是跨页一致性的唯一运行时依据，也是后续编辑读到的 `DECK_DESIGN` 的来源。判断依据见 [`design.md`](./references/design.md)。
5. 新建文稿使用 `write_file`，只传 `locator="workspace:/.../*.slides"`，不传 inode。
6. 局部替换优先 `edit_file`；整体重写才用 `write_file`。示例文件都是独立 source 起点，不能直接互相拼接。同一份 Slides 的写操作必须串行。修改声明与引用时先用 `grep` 找全关联处；删除按“先移除引用、后删除声明”，新增按“先增加声明、后增加引用”，保证每次写入都是可编译状态。能由一段更大且唯一的 `old_string` 覆盖时，优先一次完成关联修改。
   长文稿不要在一次工具调用中生成全部页面：预计达到 10 页，或包含较多图表、SVG、Brush、图片等复杂页面时，按章节每批创建 3–5 页；复杂批次缩小到 1–2 页。第一批用 `write_file` 写入共享 theme、共享常量、首批完整页面和唯一的 `compose()`；后续用 `edit_file` 原子加入一批完整的顶层页面声明，并同步更新同一个 `compose({ slides })`。每批写入后先处理 observation 中的编译与文档诊断，恢复到可编译状态后才能继续下一批；不要逐页制造无谓版本，也不要在最后一次性重写已经成功的页面。最终仍按第 9–10 步做整稿验收。
7. 写入失败时按模型可见的错误消息和恢复动作处理。写入成功后，先阅读 observation 中的 `自检`；若有 diagnostic，按其字符串 code、line 和 message 修复。同一输入、同一错误 code 或同一 Shell exit code 再次出现时，先改变失败原因再重试；等待、换目录或原样重放不会修复确定性失败。
8. 从写入 observation 的 `presentation_id`，或 `read_file` 结果中的 `details.presentationId` 取得 CLI 身份。它不同于 locator、inode 和文件名，不得猜测。
9. 做质量验收：直接消费低 token observation 时可用 `ppt_inspect`；需要完整机器 JSON、Shell 管道、脚本聚合或自动化时可用 `linnya-slides inspect --presentation <id>`。两者共享同一套检查事实，按当前消费方式选择；同一次验收不要求重复执行。先确认 `buildStatus` 和 `versionId`，按 P0 → P1 → P2 查看；同级先处理 root group，`shared-source` 表示同一源码控制点可一次处理多处后果。再用 `read_file` 定位当前源码；修改后必须在新 `versionId` 上复验，最后 render。P2 是设计复核，不要求机械清零。只在比较已经知道的源码对象时使用 `ppt_inspect.focus` 或 CLI `--source-range start:end`；最多四个范围，消费其紧凑的横纵间隙/相交事实，不要求全页距离矩阵。
10. 需要确认像素效果时才 render。迭代中的新建或大改可以先看代表页，局部修改只看受影响页面；准备完成时，新建或整稿改版应在最终 revision 上检查全部页面，页数多时用显式范围分批，局部修改则在最终 revision 上重新检查全部受影响页面。每次 render 从成功 stdout JSON 确认 `presentation.versionId`，再直接读取 `slides[].locator`；CLI 不会代替 Agent 自动选页。同一 `presentation.versionId + slideNumber` 的检查图最多读取一次，收齐后先汇总页面问题再合并编辑；若 `read_file` 返回 `attachment_status=already_attached`，说明相同像素已在当前 run，无需重试。编辑后只读取新 report 中受影响页的 locator，不原样重放同一批图片。

对象选择遵循语义优先：文字、原生数学公式、数据图表、表格、照片和简单可编辑几何继续使用 Text/Formula、Chart、Table、Image、Shape；复杂流程、架构或机制示意图在“整体编辑即可”时使用 `createSvgGraphic()`；需要手绘插画、笔触、纸面边框或水彩时使用 `createBrushArtwork()`。Brush 通过有序 layers 组合 stroke、watercolor/wash/mass、hatch、field 与几何 marks；复杂画面优先用多个语义图层和不同质感，不要把排线当成唯一纹理。它仍是带显式纯色背景的不透明图片资产，不是透明贴图：背景色应与所在纯色区域一致，下面是照片、渐变或纹理时不要叠加使用。文字和标签用原生 Text 覆盖；块公式和段内公式都使用正式 Formula 语义，不要画成 Brush、SVG 或图片。精确合同见 [`syntax.md`](./references/syntax.md)。

### 查看与检查
- 看 source、页面内容与代码组织：`read_file`。
- 看构建状态、检查提示及其证据：直接阅读可用 `ppt_inspect`；机器化处理、Shell 管道或自动化可用 `linnya-slides inspect`。
- 看真实像素：`linnya-slides render`，再读取成功 JSON 中逐页给出的 JPEG 检查图 locator。
- 查本机字体：新建、整体换风格或用户明确换字体时使用 `linnya-slides fonts`。
- 如果你有视觉能力，渲染Slides为图片并查看，以确认是否符合预期或需调整。

CLI 的参数、输出消费顺序和 Agent 限制见 [`references/cli.md`](./references/cli.md)。

新下载或转换生成的资产默认放在当前 conversation 工作目录，便于后续读取和随对话清理：
调用 Shell 时省略 `cwd`、使用 `assets/...` 等相对 OS 路径，并传
`requires_write_access: true`；在 deck.js 中以 `conversation:/assets/...` 引用。这是推荐位置，
不是唯一位置；用户指定其他落点，或当前任务已有其他目录的写入权限时，可以使用对应真实路径。
`requires_write_access` 和显式 `cwd` 本身不会扩大当前权限，写入不被允许时不要枚举系统目录碰运气。
已经存在于 Downloads、用户指定位置或其他获准位置的文件也可以在允许读取时直接引用。网络图片
必须先下载为本地文件，不能把 URL 写进 deck.js。Slides 首次成功提交后会把采用的文件复制为
presentation-owned 资产。

## 资源导航与权威等级

| 任务 | 读取资源 | 资源性质 |
|---|---|---|
| 理解 deck.js 结构、布局和节点 | [`syntax.md`](./references/syntax.md) | 正式语法说明 |
| 查精确字段、联合类型和工厂签名 | [`layoutPrimitives.d.ts`](./references/layoutPrimitives.d.ts) | 由代码生成的类型真值 |
| 选择图表 preset | [`chart-presets.md`](./references/chart-presets.md) | 由运行时注册表生成 |
| 做叙事、视觉系统、页面节奏判断 | [`design.md`](./references/design.md) | 设计建议，不是 lint 合同 |
| 确认某个能力具体怎么写 | [`examples/`](./references/examples/) 中覆盖该能力的 `.js` | 语法与能力示范，不是版式模板 |
| 调用 CLI、消费 JSON/图片 locator | [`cli.md`](./references/cli.md) | Agent CLI 合同 |

示例按覆盖的能力划分，不按"页面类型"划分：

- [`cover-variants.js`](./references/examples/cover-variants.js)：五种结构不同的封面构造法（字体主导、图片主导、数据主导、编辑出版、色块宣言）。
- [`media-and-paint.js`](./references/examples/media-and-paint.js)：图片适配与遮罩、渐变与半透明、自定义几何、富文本 run、TableCell 逐格样式。
- [`card-grid.js`](./references/examples/card-grid.js)：卡片行的四种变形，最后一页是"同内容换构图"的对照。
- [`chart-analysis.js`](./references/examples/chart-analysis.js)：图表数据结构与主副图配比。
- [`table.js`](./references/examples/table.js)：表格基本结构。
- [`timeline.js`](./references/examples/timeline.js)：absolute 坐标算术与添加顺序决定的层级。
- [`native-formula.js`](./references/examples/native-formula.js)：独立原生公式与同段行内公式。
- [`brush-artwork.js`](./references/examples/brush-artwork.js)：声明式 Brush 图层、deck.js 循环、不透明背景合同与竖版画布。
- [`complete-deck.js`](./references/examples/complete-deck.js)：多页 deck 的组织方式与页面节奏。

示例中的颜色、字体和版式是各自的一次性选择，不是 Linnya 的默认风格，也不构成推荐版式。读示例是为了确认某个能力的写法，视觉决策应当在读示例之前就由内容和受众定下来。

发生冲突时，运行时代码和生成文件高于散文；CLI 实际输出高于手写推断；设计建议不能覆盖类型、诊断或用户要求。

## 完成标准

- 内容与用户批准的计划或局部修改要求一致；事实和来源没有被臆造。
- 新建或整体改版的文稿在 `compose({ theme })` 中声明了视觉系统。
- 最终内容已核对语言一致性与单位表达，尤其区分百分比、百分点和其他容易混淆的口径。
- 写入 observation 中没有未处理的 error；inspect 的 `buildStatus` 可用，findings 已结合证据和设计意图逐项判断。
- 需要视觉确认的页面已经按最终 revision 的策略 render 并检查，而不是只凭 source 猜效果，也不是沿用较早 revision 的截图。
- 最终渲染已经逐项通过 [`design.md`](./references/design.md#高频问题重点复核) 的高频问题复核；`inspect` 通过或最终回答自述不能代替像素判断。
