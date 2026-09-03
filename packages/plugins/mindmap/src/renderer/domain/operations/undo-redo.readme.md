## Undo/Redo（撤销/恢复）README（当前实现）

> 中文说明：
> - 当前 undo/redo 仍以 **快照** 为主（可用且稳定），并配合 selectionRestore 让选择恢复语义化/可观测。
> - 该子系统的目标是“行为稳定 + 可解释 + 可定位”，而不是追求最小内存。
>
> 最后更新：2026-02-04

---

## 1) 核心文件

- 历史栈（快照）：`domain/operations/operationHistory.ts`
- 选择恢复：`domain/operations/selectionRestore.ts`

---

## 2) 触发边界（非常重要）

> 中文说明：history 监听的是 `operation` 事件，因此 **只有会 fire operation 的变更** 才会进入 undo/redo。

- operation ownership：`domain/operations/*`
- 快捷键入口：由 `interaction/keyboard/*` 统一治理（不要在 history 内监听 keydown）

---

## 3) selection 恢复策略（语义化 + 可观测）

- 目标 node 不可见/不可命中时，按策略回退（最近可见祖先/清空选区等）
- 必须输出结构化日志，禁止静默吞错

