# 用户文档预览

本包是超级标签、对话文档引用和画布共用的用户预览呈现。内容来自正式
`DocumentPreviewResult`，标题、状态、类型图标、紧凑排版与首屏范围只定义一次。Canvas 消费本包，不维护自己的 Markdown 解析、字号、图片删减或摘要图。Workspace
Markdown 的块呈现归
`markdown-document-core/workspace-preview`；其他类型继续消费其正式封面及 Host 类型贡献的交互详情。

调用方显式提供 Document、逻辑容器宽度、主题、AbortSignal 与可选首屏高度。宽度不包含相机缩放或 DPR；正文默认 14px、按可用宽度换行。主窗口与隐藏 worker 显式导入同一个
`style.css`，不注入另一份样式。调用方负责身份和项目范围、数据读取、订阅与打开文档的授权；本包不接触 Host、数据库或可写编辑会话。

`createDocumentPreviewSurface`
返回 DOM 和独立 disposer；字体/图片的最终绘制屏障由实际绘制宿主完成。live 消费者换目标或卸载时释放；光栅消费者在 paint 结束或失败时调用
`disposeDocumentPreviewSurface`。自定义交互详情通过 `externalBody`
共用标题与正文槽，不能再在消费方复制标题/正文外观。

表面显式持有明暗主题，加载 Renderer
UI 正式语义 token。Canvas 不对文档表面额外着墨或覆盖标题颜色；纸张材质属于外层。真实 Workspace 根节点的布局隔离由内容 owner 负责，Host 编辑器的全局留白、图注和字号不得污染预览。

业务回归在 Host
workflow 的首屏/展开/恢复/范围生命周期、Canvas 文档表面的前后台一致性，以及
`dev/probes/run-preview-parity-probe.mjs`
的真实 Electron 图像对照中完成；本包不复制一套只断言 DOM 字段的测试。
