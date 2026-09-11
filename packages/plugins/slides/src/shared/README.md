# Slides Shared

`src/shared` 是 Slides 插件的跨 backend / renderer 公共合同层，负责承载两端都需要理解的 DTO、schema、常量和纯函数。这里的代码必须能在 backend 和 renderer 中安全运行，不能绑定 Node、DOM、Vue、Pinia、数据库、workspace、IPC handler 或具体渲染库。

`@plugin/slides/shared` 是 backend、测试和类型消费的稳定 public barrel。浏览器或 worker 的**运行时值导入**
必须使用 `@plugin/slides/shared/<semantic-feature>` 子入口；根桶会联通 document source 等 backend-heavy 模块，
不属于 browser bundle 边界。子入口本身仍必须保持纯共享合同。

## 文档树

```text
shared/
├── README.md                         # 本说明
├── index.ts                          # @plugin/slides/shared public barrel
├── pluginMeta.ts                     # Slides 插件 id、文档类型、文件扩展名、owned tables
├── ipc.ts                            # Slides IPC channel 名称和轻量公共结果类型
├── documentSource/                   # presentation 来源、source span、slide marker 纯索引
├── generatedLayoutConstraints/       # generated Flex/Yoga 的窄布局事实合同
├── deckSpec/                         # DeckSpec、SlideSpec、PatchSpec、尺寸、asset ref、semantic role
├── visual/                           # 颜色合同、theme、chart palette
├── renderModel/                      # PresentationRenderModel、RenderNode 遍历、editable target 纯规则
├── svgGraphic/                       # SVG Graphic 来源、owned ref、admission DTO 与错误码
├── mathFormula/                      # 原生公式 durable source、SVG metrics 与稳定错误码
├── slideRasterization/               # 单页 raster request/profile/result/error 纯合同
├── presentationExport/               # 三格式请求联合、默认值、artifact 描述与 parser
├── pptPlanToolContract.ts             # ppt_plan 参数、视觉方向与跨端计划数据合同
├── pptInspectToolContract.ts          # ppt_inspect 严格参数、最小 data 与结果合同
├── spatialTypes.ts                   # 空间关系 DTO
├── flexComposeContract.ts            # deck.js scene graph compose DSL 合同
├── presentationInfo.ts               # PPTX reader 输出的 PresentationInfo 合同
├── canonicalDeck.ts                  # parser canonical deck 合同
├── deckPreview.ts                    # DeckPreview 合同
├── toolCapabilities.ts               # inspect/edit 工具能力 DTO 与构造规则
├── toolFeedback.ts                   # inspect feedback DTO 与 UI slim 规则
├── templateSpec.ts                   # template summary/spec DTO
├── render-geometry/                  # render 几何、图表几何、文本测量几何纯规则
├── shapeGeometry/                    # preset/参数化/polygon/typed path 形状轮廓合同
└── textLayout/                       # 文本布局合同、断行、line metrics、行级 IR
```

## 当前语义分组

理解和新增代码时按下面的业务边界归类：

| 分组 | 文件 | 职责 |
|---|---|---|
| 插件与 IPC 合同 | `pluginMeta.ts`、`ipc.ts` | 插件 id、文档类型、文件扩展名、owned tables、IPC channel 名称 |
| 文档来源与源码定位 | `documentSource/` | presentation 来源、deck.js source span、slide marker 行号索引 |
| Generated 布局事实 | `generatedLayoutConstraints/` | 声明约束、Yoga 最终盒、比例与 computed 父容器身份；不是 authoring API |
| DeckSpec 与 patch 合同 | `deckSpec/` | 生成结果、导入稿 patch、元素、尺寸、图片引用和语义角色 |
| 视觉与主题合同 | `visual/` | 颜色规范化、主题与 chart palette |
| compose DSL 合同 | `flexComposeContract.ts` | deck.js scene graph DSL |
| 读路径与质量输入合同 | `presentationInfo.ts`、`canonicalDeck.ts`、`deckPreview.ts` | PPTX reader、RenderModel 派生的窄 lint facts、canonical deck、preview DTO |
| RenderModel 合同 | `renderModel/`、`render-geometry/` | renderer 消费的 render contract、遍历、图表/文本几何纯规则 |
| Shape Geometry 合同 | `shapeGeometry/` | 形状语法、严格校验、local-space 解析、preset 展开和 path 序列化 |
| SVG Graphic 合同 | `svgGraphic/` | authoring source、owned asset ref、admission policy/report 与稳定错误码 |
| 数学公式合同 | `mathFormula/` | durable LaTeX source、block/inline 语义、SVG content box 与布局 metrics |
| 栅格化合同 | `slideRasterization/` | 单页请求、像素 profile、PNG bytes 结果和稳定错误 |
| 导出合同 | `presentationExport/` | PPTX/图片/PDF 请求联合、图表模式、图片宽度和文件描述 |
| 文本布局合同 | `textLayout/` | padding、wrap、autofit、断行、行高、行级 IR 权威 |
| 工具反馈与公开结果 | `renderModel/editableTargets.ts`、`spatialTypes.ts`、`toolCapabilities.ts`、`toolFeedback.ts`、`pptPlanToolContract.ts`、`pptInspectToolContract.ts` | backend inspection 的完整中间反馈，以及 backend/Renderer 共用的最小 strict 工具结果 |
| 模板合同 | `templateSpec.ts` | 模板摘要和模板 spec DTO |

## 边界与依赖

- shared 只能依赖 TypeScript 标准能力和其他 shared 内纯模块。
- shared 不能依赖 `src/backend/**`、`src/renderer/**`、`@plugin/backend/*`、`@plugin/renderer/*`。
- shared 不能依赖 PptxGenJS、Konva、ECharts、JSZip、xmldom、better-sqlite3、Vue、Pinia、DOM、Node `fs`。
- shared 可以定义 port 形状，例如 `RunAdvanceProvider`、`FontMetricsProvider`，但不能创建具体平台实现。
- shared 可以包含纯校验、归一化、遍历、换算和轻量 parser；不能执行 I/O、注册 IPC、读写 repository 或触发 UI 副作用。
- `presentationInfo.ts` 的 `chartInfo` 只承载 quality 需要的最终类别/系列名称与标签通道，不复制 series values 或 renderer 私有配置；generated RenderModel 可提供，imported 缺失时规则必须跳过。
- backend / renderer 对 shared 的消费应保持单向。shared 不反向了解调用方。
- renderer / worker 的 value import 禁止指向 `@plugin/slides/shared` 根桶；只能使用 `pluginMeta`、`renderModel`、
  `shapeGeometry`、`slideRasterization` 等语义子入口。`import type` 可以使用稳定 barrel，但优先保持语义清楚。
- 插件独占工具的 strict schema 由插件 shared 拥有。`pptInspectToolContract.ts` 是 `ppt_inspect` 参数、执行期结果和 Conversation 消息结果的唯一跨端 owner：backend producer parse 包含 `observationPreviewMeta` 的执行期 schema；该 meta 被 ToolNode 消费且不进入 Conversation 工具消息，Renderer projector parse 严格的 `data + observation` 消息 schema。两份结果合同复用相同 data/observation 定义，不维护兼容读取。可选 `focus` 只接纳至多四个 1-based 源码闭区间；完整 finding 与 focus 关系只进 observation，不进入卡片 data。业务投影规则见 [presentationInspection](../backend/features/presentationInspection/README.md)。
- `pptPlanToolContract.ts` 是 `ppt_plan` 参数与计划 data 的唯一跨端 owner。`pages` 是页数和顺序的唯一输入事实；backend 生成连续 `slideNumber` 与 `pageCount`。`visualDirection` 只审批整稿的设计理念、构图策略和唯一记忆点，不复制最终 deck.js 的颜色、字体或图表调色板。

## Public Barrel 规则

`index.ts` 是跨目录稳定入口。新增公共合同遵循：

1. 优先把类型、常量、纯函数放进对应业务文件或子目录。
2. 需要跨 backend / renderer 使用时，从 `index.ts` re-export 以保持合同完整；同时确认 browser consumer 是否应
   从对应语义子入口导入。
3. 只被单侧使用的代码不要放 shared；放回 backend 或 renderer 对应 feature。
4. 不要把临时测试 helper、运行时 adapter、UI 文案、工具实现放进 `index.ts`。
5. 物理整理目录时，必须保持 `@plugin/slides/shared` 的导出兼容；browser runtime import 则保持语义子入口，
   防止 barrel tree-shaking 失效时把后端依赖带入浏览器。

## 新增代码归类

- 新生成字段：优先放 `deckSpec/` 对应合同；如果字段也影响 render preview，同步 `renderModel/`。generated deck 编辑应修改 deck.js，不在 DeckSpec 恢复持久化 edit state。
- 新 PPTX reader 输出字段：放 `presentationInfo.ts`，再由 parser/canonical/render-model mapper 消费。
- 新 renderer 消费字段：放 `renderModel/`；遍历能力放 `renderModel/renderModelTraversal.ts`。
- 新文本布局语义：放 [`textLayout/README.md`](textLayout/README.md) 对应合同和纯算法。
- 新 render 几何计算：放 [`render-geometry/README.md`](render-geometry/README.md) 对应模块。
- 新形状轮廓语义：放 [`shapeGeometry/README.md`](shapeGeometry/README.md)；Paint、绝对位置和具体 renderer adapter 不得进入该模块。
- 新 SVG Graphic 跨端事实：放 [`svgGraphic/README.md`](svgGraphic/README.md)；XML parser、hash、文件与 renderer adapter 不得进入 shared。
- 新公式跨端事实：放 [`mathFormula/README.md`](mathFormula/README.md)；canonical AST、LaTeX parser 与 OMML emitter 不得进入 shared。
- 新颜色或主题规则：放 `visual/`。
- 新 source-backed 编辑定位：放 `documentSource/`。
- 新 inspection 中间反馈 DTO：放 `toolFeedback.ts`；工具可执行能力描述放 `toolCapabilities.ts`；跨 backend/Renderer 的公开工具结果另建具名 strict contract，不能复用中间 feedback 充当 wire shape。

如果一个能力需要 Node、DOM、数据库、workspace、font catalog、text measurement service、Konva 或 PptxGenJS，它不属于 shared；shared 只能定义它与两端交互所需的 DTO 或 port。

## 物理整理规则

当前 shared 根目录仍保留 compose、parser preview、tool feedback、template 等横向合同。后续整理继续分小步进行：

- 保留 `index.ts` public barrel 稳定。
- 每次只迁移一个语义分组，例如 `composeContract/`、`previewContract/`、`toolFeedback/`。
- 先建目录 README 和内部 `index.ts`，再迁移文件，最后更新 barrel。
- 避免只按“类型/工具函数”机械切分；目录名应表达业务合同边界。
- 迁移时优先保持外部 import 不变，内部 deep import 再逐步收敛。

不建议把不好归类的文件直接丢进 `utils`、`helpers`、`common`。如果出现这类需求，先判断它到底属于 DeckSpec、RenderModel、text layout、document source、visual contract 还是 tool feedback。

## 测试入口

- shared 全量相关测试：`packages/plugins/slides/src/shared/**/*.test.ts`
- `ppt_inspect` strict contract：`packages/plugins/slides/src/shared/pptInspectToolContract.test.ts`
- `ppt_plan` strict contract：`packages/plugins/slides/src/shared/pptPlanToolContract.test.ts`
- text layout：`packages/plugins/slides/src/shared/textLayout/**/*.test.ts`
- render geometry 回归：`packages/plugins/slides/src/backend/__tests__/render-geometry-exhaustive.test.ts`
- backend / renderer 使用 shared 合同的集成测试：`pnpm run test:plugin:slides`

文档或纯导出调整至少跑 `git diff --check`。涉及合同字段、布局、颜色、source span、render-model 或 tool feedback 行为时，应补对应业务测试，而不是只改类型。

Paint 的 `direction` 与 `angle` 二选一，接纳时统一为 OOXML 角度（0° 向右、顺时针）；非正方形按 scaled 坐标映射。径向 center/radius 分别按宽、高归一化，预览必须保留双轴半径。详见 [视觉 Paint 合同](../../docs/visual-paint-contract.md)。
