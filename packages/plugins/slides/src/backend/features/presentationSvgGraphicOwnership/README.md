# Presentation SVG Graphic Ownership

该 feature 负责把 Agent 创作期的 SVG
Graphic 来源，转换为 presentation-owned、不可变、可回放的 SVG 资产引用。

## 边界

- `presentation_svg_graphic_bindings`
  只保存 Slides 内部的“文稿 + 源身份 -> 首次接管资产”关系。
- SVG XML 的安全准入由 `backend/engine/svgGraphic`
  负责；该 feature 不重复解释 SVG 语法。
- canonical SVG 的内容寻址存储、完整性复核和 `document_asset_links`
  ownership 由 Host 的 `documentSvgAsset` 窄端口负责。
- DeckSpec 与后续渲染只消费
  `SvgGraphicOwnedAssetRef`，不得保留任意本地路径、会话路径或原始 XML。

## 首次写入获胜

`local_path`、`file:` 与 `conversation:`
只在尚未绑定时读取一次。绑定建立后，即使原文件被覆盖或删除，历史 revision 和无关编辑仍读取原有 owned
asset。用户若要替换图形，必须修改源码引用；系统不会把路径当成 live link。

inline SVG 以 admission 后 canonical content
hash 作为源身份，因此内容变化自然产生新绑定。绑定提交使用 first-write-wins；并发首次写入时，调用方最终统一读取胜出绑定。

## 错误合同

准入错误保持 `slides.svg.*`
细分错误码；来源不可用、ownership、binding 与 store 错误映射为
`PresentationBuildFailureError`。错误摘要不包含原始 SVG、解析后的宿主路径、数据库路径或受管 blob 路径。
