# Conversation Platform 开发规范

> **What** · Linnya 对话平台的全链路权威规范：从 Agent 产生一条事实，到用户在屏幕上看到它，中间每一层的合同、身份、校验与生命周期。
> **When to read** · 改动 RuntimeEvent、持久化、投影、渲染、工具、subrun 或取消链路之前。
> **权威性** · 共享 schema 与 owner 实现描述当前可执行事实；[`00-invariants.md`](./00-invariants.md) 是跨链路规范的唯一编号与摘要；专题文档负责解释机制和派生约束。三者冲突即合同缺陷，必须停止扩散、登记并修正，禁止消费方自行猜测或增加兼容旁路。

这套文档按**链路**组织，不按代码分层组织。原因：读者的问题总是"一条 `tool_output` 从产生到渲染经过什么"，而不是"renderer 目录里有什么"。

---

## 1. 全链路总图

```text
┌─ Linnkit（通用 Agent 框架）────────────────────────────────┐
│  Graph / LLM / ToolNode                                    │
│    └─ AnyAgentEvent ──eventMapper──▶ RuntimeEvent（草稿）   │
└────────────────────────────┬───────────────────────────────┘
                             │ RuntimeEventSink
┌─ Linnya Host ──────────────▼───────────────────────────────┐
│  RuntimeEventPublisher.route()  ──▶ RoutedRuntimeEvent      │
│    （附着 run_id / parent_run_id / lane / visibility）      │
│                             │                              │
│                          EventBus                          │
│              ┌──────────────┼──────────────┐               │
│              ▼              ▼              ▼               │
│        events 表      SSEEvent      observers              │
│      （唯一事实源）   （实时 wire）  （audit/telemetry）     │
│              │                                             │
│              ▼                                             │
│    conversation_ui_messages（可重建 UI read model）         │
└──────────┬──────────────────────────┬──────────────────────┘
           │ HTTP 分页                │ SSE
┌──────────▼──────────────────────────▼──────────────────────┐
│  Renderer / Conversation domain                            │
│    window store              request-scoped router         │
│    （durable 历史）              └─ reduceEvent            │
│           └──────── merge by message_id ────────┘          │
│                          ▼                                 │
│              visual-row 增量投影                            │
│                          ▼                                 │
│              TanStack Virtual 画布                          │
│                          ▼                                 │
│              message / tool / subrun leaf                  │
└────────────────────────────────────────────────────────────┘
```

三条链路互不代生：live 不补造 durable 历史，reload 不模拟实时过程，render 不创建事实。live 与 reload 只在 selector / render 输入处按正式 `message_id` 汇合：

| 链路 | 输入 | 输出 | 规范 |
|---|---|---|---|
| **live** | `SSEEvent` | live message | [`05-live-projection.md`](./05-live-projection.md) |
| **reload** | `ConversationUiMessage[]` | window rows | [`06-read-model.md`](./06-read-model.md) |
| **render** | window ∪ live | DOM | [`07-render.md`](./07-render.md) |

---

## 2. 文档地图

| # | 文档 | 管什么 |
|---|---|---|
| — | [`00-invariants.md`](./00-invariants.md) | **全链路不变量总表**（`INV-xx`）。唯一编号与规范摘要；专题文档不得改写其语义 |
| 01 | [`01-identity.md`](./01-identity.md) | 身份矩阵：Runtime ↔ 产品 read model ↔ 视觉轮次；派生规则与禁止 fallback |
| 02 | [`02-event-pipeline.md`](./02-event-pipeline.md) | 事件产生 → admission → publish → fan-out；序号命名空间；请求级路由 |
| 03 | [`03-persistence.md`](./03-persistence.md) | `events` 事实表、`conversation_ui_messages` read model、rebuild、迁移 |
| 04 | [`04-schema-contract.md`](./04-schema-contract.md) | schema 分层与 owner、metadata 非控制面、校验边界、变更纪律 |
| 05 | [`05-live-projection.md`](./05-live-projection.md) | `reduceEvent`、在途状态按执行身份分区、释放语义 |
| 06 | [`06-read-model.md`](./06-read-model.md) | window 分页、window ∪ live 合并、双槽 truncate、加载期缓冲 |
| 07 | [`07-render.md`](./07-render.md) | visual row、三层虚拟化、滚动契约、媒体管线、timeline |
| 08 | [`08-lifecycle.md`](./08-lifecycle.md) | 导航、DOM 归属、取消三层屏障、HITL、foreground run 控制面 |
| 09 | [`09-tools.md`](./09-tools.md) | tool call / output、batch 结算、wrapper 别名、工具卡消费规则 |
| 10 | [`10-subruns.md`](./10-subruns.md) | 活动模型、父子 agent、系统 batch、trace、lifecycle 与展示 |
| 11 | [`11-testing-gates.md`](./11-testing-gates.md) | 测试分层、guard、Electron 真机门禁、什么测试不算门禁 |
| 12 | [`12-open-risks.md`](./12-open-risks.md) | 当前风险、待单独立项的演进与冻结边界；**不是**完成记录 |

---

## 3. 按问题查文档

| 我想…… | 看这个 |
|---|---|
| ……新增或修改一种 RuntimeEvent | [02](./02-event-pipeline.md) → [03](./03-persistence.md) → [05](./05-live-projection.md)，四处同 PR 改 |
| ……修改输入框上下文用量或提高刷新频率 | [02](./02-event-pipeline.md) → [04](./04-schema-contract.md) → [05](./05-live-projection.md) → [06](./06-read-model.md) → [07](./07-render.md)；实现说明见 [`context-window-usage`](../../apps/renderer/domains/conversation/features/context-window-usage/README.md) |
| ……修改自动上下文压缩开关/水位/事件归属 | [00 INV-21/60](./00-invariants.md) → [02](./02-event-pipeline.md) → [04](./04-schema-contract.md) → [05](./05-live-projection.md)；framework 见 [`context-engineering`](https://github.com/linnlabs/linnkit/blob/main/docs/integration/context-engineering.md) 与 [`graph-engine`](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/graph-engine/README.md) |
| ……搞清 `answer_id` / `tool_call_id` / `message_id` / `visual_turn_id` 的区别 | [01](./01-identity.md) |
| ……知道一条消息为什么在重载后消失/重复 | [06](./06-read-model.md) 合并规则 + [01](./01-identity.md) |
| ……加一个工具卡片 | [09](./09-tools.md) + [04](./04-schema-contract.md) |
| ……让工具复用别的工具的卡片 | [09](./09-tools.md) wrapper 别名章 |
| ……修改 Tool 幂等策略或 key | [09 §9](./09-tools.md#9-tool-幂等属于-linnkit-runtime) → [Linnkit Tool runtime owner](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/tools/README.md) |
| ……做工具的 child agent 过程展示 | [10](./10-subruns.md) |
| ……排查滚动、吸底、估高、闪帧 | [07](./07-render.md) |
| ……排查切会话 / 新建对话失败 | [08](./08-lifecycle.md) DOM 归属章 |
| ……排查取消后卡片仍转圈 | [08](./08-lifecycle.md) 取消三层屏障 |
| ……从 CLI 发消息、观察运行、处理 wait-user 或终止 | [`apps/linnya-cli/README.md`](../../apps/linnya-cli/README.md)；Host 语义见 [`application/conversation-control/`](../../src/app-hosts/linnya/application/conversation-control/README.md) |
| ……修改用户引用 `user_quote`、历史展示或 edit-resend | [输入贡献 §4](../../apps/renderer/domains/conversation/docs/input-contribution.md#4-user_quote-结构化多引用-wire) + [04](./04-schema-contract.md)；字段可缺失，存在即 strict admission，禁止 fallback |
| ……知道改动要跑哪些门禁 | [11](./11-testing-gates.md) |
| ……判断一个字段该放哪个 schema | [04](./04-schema-contract.md) |
| ……知道什么现在不该动 | [12](./12-open-risks.md) 冻结边界 |

---

## 4. 权威文件

改消息全生命周期时必须共同复核。路径以仓根为基准。

### 4.1 通用框架层（Linnkit）

| 边界 | 文件 |
|---|---|
| Runtime / SSE 事实合同 | [独立 Linnkit 仓的 `src/contracts/`](https://github.com/linnlabs/linnkit/tree/main/src/contracts) |
| Runtime 身份 | [`src/contracts/identity/`](https://github.com/linnlabs/linnkit/tree/main/src/contracts/identity) |
| 事件治理纯函数 | [`src/runtime-kernel/events/`](https://github.com/linnlabs/linnkit/tree/main/src/runtime-kernel/events) |
| Graph 事件主链 | [`src/runtime-kernel/graph-engine/`](https://github.com/linnlabs/linnkit/tree/main/src/runtime-kernel/graph-engine) |
| 自动压缩策略、计划、固定格式与输出预算 | [Linnkit context compaction](https://github.com/linnlabs/linnkit/tree/main/src/context-manager/features/context-compaction) |
| 通用 Tool 取消事实 | [`toolNode.cancellation.ts`](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/graph-engine/nodes/toolNode.cancellation.ts) |
| Tool 合同、参数规范化与幂等 key | [`src/runtime-kernel/tools/`](https://github.com/linnlabs/linnkit/tree/main/src/runtime-kernel/tools) |

### 4.2 产品共享合同（Schemas）

| 边界 | 文件 |
|---|---|
| Host → HTTP → Renderer durable DTO | `packages/schemas/src/conversation/ui-message.ts` |
| 各类 metadata 判别联合 | `packages/schemas/src/conversation/message-metadata.ts` |
| 用户结构化引用 wire | `packages/schemas/src/conversation/user-quote.ts`；产品语义见 `apps/renderer/domains/conversation/docs/input-contribution.md` §4 |
| 回答中的文件链接 IPC | `packages/schemas/src/conversation/file-link.ts`；locator 合同见 `packages/schemas/src/file-locator.ts` |
| 工具消息 lifecycle 与 payload | `packages/schemas/src/conversation/tool-message.ts` |
| 消息身份与派生函数 | `packages/schemas/src/conversation/message-identity.ts` |
| 视觉轮次身份 | `packages/schemas/src/conversation/visual-turn-identity.ts` |
| 摘要事实与进度 presentation | `packages/schemas/src/conversation/summary-message.ts` |
| 递归 JSON 值 | `packages/schemas/src/json-value.ts` |
| CLI ↔ App Conversation control wire | `packages/schemas/src/conversation-control/` |

### 4.3 Host（事实、持久化、控制面）

| 边界 | 文件 |
|---|---|
| durable UI producer | `src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/projectEvent.ts`、`toolProjection.ts` |
| EventStore 实现 | `src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts` |
| 存储事实 codec | `src/app-hosts/linnya/adapters/persistence/event-store/functions/runtimeEventStorageCodec.ts` |
| 取消完成屏障 | `src/app-hosts/linnya/adapters/flow/interactive-run/orchestration/flowExecutionCompletionRegistry.ts` |
| HITL response fact 创建 | `src/app-hosts/linnya/adapters/flow/interactive-run/functions/buildInteractionResponseIncomingEvent.ts` |
| Flow 编排 | `src/app-hosts/linnya/adapters/flow/flow.orchestrator.ts` |
| CLI 产品控制 use case | `src/app-hosts/linnya/application/conversation-control/` |
| CLI 本地 HTTP、安全与连接描述 | `src/app-hosts/linnya/adapters/conversation-control-bridge/`、`src/electron-main/services/apiServer.ts` |
| Host Schema 基线与当前支持窗口 | `src/electron-main/services/database/migrations/` |

### 4.4 Renderer（投影、合并、渲染）

以 `apps/renderer/domains/conversation/` 为根。

| 边界 | 文件 |
|---|---|
| live 投影入口 | `services/messageProjection/index.ts` |
| 投影提交管线 | `services/orchestration/projectionCommitPipeline.ts` |
| 输入框上下文用量 | `features/context-window-usage/` |
| 请求级事件路由 | `features/realtime-event-routing/` |
| 用户输入接纳 | `features/user-input-admission/` |
| durable DTO admission | `message-window/functions/uiMessagesDtoGuards.ts`、`mapUiMessageDto.ts` |
| window / live 合并 | `message-window/functions/mergeWindowAndLiveMessages.ts` |
| 内容相位 | `functions/conversationContentPhase.ts` |
| visual row 投影 | `ui/conversationView/logic/` |
| Markdown 文件链接识别与展示 | `features/resource-link/`；跨域打开由 `apps/renderer/app/workflows/conversation-resource-link/` 装配 |
| 终态收尾 | `services/orchestration/reconcileTerminalConversationView.ts` |
| subrun durable 刷新 | `features/subrun-trace/store/subrunTraceInvalidationStore.ts` |
| 测试消息构造 | `testing/functions/createConversationTestMessage.ts` |

### 4.5 门禁

| 用途 | 文件 |
|---|---|
| 合同防回退 | `scripts/guards/conversation-contract-guard.mjs` |
| Vue reactive admission 防回退 | `scripts/guards/conversation-vue-reactive-boundary-guard.ts` |
| 真机导航 E2E | `scripts/e2e/conversation-navigation/run-electron-conversation-navigation-e2e.mjs` |

---

## 5. 配套规范（保留原位）

以下文档是高价值实现级规范，不并入本目录，但其不变量以 [`00-invariants.md`](./00-invariants.md) 为准：

| 文档 | 管什么 |
|---|---|
| `apps/renderer/domains/conversation/docs/conversation-virtualization.md` | 虚拟化与滚动的完整实现契约、媒体管线、估高体系 |
| `apps/renderer/domains/conversation/docs/input-contribution.md` | 输入框贡献框架三原语与插件 SDK 边界 |
| `src/domains/citation/README.md` | Conversation 引用的 producer、live/reload/Subrun、依赖闭包与 Editor 转换 |
| [独立 Linnkit 仓的 `docs/integration/`](https://github.com/linnlabs/linnkit/tree/main/docs/integration) | Linnkit 作为独立 npm 包的接入手册（外部读者视角） |
| `packages/schemas/README.md` | `@app/schemas` 包级说明与目录职责 |
| `apps/linnya-cli/README.md` | CLI 命令、JSON/JSONL、退出码、安全发现与分层测试 |

---

## 6. 维护纪律

1. **先读规范，再读 owner 代码，最后修改**。开工前必须先按 §3 找到对应专题文档，并对照 `00-invariants.md` 与共享 owner schema；不能只看故障组件或调用点就决定产品语义。
2. **不变量只编号一次**。新增跨链路约束进 `00-invariants.md`；专题文档可以解释机制、事故、派生约束和操作清单，但不得改变不变量语义。
3. **`INV-xx` 编号不复用、不重排**。删除的条目留空号并注明。
4. **具体字段以共享 owner schema 为准**。专题文档重复列举字段时，修改 schema 必须同步复核对应文档；禁止以文档副本建立第二份合同。
5. **文档引用的路径与命令必须真实存在**。校验方式见 [`11-testing-gates.md`](./11-testing-gates.md) §文档验证。
6. **不写施工过程**。迭代历史由 git 承载；一次性计划不进本目录。
7. **发现文档与事实脱节**：按「共享 schema / owner 实现事实 → `00-invariants.md` 规范摘要 → 专题解释」定位冲突，并在 [`12-open-risks.md`](./12-open-risks.md) 登记。事实与规范不一致时必须明确选择修代码还是修规范，不能静默让消费方兼容两套语义。
