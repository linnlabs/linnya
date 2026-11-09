# 文档只读预览

本 domain 提供由内容 owner 决定的只读预览数据，不创建可写 Editor，也不读取插件表。App 组合层提供 Workspace 身份、文本快照、类型 provider 和文件缓存。Markdown provider 归 Markdown owner，Slides provider 归插件自己的 document hook；Canvas 等后续类型只实现同一可选 capability。

调用方传稳定 documentId、所在 projectId、宽度和像素比；Core 在读取前和每个异步结果返回前重新检查节点与项目，并在缓存命中及渲染/缓存写入后重验内容版本。删除返回 deleted，移动越界返回 outside_project（不含标题或正文），插件停用/缺失返回已有文本快照并标 plugin_unavailable。改名后身份不变。预览不展开引用，不会递归加载嵌套文档。

provider 的 getRevision 来自内容 owner 的真实版本。派生内容按 projectId、documentId、revision、宽度、DPR 缓存；缓存目录来自 Host 的工作区根，64MB LRU，可删除重建。UI 请求新版本时保留已有图片到请求完成，保存正文不等待封面。渲染最多两个并行任务、64个未完成请求；相同版本请求合并，过载返回 preview_unavailable，调用方稍后可重试。图片/正文都经过正式 schema 接纳。

磁盘条目JSON或schema损坏时删除该条并按未命中重建；文件不存在仍为未命中。权限、路径和其他磁盘错误继续上报，不能把存储故障当成缓存格式变化。

Backend 插件经 `@plugin/backend/documentPreview.createDocumentPreviewReader(db)` 建立只读 reader；Renderer 经 `@plugin/renderer/documentPreview.readDocumentPreview` 调用统一 `document-preview:read`。Host wrapper 不公开数据库或物理路径。IPC/磁盘 resolver/renderer shim/external 必须一起更新。

Markdown 返回正式 rootBlock JSON、图片派生字节与引用呈现；用户摘要不经过 Agent 文本投影。其内容 owner 的同一只读 renderer 供封面与详情使用，见 [Markdown preview](../markdown/features/document-preview/README.md)。Slides 第一页复用正式 Hidden Worker 页面光栅化管线，不写会话文件。`DocumentTypeContribution.readonlyPreviewComponent` 是详情档的可选增强，由内容 owner 懒贡献，接收 documentId/projectId；只在用户展开时挂载，不能让远景为每张卡挂一个实时 surface。Slides 详情复用插件的只读分页组件，离开即释放单页位图，Markdown 详情继续走标准只读 DOM。

业务验证覆盖稳定身份、改名、软删除、越界、停用快照、渲染中移动、版本失效、缓存复用、并发合并和有界队列。真实 Electron 的冷封面耗时与跨平台视觉属于原生验证，不能由纯函数计时替代。

封面内容可声明 `overview: thumbnail`，表示远景仍适合保留缩略图；未声明时使用标题身份。该偏好由内容 owner 提供，消费者不能按插件 ID 或是否存在摘要图片猜测。

Renderer 的近景详情通过 `mountDocumentPreview` 挂到调用方 DOM 容器，使用 App 的唯一 document-preview workflow；接收 mode、widthPx 与 onReady，并可传 AbortSignal，返回独立 disposer。该本地能力不经 IPC，不开放可写文档会话，调用方退出或换目标必须取消并释放。Composer 仍封面后展开，文档卡可 detailOnly 直开；只有聚焦项应挂载详情。
