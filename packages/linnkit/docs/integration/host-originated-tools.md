# Host-originated tools

## 1. 适用场景

Host-originated tool 指由产品中的确定性动作直接发起、而不是由模型选择的工具调用。例如用户点击一个明确按钮后，host 已经知道要调用哪个工具以及参数是什么。

这条能力不等于向 Agent 暴露更多工具，也不等于在 Graph 外执行工具。正确路径仍然是进入 `ToolNode`，让同一个 runtime 负责执行、输出事件、审计、遥测和后续 LLM 路由。

## 2. 公共入口

`@linnlabs/linnkit/runtime-kernel` 提供 `createHostToolCallBootstrap`。

它从一组同源输入构造：

- 标准 tool call。
- 与该 call ID、工具名和参数一致的 `tool_call_decision`。
- 固定的 `tool` 起始节点。
- 可与 host 运行时状态合并后传给 `GraphExecutor.prime` 的 local patch。

该 helper 只构造协议事实，不执行工具。

## 3. Host 仍然负责

- 生成 conversation、turn、run、event 和 tool call 身份。
- 提供合法、可序列化的工具参数。
- 发布并持久化 helper 返回的 decision event。
- 注入 request、`ToolExecutionContext`、AbortSignal、SSE/IPC sink 和执行策略。
- 装配 GraphExecutor、ToolNode、LLM 节点、checkpointer、tool runtime、audit 和 telemetry。
- 把 local patch 与本次 run 的其它 local 状态合并，再以 helper 返回的 `nodeId` prime executor。
- 调用 `runUntilYield` 并处理返回事件与 run 生命周期。

Linnkit 不替 host 选择具体工具，不生成业务参数，也不提供全局“系统工具运行器”。

## 4. Decision event 生命周期

helper 已把 decision event 放进返回的 history，使 ToolNode 完成后进入 LLM 时能够重建合法的工具调用上下文。

该 decision event 不会因为从 `tool` 节点开始而自动出现在 `runUntilYield` 的返回事件中。Host 必须在执行前将它走与普通 LLM decision 相同的发布和持久化通道，且不能再次把它追加进 history。

ToolNode 产生的 process/output 事件继续由 Graph runtime 返回和分发。

## 5. 关键不变量

1. `toolCall.id`、decision 的 `tool_call_id` 和 meta 中的 call ID 必须同源。
2. 工具名和 args 必须同时写入标准 call 与 decision payload，不能由 host 分别拼装。
3. 起始节点固定为 `tool`，不要先走一次空 LLM 调用。
4. 工具必须由 ToolNode 执行，禁止 Graph 外直接调用 ToolRuntime 后手写 output 事件。
5. 若工具完成后需要 LLM 收尾，run 的 step 预算必须覆盖 tool 与后续 llm。
6. 需要自然生成单一 final answer 的工具不得设置 `terminateRun` 或 `control.finalAnswer`。
7. 系统专用工具是否暴露给 Agent 是 host 的产品策略；使用 bootstrap 不会自动注册或暴露工具。

## 6. 与其它入口的区别

| 入口 | 谁选择工具 | 起始节点 | 适用场景 |
|------|------------|----------|----------|
| 普通 Agent run | LLM | `user` / `llm` | 用户意图需要模型判断 |
| Host-originated bootstrap | Host 的确定性产品逻辑 | `tool` | 工具和参数已经确定 |
| Child run | 父工具或 runtime | `llm` | 需要隔离上下文的子 Agent |
| Testkit scripted decision | 测试脚本 | 测试 harness 决定 | 仅协议测试，生产禁止依赖 |

## 7. 不适用场景

- 不要用它替代普通 Agent 的工具选择。
- 不要用它绕过权限、审计或 ToolRuntime 注册。
- 不要在 Linnkit helper 中加入 table、editor、workflow 或具体工具名。
- 不要用它批量构造多个互不相关的顶层工具对；批量产品语义应由一个明确的父工具拥有。

## 8. 验证要求

Host 接入时至少验证：

- decision 与 tool call 身份、名称和参数完全一致。
- decision 先于 tool output 发布并持久化。
- ToolNode 实际收到预期参数。
- 工具成功或失败后按 Graph 策略进入后续 LLM。
- reload 后 provider 历史仍能重建合法的工具调用对。
- 取消、审计、遥测与普通 Graph run 使用同一通道。
