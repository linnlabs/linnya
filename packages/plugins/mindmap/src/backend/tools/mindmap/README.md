# Workspace MindMap Tool

这里是后端 Workspace 侧的 Mindmap 文本大纲工具实现目录。

## 工具清单

### `mindmap_create_node`

- 文件：`MindMapCreateNodeTool.ts`
- 作用：在指定父节点下追加一个或多个文本节点。
- 写入位置：`mindmap_versions.content_json`。
- 并发策略：读取最新版本后，通过 per-document 写入队列和 CAS 保存新版本。
- 参数：`document_id`、`parent_node_ref` 或 `parent_node_id`、`topic`，也支持 `operations` 批量新增。

工具只负责结构编辑，不解释节点的研究状态，也不维护证据或置信度。

## 共享逻辑

- `mindmapToolUtils.ts`：文档加载、节点引用解析、版本保存和变更汇总。
- `read/mindmapNodeRefViewBuilder.ts`：把节点树转换为带短引用的缩进文本，供 Agent 精确定位节点。
- `mindmapWriteQueue.ts`：把同一文档的并发读改写串行化。

## 边界

- 工具只做数据层写入，不负责 UI 呈现。
- 节点的公开语义只有文本、层级和编辑器已有的结构属性。
- 假设、证据、置信度等研究信息由独立的研究 deck 承载。
