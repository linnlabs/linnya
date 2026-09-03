# SVG Graphic engine

该模块拥有 SVG Graphic 的唯一 XML admission、canonicalization 与内容 hash。它只接受
`shared/svgGraphic` 冻结的首期无文本子集，输出 canonical SVG、正数 viewBox、复杂度指标、
feature facts 和 SHA-256。

ownership、preview、hidden worker、screenshot 与 PPTX writer 使用同一份 canonical
bytes；不得在各 consumer 内重新清洗、放宽元素或读取原始 Agent SVG。PPTX fallback 与外部
`asvg:svgBlip` 回读也消费同一 admission 结果，不能建立第二套规则。

## 当前纵向链路

```text
createSvgGraphic source
  -> admitSvgGraphic
  -> presentation-owned asset
  -> DeckSpec owned ref
  -> 授权解析为 transient compile context
  -> RenderModel / Konva / hidden raster
  -> transparent PNG fallback + PPTX SVG/PNG dual media
  -> PptxReader admission -> CanonicalDeck / RenderModel
```

PPTX 写入 canonical `.svg` media，并通过 `SvgGraphicFallbackRasterizerPort` 取得最长边
1920px、保持 viewBox 比例的透明 PNG。package postprocessor 按对象名与 relationship 定位 companion
media，替换 PptxGenJS 固定占位图并复核 SVG hash、content type 和双 relationship；缺任一事实都以
`slides.svg.render_failed` 或 `slides.svg.pptx_embedding_failed` 失败。

回读优先识别 `asvg:svgBlip`。通过当前 admission 的 SVG 恢复为 SvgGraphic；超出子集但仍有
PNG 时保留 raster Image 并记录 fidelity warning；两种媒体都不可用时拒绝文稿。PowerPoint
重存后只保留 SVG 的情况是合法输入，再次导出时会重建真实 fallback。

## 首期 canonical write

- 允许基础几何、path、局部 gradient、marker 与 translate/scale/rotate；
- 作者可省略根元素的标准 `xmlns` 声明，canonicalizer 会确定性补齐，使产物可被浏览器和
  Office 当作独立 SVG media 解码；显式错误 namespace 不兼容；
- 只允许同文档 `url(#id)` 引用；
- 拒绝 script、事件、CSS、外部资源、嵌入媒体、filter/mask/clipPath、动画与未知 namespace；
- 拒绝 `text` / `tspan`，diagram 标签使用原生 Text；
- 超出共享预算时结构化失败，不截断、不栅格降级。

兼容回读若未来需要把更宽的 SVG 提升为 SvgGraphic，必须作为单独 read admission 明确建模，
不能反向扩大这里的 Agent canonical write 子集。
