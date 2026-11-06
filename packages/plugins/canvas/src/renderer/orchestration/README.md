# Canvas 表面装配

这里连接正式 feature、kernel 和 Host 端口，不持有第二份文档或交互状态。文档、草稿、连线、布局及选择仍由各 feature 的公开能力拥有；样式和业务计算继续由相应 functions 完成。

`createCanvasSurface` 是唯一组合根。装配阶段按原顺序执行：局部 session 与交互能力、异步 kernel、正文采样与导航、编辑/创建草稿、选择/打开及只读订阅、DOM/显示/Host 订阅、显示投影、视口命令、键盘命令，最后打开文档。不能把后续 DOM 安装提前到 kernel 创建的等待之前，也不能给装配步骤增加异步等待。

- `createCanvasSurfaceSession` 只创建文档 session、各 feature 能力和局部表面状态。
- `createCanvasSurfaceRendering` 连接同一 kernel 的 raster、可见内容刷新和正文导航。
- `createCanvasSurfaceDraftEditing` 统一文字草稿、正文编辑与拖动的保存边界；`createCanvasSurfaceSelection` 处理切换/打开与连线协作，`createCanvasSurfaceCreation` 组织新卡和树节点创建。
- `installCanvasSurfaceBindings` 安装已有 DOM/显示投影、剪贴板、保存及历史恢复入口，返回各自的清理句柄。
- `createCanvasSurfaceIntentHandler` 将 kernel 手势意图送到正式文档能力。初始化微任务中的 `render-status` 由组合根立即消费，此时后续编辑能力尚未安装。
- `createCanvasSurfacePresentation` 只产生惰性的 Vue 只读投影；`createCanvasSurfaceCommands` 和 `createCanvasSurfaceOperations` 组织键盘/工具栏触发的跨能力流程。
- `createCanvasSurfaceFacade` 只暴露页面合同；`createCanvasSurfaceDisposal` 显式保持关闭顺序，先停交互与订阅，再结束编辑，最后释放 raster/kernel。

草稿保存后的 reveal 和树创建使用延迟读取的 viewport 引用；创建能力时不会提前读取尚未装配的 viewport。依赖类型放在本层 `definitions`，通过明确返回值连接，不能用未初始化字段、断言或空对象 fallback 绕过初始化约束。各阶段的引用只用于装配，不作为新的 store。

验证使用 Canvas 的 typecheck、lint、test、帧闭包门禁以及 renderer/render-worker 构建。正文保存、历史恢复、选择/打开、视口和主题投影由对应模块流程测试覆盖；真实图形像素和输入仍使用 kernel owner 文档中的 Electron probe。
