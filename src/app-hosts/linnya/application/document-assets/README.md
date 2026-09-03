# Document asset ownership

该 app-level shared use case 只拥有文档与 asset 的 durable 归属关系：
`document_asset_links`。它不知道 asset 是 raster image、SVG 还是未来其他明确媒体，也不负责
ingress、内容验证或 materialization。

`document-image-assets` 与 `document-svg-assets` 作为 sibling use cases 各自完成媒体接管，随后
调用这里的窄 `DocumentAssetOwnershipPort`。共享 ownership 避免两种媒体重复读写关系表，同时
不会演变成包含 admission、存储和渲染的全局 media manager。
