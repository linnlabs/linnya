# 文档超级标签交互

公开 `createDocumentReferenceExtension` 继承 portable core 的同名 inline
atom，仅装配 Host
NodeView 与 @ 候选。持久属性仍只有 documentId/referenceId，复制的出现位置分配新 referenceId；标题、路径与项目可用状态通过通用
`@plugin/renderer/documentReferences` 查询，不复制到正文属性。

@ 候选限定当前项目，代码/公式与输入法组合不触发提交；键盘上下选择、Enter 插入、Escape 关闭。标签支持 Tab/Enter 按稳定ID打开，目标删除/越界分别显示状态；插件不可用保留身份，点击时显示用户可主动触发的“启用插件”或“前往插件商店”动作。App 通过
`DocumentTypePresentationPort`
注入现有插件生命周期与导航，Editor 不读取插件 store。候选图标取 document type
contribution，排序复用 Workspace 的 last_opened_at/updated_at 正式事实。Workspace
rename/move/delete/transfer 与插件启停事件刷新当前标题和可用状态，旧异步响应不能覆盖新的读取。

悬停先显示只读图片与摘要，进入预览浮层后自动展开 provider 的只读详情，也保留显式展开按钮。Markdown 展开只生成 portable
DOM，不装 NodeView、不递归请求引用文档；有 readonlyPreviewComponent 的类型改为懒挂载它自己的只读详情，离开后立即卸载。离开或销毁后不会打开晚到的预览，详情异步返回后也会释放。窗口内的候选和预览采用 Renderer
UI token；图标复用公开 DocumentIcon。

独立正文消费者通过 Host 工厂的同名 extension
override 装配。Workspace 的正式注册点是
`core/extensionRegistry.ts`，后端 schema、同事务保存索引、可信 Markdown 读取与 Pending 接受/拒绝/部分决策已同步接入。共享 Markdown
serializer 调用 NodeSpec 的严格身份投影，缺少当前 presentation 时明确失败，不把通用占位字当成 Markdown 链接。生产 schema
conformance 与真实 parser→Revision→节点物化共同验收。

预览浮层挂载后由已有Floating
UI的fixed定位、flip/shift与size约束管理，autoUpdate跟随异步封面/详情增高、滚动、视口改变与宿主transform移动。可用宽高与既有尺寸上限共同约束面板，内容在面板内滚动，不能让恢复、展开或只读翻页操作落到屏幕外。关闭先释放观察/RAF与在途定位，再交还焦点边界和详情，晚到结果不能修改旧浮层。定位能力只属于此NodeView，无产品类型特判或全局注册。参考官方[尺寸约束](https://floating-ui.com/docs/size)和[自动更新生命周期](https://floating-ui.com/docs/autoupdate)。
