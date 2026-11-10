# 文档资产字节事实

`listDocumentAssetByteFacts` 只读取本连接中仍归属指定文档的资产 ID 与已登记的 size_bytes。缺失归属、缺失字节数或非法字节数明确失败，不能作为零字节绕过历史预算；不读取文件、不返回路径或 URI。

历史 owner 判断自身可达性，Host 通过 documentAssetOwnership facade 提供该事实，并在同一 SQLite 事务登记/释放精确归属。资源在其他文档中的归属不受当前文档历史裁剪影响。
