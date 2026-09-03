# 表格 AI 模式 UI 不稳定根因分析与重构方案（历史归档）

> 归档说明（2026-07-16）：下文保留的是问题发生时的旧架构、推导过程和阶段方案，不是现行施工说明。
> 最终实现没有保留 `tableAiUiBridge`、`tableAssistantStore` 或 AI 全局事件总线。单一真源已迁到
> `domains/editor/features/table-ai-mode/` 的显式模式会话；列引用状态更新由同 feature orchestration
> 直接调用高亮 runtime。现行结构见 `table-ai-overview.md` 和 TableBlock `README.md`。

> 目的：解释为什么“退出 AI 填充后坐标栏有概率不消失、选中柄有概率不显示”，并给出 **高内聚 / 低耦合** 的重构路线，消除竞态与时序依赖。
>
> 约束：本方案优先 **根因修复**，不做“补丁式防御修复”。事件总线仍可用于跨域通信，但 UI 显隐必须改为状态驱动。

---

## 1. 现象复盘（用户可观测到的行为）

- **退出 AI 填充模式后**：
  - 行/列坐标栏 **偶发残留**（应隐藏却仍显示）。
  - 单元格选中柄（handle overlay）**偶发不显示**（应恢复却没有）。

这些问题具有共同特征：

- **概率性**：通常与“快速切换/侧边栏动画/流式取消/撤销列添加”等时序相关。
- **难复现**：单步调试很难稳定抓到，因为根因属于“状态不同步”而不是单点逻辑错误。

---

## 2. 现状架构（关键链路）

### 2.1 关键模块分工（当前）

- `apps/renderer/domains/conversation/store/tableAssistantStore.ts`
  - 真正的“表格 AI 模式”状态：`isTableMode`
  - 负责启用/禁用表格模式、提交、撤销列添加等复杂流程

- `apps/renderer/domains/conversation/integrations/tableIntegration.ts`
  - Producer：负责 `ENTER/EXIT`、列引用状态变化等事件发出（`aiIntegrationEventBus`）

- `apps/renderer/shared/services/aiIntegration/eventBus.js`
  - 全局事件总线（**瞬时事件**，无状态、无重放、无“最后值”）

- `apps/renderer/domains/editor/blocks/TableBlock/ui/TableInteractionManager.vue`
  - Consumer（UI 侧）：监听事件总线维护本地 `showCoordinateHeaders`
  - `showCoordinateHeaders=true` 时渲染坐标栏、同时用 `v-if` 隐藏选中柄

- `apps/renderer/domains/editor/blocks/TableBlock/extensions/TableCellInteractionExtension.js`
  - PM 插件：维护 `activeCellPos/showHandle/interactionMode`
  - 点击表格外部会触发全局 `mousedown` → `hideHandle`（这是设计预期）

### 2.2 关键问题：状态源分裂

当前“是否显示坐标栏”至少存在 **两套状态**：

- 源头：`tableAssistantStore.isTableMode`
- UI 副本：`TableInteractionManager.showCoordinateHeaders`（通过事件维护）

**这两者并没有强一致性保证**。

---

## 3. 根因分析（为什么会“概率性”失败）

### 根因 A：事件总线是“瞬时”而不是“状态”

`aiIntegrationEventBus.emit(...)` 只会通知 **当前已订阅** 的监听器：

- 组件若在 `ENTER` 后才挂载/重挂载 → **错过 ENTER** → UI 仍认为非 AI 模式
- 组件若在 `EXIT` 时短暂处于卸载/重建/订阅丢失 → **错过 EXIT** → UI 仍认为在 AI 模式

这种“丢事件”并不需要代码报错，就能发生——因此表现为概率性。

### 根因 B：退出流程本身是异步的（存在多个阶段）

`tableAssistantStore.disableTableMode()` 内部存在：

- 取消流式
- （可选）撤销列添加 → 等待一次 `docChanged` 再清理
- 之后才调用 `aiAssistantTableIntegration.disableTableMode()` 发送退出事件
- 再清理 store 状态

这意味着在退出过程中存在一个 **“中间态窗口”**：

- store 可能仍 `isTableMode=true`
- 但某些 UI 已开始清理 / 组件可能重排 / 订阅可能被短暂拆卸
- 导致 ENTER/EXIT 与 UI 副本不同步

### 根因 C：选中柄的显示被两套机制同时影响（互相覆盖）

选中柄是否出现取决于：

1) PM 插件状态 `showHandle`（点击表格外部会被置 false）  
2) Vue 层 `v-if="!showCoordinateHeaders"`（AI 模式下强制隐藏组件）

退出 AI 模式时，`TableInteractionManager` 虽然尝试 `restoreHandleVisibility()`，但它依赖：

- 当前 selection 是否仍在 cell 内（可能已因失焦/点击侧边栏/事务变化而改变）
- 并且 restoration 本质仍是“命令式补偿”，不是可推导的一致状态

当“坐标栏残留”发生时，选中柄必然被 `v-if` 隐藏，于是你会同时观察到：

- 坐标栏不关
- 选中柄不显示

这不是两个 bug，而是同一个“模式状态不同步”的不同外观。

---

## 4. 设计目标（重构后必须满足）

- **单一数据源**：UI 显隐只从一个状态推导，不能靠“是否收到事件”。
- **可重放/可恢复**：任何组件即使晚挂载，也能从当前状态恢复正确 UI。
- **模式机（Mode Machine）**：明确 AI 模式与普通模式互斥，避免多处 if/restore 补偿。
- **低耦合**：
  - Editor/TableBlock 不应直接依赖 Conversation 域 store 的实现细节。
  - Conversation 域也不应了解 TableBlock 的具体 UI 组件。
  - 二者通过 **共享桥接层（Bridge）** 或 **端口接口（Port）** 连接。

---

## 5. 解耦方案（推荐架构）

核心思想：**用“状态桥”替代“瞬时事件”来驱动 UI 显隐**。

### 5.1 新增：Table AI UI 模式桥（Bridge Store）

放在 shared 域（避免 editor ↔ conversation 互相直接依赖）：

- 建议路径：`apps/renderer/shared/stores/tableAiUiBridge.ts`

建议状态结构（示例）：

- `mode: 'off' | 'table_fill'`
- `sessionId: number`（单调递增，便于排查）
- `activeTable: { editorId: string; tablePos: number } | null`
- `enteredAt: number`

由 Conversation 域写入：

- `tableAssistantStore.enableTableMode()` → `bridge.enter({ editorId, tablePos })`
- `tableAssistantStore.disableTableMode()` → `bridge.exit()`

由 TableBlock UI 读取：

- `TableInteractionManager` / `TableCoordinateHeaders` 改为 **computed**：
  - `showCoordinateHeaders = bridge.mode !== 'off' && bridge.activeTable matches 当前 editor`

> 注意：事件总线仍可保留用于“装饰更新/高亮”等副作用，但 UI 显隐必须由 bridge state 驱动。

### 5.2 PM 插件互斥：让插件理解“模式”

将 “AI 模式下不显示 handle” 的规则下沉到 PM 插件体系，避免 Vue 层 `v-if` 强切换导致状态割裂。

推荐做法：

- 新增一个轻量 Tiptap 扩展（例如 `TableUiModeBridgeExtension.ts`）：
  - 订阅 `tableAiUiBridge`
  - 当 mode 变化时，向 PM dispatch 一个事务：
    - `tr.setMeta(TableCellInteractionPluginKey, { suspended: true/false })`

并修改 `TableCellInteractionExtension.js` 插件 state：

- 增加 `suspended: boolean`
- `suspended=true` 时：
  - 忽略 click/mousedown 导致的 showHandle 切换
  - decorations 不再画 `is-cell-active`
  - 输出 `showHandle=false`

这样退出 AI 模式后，不需要 Vue 的 `restoreHandleVisibility()` 补偿：

- 插件恢复正常逻辑
- 下一次 selection/click/transaction 会自然刷新 handle

### 5.3 事件总线职责收敛（高内聚）

建议约束：

- `aiIntegrationEventBus`：**只**承载跨域副作用事件（高亮、装饰、选择变化、工具输出）。
- “是否处于表格 AI 模式”：由 `tableAiUiBridge` 表达，不再靠 `ENTER/EXIT` 事件表达 UI 状态。

这样可以把“状态”和“事件”分层：

- **状态层**：可恢复、可推导、可一致
- **事件层**：一次性通知，用于触发副作用

---

## 6. 分阶段重构计划（可逐步落地，便于回滚）

### Phase 0（可选）：增加可观测性（不改行为）

目标：稳定复现并验证根因。

- 在 bridge 引入前，先在关键路径补充日志（中文注释）：
  - ENTER/EXIT 事件发出/接收
  - `TableInteractionManager` mounted/unmounted、当前 showCoordinateHeaders
  - `tableAssistantStore.isTableMode` 变化
  - 侧边栏动画期间的 layout shift 事件

### Phase 1：引入 `tableAiUiBridge`（不改 PM 插件）

修改点：

- 新增 `apps/renderer/shared/stores/tableAiUiBridge.ts`
- `tableAssistantStore` 写 bridge（enter/exit）
- `TableInteractionManager` 用 bridge 的 computed 驱动坐标栏显隐（不再监听 eventBus 来控制显隐）

预期收益：

- “坐标栏不消失”概率问题应大幅下降（UI 不再依赖瞬时事件）。

> ✅ 已落地（第一阶段）：
> - 新增 `apps/renderer/shared/stores/tableAiUiBridge.ts` 作为单一数据源；
> - `tableAssistantStore.enableTableMode/disableTableMode` 写入 bridge；
> - `TableInteractionManager` 改为从 bridge 派生 `showCoordinateHeaders/currentTableInfo`，不再监听 ENTER/EXIT 来控制显隐。

### Phase 2：插件互斥（移除 restore 补偿）

修改点：

- 新增 `TableUiModeBridgeExtension.ts`（TableBlock 内）
- 修改 `TableCellInteractionExtension.js` state 支持 `suspended`
- `TableInteractionManager` 移除 `restoreHandleVisibility()`（或仅作为临时兼容）
- Vue 层不再用 `v-if` 直接移除 handle 组件（可改为始终存在但由 props 决定显示）

预期收益：

- “选中柄不显示”与“坐标栏残留”彻底解耦
- Handle 的显示规则归一（PM 内部自洽）

> ✅ 已落地（第二阶段）：
> - `TableCellInteractionExtension` 增加 `suspended` 模式：AI 模式期间强制隐藏 handle/装饰并暂停交互；
> - 退出 AI 模式时，插件基于当前 selection 自动恢复 handle 状态，移除 Vue 层 restore 式补偿的必要性。

### Phase 3：事件总线收敛与契约整理

- 将 `TABLE_ENTER_AI_MODE / TABLE_EXIT_AI_MODE` 从“UI 显隐信号”降级为“副作用信号”
- 明确 eventData 的 schema（TS interface），减少 `any`/unknown 传播

---

## 7. 风险评估与回滚策略

- **风险**：bridge 引入后，若 editorId/tablePos 传递不准确，可能导致坐标栏不显示或显示到错误 editor。
  - **缓解**：bridge state 必须携带 `sessionId` + `editorId`，并在 TableBlock 内严格匹配。

- **回滚**：Phase 1/2 都可开关：
  - `useBridgeDrivenUi` feature flag（默认 off → on 灰度）

---

## 8. 验证清单（回归用例）

- **坐标栏显隐**
  - 进入 AI 填充 → 坐标栏显示
  - 退出 AI 填充（正常结束/取消/撤销列添加触发的退出）→ 坐标栏必隐藏
  - AI 侧边栏展开/收起/拖拽宽度 → 坐标栏位置跟随
  - 编辑器重建/视图切换后回到编辑器 → 若仍在 table mode，坐标栏应恢复正确状态

- **选中柄**
  - AI 模式期间不显示
  - 退出 AI 模式后：点击单元格/键盘移动 → 必能恢复显示
  - 点击表格外部隐藏、再点击单元格显示（行为一致）

---

## 9. 结论（为什么这不是“过于混乱”的抱怨，而是结构性问题）

当前问题的根因不是某一行代码写错，而是 **“用瞬时事件驱动 UI 状态”** 这一设计选择在复杂异步 + 组件生命周期下必然出现丢事件/不同步。

最终落地把：

- **状态（mode）**：放到 Editor `table-ai-mode` 显式会话，而不是阶段方案中的 shared bridge
- **副作用（高亮/装饰）**：收回同 feature orchestration 直接调用，并用 `sessionId` 隔离延迟请求

互斥规则同时下沉到 PM 插件体系，使 UI 不再依赖 `v-if` 与“补偿式 restore”对抗时序问题。
