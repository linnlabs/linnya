# Slides Backend Engine

`backend/engine` 是 Slides 后端的纯业务引擎层，负责把已编译的 `DeckSpec` 转换为 PPTX、解析 PPTX 读模型、派生 preview/render-model、执行 patch 与质量诊断。它不负责让 Agent 自动设计页面；generated deck 的布局由 `backend/codegen` 编译 deck.js scene graph 并通过 Flex/Yoga 产生显式几何。

engine 不负责 workspace 节点生命周期、数据库、IPC、工具上下文、renderer UI 或 Agent prompt。这些流程由 `backend/coordinator` 与 backend features 装配。

## 文档树

```text
backend/engine/
├── core.ts                    # coordinator/codegen 装配所需的窄入口
├── types.ts                   # engine adapter、port、执行上下文类型
├── DeckAssembler.ts           # DeckSpec -> PPTX Buffer 主编译入口
├── StructuredCompiler.ts      # structured slide -> PPTX
├── FreeformCompiler.ts        # freeform slide -> PPTX
├── assets/                    # 图片来源解析、预取和写入前归一化
├── coordinator/               # engine 内 query、导入稿 patch、生成校验
├── deck/                      # 默认 DeckSpec builder
├── execution/                 # engine 执行 adapter
├── parser/                    # PPTX 读取、canonical、preview、render-model 派生
├── patch/                     # PatchCompiler、patch plan、OOXML patch editor
├── pptx/                      # PPTX 包级清洗、主题字体补全和结构校验
├── quality/                   # LayoutLint、AestheticLint、QualityGate、空间分析
├── shape/                     # ShapeGeometry -> PptxGenJS adapter
├── shared/                    # engine 内跨子模块共享纯算法
├── svgGraphic/                # SVG Graphic admission、canonicalization 与 PPTX 语义
├── mathFormula/               # 受控公式 compiler、MathJax SVG/OMML 双投影与 PPTX patch
├── template/                  # 模板导入与主题读取
├── text/                      # 文本测量、render-model text layout、PPTX text options
└── visual/                    # Paint 编译适配、typed OOXML patch plan 与视觉默认值
```

## 主链路

生成与导出：

```text
deck.js
  -> backend/codegen Flex/Yoga compiler
  -> DeckSpec（所有元素已有显式几何）
  -> presentationBuildExecution 准备自包含资产 DTO
  -> build Worker 内 DeckAssembler
  -> StructuredCompiler / FreeformCompiler
  -> pptx sanitizer / validator
  -> transferable ArrayBuffer -> Buffer
```

读取与预览：

```text
PPTX Buffer
  -> parser/PptxReader
  -> PresentationInfo
  -> CanonicalBuilder / PreviewMapper / RenderModelMapper
  -> coordinator query runtime 或 renderer
```

质量诊断：

```text
PresentationInfo 或 RenderModel
  -> LayoutLint / AestheticLint / HeuristicLint
  -> inspect feedback: buildStatus + findings
```

## 已废弃的自动布局边界

早期 `PageComposer -> grammar/topology/solver -> RepairLoop` 自动布局链已经退役并删除。原因是它与 deck.js 源码真相并存，既无法稳定复现 Agent 设计，也会在修复时改写源码语义。当前只有两类布局事实：

- deck.js 的 Flex/Yoga 编译结果；
- 导入 PPTX 后解析得到的既有几何。

不要在 engine 恢复 `autoLayout`、grammar、topology、solver 或自动 repair。新的 Agent 设计能力进入 codegen DSL/Skill；诊断能力进入 `quality/`，再由 Agent 修改 deck.js。

## 边界与依赖

| 允许 | 禁止 |
|---|---|
| 依赖 `@plugin/slides/shared` 的 DTO、schema、常量和纯规则 | import renderer、Vue、DOM UI 或 Pinia store |
| 依赖平台 text measurement、font resolution 等 port | 直接操作 workspace 节点、数据库或 IPC |
| 通过 `core.ts` 暴露稳定、窄小的装配能力 | 新增大而全 barrel 或恢复已退役自动布局接口 |
| 输出 `Buffer` 或 shared DTO 给上层 runtime | 在 engine 内持久化 presentation 状态 |

## 开发规范

- structured、freeform、mixed 三条导出路径共同调用 `pptx/initializePptxDocument.ts`，统一写入 layout、title 和声明主题字体。
- PPTX 页面尺寸只消费 shared 已规范化的 `SlideLayout`。preset 保持原生 layout 名称；自定义尺寸按 EMU
  生成稳定名称并在创建任何 slide/master 前调用 PptxGenJS `defineLayout()`。禁止在 compiler 内另算比例或比较浮点宽高。
- PPTX 主题字体来自 `DeckSpec.theme.fonts`；本机 `resolvedFamily` 只服务测量和预览。
- 新 Paint 字段先改 [`../../../docs/visual-paint-contract.md`](../../../docs/visual-paint-contract.md) 的 shared 合同，再接 compiler、parser、render-model 和 renderer。
- 新形状轮廓先改 shared `shapeGeometry`，再同步 backend shape、parser、RenderModel、Konva、Skill 和 E2E；未知 geometry 禁止降级为 rect。
- 新 SVG Graphic 语义先改 shared `svgGraphic`，再由 `svgGraphic/` 唯一 admission 产出 canonical bytes。
- 新公式语义先改 shared `mathFormula`；`mathFormula/` 必须从同一 canonical IR 产生 MathML/MathJax path SVG 与原生 OMML，inline 断行继续由 shared `textLayout` 唯一负责。
- 图片和 SVG Graphic 的 `cover` / `contain` 比例几何统一由 shared `render-geometry/imageGeometry.ts` 计算；PPTX 侧从已物化图片字节或 SVG viewBox 读取原始尺寸并转换为 `srcRect` 或居中图片框，禁止把目标框尺寸重复作为原图尺寸传给 PptxGenJS。
- 生产 PPTX 编译只能经 `features/presentationBuildExecution` 进入 build Worker；Worker DTO 禁止携带未解析文件路径。
- 新文本布局语义先改 shared `textLayout`，engine 只负责技术适配与测量接线。
- 新 PPTX 读字段放 `parser/xml/`，并按需贯通 `PresentationInfo`、canonical 与 render-model。
- 新 quality 规则放 `quality/`，消费 shared DTO 或明确 lint input，不直接读取 PPTX zip。

## 测试入口

- engine 主测试：`packages/plugins/slides/src/backend/__tests__/*.test.ts`
- parser render-model：`packages/plugins/slides/src/backend/engine/parser/render-model/**/*.test.ts`
- patch：`packages/plugins/slides/src/backend/engine/patch/__tests__/*.test.ts`
- pptx 包处理：`packages/plugins/slides/src/backend/engine/pptx/__tests__/*.test.ts`
- template、text、visual、SVG：对应子目录 `*.test.ts`
- 插件全量：`pnpm run test:plugin:slides`
