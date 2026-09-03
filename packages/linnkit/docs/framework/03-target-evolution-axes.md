# 03 · 目标演进的 9 条轴

> 把"通用 / 高级 / 易用 / 灵活 / 健壮 / 优雅 / 易审计 / 多 Agent / 集群"这些目标词在 linnkit 的语境下定义清楚，每条轴给出**当前坐标 → 期望坐标 → 关键动作**。

---

## 1. 9 条演进轴

### 1.1 通用化（Generality）

> **定义**：linnkit 不假设任何特定宿主、特定产品、特定 LLM provider；任何把它装进自己产品的人都能受益。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| `AgentInvocationRequest` 仍含 `promptKey` / `mode`，是宿主气味 | Agent 是一等可序列化资源，可注册可发现可热加载 | [N-1 AgentSpec](./04-protocol-roadmap.md#n-1-agentspec--agentdescriptor一等对象-p0) |
| `profile` 只覆盖 context | "agent profile" 覆盖角色 / 权限 / 能力包 | AgentSpec.role + capabilities[] |
| 工具直接绑死宿主实现 | 工具走 ports + capability descriptor | tool capability descriptor（[N-1 §3](./04-protocol-roadmap.md#n-1-agentspec--agentdescriptor一等对象-p0)） |

**信号**：第三方读了 README 就能写出 `linnkit.runAgent(spec, input)` 跑一个 agent，不需要打开任何宿主代码。

### 1.2 高级（Advanced）

> **定义**：能表达 plan / reasoning / reflection / verify 这些"agent 推理动作"，且让用户能扩展 graph 节点。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| 只有 `thought` 事件 | 一等的 `plan` / `hypothesis` / `reflection` / `self_critique` 事件 | reasoning artifact 协议（详见 [`04 §5.1 N-7 候选`](./04-protocol-roadmap.md)） |
| graph 是固定 5 节点 | 用户可注册新节点（`verify` / `critic` / `reflect` / `vote` / `route`） | NodeRegistry 协议（[`04 §5.2 N-8 候选`](./04-protocol-roadmap.md)） |
| 没有 diff 注入上下文 | `replacementSourceIds` 升级为 diff-based 重渲染（参考 Codex `reference_context_item`） | context-manager v2 |

**信号**：可以用 linnkit 复刻一个简化版 ReAct + Plan + Reflect 三段式 agent，全程使用框架级 API，不去 patch graph engine。

### 1.3 灵活（Flexibility）

> **定义**：所有"宿主可决定的"东西都是 port，所有"框架自己决定的"东西都有清晰扩展点。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| port 已布到 LLM / persistence / telemetry | port 覆盖 memory / permission / sandbox / message-bus / event-bus / redaction | [N-2 / N-4 / N-5 / N-6](./04-protocol-roadmap.md) + [G-4](./04-protocol-roadmap.md#g-4-pii--secret-redaction-port-p2) |
| 没有 plugin 机制 | `linnkit-plugin-*` 包可以注册新工具 / 节点 / port adapter | plugin registry（[`06 §5`](./06-developer-experience-roadmap.md)） |
| `wait_user` 是 control flag | `wait_*` 是 GraphExecutor 一等概念，可扩展 `wait_external` / `wait_subagent` / `wait_human` | wait protocol 泛化 |

### 1.4 健壮（Robustness）

> **定义**：长 run 不丢、cancel 干净、cost 不失控、failure 可恢复、跨进程数据可重放。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| `RunSupervisor` 本体未实现，cancel 靠 AbortSignal 一根棒子 | 完整 `RunHandle v2`：cancel(reason) / pause / resume / observe / cost / progress | [N-3](./04-protocol-roadmap.md#n-3-runsupervisor-本体--runhandle-v2-p0) |
| 没有 cost 模型 | `CostLedger` + `QuotaPort` | [G-2](./04-protocol-roadmap.md#g-2-costledger--quotaport-p1) |
| Checkpointer 没有 contract test 覆盖极端情形 | contract test 覆盖恢复偏移 / 幂等 append / 乱序重放 | Checkpointer contract test 升级 |
| 工具失败、模型 fallback 不可审计 | 都走 `AuditEnvelope` | [G-1](./04-protocol-roadmap.md#g-1-auditenvelope-标准化-p0) |

### 1.5 优雅（Elegance）

> **定义**：协议层无遗留垃圾、无兼容期 alias 永驻、无"过去的妥协"残留。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| chat 兼容层还在，`profiles/chat/*` 还在 | 完全 agent-only core，chat = "tools-disabled agent" | [`07 Phase F.4`](./07-roi-ranked-priorities.md#phase-f)：chat 收敛期启动 + 删 `profiles/chat/*` |
| 迁移期 compat namespace 在根入口 | 已删除，root 入口保持稳定面干净 | [`07 Phase F.6`](./07-roi-ranked-priorities.md#phase-f) |
| `packages/schemas` 是外部 contract 层 | agent 自有协议并回 `linnkit/contracts` | 待 Phase G 评估 |

**信号**：root `linnkit` 入口的导出表只剩"对外稳定 API"，没有 `*Compat` 前缀。

### 1.6 易审计（Auditability）

> **定义**：任何一次 run，事后都能完整复现"模型选了什么 / 工具被拒原因 / fallback 触发条件 / 用户在哪步审批了什么 / cost 怎么累计的"。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| TelemetryPort 4 类 kind + noop | `AuditEnvelope` 标准化 + `AuditPort` | [G-1](./04-protocol-roadmap.md#g-1-auditenvelope-标准化-p0) |
| 无 PII / secret redaction | redaction port hook 在 LLM 调用 / 工具入参 / 事件持久化 三处 | [G-4](./04-protocol-roadmap.md#g-4-pii--secret-redaction-port-p2) |
| 回放靠 testkit/replayHarness 内部 | `linnkit/replay` 子入口 + DevTools Web | [G-3](./04-protocol-roadmap.md#g-3-replay-sdk--devtools-p1) |
| 权限决策无轨迹 | PermissionPort 的 allow / deny / ask / sandbox 决策也走 AuditEnvelope | [N-5 + G-1 联动](./04-protocol-roadmap.md) |

### 1.7 管理（Management / Lifecycle）

> **定义**：长 run、异步 run、定时 run、子 run 树都有统一中枢能 observe / cancel / list / report。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| `RunSupervisor` 本体未实现 | `registerRun / observeRun / cancelRun / pauseRun / resumeRun / handleFailure / listActiveRuns / runTree` | [N-3](./04-protocol-roadmap.md#n-3-runsupervisor-本体--runhandle-v2-p0) |
| 无 `runTree` 概念 | child-run 树形可观察 | RunSupervisor.runTree(rootRunId) |
| 无租户隔离 | session_key template 进 ports | [`04 §4 路线图`](./04-protocol-roadmap.md) |

### 1.8 多 Agent 协作（Multi-Agent Collaboration）

> **定义**：两个或多个 agent 可以异步消息互通、共享 working memory、协商 capability。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| 只有 child-run 单向调用 | actor 风格 mailbox：`bus.send(toAgentId, message)` / `bus.subscribe(...)` | [N-2 AgentMessageBus](./04-protocol-roadmap.md#n-2-agentmessagebus-portagent-to-agent-异步消息-p1) |
| 无 agent discovery | AgentSpec.capabilities[] + 简单 registry 协议 | AgentSpec + N-2 |
| 无共享 working memory | shared memory scope（per-conversation / per-tenant） | [N-4 MemoryPort](./04-protocol-roadmap.md#n-4-memoryport--knowledgeport产品中性的记忆抽象-p1) |
| `delegate_to_agent` 工具不存在 | 框架级通用工具 | [`05 §3`](./05-builtin-tools-protocol.md) |

### 1.9 集群 / 分布式（Cluster / Distributed）

> **定义**：linnkit 内核不假设单进程；EventBus、Checkpointer、RunSupervisor、Memory 都能跨进程 / 跨节点。

| 当前坐标 | 期望坐标 | 关键动作 |
|---|---|---|
| EventBus 是进程内 EventEmitter | EventBus 是 port，可装 Redis Stream / NATS / WebSocket fan-out | [N-6 EventBusPort](./04-protocol-roadmap.md#n-6-eventbusport-跨进程化-p2) |
| Checkpointer 只本地内存 + SQLite | 分布式 Checkpointer（Postgres / SQLite-WAL-shared / FoundationDB） | Phase H |
| RunSupervisor 单进程 | RunSupervisor cluster mode（一致性 hash / leader / 跨节点 cancel） | Phase H |
| `wait_user` 单一形态 | `wait_external` 泛化（webhook / IM 回调 / 子 agent 完成） | Phase H |

---

## 2. 9 条轴的优先级映射

| 轴 | 关键 P0 | 关键 P1 | 关键 P2 |
|---|---|---|---|
| 通用化 | N-1 AgentSpec | — | — |
| 高级 | — | reasoning artifact / NodeRegistry | — |
| 灵活 | — | N-2 / N-4 / N-5 / plugin | N-6 / wait protocol 泛化 |
| 健壮 | N-3 RunSupervisor | G-2 CostLedger | Checkpointer contract test 升级 |
| 优雅 | chat 收敛 + 删除迁移期 compat namespace | — | schemas 并回 |
| 易审计 | G-1 AuditEnvelope | G-3 Replay SDK + DevTools | G-4 Redaction |
| 管理 | N-3 RunSupervisor | session_key template | — |
| 多 Agent | — | N-2 AgentMessageBus | discovery / capability 协商 |
| 集群 | — | — | N-6 / 分布式 Checkpointer / cluster RunSupervisor |

> **观察**：P0 只压在"通用化 + 健壮 + 优雅 + 易审计"这 4 条轴上——这正是任何**新消费者立项前**真正的硬阻塞。
> 多 Agent / 集群 P1+P2 才发力，因为 P0 完成前去做 multi-agent 等于在沙地上盖楼。

---

## 3. 演进哲学

linnkit 演进遵循 4 条铁律：

1. **协议优先于实现**——能用 port 解的不内置实现；能用契约说明的不写代码示范
2. **门槛先于扩张**——任何升级前过 Q1-Q4 4 条门槛（[`../archive/engine-phases/00-engine-scope-audit.md`](../archive/engine-phases/00-engine-scope-audit.md) §1.1）
3. **信息丰富先于接口最小**——port 接口要带"宿主可能需要的元信息"，不要逼宿主反向回查
4. **不变量先于功能**——任何破坏现有不变量的提案要么不做，要么先升级不变量再做

→ 详见 [`04 §1`](./04-protocol-roadmap.md) 协议设计原则。
