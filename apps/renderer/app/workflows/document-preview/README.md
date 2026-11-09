# 通用文档只读预览装配

本 workflow 拥有用户预览的读取、范围订阅、悬停展开、恢复和打开动作。超级标签浮层、Composer 引用和 Canvas 近景都挂载这里；消费者只负责定位与生命周期，不再自己生成摘要、正文或展开按钮。

`@linnya/document-preview` 拥有唯一的标题、类型图标、间距与正文表面。Markdown 由 `@linnya/markdown-document-core/workspace-preview` 根据正式 Workspace JSON 呈现，包括图片、图表、公式与引用编号；不再读取给 Agent 的 Markdown 文本。插件类型仍可提供只读详情组件，共用标题与正文容器。只读正文不装编辑 NodeView，内部链接不导航或递归展开。

`mountDocumentPreview({ element, documentId, projectId, mode?, widthPx?, signal?, onReady? })` 是 Renderer 本地挂载口，DOM 与 signal 不过 IPC。默认 first-screen 显示真实首屏，进入预览或点展开后显示全文；detail 模式用于已聚焦的近景。正文统一 14px 并按容器宽度换行，Canvas 传未经过相机缩放的卡宽。正文呈现完成通知 onReady，Canvas 据此撤下位图。

Host 在懒加载前后核对当前项目，每个容器有独立所有权。当前目标、内文标签目标或插件状态变化会撤下并刷新旧内容。关闭、取消或切换范围释放 DOM、图表与订阅，迟到转换不能写入新预览。旧 disposer 不会卸载同容器后来挂载的目标。

Canvas 相机、卡片选区与近景判定属于消费者；静态光栅与隐藏导出 worker 直接使用同一个 document-preview 表面，按卡高只构建可见前缀。首屏与全文共享字号、宽度、间距和内容规则。实际冷载与帧耗时必须在正式产物测量，业务测试不能冒充性能验收。
