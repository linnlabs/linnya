# 独立 Markdown 编辑表面

本 feature 拥有可嵌入文档的 Markdown 表面与正文转换。外层文档拥有身份、内容版本、草稿保存和撤销归组；表面不读取 Workspace file store，也不启动 Markdown 文档会话。

插件通过 `@plugin/renderer/embeddedMarkdownEditor` 的 `createEmbeddedMarkdownEditor` 创建一个绑定容器的句柄；输入/输出都是 `@app/schemas` 的 JsonValue。正文由生产 ProseMirror schema 严格校验，未知节点/marks/attrs 不会被静默丢弃。替换失败保留当前内容，程序替换不触发用户更新回调。外层关闭时必须 destroy 句柄。

正文扩展由 Editor 域内 `shared/markdown-content` 唯一提供，独立 Markdown 文件与嵌入表面共用标准 doc/paragraph 模型。它不使用 Workspace rootBlock 身份或 Pending revision 协议。额外的通用正文能力先进入该 owner，不允许插件任意替换编辑器扩展。

`parseEmbeddedMarkdown` / `serializeEmbeddedMarkdown` 在同一组扩展上转换，不创建 Editor 或挂载 DOM；它们是 Renderer 门面，不应从 Backend 深导入。Backend 消费者需要自己的公开适配与 Node-safe 转换入口。

验证使用 `__tests__/embeddedMarkdown.integration.test.ts`，覆盖独立表面互不污染、真实 Markdown 往返、非法替换保护、只读与编辑切换。Host facade 的 provider、浏览器 protocol shim 与外部模块映射必须一起维护。
