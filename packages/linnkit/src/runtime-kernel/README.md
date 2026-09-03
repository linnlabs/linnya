# Runtime Kernel 总览

Layer: `runtime-kernel`

这里承接后端 Agent 可复用的运行时骨架。  
本目录是 `linnkit` package 的 runtime-kernel 真源。任何新接入方都通过 `linnkit/runtime-kernel` 装配它。

---

## 1. 模块定位

本目录负责：

- graph loop 与节点协议
- RuntimeEvent 生命周期治理、AgentEvent → RuntimeEvent 桥接；标准 SSE wire 投影在 `contracts`
- llm caller / resolver / streaming normalization
- tool runtime 最小协议
- child-run 最小协议
- run-context / enrichment / reminder / subrun trace
- audit sink 与决策审计 helper（EventStore / noop / console / file / composite）
- telemetry port 与运行事实事件（llm/tool/context/graph/run lifecycle）

本目录不负责：

- 任一产品的默认 runtime 装配
- realtime / persistence / application flow 等 Host application layer
- concrete tools 与产品服务

---

## 2. 关键边界 / 不变量

1. `runtime-kernel` 不得反向依赖 `host-adapters`
2. 不得直接依赖产品 registry、workspace、knowledge base 或其它 Host domain
3. 新协议要优先定义最小合同，不要继续把 product 类型直接拖进来
4. `ToolContext` 不能整体粗暴搬进来，只能继续拆成 runtime-owned 小接口
5. `audit/` 只放 sink、组合器与决策审计 helper；审计协议 schema 真源在 `contracts/audit.ts`
6. 标准 `RuntimeEvent → SSEEvent` 投影真源是 `contracts.runtimeEventToSSEEvent()`；runtime-kernel 不再保留 `AnyAgentEvent → SSE` 老路径
7. kernel 内部可观察性必须走显式 `AuditPort` / `TelemetryPort`；不要在 graph node / middleware 中直接写全局 recorder 或 AsyncLocalStorage

---

## 3. 详细目录树

```text
packages/linnkit/src/runtime-kernel/
├── README.md
├── audit/                     # AuditPort sink：EventStore / noop / console / file / composite
├── child-runs/                # child-run 原语、history policy、最小上下文（同步子 run 可独立 runId/parentRunId）
├── execution/                 # event-bus / sequencer / runtime error factory
├── events/                    # agentEvents / eventGovernance / eventMappers（AgentEvent→RuntimeEvent；SSE 投影在 contracts）
├── graph-engine/              # GraphExecutor / typed tick-pipeline / nodes / checkpointer / event-store
├── llm/                       # caller / modelResolver / policies / streaming
├── enrichment/                # enrichment registry 与 patch 合同
├── run-context/               # run trace / parent / tags
├── run-supervisor/            # RunSupervisor / RunHandle / lifecycle functions / RunRegistryStore
├── child-run-trace/           # subrun_trace 观测协议 publisher 与最小合同
├── system-reminder/           # reminder 标签、规则注册表与普通 tick 注入；见模块 README
├── telemetry/                 # TelemetryPort + 5 类 kind 常量 + noop 默认实现 + contract 测试
└── tools/                     # tool contracts / execution context / schema context / helpers
```

> **公开入口提醒**：本目录通过两个 package export 暴露：
> - `linnkit/runtime-kernel`（**Node-only** 全展开 namespace，含 `node:async_hooks` / `crypto` 等）
> - `linnkit/runtime-kernel/events`（**browser-safe slim seam**，仅 `events/` 下的 governance 纯函数；浏览器客户端必须走这个）

---

## 4. 真实数据流

### 4.1 graph run

1. `GraphExecutor` 驱动 graph loop
2. `tick-pipeline` 完成一次 llm 调用前后的阶段化处理
3. `LlmNode` / `ToolNode` 执行节点语义
4. 事件统一落到 `events/*`
5. 工具执行依赖 `tools/*` 的最小协议

#### tick-pipeline 写入契约

`LlmNode` 内部的一次 LLM tick 由 `tick-pipeline` 五个 stage 组成。stage 必须通过 `defineTickStage` 声明自己读取和写入的顶层字段，并返回 patch 交给 `runTickPipeline` 合并。

中文备注：这条约束是为了避免 stage 重新退回“共享可变 ctx 袋”模式。新增 stage 时不要直接改 `ctx.xxx`；需要追加 `newEvents` 时返回 `appendNewEvents`，由 runner 保留原数组引用并集中追加。

### 4.2 child-run

1. runtime-kernel 只定义 child-run 原语与最小上下文
2. registered agent resolve 与 invoker 装配在接入方 Host composition root / adapter
3. Host 必须显式把 child invoker 注入 root ToolContext，递归 child 继承同一 capability
4. 工具侧只消费 child-run 入口，不拥有协议本体

这里的“同一 capability”表示 root 与 child 使用同一次 Host runtime 装配，不表示它们
共享运行身份。每个 child 仍必须拥有独立的 `run_id / execution_id / answer_id`，并通过
`parent_run_id` 与父 run 建立关系。

Host 不得在 child 执行期通过 global getter 分别获取 Supervisor、EventStore、Audit、
Telemetry 或 CostCollector，也不得在缺端口时创建 Memory fallback。进程 singleton 若被
采用，只能由 composition root 读取一次并封装成显式 scope，再注入所有消费者。

---

## 5. 开发注意事项

1. 如果一个能力必须知道某个产品的默认装配、目录或数据模型，它不该放这里
2. 如果一个类型包含明显的 product 字段，优先继续拆小接口，而不是搬整个大类型
3. 变更 `events / graph-engine / tools` 协议时，必须补最小 contract 回归
4. 不接受 compatibility bridge、旧 shape reader 或产品特判进入 kernel 主链
5. child-run 接入必须分别验证同一 scope 内的并发 run 身份隔离，以及两套 Host runtime
   scope 之间的实例隔离；二者不能互相替代

---

## 6. 推荐阅读顺序

1. [`graph-engine/README.md`](./graph-engine/README.md)
2. [`tools/README.md`](./tools/README.md)
3. [`llm/README.md`](./llm/README.md)
4. [`system-reminder/README.md`](./system-reminder/README.md)
5. [`../../docs/integration/README.md`](../../docs/integration/README.md)

---

## 7. 相关文档

- [`packages/linnkit/docs/README.md`](../../docs/README.md)
- [`packages/linnkit/src/runtime-kernel/graph-engine/README.md`](./graph-engine/README.md)
- [`packages/linnkit/src/runtime-kernel/tools/README.md`](./tools/README.md)
- [`packages/linnkit/src/runtime-kernel/system-reminder/README.md`](./system-reminder/README.md)
- [`packages/linnkit/docs/archive/engine-phases/README.md`](../../docs/archive/engine-phases/README.md)（早期抽包决策档案总览，**已归档**）
- [`packages/linnkit/docs/framework/`](../../docs/framework/)（linnkit 框架演进活文档）
- [`packages/linnkit/docs/archive/engine-phases/24-phase-e-implementation-runbook.md`](../../docs/archive/engine-phases/24-phase-e-implementation-runbook.md)（早期抽包 runbook，归档参考）
