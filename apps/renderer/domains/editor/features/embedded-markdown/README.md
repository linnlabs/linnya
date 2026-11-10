# 独立 Markdown 编辑表面

本 feature 拥有可嵌入文档的 Markdown 表面与正文转换。外层文档拥有身份、内容版本、草稿保存和撤销归组；表面不读取 Workspace file store，也不启动 Markdown 文档会话。

插件通过 `@plugin/renderer/embeddedMarkdownEditor` 的 `createEmbeddedMarkdownEditor` 创建一个绑定容器的句柄；输入/输出都是 `@app/schemas` 的 JsonValue。正文由生产 ProseMirror schema 严格校验，未知节点/marks/attrs 不会被静默丢弃。替换失败保留当前内容，程序替换不触发用户更新回调。外层关闭时必须 destroy 句柄。

`onBlur`表示焦点离开整个挂载容器；标签等可聚焦NodeView之间的内部焦点转移不结束编辑。Host通过容器focusout观察这条边界，避免先清除外层草稿、卸载节点而吞掉标签的点击；从内部控件再离开容器仍会通知保存，销毁时先移除此通知。

正文扩展由 `@linnya/markdown-document-core` 唯一提供，独立 Markdown 文件、嵌入表面与后台 Worker 共用标准 doc/paragraph 模型。嵌入表面使用相同的纯内容呈现，独立文件编辑器只在域内工厂补代码与 HTML NodeView。它不使用 Workspace rootBlock 身份或 Pending revision 协议。额外的通用正文能力先进入该 owner，不允许插件任意替换编辑器扩展。

`parseEmbeddedMarkdown` / `serializeEmbeddedMarkdown` 在同一组扩展上转换，不创建 Editor 或挂载 DOM；Renderer 门面只转发 portable core；Backend 消费者直接消费该公开包，不能深导入 Renderer。

验证使用 `__tests__/embeddedMarkdown.integration.test.ts`，覆盖独立表面互不污染、真实 Markdown 往返、非法替换保护、只读与编辑切换。Host facade 的 provider、浏览器 protocol shim 与外部模块映射必须一起维护。

异步插图可调用 `captureInsertion()` 保存一个随正文事务映射的插入锚点，准备完成后一次插入结构化节点。替换正文或销毁表面会取消未完成锚点，不能把迟到的图片插入下一份文档。`insertContent` 与锚点插入都先做同源严格 schema 校验。`resolveImageSource` 只把持久 src 投影为临时可显示地址，NodeView 不改 JSON；图片身份继续由调用方的资产归属与提交事务拥有。

外层视口可通过可选`onNavigate`接收正文内捏合/Cmd滚轮与空格/中键拖动意图。普通滚动停留在正文内，拖动不转移焦点或结束编辑。Space正常输入立即发生；仅在真实拖动达到3屏幕像素时，把这次按住Space产生的事务步骤映射穿过后续输入后反转，不调用全局undo、不替换整个文档、不延迟键盘输入。重复Space、替换选区和Markdown输入规则属于该次输入；平移开始后，本次仍按住的Space默认输入被取消，直到Space松开，先松鼠标也不恢复重复输入。未达到拖动阈值的长按仍正常输入；IME开始、切卡、只读切换与销毁会释放临时手势。

按键/指针状态参考[tldraw input handling](https://tldraw.dev/sdk-features/input-handling)，正文内部使用ProseMirror公开Step/Mapping处理位置，插件合同不暴露Editor或ProseMirror对象。
