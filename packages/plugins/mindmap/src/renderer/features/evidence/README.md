## Evidence（引用）Feature README（当前实现）

> 中文说明：
> - 本 README 说明 evidence（引用）在 MindMap 中**已经落地**的：数据模型、前后端接口、以及与节点操作的一致性机制。
> - 这是 feature 级文档入口；不要再在 `docs/` 里为 evidence 单独堆“过程性方案稿”。
>
> 最后更新：2026-09-01

---

## 1) 核心目标与架构选择

- **目标**：为 MindMap 节点提供“可挂载引用/证据”的能力，并保持与编辑器 Citation 的语义对齐（但不强耦合 editor 域内部实现）。
- **架构**：Spine + Satellite
  - **Spine（骨架）**：`mindmap_versions.content_json` 存储节点树结构与布局等内容（MindMapData）。
  - **Satellite（卫星表）**：`mindmap_evidence` 表存储引用条目（独立 CRUD，不触发 mindmap version 变更）。

---

## 2) 数据与接口落点（代码事实）

### 2.1 后端（SQLite / Service / IPC）

- **Schema**：`src/features/workspace/infrastructure/sqlite/documents/mindmap_document/schemas/blocks/evidence.schema.ts`
- **Service**：`src/features/workspace/infrastructure/sqlite/documents/mindmap_document/services/blocks/evidence.service.ts`
- **IPC handler**：`src/electron-main/ipc/handlers/workspace/documents/mindmap_document/evidence-ipc.ts`
- **Preload allowlist**：`src/electron-main/preload/valid-channels.ts`
- **关键字段口径**：
  - `source_id`：`knowledge_base=docId#blockId`、`web=url`、`manual/conversation_turn=uuid`
  - `container_title`：出处/容器标题（期刊名、书名、网站名）
  - `note`：仅用于“证据与节点关联理由”等备注语义，不承载出处字段

### 2.2 前端（Gateway / Store / UI）

- **Gateway**：`apps/renderer/shared/ipc/mindMapEvidenceGateway.ts`
- **Store**：`packages/plugins/mindmap/src/renderer/features/evidence/domain/store/evidenceStore.ts`
- **安装入口（副作用编排）**：`packages/plugins/mindmap/src/renderer/features/evidence/services/installEvidenceFeature.ts`
- **一致性同步插件**：`packages/plugins/mindmap/src/renderer/features/evidence/domain/sync/evidenceSyncPlugin.ts`
- **UI**：
  - 节点内引用展示/展开（Node addon）：`packages/plugins/mindmap/src/renderer/features/evidence/ui/ReferenceAddon.vue`
  - 插入引用面板：`packages/plugins/mindmap/src/renderer/features/evidence/ui/ReferenceInsertPanel.vue`

Web/Manual 表单是 Host `@plugin/renderer/referenceRuntime` 的 Citation UI 合同消费者：Mindmap 通过 port 获取
表单交互与校验，`.web-manual-citation-form` 样式由 Host 的 Editor Citation 公共合同唯一装载。插件不得 deep
import Editor 源码、复制该 CSS，或覆盖这套公共 class；基础 Radio/Panel 等控件仍直接依赖
`@linnya/renderer-ui`。

### 2.3 UI 触发入口与渲染方式（关键约束）

- **节点内展开/收起**：统一走事件 `ui:toggleReferenceInNode`
  - 触发方（示例）：
    - `features/tagging/ui/TaggingBadgeAddon.vue`（点击 Refuted 感叹号）
    - `features/evidence/ui/ReferenceAddon.vue`（点击折叠/展开按钮）
  - 响应方：`services/installEvidenceFeature.ts` 监听该事件并更新 store + 拉取列表
- **渲染基础设施**：Evidence 作为 Node addon 被统一挂载
  - Host：`presentation/ui/NodeAddonsHost.vue`（遍历 `.mm-topic-addons[data-nodeid]` 并 Teleport）
  - Registry：`presentation/addons/nodeAddonsRegistry.ts`
  - Evidence 注册点：`services/installEvidenceFeature.ts`（`registry.register({ id: 'evidence:reference', ... })`）

### 2.4 刷新与“展开态保持”（AutoRefresh 场景）

> 中文说明：MindMap 的 AutoRefresh 是“全量 reload + 状态恢复”，Evidence 必须保证用户视觉上是“增量更新”。

- **展开态归属**：`evidenceStore.expandedByNodeId`（按 nodeId 存储，避免组件内部 ref 丢失/互相覆盖）
- **缓存重置策略（根因级约束）**：在 `lifecycle:documentReady` 时区分 switch/reload
  - switch（切换文档）：`resetCache()`（避免旧文档缓存污染新文档）
  - reload（同一 documentId）：**禁止 resetCache**（否则会把展开态清空，表现为“刷新把引用关回去”）
  - 实现：`services/installEvidenceFeature.ts`
- **reload 数据更新**：reload 后在下一次 `lifecycle:structureReady` 对“已展开节点”逐个 `loadEvidences(nodeId)`，确保列表内容是最新的（卫星表写入不会触发 spine 版本变化）。

### 2.5 视觉稳定性：避免“误折叠”的坑（已修复）

> 根因：reload 期间 count 可能短暂处于 unknown/loading，UI 计算属性会退化成 0；若用 `count===0` 作为折叠条件，会误把用户手动展开的节点折叠回去。

- **硬规则**：只有当 `countKnown === true` 且 `count === 0` 时，才允许自动折叠。
- 修复落点：`ui/ReferenceAddon.vue`（watch 条件收敛为 `[countKnown, count, expanded]`）。

---

## 3) 与节点操作的一致性（删除/复制/剪切/撤销）

### 3.1 一致性机制（低耦合扩展点）

- evidence 不通过“右键/快捷键入口偷接”来维护一致性；
- 统一通过：
  - **before hooks**：`packages/plugins/mindmap/src/renderer/domain/core/hooks.ts`
  - **operation bus**：`mind.bus.fire('operation', ...)`
  - **feature 内聚同步插件**：`packages/plugins/mindmap/src/renderer/features/evidence/domain/sync/evidenceSyncPlugin.ts`

### 3.2 关键行为（当前实现）

- **删除节点**：在 `before.removeNodes` 中对待删除节点及其子孙收集 nodeIds，并对 evidence 做 soft delete（支持 undo）。
- **复制/粘贴节点**：复制会生成新 nodeId；通过 operation 事件配对 oldId/newId 映射后 clone evidence。
- **剪切/粘贴节点**：同步逻辑识别剪切语义并将 evidence move 到目标节点。
- **撤销/重做**：MindMap undo/redo 为快照重建（`mind.refresh(prevData)`），因此 evidence 侧需要“软删除 + 恢复”策略避免数据永久丢失。

> 补充（常见坑）：selection 可能把 root 节点混入待删除列表；同步插件必须对齐核心删除逻辑过滤 root，
> 否则会把整棵树的 evidence 软删除。实现见 `domain/sync/evidenceSyncPlugin.ts`（`unionTopics` + 顶层节点过滤）。
