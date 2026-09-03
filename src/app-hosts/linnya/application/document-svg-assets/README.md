# Document SVG assets

该 application use case 把 admission 后的 canonical SVG 接管为文档拥有的内容寻址 asset。
它组合 Asset domain 的 `managed-svg-asset` 与共享 `document_asset_links` ownership，但不解析
SVG、不认识 Slides DeckSpec，也不把底层路径或 SQLite 异常暴露给插件。

调用方必须同时提交 canonical SVG 与其 SHA-256；Host 会在发布前复核两者一致。读取必须先证明
当前文档 ownership，再从当前 store 复核 bytes。对外失败统一为
`DocumentSvgAssetRuntimeError.failure`，插件不能根据物理路径或底层错误文案猜分类。
