# Workspace MindMap Tools

> 中文说明：
> - 这里是后端 Workspace 侧的 MindMap 工具实现目录
> - 这些工具直接操作 `mindmap_versions` 或 `mindmap_evidence`，并由前端 AutoRefresh 触发刷新

---

## 1) 工具清单

### 1.1 `mindmap_tag_node`

- 文件：`MindMapTagNodeTool.ts`
- 作用：给节点写入 `tagging.status / tagging.confidence / tagging.labels`
- 写入位置：`mindmap_versions.content_json`
- 并发策略：工具自动读取最新版本并在保存时做 CAS（乐观锁），避免并发覆盖
- 规则约束：
  - 节点类型来自 `tagging.labels.kind`
  - 假设：允许 status + confidence
  - 结论：只允许 confidence
  - 问题：不允许 status / confidence
  - labels 仅允许包含 `kind`

### 1.2 `mindmap_attach_evidence`

- 文件：`MindMapAttachEvidenceTool.ts`
- 作用：给节点挂知识库证据（写入卫星表）
- 写入位置：`mindmap_evidence`
- 并发策略：不需要版本锁（不改 `mindmap_versions`）
- **协议收敛（V1）**：
  - 模型只需输出 `node_ref`（节点短引用）+ `refs`（知识库 `[@XXXXXX]` 引用列表）
  - 禁止模型传 `snippet/title/sourceId` 等字段，杜绝幻觉编造
  - 工具端通过 `@plugin/backend/citationSourceRuntime` 获取 Host 已接纳的来源，只接受其中的 Knowledge `(docId, blockId)` 身份
  - 从知识库 SoT 确定性回填 `snippet`（截断 500 单位）、`title`（文档名）、`sourceId`（`docId#blockId`）
  - `sourceType` 固定为 `knowledge_base`
  - tool 输出 `results[].citation`，字段与统一 CitationSnapshot 核心语义对齐（`sourceType/sourceId/title/snippet/url/authors/date/containerTitle/note`），并补充 `docId/blockId`
  - 中文备注（重要约束）：KB 的 `[@ref]` **不会写入** `mindmap_evidence.ref`（该字段在同一 mindmap 文档下要求唯一）；引用外观仅用于 tool_output 展示，落库定位以 `sourceId=docId#blockId` 为准

### 1.3 `mindmap_create_node`

- 文件：`MindMapCreateNodeTool.ts`
- 作用：在指定父节点下新建子节点（追加到 children 末尾）
- 写入位置：`mindmap_versions.content_json`
- 并发策略：工具自动读取最新版本并在保存时做 CAS（乐观锁），与 `mindmap_tag_node` 一致
- 语义对齐：
  - 父节点若折叠（`expanded === false`），会先设为展开（`expanded = true`）
  - 新节点默认只写入 `{ id, topic }`
- **可选 `kind` 参数**：创建节点时指定节点语义类型（hypothesis/question/conclusion）
  - 传入 `kind` 后，节点会自动初始化 `tagging.labels.kind`
  - 这样后续可以直接用 `mindmap_tag_node` 设置 status/confidence，无需额外一步
  - 不传 `kind` 则节点无类型，无法设置 status/confidence（需要先用 `mindmap_tag_node` 设置 kind）

---

## 2) 共享逻辑

- `mindmapToolUtils.ts`
  - 文档加载与版本校验
  - nodeRef 解析与节点查找
  - 保存新版本与变更汇总

- `taggingRules.ts`
  - 节点类型/状态/置信度的规则定义
  - 写入合法性校验与规范化
  - 前后端规则保持一致（后端侧版本）

---

## 3) 调试与定位

建议排查路径：

1) 工具执行失败：先看参数合法性（document_id/node_ref）
2) 规则失败：检查节点 `tagging.labels.kind` 与写入字段是否匹配
3) 刷新失败：确认 `autoRefresh` 是否收到了 tool 事件

---

## 4) 约束与边界

- 工具只做“数据层写入”，不负责 UI 呈现
- 禁止在工具内做 DOM 或前端交互逻辑
- 不做“防御性修复”：规则不满足就直接报错
