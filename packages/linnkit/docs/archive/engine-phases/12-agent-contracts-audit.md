# 12 · Agent Contracts Audit

> **状态**：✅ 第一轮归属审计完成，待纳入 D-4  
> **日期**：2026-04-21  
> **作用**：把 `src/agent/*` 对 `@app/schemas` 的依赖，拆成“agent 自有 / 共享 / 产品协议”三类，避免后续抽包时一锅端  
> **关联主文档**：
> - [`07-public-api-and-package-boundary.md`](./07-public-api-and-package-boundary.md)
> - [`11-phase-e-hard-blockers.md`](./11-phase-e-hard-blockers.md)

---

## 1. 结论先说

这轮看下来，`@app/schemas` **不是整体都脏**。

真正值得治理的，不是“agent 依赖了 schemas，所以 schemas 都要搬”，而是：

1. 哪些本来就是 agent 自己的核心事实模型
2. 哪些天生就是跨端共享协议
3. 哪些其实已经带上了 Linnya 产品目录和业务命名，不该原样并进 `linnkit`

一句大白话：

- `AiMessage`、`RuntimeEvent` 这类东西很像 agent 自己的骨架
- `SSE`、`EventEnvelope` 这类东西更像公共管道
- `PromptKeys` 这种东西已经像 Linnya 自己的菜单，不该直接塞进 agent 包

---

## 2. 本轮硬数据

按本轮结构化统计，`src/agent/*` 里对 `@app/schemas` 直接引用最重的名字是：

- `AiMessage`：57
- `RuntimeEvent`：48
- `PromptKeys`：7
- `EventEnvelope`：4

这说明 `schemas` 的核心问题很集中，不是全面失控。

---

## 3. 三类归属

### 3.1 A 类：明显属于 agent 自有协议

#### `AiMessage` 系列

包括：

- `AiMessage`
- `AssistantMessage`
- `UserMessage`

为什么归 A 类：

- 它们是 agent 的消息事实模型
- 被 `ports`、`runtime-kernel`、`context-manager` 全链路使用

代表定义：

- [packages/schemas/src/domain-models.ts](../../../../../packages/schemas/src/domain-models.ts:277)

代表使用：

- [agent-invocation.ts](../../../../../src/agent/ports/agent-invocation.ts:1)
- [messageAdapters.ts](../../../../../src/agent/context-manager/profiles/chat/utils/messageAdapters.ts:1)
- [ConversationSession.ts](../../../../../src/agent/context-manager/profiles/agent/context/ConversationSession.ts:17)

#### `RuntimeEvent` 系列

包括：

- `RuntimeEvent`
- `FinalAnswerEvent`
- `ToolOutputEvent`
- `ErrorEvent`
- `createFinalAnswerEvent`
- `createErrorEvent`

为什么归 A 类：

- 它们是运行过程、持久化事实、历史回放的主干
- 如果以后真把 agent 自有合同往 `linnkit` 收，这一类最值得先收

代表定义：

- [packages/schemas/src/runtime-events.ts](../../../../../packages/schemas/src/runtime-events.ts:71)

代表使用：

- [eventMappers.ts](../../../../../src/agent/runtime-kernel/events/eventMappers.ts:41)
- [eventConverter.ts](../../../../../src/agent/context-manager/profiles/agent/utils/eventConverter.ts:10)
- [engine.ts](../../../../../src/agent/runtime-kernel/graph-engine/engine.ts:6)

#### `SubRunTraceEvent`

包括：

- `SubRunTraceEvent`
- `createSubRunTraceEvent`

为什么归 A 类：

- 虽然主要服务实时展示
- 但语义来源仍然是 agent runtime 自己的 child-run 过程

代表定义与使用：

- [packages/schemas/src/runtime-events.ts](../../../../../packages/schemas/src/runtime-events.ts:430)
- [eventBusSubRunTracePublisher.ts](../../../../../src/agent/runtime-kernel/subrun/eventBusSubRunTracePublisher.ts:12)

### 3.2 B 类：明显属于共享跨端协议

#### `SSE*` 系列

包括：

- `SSEEvent`
- `createSSE*`
- `createSSERequiresUserInteractionEvent`

为什么归 B 类：

- 它们更像 agent 到 UI/宿主的传输投影
- 不是 runtime 自己的核心事实模型

代表定义与使用：

- [packages/schemas/src/sse/interaction.ts](../../../../../packages/schemas/src/sse/interaction.ts:24)
- [waitUserNode.ts](../../../../../src/agent/runtime-kernel/graph-engine/nodes/waitUserNode.ts:3)

#### `EventEnvelope` / `ExecutionTraceContext`

为什么归 B 类：

- 这是一层执行管道信封
- 它们不是 Linnya 专属，但也不适合算作 agent 私有事实模型

代表定义与使用：

- [packages/schemas/src/execution-events.ts](../../../../../packages/schemas/src/execution-events.ts:20)
- [sequencer.ts](../../../../../src/agent/runtime-kernel/execution/sequencer.ts:22)
- [event-bus.ts](../../../../../src/agent/runtime-kernel/execution/event-bus.ts:14)

#### `DEFAULT_MAX_STEPS`

为什么归 B 类：

- agent 内核在用
- 但它承担的是“前后端默认值一致”的职责
- 更像共享配置，不像 agent 私有协议

代表定义与使用：

- [packages/schemas/src/api-dtos.ts](../../../../../packages/schemas/src/api-dtos.ts:32)
- [engine.ts](../../../../../src/agent/runtime-kernel/graph-engine/engine.ts:7)
- [config.ts](../../../../../src/agent/context-manager/profiles/agent/config.ts:2)

### 3.3 C 类：明显属于 Linnya 产品协议，或不该原样进 agent 包

#### `PromptKey` / `PromptKeys`

这是这轮最明确的 C 类。

为什么：

- `src/agent` 生产代码对它的直接用量其实不大
- 但定义内容已经塞满 Linnya 任务名和产品入口名

代表定义：

- [packages/schemas/src/agent-config/index.ts](../../../../../packages/schemas/src/agent-config/index.ts:14)

其中明显带产品味道的值包括：

- `SLIDES_AGENT`
- `DEEP_RESEARCH_*`
- `REVIEW`
- `MINDMAP_*`
- `TASK_*`

这说明它不是“纯 agent 协议”，而是“Linnya 当前任务目录”。

代表使用：

- [agent-invocation.ts](../../../../../src/agent/ports/agent-invocation.ts:1)
- [internalAgentInvoker.ts](../../../../../src/agent/runtime-kernel/child-runs/internalAgentInvoker.ts:19)

结论：

- 未来不要把现有 `PromptKeys` 原样并进 `linnkit`
- 如果要治理，也应该先拆出真正 product-neutral 的最小形态

#### `api-dtos.ts` 整套 HTTP DTO

包括：

- `ConversationNextRequest`
- `ConversationOptions`
- `AgentInvokeRequest`

为什么归 C 类：

- 它们更像前后端 API 边界
- 不是 `linnkit` 核心运行时本体

而且从当前 `src/agent` 生产代码看，内核并没有深度依赖这些 HTTP DTO。  
这反而是好消息，说明 agent 还没有被 API 层绑死。

---

## 4. 推荐动作

### R1：Phase E 前不做“大搬家”

不要把“真抽包”和“schemas 大迁移”绑成一次性动作。

原因：

- Phase E 当前真正的硬阻塞是公开入口和 deep import
- `schemas` 归属治理应该进入 D-4，但不该拖慢 E

### R2：D-4 先产出三张清单

1. `agent 自有协议`
2. `共享跨端协议`
3. `Linnya 产品协议`

### R3：如果后面要收第一批，优先收 A 类

第一批最值得收回 `linnkit` 的候选：

- `AiMessage` 系列
- `RuntimeEvent` 系列
- `SubRunTraceEvent`

### R4：暂时明确不原样收 C 类

尤其是：

- `PromptKey`
- `PromptKeys`
- 整套 API DTO

---

### R5：ports 公共面立即把 `PromptKey` 抽象成 `string`（已落地，2026-04-21）

**背景**

`src/agent/ports/agent-invocation.ts` 的 `AgentInvocationRequest.promptKey` 原本写成 `PromptKey`（C 类产品 enum），与本审计 §3.3 + R4 的结论直接冲突：

- ports 是 engine 公共合同面，必须产品中立；
- 但 `PromptKey` 的取值集合（`SLIDES_AGENT` / `DEEP_RESEARCH_*` / `TASK_*` ...）是 Linnya 产品的 task 菜单；
- 等于在 engine 公共面写死了"engine 知道 Linnya 有哪些 task"，这是抽包的硬污染点。

**调查结论**

全 `src/agent/*` 内对 `promptKey` 的语义性使用（`promptKey === '...'` / `switch (promptKey)` / `case PromptKey.X`）：**0 处**。

也就是说，engine 内部对 `promptKey` 是 100% **opaque** 的——只是个透传 routing key，由 host 的 task resolver 才真正解析其值。

**落地动作**

1. **第一阶段（已完成，2026-04-21）**：
   - `src/agent/ports/agent-invocation.ts`：`promptKey: PromptKey` → `promptKey: string`
   - 移除 `import { PromptKey } from '@app/schemas'`
   - 在字段 doc-comment 里写明"opaque task / prompt 标识，engine 不解析其值"
   - 验证：`tsc --noEmit` 与基线对比，promptKey 相关错误从 18 → 14（减少 4 条 host 端原本的 widening 错误，**0 新增**）

2. **第二阶段（留给 D-4 schema 治理）**：
   - 把 engine 内部 30+ 文件（`runtime-kernel/`、`context-manager/`、tests）里残留的 `PromptKey` type-import 也清理成 `string`
   - 评估工作量：grep 显示 30 个文件、约 30 处 type-import；多数是 contracts.ts / task base / test setup，机械替换；
   - 风险：低（值集合本来就是 string union，运行时 0 影响）；
   - 预估：1-2 个工作日。

**这条对 Phase E 的意义**

- ports 公共面提前满足"产品中立"约束 → Phase E 的 E-3（公共导出冻结）可以直接生效；
- engine 内部细节的清理可以与 D-4 并行，不阻塞 D-1 / D-2 / D-3 的 host 迁移；
- linnsec 将来作为新 host 接入时，不会从 engine ports 里看到 Linnya 私有的 task 菜单。

---

## 5. 这份审计对实施排序的影响

结论很直接：

- D-4 必做
- 但 D-4 不是 Phase E 的第一刀
- 第一刀仍然是 D-1 / D-2 / 宿主装配边界收口

也就是说，正确顺序是：

1. 先补入口
2. 先拦 deep import
3. 先收宿主装配边界
4. 再决定哪些 schema 值得收回 `linnkit`

---

## 6. 状态

- [x] 第一轮三类归属审计完成
- [x] 明确 `PromptKeys` 是当前最明显的产品化污染点
- [x] 明确 A 类第一批候选
- [x] R5 第一阶段已落地（ports 公共面 PromptKey → string，2026-04-21，commit `8960d17c`）
- [x] 回填到 `engine/07` D-4 任务说明（`engine/07 §2.3` 已显示新 promptKey 形态 + 引用本审计）
- [x] **R3（A 类形态拍板）已定稿**（2026-04-22 用户决策 F4/F6）：A 类协议**物理 move**到 `src/agent/contracts/`，**不做兼容回退窗口**；必须直接批量改完整仓导入路径
- [x] **R5 第二阶段**（engine 内部 PromptKey type-import 清理）已完成 → 见 [`engine/20 §4`](./20-d3-d4-port-interfaces-plan.md) **T1 = D-4.a**
- [x] **R3 物理 move 实施** 已完成 → [`engine/20 §6`](./20-d3-d4-port-interfaces-plan.md) **T3** 已完成：codemod / contracts 入口 / 全仓替换 / `packages/schemas` 旧真源与死导出清理完毕
- [x] D-4 全部完成
