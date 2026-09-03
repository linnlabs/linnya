# ReflowScheduler（重算调度器）

> 中文说明：这是 **MindMap 的基础设施 README**（固化版），用于统一处理“节点尺寸变化 → 连线几何重算”的触发入口与时序约束。  
> 目标是把重算从“到处散落调用”收敛为“一个入口 + 一套规则”，提升稳定性与可维护性。

---

## 解决什么问题

MindMap 的节点会因为很多原因产生尺寸变化：

- 文本编辑（换行/字体/样式）
- 富内容渲染与后续 resize（ResizeObserver）
- addons（例如证据）展开/收起与内容增删
- 节点插入/删除/移动导致局部 DOM 结构改变

如果每个 feature/组件都自行 `linkDiv()`，会导致：

- **触发点散落**：难定位“谁触发了抖动/漂移/卡顿”
- **重复重算**：同一帧多次 linkDiv()，性能和视觉都变差
- **时序竞态**：DOM 未稳定就测量/重算，出现“第一次没反应/第二次才对”的错觉

ReflowScheduler 的职责就是：**把“重算请求”统一收敛，并在合适的时机合并执行一次 `mind.linkDiv()`**。

---

## 文件位置（实现）

- 实现：`packages/plugins/mindmap/src/renderer/shared/utils/reflow/ReflowScheduler.ts`
- 导出：`packages/plugins/mindmap/src/renderer/shared/utils/reflow/index.ts`
- 安装：`packages/plugins/mindmap/src/renderer/presentation/engine/MindMapEngine.ts`（`mount()` 中安装并注入）
- MindMap 实例 API：`mind.requestReflow(reason)`

---

## 红线（必须遵守）

- **UI/feature 禁止调用 `mind.layout()`**
  - `layout()` 会重建节点 DOM，极易破坏选中状态与 Teleport 宿主，造成“内容消失/漂移/抖动”

- **UI/feature 禁止直接调用 `mind.linkDiv()`**
  - 必须通过 `mind.requestReflow(reason)` 统一调度

---

## 对外 API（调用规范）

### 统一入口

- `mind.requestReflow(reason: ReflowReason): void`

### ReflowReason（原因枚举）

当前实现位于 `ReflowScheduler.ts` 的 `ReflowReason` union。常用值：

- `node-edit:finish`：文本编辑提交
- `rich-content:resize`：富内容尺寸变化
- `addons:toggle`：addons 展开/收起
- `addons:content`：addons 内容变化（增删/加载后渲染）
- `node-operation:dom-changed`：节点操作引起的几何变化（插入/删除/移动/reshape 等）

> 中文说明：reason 的价值是“可观测”。新增 reason 必须描述触发场景与为什么需要重算。

---

## 调度策略（实现约定）

- 默认使用 `requestAnimationFrame` 合并：同一帧内多次 `requestReflow()` → **只执行一次** `mind.linkDiv()`
- 统一在 scheduler 内输出日志（当前阶段默认开启），日志包含：
  - `reasons`：本次合并的原因集合
  - `coalescedCount`：合并次数
  - `durationMs`：`linkDiv()` 耗时

---

## 例外：哪些地方允许直接 `linkDiv()`（强时序点位）

中文说明：有少数核心流程需要“立即重算 → 立即测量/补偿”，这类地方 **必须保留直接 `linkDiv()`**，否则会引入可见错误。

当前已确认的强时序点位：

- `domain/core/methods.ts`：`init()`  
  `layout()` 后必须紧跟 `linkDiv()`，保证首屏节点与连线同一轮同步完成。

- `interaction/dataControls.ts`：`refresh()`  
  `layout()` 后必须紧跟 `linkDiv()`，避免结构重建后连线短暂不同步。

- `interaction/nodeExpansion.ts`：`expandNode()`  
  `linkDiv()` 后紧接着需要测量 `afterRect` 计算 drift 补偿；如果延后到 rAF，会导致补偿计算错误。

> 重要：新增“强时序点位”必须写清楚原因（例如“后续依赖测量结果/位移补偿”），否则默认应迁移到 scheduler。

---

## 已接入的触发源（阶段 B/C 状态）

- `presentation/ui/NodeEditor.vue`：`requestReflow('node-edit:finish')`
- `presentation/ui/RichContentHost.vue`：`requestReflow('rich-content:resize')`
- `features/evidence/ui/EvidenceInNode.vue`：`requestReflow('addons:toggle' | 'addons:content')`
- `domain/operations/nodeOperations.ts`、`shared/utils/dom/domManipulation.ts`：已将多数散落 `linkDiv()` 迁移为 `requestReflow('node-operation:dom-changed')`

---

## 研发约束（给未来改代码的人看的）

- **不要为了“看起来更快”就引入局部 linkDiv**
  - 例如依赖 `offsetParent` 传参做“局部重算”，会把正确性绑定到 CSS/DOM 结构，长期非常脆弱
  - 阶段 C 的策略是“先稳再快”：用统一的全局几何重算换取确定性；后续如果要做局部优化，必须先写清楚契约与测量依据

- **不确定时先加日志，不要猜**
  - scheduler 已经是最佳收敛点：优先在 reason 与 flush 日志中定位频繁触发源

---

## 常见排查清单

- **线条抖动/卡顿**
  - 看 scheduler 日志：是否出现同一操作触发多个 reasons？是否同一帧 coalescedCount 很高？

- **展开/编辑后线条没更新**
  - 看触发源是否用了 `requestReflow()`；是否是强时序场景误迁移导致测量/补偿错误

---

*最后更新：2026-02-02*

