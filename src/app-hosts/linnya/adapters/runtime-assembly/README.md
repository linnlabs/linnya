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
自动重试 6 次，即首次调用加 6 次重试；向框架声明的基础等待为 1500 ms。Linnkit 仍拥有错误分类、
重试编排与模型切换，较长的分类建议间隔不能被 Host 的基础间隔缩短。总真实调用数继续使用
框架默认上限 8，覆盖重试与已有切模路径；单一固定模型持续失败时最多调用 7 次。
不可重试错误、显式禁止客户端重试及取消仍遵守框架原有约束。Provider SDK 保持零自动重试。

当前依赖的 Linnkit 0.37.4 会优先使用结构化可重试错误的 1000 ms 建议值，因此 canonical 断流场景
实际仍等待 1000 ms。1500 ms 下限需在后续正式框架修复版本中生效；Host 不增加第二个等待或
重试器来覆盖它。当前业务测试验证次数、流重置和取消，不把配置值冒认为实际等待时间。

配置在 caller 构造时生效，没有运行中的热更新入口。普通 resume 复用已装配的 root caller；
Host 重建后恢复旧 run 仍须通过正式 runtime compatibility 校验，不能绕过框架版本或身份门禁。
行为测试使用真实 npm Linnkit caller 与脚本化 inference port，验证次数、失败输出撤回及取消，
不发送外部模型请求。

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
