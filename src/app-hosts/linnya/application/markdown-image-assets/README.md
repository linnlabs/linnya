# Markdown 图片资产编排

该入口负责 Markdown 的会话图片准入、正文/Pending/历史归属与 Renderer 的资产读取。来源只接受当前 conversation 工作目录内的真实 PNG、JPEG、WebP；调用既有 physical reader、目录准入与 managed-image-ingress，不维护另一份图片存储。

与即时采用图片的 `document-image-assets` 不同，文件写入先异步准备资产，然后在正文、Pending 和工具回执的同一 SQLite 事务里取得归属。注册成功但整批失败的无归属资产交由既有 GC 回收，不能直接删除可能被其他文档共享的字节。

`createMarkdownDocumentStore` 向 Markdown 注册数据库作用域的窄 ownership port。领域仅交付仍可恢复的 asset IDs，不读取 Asset 表；Host 复用 `document-assets` 的归属 adapter。所有生产写入入口必须使用此工厂，或在数据库初始化后绑定该 port。正文版本、块历史与 Pending 快照共同决定保留集；仅存在于已拒绝 Pending 的资产解除本入口的归属。文档生命周期继续复用统一所有权释放链。

Renderer 使用 `media://load/asset-image/` 加资产 ID 的 base64url 编码。协议按账本解析当前位置，要求仍有文档归属，并经 verified-image 检查内容、哈希与存储边界；不向 Agent 投影本地路径。协议不能读取会话路径或任意文件。新 SVG 准入与按引用读取像素不在本入口范围内。

业务验证见 `__tests__/markdownImageLifecycle.integration.test.ts`：真实文件、真实 ingress 与 SQLite 覆盖源文件删除、共享资产、Pending 决策、历史保留、来源越界和事务回滚。
