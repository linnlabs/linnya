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

## LLM 重试策略

`createDefaultLlmCaller()` 是默认 root 与 child LLM caller 的唯一配置入口。同模型失败后最多
传输错误自动重试最多6次，输出损坏、限流和其他可重试错误各最多3次；初次请求不算重试。
类别预算独立计数，但同模型混合错误仍共享最多6次的总重试边界，不按类别轮换无限重试。
传输与限流指数等待，基础1500ms、单次本地上限60秒；连续六次传输等待为
1.5/3/6/12/24/48秒，合计94.5秒，另加每次请求本身耗时。更长的明确上游等待不被本地上限缩短。
长时间断网耗尽后沿原生命周期暂停与恢复，不新增Host重试器。Linnkit唯一拥有调度、取消与模型切换；
总真实调用数继续使用框架默认上限8，覆盖重试与已有切模路径，单一固定模型持续传输失败最多调用7次。
不可重试错误、显式禁止客户端重试及取消仍遵守框架原有约束。Provider SDK 保持零自动重试。

配置在 caller 构造时生效，没有运行中的热更新入口。普通 resume 复用已装配的 root caller；
Host 重建后恢复旧 run 仍须通过正式 runtime compatibility 校验，不能绕过框架版本或身份门禁。
行为测试使用真实 npm Linnkit caller 与脚本化 inference port，验证次数、实际等待、失败输出撤回及取消，
不发送外部模型请求。

## 可观察性装配

`createDefaultGraphRuntimeDependencies()` 接收可选：

- `telemetryPort`：供 graph_node / run_lifecycle / llm_call / context_build / context_compaction / tool_call 事件写入宿主 sink
- `auditPort`：供 model.select / model.fallback / context.manager / tool / wait_user 等决策写入审计账本
- `tokenizer` / `tokenCounter`：统一 context 预算估算、LLM telemetry 本地估算和 token ledger

中文备注：可观察性是显式依赖注入，不是全局 recorder。需要扩展落点时，优先包一层 Port adapter。

## 自定义工具装配

Host 提供自定义工具环境时，应一起传入 `toolRuntime` 与从同一 registry 创建的
`toolManager`：前者供模型 schema 和执行定义使用，后者供上下文的可用名称、参数校验与
历史摘要使用。默认环境不传时保持现有全局装配。Child invoker 的默认 LLM node 与
ToolNode 共用传入的完整 `ToolRuntimePort`，不能只替换执行端。若显式覆写 `createLlmNode`
或 `contextBuilder`，调用者负责在该自定义构建器内保持一致。

这些是通用依赖注入口，不是权限沙箱或历史资料过滤。历史实验仍须在自己的 adapter
约束每次执行、资料版本和恢复身份，不能仅凭自定义 schema 声称已隔离。

## 文件树

```text
src/app-hosts/linnya/adapters/runtime-assembly/
├── README.md
└── graphRuntimeFactory.ts
```
