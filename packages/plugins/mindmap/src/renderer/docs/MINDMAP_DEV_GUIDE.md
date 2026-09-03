## MindMap 开发规范（Contracts + 基础设施升级结论合并版）

> 中文说明：
> - 这是 MindMap 的**开发规范单文件**：把“必须遵守的硬规则（contracts）”与“为什么要这么做（infra upgrade 结论）”合并到一起，便于快速扫读与评审对齐。
> - 本文件优先面向“写代码的人”：能快速判断什么能做、什么不能做、遇到问题如何定位。
>
> 最后更新：2026-02-05

---

## 0) 先看结论（最重要的红线）

- **入口收敛**：副作用只允许从 `mind.commands.*` 进入；UI/feature/handler 禁止直连 operations
- **Reflow 统一**：UI/feature 禁止 `mind.layout()` / `mind.linkDiv()`；只能 `mind.requestReflow(reason)`
- **payload 禁止 DOM 泄漏**：跨层只传 `nodeId/nodeIds`；禁止 `Topic/HTMLElement/domId/Event`
- **键盘治理**：禁止 feature 私自 `addEventListener('keydown')` 接管业务快捷键（统一走 KeymapRegistry）
- **nodeId/domId 隔离**：业务永远用 nodeId；domId 仅用于 DOM 命中且必须用工具函数转换

配套导航：`docs/README.md`（模块目录树与关键入口）

---

## 1) 为什么要有这些规则（根因总结）

本轮“引用（原证据）”相关问题暴露的系统性根因：
- 生命周期信号语义混用（把 `linkDiv` 当 ready）
- 事件命名/域边界不清，payload 夹带实现细节
- UI/feature 直接触发布局重算，导致抖动与不可观测
- nodeId/domId 混用导致缓存 key 对不上
- 新增节点内部交互 UI 后出现选择/拖拽/平移穿透

这些不是“某个 bug 的补丁”，而是结构性问题；因此必须用 contracts + 工程护栏制度化。

---

## 2) 生命周期信号契约（Lifecycle Signals）

> 目标：把“文档就绪/结构就绪/几何就绪”三类信号变成**稳定、可依赖、可观测**的契约，禁止用 `linkDiv` 等实现细节当 readiness 信号。

### 2.1 `lifecycle:documentReady`
**语义**：MindMap 的“文档上下文”已确定并稳定（`documentId` 已存在且代表当前打开文档）。

- **何时触发**：`currentDocumentId` 从空 -> 非空，或发生切换（old != new）。
- **不保证**：不保证 `nodeData` 已 apply；不保证 DOM 已重建；不保证连线已绘制。

**payload（对象参数，禁止改成多参数）**
- `documentId: string`
- `reason: 'open' | 'reload' | 'switch'`
- `timestamp: number`

### 2.2 `lifecycle:structureReady`
**语义**：MindMap 的“结构”已就绪：`nodeData` 已 apply，节点 DOM 已按当前数据完成重建。

- **何时触发**：`init()` / `refresh()` / `focusNode()` / `cancelFocus()` 等结构性重建流程结束后触发。
- **不保证**：不保证异步 addon 内容已加载完成；不保证下一帧不会再发生内容注入。

**payload**
- `documentId: string`
- `nodeCount: number`
- `structureRevision: number`（单文档内自增）
- `timestamp: number`

### 2.3 `lifecycle:geometryFlushed`
**语义**：一次几何重算已完成（`linkDiv()` 已执行完成），连线应与当前 DOM 高度/位置对齐。

- **触发者**：`ReflowScheduler.flush()`（统一入口）
- **注意**：这是**观测信号**，业务 feature 不应把它当 readiness 条件

**payload**
- `reasons: ReflowReason[]`
- `coalescedCount: number`
- `durationMs: number`
- `structureRevision: number`
- `timestamp: number`

### 2.4 内容加载与刷新链路契约（`init` vs `refresh`）

> 目标：把“加载内容 / 全量刷新”的行为口径固定下来，避免视口闪动与重复副作用。

#### 2.4.1 硬规则（强制）

- **同一个 `MindMapInstance` 生命周期内，`init()` 只允许首屏调用一次**（`nodeData` 为空时）。
- **后续任何“应用新内容”必须使用 `refresh(data)`**（包括：reload、后端写新版本后的自动刷新）。
- **需要等待 DOM 重建完成时，必须等待 `lifecycle:structureReady`**，禁止用固定 `setTimeout(...)` 猜测。

#### 2.4.2 为什么（根因）

- `init()` 内部会安装 runtime plugins，并且会 `toCenter()`。
  - 若重复调用 `init()`：会导致 plugins 重复安装（`disposable` 叠加，潜在重复副作用/内存泄漏）。
  - `toCenter()` 会让视口先跳到中心，再被外部快照恢复拉回，用户观感就是“闪一下”。
- `refresh(data)` 属于结构性重建流程（layout + `requestReflowNow` + `lifecycle:structureReady`），但不应强制改变视口。

#### 2.4.3 唯一正确链路（代码事实）

- file-manager 打开/刷新 MindMap 必须走统一链路：
  - `mindmapHandler.open(session)`
  - → `mindMapAdapter.setDocumentSession(...)`
  - → `mindmapStore.setDocumentSession(...)`
  - → `loadContent(...)`
  - → `applyContent(...)`（内部按规则选择 `init` 或 `refresh(data)`）
  - → `lifecycle:structureReady`

相关落点：
- `packages/plugins/mindmap/src/renderer/domain/store/mindmapStore.ts`（`applyContent` 的 `init-once` 约束）
- `packages/plugins/mindmap/src/renderer/interaction/dataControls.ts`（`refresh(data)` 的结构性重建语义）
- `packages/plugins/mindmap/src/renderer/features/autoRefresh/services/mindMapAutoRefreshService.ts`（等待 `structureReady` 再恢复快照）

---

## 3) 事件契约与命名规范（Event Convention）

### 3.1 命名分域（强制）
- `lifecycle:*`：生命周期信号
- `ui:*`：UI 意图事件（表达用户想做什么）
- `state:*`：状态广播（状态发生变化）
- `operation`：统一操作事件（通过 payload.name 区分具体操作）

### 3.2 payload 规则（强制）
- 一律对象 payload（禁止多参数）
- 禁止泄漏实现细节：禁止携带 `HTMLElement/Topic` 与 domId（`me...`）
- UI 事件禁止透传 MouseEvent（必须用纯 payload）

### 3.3 ownership（强制）
- `lifecycle:*`：engine/core/scheduler 单点触发
- `state:*`：interaction/core 单点触发
- `ui:*`：允许多入口触发，但只表达意图
- `operation`：只能由 domain/operations 触发

---

## 4) 重算策略契约（Reflow Policy）

### 4.1 红线（强制）
- UI/feature 禁止：`mind.layout()` / `mind.linkDiv()`
- UI/feature 只允许：`mind.requestReflow(reason)`

### 4.2 强时序白名单（必须制度化）
- 统一出口：`mind.requestReflowNow(reason)`（或 scheduler `forceFlush`）
- 白名单之外禁止使用（否则会回到“散落重算/不可观测/抖动”）

详细说明（强烈建议必读）：
- `shared/utils/reflow/reflowscheduler.readme.md`

---

## 5) nodeId / domId 规范（NodeId Policy）

### 5.1 基本定义
- **业务 nodeId**：`nodeObj.id`，跨层接口唯一允许传递的节点 ID
- **DOM domNodeId**：`me${nodeObj.id}`，仅用于 DOM 命中与交互层

### 5.2 硬规则（强制）
- 跨层接口（store/IPC/event payload）禁止 domNodeId
- 命中 DOM 后第一时间转换为 nodeId；后续全链路只传 nodeId
- 禁止手写 `'me' + nodeId` / `slice(2)`，必须用工具函数

工具函数：
- `shared/utils/dom/nodeId.ts`：`toDomNodeId/fromDomNodeId/isDomNodeId/assertNodeId`

---

## 6) 工程护栏（可执行约束）

- `scripts/guards/mindmap-guards.ts` + `pnpm run guard:mindmap`
  - 禁止散落 linkDiv/layout
  - 禁止 domId 手写/泄漏
  - 禁止新增不可治理的 keydown 监听等

---

## 7) 最小必测回归清单（开发自测）

- **引用首屏稳定渲染**：打开含引用文档，不选中也应出现预览/壳
- **右键菜单口径正确**：只显示“添加引用”；count=0 可用；count>0 置灰禁用（count 未就绪时也应先禁用，待补齐后自动更新）
- **多节点同时展开**：连续展开两个节点引用，两个都保持展开
- **addons 尺寸变化后的连线一致性**：异步渲染导致高度变化后连线稳定重算，无错位/抖动
- **交互穿透**：在引用区域点击/滚动/按钮操作不触发 selection/drag/pan 穿透（必要时开启 gate debug）

---

## 8) 关键落点索引（快速跳转）

- Commands：`domain/commands/commands.readme.md`
- Interaction：`interaction/interaction.readme.md`
- Undo/Redo：`domain/operations/undo-redo.readme.md`
- Transaction：`domain/transaction/transaction.readme.md`
- ReflowScheduler：`shared/utils/reflow/reflowscheduler.readme.md`
- InteractionGate：`shared/utils/interactionGate/interactiongate.readme.md`
