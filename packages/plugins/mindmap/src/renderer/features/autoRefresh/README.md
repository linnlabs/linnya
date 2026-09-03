## AutoRefresh Feature（Workspace Mutation 驱动的 MindMap 自动刷新）

> 中文说明：
> - 本 README 描述的是 `packages/plugins/mindmap/src/renderer/features/autoRefresh/` 的实现与开发规范。
> - AutoRefresh 的目标是：当后端 MindMap 文档产生新版本后，若用户正在打开该 MindMap，前端能在**不打断输入/拖拽/框选/pan**的前提下，可靠刷新到最新版本，并尽量恢复 viewport/selection/专注模式（focus）。
> - `mindmap_attach_evidence` 只写证据卫星表，不产生文档版本；它通过证据专用增量触发器刷新 count/list。
>
> 参考：
> - `docs/README.md`（MindMap 总导航，含 AI 能力指南）

---

## 1) 目标与非目标

### 1.1 目标（必须）

- **统一刷新入口**：外部只调用 `requestRefresh()`（触发方不直接 `open()`）。
- **合并/防抖**：同一 `documentId` 的连续工具调用只触发一次刷新（默认防抖窗口 300ms）。
- **交互门禁**：输入/拖拽/框选/pan/moveMode 时延迟刷新，交互结束再执行。
- **快照恢复**：刷新后尽量恢复 viewport/selection/专注模式（节点仍存在则恢复，否则放弃恢复且不猜测）。
- **可观测**：提供统一日志前缀与可选 debug 开关。

### 1.2 非目标（刻意不做）

- **不做轮询常态化**：轮询仅可作为临时兜底；主路径应是 workspace mutation bus。
- **不发明第二条刷新链路**：刷新必须复用 file-manager 的 `mindmapHandler.open`（read → adapter.setDocumentSession → init/refresh）。
- **不修改 MindMap 数据**：AutoRefresh 只负责刷新编排，不做任何 nodeData patch。

---

## 2) 刷新触发

### 2.1 文档版本刷新

插件 renderer port 在收到当前打开文档匹配的 `workspace.document.updated(version)` 后调用：

- `requestRefresh({ documentId, reason: 'push:document_updated', versionNumber, requestedAt })`

触发条件：
- 事件 `nodeType` 与 MindMap 文档类型匹配；
- `documentId` 是当前打开的 MindMap；
- `mutationKind === 'version'`。

### 2.2 证据增量刷新

`mindmap_attach_evidence` 不产生文档版本，不能走全量文档刷新。对话工具卡主时间线仍通过 renderer tool refresh port 安装证据专用触发器：

- `useMindMapEvidenceRefreshTrigger({ toolName, toolArgs, toolResult, status, messageId, conversationId })`

它只识别 `mindmap_attach_evidence` 与历史别名 `workspace_mindmap_attach_evidence`，从工具结果的 `data.results[].nodeId` 中读取已挂证据的节点，刷新这些节点的 evidence count；若节点证据面板已展开，同时刷新 evidence list。

---

## 3) 架构：编排器 / 门禁 / 快照

### 3.1 编排器（单例）

文件：`services/mindMapAutoRefreshService.ts`

核心流程：

1. `requestRefresh(request)`：校验当前打开文档是否匹配 → 合并 pending → 设置防抖定时器
2. 防抖到期 `triggerRefresh(documentId)`：
   - `checkRefreshAllowedWithLog(mind)` 判定是否允许刷新
   - 若阻塞：`waitForInteractionEnd(..., callback)` 延迟执行
3. `executeRefresh(documentId)`：
   - `takeRefreshSnapshot()`
   - 调用 `mindmapHandler.open({ documentId, ... })` 走统一打开链路
   - 等待 `lifecycle:structureReady`（禁止用固定延时猜测 DOM 就绪）
   - `restoreRefreshSnapshot(snapshot)`

### 3.2 交互门禁

文件：`services/mindMapRefreshGate.ts`

阻塞条件（结构化返回 `GateBlockReason[]`）：
- `editing`：`mindmapStore.isEditingInput` 为真
- `dragging`：`mind.dragged` 非空
- `selecting`：`mind.selection.isAreaDragging === true`
- `panning`：`mind.dragMoveHelper.mousedown === true`
- `moveMode`：`mindmapStore.moveMode` 为真

### 3.3 快照与恢复

文件：`services/mindMapRefreshSnapshot.ts`

快照内容：
- viewport（x/y/scale）
- selection（nodeIds/currentNodeId）
- focusMode（isFocusMode/focusedNodeId/direction/tempDirection）

恢复原则：
- focusMode：若聚焦节点仍存在则恢复；否则放弃恢复（回到全图，不猜测替代节点）
- 节点仍存在：恢复 selection
- 不存在：清空 selection（禁止猜测替代节点）

补充说明（与当前实现一致）：
- AutoRefresh 不再强制恢复 viewport，而是交由 `mindmapStore` 的“锚点视口（anchor）”机制处理；
- 这样能避免“内容变化导致 root 基准移动”时的视图漂移。

---

## 4) 开发规范（强约束）

- **刷新链路唯一**：必须走 `mindmapHandler.open`（禁止绕开 adapter/store 直接 patch MindMapEngine）。
- **严禁打断交互**：门禁是硬红线；被阻塞必须延迟，不能“硬刷新”。
- **触发方只发请求**：文档版本刷新只调用 `requestRefresh()`；证据工具只刷新 evidence store 的 count/list。
- **只允许收敛，不允许散落**：刷新逻辑集中在本 feature；其他模块不要各写一套防抖/延迟。

---

## 5) 文件树（当前实现）

```text
features/autoRefresh/
├─ README.md                               # 本文件
├─ index.ts                                # 统一导出入口
├─ domain/
│  └─ types.ts                             # 类型定义（reason/gate/snapshot）
└─ services/
   ├─ installAutoRefreshFeature.ts         # 安装入口（documentReady 时清理 pending）
   ├─ mindMapEvidenceRefreshTrigger.ts     # attach_evidence 证据增量刷新触发器
   ├─ mindMapAutoRefreshService.ts         # 核心编排器（合并/防抖/执行）
   ├─ mindMapRefreshGate.ts                # 交互门禁（editing/drag/select/pan/moveMode）
   └─ mindMapRefreshSnapshot.ts            # viewport/selection/focusMode 快照与恢复
```

---

## 6) 调试与排查

- **开启调试**：在控制台执行 `window.__MM_AUTO_REFRESH_DEBUG__ = true`，或调用 `setAutoRefreshDebug(true)`。
- **日志前缀**：`[MindMapAutoRefresh]`
- **常见问题**：
  - “文档版本没刷新”：检查后端是否发布 `workspace.document.updated(version)`；检查当前打开文档是否匹配事件 `documentId`。
  - “挂证据后徽标没更新”：检查工具结果是否包含 attached 状态的 `data.results[].nodeId`；检查是否命中当前 `mindmapStore.currentDocumentId`。
  - “一直不刷新”：门禁阻塞（editing/dragging/selecting/panning/moveMode）；开启 debug 看 blockReasons。
