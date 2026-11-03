# 文档只读预览

本 domain 提供静态封面加文字的只读预览，不创建可写 Editor，也不读取插件表。App 组合层提供 Workspace 身份、文本快照、类型 provider 和文件缓存。Markdown provider 归 Markdown owner，Slides provider 归插件自己的 document hook；Canvas 等后续类型只实现同一可选 capability。

调用方传稳定 documentId、所在 projectId、宽度和像素比；Core 在读取前和每个异步结果返回前重新检查节点与项目。删除返回 deleted，移动越界返回 outside_project（不含标题或正文），插件停用/缺失返回已有文本快照并标 plugin_unavailable。改名后身份不变。预览不展开引用，不会递归加载嵌套文档。

provider 的 getRevision 来自内容 owner 的真实版本。派生图片按 documentId、revision、宽度、DPR 缓存；缓存目录来自 Host 的工作区根，64MB LRU，可删除重建。UI 请求新版本时保留已有图片到请求完成，保存正文不等待封面。渲染最多两个并行任务、64个未完成请求；相同版本请求合并，过载返回 preview_unavailable，调用方稍后可重试。图片/正文都经过正式 schema 接纳。

Backend 插件经 `@plugin/backend/documentPreview.createDocumentPreviewReader(db)` 建立只读 reader；Renderer 经 `@plugin/renderer/documentPreview.readDocumentPreview` 调用统一 `document-preview:read`。Host wrapper 不公开数据库或物理路径。IPC/磁盘 resolver/renderer shim/external 必须一起更新。

Markdown 的封面是无活动 HTML 的文字摘要 SVG，完整 Markdown 详情由标准只读 renderer 消费；它不是完整正文截图。Slides 第一页复用正式 Hidden Worker 页面光栅化管线，不写会话文件。详情组件是文档类型的可选增强，不能让远景为每张卡挂一个实时 surface。

业务验证覆盖稳定身份、改名、软删除、越界、停用快照、渲染中移动、版本失效、缓存复用、并发合并和有界队列。真实 Electron 的冷封面耗时与跨平台视觉属于原生验证，不能由纯函数计时替代。

封面内容可声明 `overview: thumbnail`，表示远景仍适合保留缩略图；未声明时使用标题身份。该偏好由内容 owner 提供，消费者不能按插件 ID 或是否存在摘要图片猜测。
