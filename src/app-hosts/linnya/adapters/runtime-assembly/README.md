# Runtime Assembly

Layer: `host-adapter`

这里承载 Linnya backend 默认 runtime 装配入口。

## 功能

- 创建默认 `ModelResolver`
- 创建默认 `LlmCaller`
- 创建默认 `GraphAgentExecutor`
- 创建默认 `LlmNode`
- 把 host 的 `TelemetryPort` / `AuditPort` / tokenizer / `token-accounting` public port 注入 runtime-kernel

## 边界

- 这里负责装配，不负责定义 runtime protocol
- 可依赖 `agent-registry` 的默认模型策略和工具注册
- 不允许把默认实现再回流到 `core/*`
- `GraphAgentExecutor` 只消费 ports；不要在 executor/stage 里直接 import Linnya 的 SQLite、logger、registry 单例

## 可观察性装配

`createDefaultGraphRuntimeDependencies()` 接收可选：

- `telemetryPort`：供 graph_node / run_lifecycle / llm_call / context_build / context_compaction / tool_call 事件写入宿主 sink
- `auditPort`：供 model.select / model.fallback / context.manager / tool / wait_user 等决策写入审计账本
- `tokenizer` / `tokenCounter`：统一 context 预算估算、LLM telemetry 本地估算和 token ledger

中文备注：可观察性是显式依赖注入，不是全局 recorder。需要扩展落点时，优先包一层 Port adapter。

## 文件树

```text
src/app-hosts/linnya/adapters/runtime-assembly/
├── README.md
└── graphRuntimeFactory.ts
```
