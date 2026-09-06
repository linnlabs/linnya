# Auto Refresh

Mindmap 文档采用版本化存储。Agent 或其它进程写入新版本后，renderer 通过 document mutation port 调用统一刷新服务，重新读取当前文档并保留视口状态。

## 责任

- 接收刷新请求并按文档合并重复请求。
- 等待当前文档会话就绪，再读取新版本。
- 将外部文档变化应用到现有 MindMap 实例。
- 维持刷新期间的视口和 readiness 状态。

这个 feature 不解释节点语义，也不维护节点外部元数据；刷新只围绕 Mindmap 文档版本进行。
