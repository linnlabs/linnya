# SVG Graphic 共享合同

`shared/svgGraphic` 只定义 SVG Graphic 在 authoring、ownership、DeckSpec、RenderModel
与诊断链之间共享的稳定 DTO、错误码和预算。它不解析 XML，不读取文件，不计算 hash，也不接触
数据库、PptxGenJS、Konva 或 DOM。

首期创作来源只有 inline SVG、受控本地路径和 conversation file locator。来源通过 backend
唯一 admission 并被文稿接管后，canonical DeckSpec 只保存 `SvgGraphicOwnedAssetRef`；原始路径与
inline XML 继续留在 deck.js 源码中，不成为 DeckSpec 的第二份长期事实。

SVG Graphic 是一个整体可移动、缩放、旋转和替换的矢量对象，内部结构不可编辑。它不是
`Image` 或 `Shape` 的特殊分支。首期 SVG 内禁止 `text` / `tspan`，标题、正文、关键数字和
diagram 标签必须继续使用原生 Text。

## 公开创建合同

`createSvgGraphic()` 接受 inline SVG 字符串，或
`inline_svg`、`local_path`、`conversation_file` 三种正式 source。元素必须给出非空
`altText`，或明确声明 `decorative: true`，二者不能同时出现。公开视觉字段只有
`fit: 'contain' | 'stretch'`、0–1 `opacity`、有限 `rotate` 和通用布局尺寸；内部 SVG
style/path 不进入 Linnya 元素编辑合同。

## 依赖边界

- shared 只持有类型、错误码、默认预算和纯数据；
- XML admission、canonicalization 与 SHA-256 只允许在
  `backend/engine/svgGraphic` 实现；
- source identity、first-write-wins binding 和 Host asset port 属于
  `backend/features/presentationSvgGraphicOwnership`；
- renderer 与 PPTX consumer 只能消费 admission 后的 canonical bytes，不得另建清洗规则。
