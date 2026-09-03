# Parser/Xml 子模块

> 本目录是 OOXML 字段与单位换算的长期权威。包级边界见 [`../../../../../README.md`](../../../../../README.md)；Paint 合同见 [`../../../../../docs/visual-paint-contract.md`](../../../../../docs/visual-paint-contract.md)。

## 角色

`parser/PptxReader.ts` 是**编排层（解压 + slide-level glue + EditableTarget 注入）**；本目录是**字段提取层**——把 OOXML 标签翻译成 `SlideElementInfo / ThemeInfo / MasterInfo` 等单位化合同。

> **2026-04-19 §4.5**：`PptxReader.ts` 从 1177 行单文件拆分为编排层 + 本目录 7 个高内聚子模块。

## 文件树

```
parser/xml/
├── XmlNode.ts          # @xmldom/xmldom DOM 通用工具 + relMap + creationId
├── TextSpacingParser.ts # spcPts/spcPct -> 可辨识段落行距 + 字号/字体解析
├── ShapeVisualParser.ts # Paint / border / custGeom / cornerRadius / shadow / shapeKind / rotation / imageFit
├── GeometryParser.ts   # GroupTransform + xfrm/Box（EMU → inches）
├── TextBodyParser.ts   # bodyPr + 保序 paragraph/run/soft-break + 行距来源
├── SlideElementParser.ts # sp/pic/graphicFrame/group 4 类元素互递归
└── ThemeMasterParser.ts # theme 调色盘/字体 + master/layout 名（接收 readXml）
```

## 设计契约

### 单位输出（强约束）

| 字段 | 输出单位 | 来源单位 | 换算 |
|------|------|------|------|
| 长度（Box / cornerRadius / gradient 偏移）| **inches** | EMU | `emuToInches()`（`@plugin/backend/textMeasurement`）|
| 字号 / stroke.width / shadow.{blur,offsetX,offsetY} | **pt** | OOXML EMU 或 1/100 pt | `/12700`（EMU→pt）或 `/100`（hundredths→pt）|
| rotate | **度** | 60000-based 度 | `/60000` |
| 行距 | **`multiple` 或 `exactPt` 可辨识合同** | `spcPct(1/1000%)` 或 `spcPts(1/100 pt)` | `spcPct / 100000`；`spcPts / 100` |
| 颜色 | `#XXXXXX` | OOXML `srgbClr@val` | `readSrgbColor()` 加 `#` |

**禁止**返回 EMU / 60000-based 度给上游；归一化单位以本表和 shared 类型注释为准。

数字 `<=4` / `>4` 只用于旧 DeckSpec admission，不能用于 OOXML 读路径。XML 标签已经明确区分 `spcPct` 和 `spcPts`，parser 必须直接产出对应 kind。

### 段落与继承

- `TextBodyParser` 按 `a:p` 顺序输出 paragraphs，按 `a:r` 顺序输出 runs；空 `a:p` 不能丢失。
- `a:br` 在当前 run 流中输出 `\n`，后续 shared cluster 层把它标记为强制换行。
- 行距解析顺序只覆盖当前可见上下文：paragraph `a:pPr`、匹配的 list-style level、generated/default。
- 当真实值需要 slide layout/master placeholder style，而调用方没有提供上下文时，输出 `unresolved` 原因，不允许假定 1.0 或复用相邻段落。
- 完整 layout/master 继承属于 parser orchestration 的后续能力：应通过窄上下文参数注入 `TextBodyParser`，不能让 `CanonicalBuilder` 或 renderer 读 raw OOXML。

### 纯函数 + 显式参数

- 全部函数纯 → 不持有 `JSZip` / `DOMParser` / `PptxReader` 实例
- IO 通过 `ReadXml` 函数注入（`ThemeMasterParser` 是唯一接 IO 的模块，但只接函数不接 zip）
- 互递归通过显式参数（`SlideElementParser.parseGroup` 调用其他 parser 时显式传 `theme / slideRelMap / parentTransform / pictureResources`）
- `spTree` 与 group 必须按直接子节点原始顺序分派，不能按 `sp/pic/graphicFrame/group` 分批收集后改变 z-order。
- SVG media bytes 由 `PptxReader` 读取并经唯一 admission 后，以窄 `pictureResources` 上下文注入；字段 parser 不持有 zip。

### Shape vs Textbox 启发式（§4.5 契约）

`SlideElementParser.parseShape` 的判定优先级：

1. `p:cNvSpPr@txBox === '1'` ⇒ 明确 textbox（强制 text）
2. 含 `a:custGeom` 或 `prst != 'rect'` ⇒ 真正几何形状，文本作为 `innerText` 保留
3. `prst == 'rect'` 且无文本 且 带视觉负载（fill / border / cornerRadius / shadow）⇒ shape（纯色块）
4. 其他 ⇒ text

不允许在调用方再 override 此判定。

`a:custGeom` 首期只承诺回读单一闭合 path 的 `moveTo / lnTo / quadBezTo / cubicBezTo / close`。外部文件若包含 guide formula、arc、多个子路径或高级 adjustment，parser 必须明确保留为未支持能力，禁止伪装成矩形。

## 模块边界

| 允许 | 禁止 |
|------|------|
| `XmlNode.ts` 被所有同级模块复用 | 子模块持有 `JSZip` / `DOMParser` 实例 |
| `ThemeMasterParser` 通过 `ReadXml` 函数访问 zip | 子模块反向 import `PptxReader.ts` |
| 通过 `@plugin/backend/textMeasurement` 消费单位换算 | 在 mapper / canonical builder 里再做 EMU→inches（重复） |
| 输出 `@plugin/slides/shared` 的 `PresentationInfo` 类型 | 输出 OOXML raw 类型给上游 |

## 加新东西 Checklist

### 加新 OOXML 字段

1. 找到或新建对应 `*Parser.ts`（按 family：text / shape / geometry / theme / element）
2. 字段必须做单位换算后再返回
3. 在 `packages/plugins/slides/src/shared/presentationInfo.ts` 加字段（如需暴露给 canonical / mapper）
4. `CanonicalBuilder.ts` 透传到 `CanonicalElement.visual`
5. `CanonicalRenderModelMapper.ts` 在缺 `specElement` 时也消费该字段
6. `__tests__/pptx-reader.test.ts` 加 fixture 锁定

### 加新元素类型（如 `p:cxnSp` 连接线）

1. `SlideElementParser.parseSlideElements` 的保序直接子节点分派增加新 tag
2. 新建 `parse<Element>` 函数
3. `packages/plugins/slides/src/shared/presentationInfo.ts` 的 `SlideElementInfo` union 扩展
4. CanonicalBuilder + RenderModelMapper 同步

### 调整单位换算

1. 仅可在本目录内 + 平台 `@plugin/backend/textMeasurement` 窄门面对应实现改动
2. 改完跑 parser、RenderModel、compiler round-trip 与插件 typecheck
3. 同步本页单位表和 shared 类型注释

## 测试入口

- `packages/plugins/slides/src/backend/__tests__/pptx-reader.test.ts`
- `packages/plugins/slides/src/backend/__tests__/render-model-mapper.test.ts`
- 涉及 Paint / 单位还要跑 Konva visual mapping、compiler round-trip 与 slide raster codec 套件
