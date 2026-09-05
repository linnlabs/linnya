# Document asset ownership

该 app-level shared use case 只拥有文档与 asset 的 durable 归属关系：
`document_asset_links`。它不知道 asset 是 raster image、SVG 还是未来其他明确媒体，也不负责
ingress、内容验证或 materialization。

`document-image-assets` 与 `document-svg-assets` 作为 sibling use cases 各自完成媒体接管，随后
调用这里的窄 `DocumentAssetOwnershipPort`。共享 ownership 避免两种媒体重复读写关系表，同时
不会演变成包含 admission、存储和渲染的全局 media manager。

`releaseDocumentAssetOwnership` 只解除指定 document ID 与 asset IDs 的关系，可以重复执行。
调用方必须先提交自己的可达性变更并保留待释放记录，以支持中断后的重试。
该操作不直接删除资产或文件；其他文档、项目、对话的引用及现有物理 GC 规则保持不变。
