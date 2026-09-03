## Tagging Feature（节点打标呈现：Status / Confidence / Evidence 入口）

> 中文说明：
> - 本 README 描述的是 `packages/plugins/mindmap/src/renderer/features/tagging/` 的实现与开发规范。
> - Tagging 的定位是“**推理画布语义呈现**”：把后端工具写入 `NodeObj.tagging` 的状态，在前端稳定可视化展示，并提供 Refuted 的证据解释入口。
> - 本 feature **不负责写入 MindMap 版本**（写入由后端工具 + 前端自动刷新闭环完成）。
>
> 参考：
> - `docs/README.md`（MindMap 总导航，含 AI 能力指南）

---

## 1) 目标与非目标

### 1.1 目标（必须）

- **状态呈现**：读取 `NodeObj.tagging.status/confidence`，显示状态 pill + 置信度标识。
- **类型呈现**：读取 `NodeObj.tagging.labels.kind`，显示节点语义类型徽标（假设/问题/结论）。
- **解释入口**：当 `status === 'refuted'` 时显示红色感叹号；点击后触发 `ui:toggleReferenceInNode`，复用 Evidence addon 展开证据列表。
- **CSS 解耦**：将 `status/confidence` 注入 DOM data attribute（`data-tagging-status/data-tagging-confidence`），让视觉呈现尽量走 CSS，不把样式持久化写回 `NodeObj.style`。

### 1.2 非目标（刻意不做）

- **不做编辑工作流**：不做 pending/Accept/评阅流；不做“AI 修订”。
- **不做写入**：不在前端直接修改 `mindmap_versions`；写入由后端工具完成，前端只负责刷新后呈现。
- **不做证据面板新实现**：证据展示复用 `features/evidence`。

---

## 2) 数据契约（前后端一致性）

- **存储位置**：`NodeObj.tagging?: NodeTagging`（Spine：`mindmap_versions.content_json`）
- **推荐字段**：
  - `tagging.status?: string`（推荐：`open/verified/refuted/closed`，允许扩展）
  - `tagging.confidence?: string | number`（推荐：`high/medium/low`，允许扩展）
  - `tagging.labels?: Record<string, string | number | boolean>`
    - `tagging.labels.kind`：节点语义类型（手动/工具可写），推荐值：`hypothesis/question/conclusion`

注意：
- Tagging feature 负责在节点 addons 的“元信息栏”统一渲染：`labels.kind`（节点类型徽标）+ `status/confidence`（状态/置信度）+ Refuted 解释入口。

---

## 3) 架构与集成点

### 3.1 安装入口（MindMapView）

在 `packages/plugins/mindmap/src/renderer/ui/MindMapView.vue` 中安装：

- `installMindMapTaggingFeature(instance)`

### 3.2 渲染机制（NodeAddonsRegistry）

- Tagging UI 通过 `NodeAddonsRegistry.register()` 注册为 addon：`id='tagging:badge'`
- addon 组件：`ui/TaggingBadgeAddon.vue`
- 渲染容器：每个节点 `mm-topic` 内的 `.mm-topic-addons`（由 `shapeTpc()` 创建）

### 3.3 DOM 属性注入（CSS 驱动）

在 `lifecycle:structureReady` 时：
- 从 `mind.nodeData` 递归提取 `tagging` 缓存（store）
- 将 `status/confidence` 注入到对应的 `mm-node`：
  - `data-tagging-status="refuted|verified|..."`
  - `data-tagging-confidence="high|0.82|..."`

这些属性由 `styles/mindmap.css` 中的 Tagging 样式消费（如 refuted 灰+删除线等）。

---

## 4) 开发规范（强约束）

### 4.1 contracts 红线（必须遵守）

- **禁止 DOM 泄漏**：跨层 payload 只传 `nodeId/nodeIds`，禁止 `HTMLElement/Topic/domId/Event`。
- **Reflow 统一**：禁止 `mind.layout()` / `mind.linkDiv()`；只允许 `mind.requestReflow(reason)`。
- **Addon 交互门禁**：
  - addon 根节点必须带 `data-mm-interactive="true"`（交互白名单）
  - 不要在根节点用 `@mousedown.stop`（会导致 selection/drag gate 的根因级回归）

### 4.2 Tagging 呈现的口径

- **未知值兼容**：status/confidence 允许未知值；UI 必须保持可观测（显示原始值或 tooltip）。
- **不写 NodeObj.style**：视觉映射必须在渲染层完成，避免把主题/样式写入版本内容。
- **色彩契约集中**：节点内 addon 与 conversation 工具卡片必须复用 `ui/taggingChipPresentation.ts`，禁止在不同组件中复制 status/confidence/kind chip 颜色表。

---

## 5) 文件树（当前实现）

```text
features/tagging/
├─ README.md                          # 本文件
├─ index.ts                           # 统一导出入口
├─ services/
│  └─ installTaggingFeature.ts        # 安装入口（lifecycle + addon 注册 + DOM 属性注入）
├─ domain/store/
│  └─ taggingStore.ts                 # 从 mind.nodeData 派生缓存（nodeId -> tagging）
└─ ui/
   ├─ TaggingBadgeAddon.vue           # 类型(kind) + 状态 pill + 置信度 + Refuted 解释入口
   ├─ taggingChipPresentation.ts      # tagging chip 的显示文案与颜色契约
   └─ index.ts                        # UI 导出
```

---

## 6) 调试与排查

- **打开调试日志**：
  - Tagging 会输出：`[installTaggingFeature] ...`、`[TaggingStore] ...`
- **常见问题**：
  - “看不到样式变化”：确认 `mind.nodeData` 中对应节点确实有 `node.tagging.status`，并且 `structureReady` 后 DOM 注入执行（检查 `mm-node[data-tagging-status]`）。
  - “感叹号点击无反应”：确认 evidence feature 已安装，并监听 `ui:toggleReferenceInNode`。
