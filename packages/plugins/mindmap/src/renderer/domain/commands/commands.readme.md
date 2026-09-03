## Commands（命令体系）README（开发指南）

> 中文说明：
> - 命令体系的定位：**用户意图的稳定 API**（唯一允许产生副作用的入口）。
> - 目标：入口单一、口径统一、可观测（txId/source/reflow reasons），为 undo/redo 与未来自由画布演进打底。
>
> 最后更新：2026-02-04

---

## 1) 你应该把什么放进 commands

- **应该**：删除/新建/移动/折叠/选择清理/重算请求等“会改状态/会触发重算/会影响历史”的动作
- **不应该**：DOM 事件对象、Topic/HTMLElement、UI 组件逻辑

> 红线：command payload 禁止 DOM 泄漏；跨层只传 `nodeId/nodeIds`（见 `docs/MINDMAP_DEV_GUIDE.md`）。

---

## 2) 目录结构（代码事实）

- 入口安装：`domain/commands/registry.ts`（注入 `mind.commands/mind.can/mind.runCommand`，并负责 meta/txId 注入）
- 类型定义：`domain/commands/types.ts`
- 守卫：`domain/commands/guards.ts`（纯检查）
- 归一化：`domain/commands/normalize.ts`（root 过滤/去重/父子收敛等口径统一）
- 命令实现：`domain/commands/commands/*`

---

## 3) can / run 的约束（非常关键）

- `mind.can.*`：**纯检查**（不得触发副作用）
  - 禁止：写 store、触发 IPC、改 DOM、调用 operations、读取几何（如 `getBoundingClientRect`）
- `mind.commands.*`：**唯一副作用入口**
  - 可以：调用现有 operations/实例方法（ownership 仍在 operations）
  - 必须：必要时先 normalize，失败必须可观测（有 reason/日志）

---

## 4) 可观测（txId / source / reflow reasons）

- 每次命令执行有 `txId` 与 `meta.source`
- 命令执行期间触发的 `operation` 会被注入 `operation.meta`（用于 history/tx 聚合）
- `requestReflow` 会在 flush 时通过 `lifecycle:geometryFlushed` 输出 reasons（并可关联 txId/txIds）

相关基础设施：
- `shared/utils/reflow/reflowscheduler.readme.md`
- `domain/transaction/transaction.readme.md`

