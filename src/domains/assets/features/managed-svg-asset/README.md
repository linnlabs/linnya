# Managed SVG asset

该 feature 只接管已经由业务 owner admission 的 canonical SVG bytes，并把它们登记为
`image/svg+xml` 内容寻址 asset。它不解析任意 SVG、不读取 Agent 路径，也不复用 raster image
inspection。

写入时复核 UTF-8、字节预算与调用方提供的 SHA-256，然后复用受管 content store 的 hard-link
发布协议并登记 `assets`。SVG 的 `width_px` / `height_px` 保持 `NULL`；viewBox 是 Slides SVG
Graphic 的业务事实，不伪装成像素尺寸。

读取时只接受 ledger 中的 SVG asset，要求路径仍位于当前 store content root，并重新核对长度、
SHA-256 与 UTF-8 roundtrip。文档 ownership 不属于该 feature，由 app-level document asset
workflow 通过 `document_asset_links` 表达。
