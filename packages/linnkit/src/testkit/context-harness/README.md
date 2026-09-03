# Context Harness 说明

`packages/linnkit/src/testkit/context-harness/` 用来放“上下文协议测试”专用夹具。

它和 `agent-harness` 的区别是：

- `agent-harness` 更关注真实 graph loop 闭环
- `context-harness` 更关注历史回放、预处理、Provider 与 `contextPolicy` 不变量

## 当前夹具

### `replayHarness.ts`

用途：

- 把 `RuntimeEvent[]` 回放成 `AiMessage[]`
- 聚焦断言 `tool_calls / tool_output / history_summary` 这类协议消息
- 避免测试直接散落调用 `convertEventsToAiMessages(...)`

适合验证：

- `tool_node action` 不会污染下一轮 `tool_calls`
- 持久化事件回放顺序是否正确
- 某类运行时事件是否应进入 LLM 上下文
- `tool_call_decision.payload.reasoning_details` 是否能回放到 `AiMessage.metadata.reasoning_details`

### `contextPipelineHarness.ts`

用途：

- 统一驱动 `preprocessor -> Provider` 测试链路
- 复用状态构造、预算、token 估算、核心消息标记
- 降低上下文不变量测试的样板代码

适合验证：

- 历史压缩结果是否会被 `AgentWorkingMemoryProvider` 重新选回
- `replacementSourceIds` 是否驱动净化阶段移除旧消息
- 某个 Provider 在指定预算和核心消息条件下的行为是否稳定
- 带真实 provider sidecar 的工具组经过预处理和 working memory 后是否仍可结构化 replay
- 缺 sidecar 的历史工具组在 provider 协议守卫下是否降级为文本历史

### `invariants/`

用途：

- 用 `validateContextPolicyInvariants()` 校验 `contextPolicy` 是否真的影响最终上下文
- 以 `ContextTrace` 为事实来源，检查 effective policy、预算、provider token delta、message keep/drop 决策
- 把工具配对、must-keep 类型、trace 细节开关这类“每个 token 可解释”的协议要求固化成可复用断言

当前默认启用 12 条不变量：

1. `contextTrace.enabled` 与实际 trace 产出一致
2. `ContextTrace.effectivePolicy` 等于本次预期 policy
3. trace 细节开关与 policy 一致
4. `maxTraceEvents` 限流自洽
5. original / final message 数与 trace 计数一致
6. final tokens 不超过总预算
7. provider `tokenDelta = afterTokens - beforeTokens`
8. `includeMessageIds` / `includeTokenBreakdown` 不泄露被关闭的明细
9. message-decision 的 keep/drop reason 与 kept 状态一致
10. `tool_calls` / `tool_output` 的 keep/drop 决策不拆对
11. `mustKeep.alwaysKeepTypes` 声明的消息类型必须保留
12. host 注入 `TokenizerPort` 后，`message-decision.tokens` 与 `finalTokens` 必须由 host tokenizer 估算结果驱动

## 使用建议

1. 测 graph 执行闭环时，优先用 `agent-harness`。
2. 测回放协议或上下文退化时，优先用 `context-harness`。
3. 不要在业务测试里重复手搓 `MessageProcessingState[]`，除非你在测状态数组本身。
4. 测 DeepSeek / Gemini 这类 replay sidecar 约束时，优先断言 sidecar 挂在同一条 `assistant(tool_calls)` 消息上，而不是断言附近存在 `thought` 文本。
5. 测 `AgentSpec.contextPolicy` 生效链路时，优先开启 `contextTrace.enabled=true` 并调用 `validateContextPolicyInvariants()`。
