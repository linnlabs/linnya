# 通用文档只读预览装配

本 workflow 是 App 的唯一文档预览 UI、身份读取与订阅生命周期装配。它消费通用 documentReferences/documentPreview
SDK、当前导航项目和文档类型可选 readonlyPreviewComponent，不解释插件正文 DTO，不创建可写 file
session。

Composer 的 Workspace 引用 wrapper 只负责从自己的 metadata 解析稳定目标；封面→展开沿用同一组件。Canvas 等 Renderer 消费者通过
`@plugin/renderer/documentPreview.mountDocumentPreviewDetail`
直开 detailOnly，Markdown 使用同源 portable 只读 DOM，Slides 使用类型贡献的只读分页。只读正文不装 NodeView，内部链接不导航或弹第二层预览。

`createDocumentPreviewController`
统一管理 Workspace 与插件可用性订阅，所有异步读取前后核对当前项目。范围或插件状态变化立即撤下旧详情；关闭后订阅释放，迟到响应不会写回。派生 UI 状态通过 feature
store 同步持有，store 不发请求或执行规则。

挂载端口接受可信 Renderer
DOM、documentId/projectId 和可选 AbortSignal；DOM 与 signal 不经过 IPC。Host 在懒 import 前后再次解析目标范围，每个容器有独立的挂载所有权。abort 可在 import 或异步类型组件未完成时关闭；旧请求返回的 disposer 只清理自己的 VNode，不会卸载后来目标。正常卸载还释放当前单页位图、DOM 和订阅。

布局 class 使用 readonly-document-preview 命名空间与既有 Markdown 全局样式，不为消费者增加未声明 scopedCSS。Canvas 视口、相机、卡片选区与近景判定属于消费者，不进入本 workflow。

Markdown 详情的模块加载与 DOM 转换拥有独立生命周期，期间显示“正在加载详情”，失败有明确状态，关闭或换范围后的迟到转换不写 DOM。真实 DOM 业务测试先准备正式解析依赖再驱动 UI，不把 Vitest 首次转译队列计入交互断言；延迟模块与取消用受控 Promise 和真实解析器单独验证。生产冷载耗时仍需在正式 Renderer 产物测量，不能用该业务测试冒充速度达标。
