# Slides Engine Parser

`engine/parser` 是 Slides backend engine 的读路径与 render-model 派生层。它把 PPTX OOXML 解析为 `PresentationInfo`，再根据使用场景派生 `CanonicalDeck`、`DeckPreview`、inspect snapshot 或 renderer 消费的 `PresentationRenderModel`。

parser 是 engine 内部能力，不是普通插件 SDK。跨装配层需要读路径能力时，应优先通过 `@plugin/slides/backend-engine-core` 暴露的窄入口。

## 文档树

```text
parser/
├── PptxReader.ts                 # PPTX 解压、slide glue、layout 名解析、EditableTarget 注入
├── CanonicalBuilder.ts           # PresentationInfo -> CanonicalDeck
├── PreviewMapper.ts              # PresentationInfo / CanonicalDeck -> DeckPreview
├── RenderModelMapper.ts          # generated / canonical -> PresentationRenderModel
├── InspectSnapshot.ts            # inspect 输出快照派生
├── README.md                     # 本说明
├── xml/
│   ├── README.md                 # OOXML 字段提取层说明
│   ├── XmlNode.ts                # DOM 通用工具、relMap、creationId
│   ├── GeometryParser.ts         # EMU -> inches、xfrm、group transform
│   ├── ShapeVisualParser.ts      # fill、border、shadow、preset/custGeom、imageFit
│   ├── SlideElementParser.ts     # sp、pic、graphicFrame、group 元素解析
│   ├── TextBodyParser.ts         # bodyPr、保序 paragraph/run 与行距来源
│   ├── TextSpacingParser.ts      # OOXML 段间距、行距、字体相关解析
│   └── ThemeMasterParser.ts      # theme、master、layout 信息读取
└── render-model/
    ├── CanonicalRenderModelMapper.ts # imported / patched canonical -> render node
    ├── GeneratedRenderModelMapper.ts # generated DeckSpec -> render node
    ├── RenderModelEditable.ts        # 可编辑能力与 source span 标记
    ├── RenderModelShared.ts          # mapper 共享默认值和几何规则
    ├── RenderModelStructured.ts      # structured slide render 映射
    ├── RenderModelText.ts            # text run / paragraph / layout 输入映射
    └── renderModelTraversal.ts       # render node 遍历工具
```

## 架构与数据流

PPTX 读路径：

```text
Buffer
  -> PptxReader.parse()
  -> xml/* 提取单位化字段
  -> PresentationInfo
```

canonical / preview：

```text
PresentationInfo
  -> CanonicalBuilder
  -> CanonicalDeck
  -> PreviewMapper 或 RenderModelMapper.fromCanonicalDeck()
```

generated render-model：

```text
DeckSpec
  -> RenderModelMapper.fromGeneratedDeck()
  -> GeneratedRenderModelMapper
  -> applyTextLayoutToRenderModel()
  -> PresentationRenderModel
```

`RenderModelMapper` 的分流是重要边界：generated deck 走 spec-first，不先编 PPTX 再 parse；imported / patched deck 才以 parser/canonical 结果作为主要事实来源。

SVG picture 回读由 `PptxReader` 先解析 package relationship 和 media bytes，再把已 admission 的
`SlideElementSvgGraphicInfo` 显式注入 `SlideElementParser`。字段 parser 不持有 JSZip，也不自行读取
media。`asvg:svgBlip` 通过当前 admission 时进入 SvgGraphic canonical/render node；不支持或不可用的
SVG 只有在 `a:blip` fallback 仍存在时才保留为 Image，并通过 `fidelity_fallback` warning 暴露降级。
PowerPoint 删除 fallback、只保留 SVG 的重存包仍可正常读取。

## 导入文本保真合同

导入链路必须保留 OOXML 的 paragraph/run 边界，不能先压成一个字符串再猜回结构：

```text
a:p / a:r / a:br
  -> SlideElementParagraphInfo[]
  -> CanonicalTextParagraph[]
  -> RenderParagraph[]
  -> backend text finalization
```

- 每个 `a:p` 对应一个 paragraph；空段落仍保留，段落之间用结构而不是样式广播表达。
- 同一段内的 run 顺序和样式逐一保留；`a:br` 映射为强制换行，不创建伪段落。
- 行距、段前后、对齐和缩进属于 paragraph，不属于 run，也不属于 `CanonicalVisualHints`。
- 行距解析结果同时携带来源：paragraph、list-style、default 或 `unresolved`。
- 当前 `SlideElementParser` 没有 layout/master 文本样式上下文；遇到只能从该上下文继承的行距时明确标记 `unresolved: layout-master-context-unavailable`，禁止退化为“取第一个非空值并广播”。补齐完整继承必须先扩 parser 的上下文 port，而不是在 mapper 加 fallback。

## 边界与依赖

- `xml/` 只做 OOXML 字段提取和单位化，不持有 repository、workspace、IPC 或 renderer 状态。
- `PptxReader.ts` 负责解压、slide 顺序、rels glue 和 editable target 注入，不把字段解析逻辑写回主类。
- `SlideElementParser` 必须按 `spTree` 与 group 的原始直接子节点顺序分派元素；按类型分批收集会改变 z-order。
- `render-model/` 只把 shared `DeckSpec`、`PresentationInfo`、`CanonicalDeck` 映射为 render contract，不直接依赖 Konva 或 Vue。
- 单位输出必须是 shared 合同单位：长度 inches，字号/线宽/阴影 pt，旋转 degree，opacity 0-1。
- OOXML 文本 run 在解析时通过平台字体 port 补 `resolvedFontFamily / resolvedBold / resolvedItalic / fontScript / fontResolution / fontFaceFingerprint`，原始 `fontFamily / bold / italic` 继续保留给 PPTX 语义；canonical 与 RenderModel 映射不得丢掉请求和解析两组事实。`fontFaceFingerprint` 是字体文件内容 + face 身份的 SHA-256，inspect/manifest 可以公开它，但不得暴露字体文件路径。
- Canonical imageRef 是 PPTX `r:embed` 的包内 part path（如 `../media/image1.png`），映射为 RenderModel `embedded`；它不是 deck.js 相对路径或 generated asset ID。HTTP(S) target 不得借 imported 路径进入 renderer。
- parser 可以解析 PPTX，但当前没有对外的直接 PPTX 文档导入 IPC。`slides:template-import` 是模板上传通道，不等同于 editable deck 导入。

## 开发规范

- 新 OOXML 字段先放到 `xml/<Family>Parser.ts`，做完单位换算再进入 `PresentationInfo`。
- 新元素类型需要同时扩 shared `SlideElementInfo` union、`SlideElementParser`、canonical builder 和 render-model mapper。
- 新 render-model 字段必须先有 shared schema，再由 generated / canonical 两条 mapper 视真实来源补齐。
- 新 paragraph 字段必须按 `PresentationInfo -> CanonicalDeck -> RenderModel` 一一透传；不得汇总到 element 级 text style。
- 读路径不能输出 OOXML raw 值给 renderer 或 tool feedback；需要排查时通过 inspect/debug 结构显式呈现。
- 可编辑能力矩阵在 `PptxReader.buildEditableTarget` 附加，工具层只消费结果，不反向猜元素可编辑性。
- `a:custGeom` 首期只回读单条闭合数值 path 的 move/line/quadratic/cubic/close；guide、arc、多 path、hole 和开放路径保持 unsupported，禁止只取第一条或伪装为 rect。

## 测试入口

- PPTX reader：`packages/plugins/slides/src/backend/__tests__/pptx-reader.test.ts`
- canonical / preview / inspect：`packages/plugins/slides/src/backend/__tests__/{canonical-builder,preview-mapper,inspect-snapshot}.test.ts`
- render-model mapper：`packages/plugins/slides/src/backend/__tests__/{render-model-mapper,render-model-mapping-text,render-model-mapping-visual,render-model-mapping-chart-table}.test.ts`
- generated/canonical text layout：`packages/plugins/slides/src/backend/engine/parser/render-model/**/*.test.ts`
- XML spacing：`packages/plugins/slides/src/backend/engine/parser/xml/TextSpacingParser.test.ts`
- Shape Geometry XML：`packages/plugins/slides/src/backend/engine/parser/xml/ShapeVisualParser.test.ts`
- SVG picture 双媒体与回读：`packages/plugins/slides/src/backend/engine/svgGraphic/pptx/svgGraphicPptxRoundtrip.test.ts`
