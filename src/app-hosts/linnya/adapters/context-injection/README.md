# Context Injection Host Adapter

Layer: `host-adapter/context-injection`

这里承接 Linnya backend 默认的上下文注入实现。  
如果要回答“runtime 在真正执行前，默认的 Agent 上下文和 ToolContext 是怎么被装进去的”，应该看这里。

---

## 1. 模块定位

本目录负责：

- 默认 `GraphExecutorContextBuilder` 装配
- Agent message orchestration 的宿主注入
- 自动 compaction 的候选格式化、重建 port 与 canonical cache anchor 投影
- `ToolContext` 的 host services / host ports 注入
- runtime-owned capability 的安装时机控制

本目录不负责：

- 定义 `GraphExecutorContextBuilder` 最小合同
- 定义 `ToolExecutionContext` / `ToolContext` 的 runtime 协议本体
- 定义 context-manager 的产品语义本体

---

## 2. 核心职责

1. 把 `context-manager` 的 Agent orchestration 接到 runtime 调用链上
2. 为 runtime 提供默认的上下文构建器
3. 为工具执行提供默认的 `ToolContext` 宿主注入
4. 保持“宿主如何注入”和“runtime 协议本体是什么”两层分离

---

## 3. 关键边界 / 不变量

1. 这里只负责“如何注入”，不重新定义 runtime 协议
2. `ToolContext` 的 runtime capability 仍由 `packages/linnkit/src/runtime-kernel/tools/*` 定义
3. `ToolContextPatch` 不能覆盖 runtime 保留字段
4. 默认 `ToolManager` / orchestrator 只在宿主层装配，不下沉到 runtime-kernel

---

## 4. 详细目录树

```text
src/app-hosts/linnya/adapters/context-injection/
├── README.md
├── defaultGraphExecutorContextBuilder.ts  # 默认 GraphExecutorContextBuilder 宿主实现
└── toolContextFactory.ts                  # ToolContext 宿主注入工厂
```

---

## 5. 真实数据流

### 5.1 默认 GraphExecutorContextBuilder 链路

`defaultGraphExecutorContextBuilder.ts` 的职责不是“自己定义上下文协议”，而是把 Linnya 默认产品能力接到 runtime 已经定义好的最小合同上：

1. runtime 调用 `GraphExecutorContextBuilder.build(...)`
2. 宿主默认 builder 统一走 agent 路径：
   - `AgentMessageOrchestrator`
   - `ToolManager`
   - 注册式 agent task resolver
3. 输出统一的：
   - `llmMessages`
   - prepared model route 驱动的 `promptBudget`
   - 已解析的 `contextCompactionPolicy`
   - 存在连续可替换历史时的 `contextCompactionCandidate`
   - system prompt 末尾与最新 `history_summary` 末尾的 canonical cache breakpoints

容量规则固定为：prepared model route 的 `context_window_tokens / max_output_tokens` 是基线；注册 Agent 只有显式声明 `contextPolicy.budget.maxTokens / reservedForResponse` 时才能进一步收窄。Host 不按 Provider、模型名或 URL 猜容量，也不把 Linnkit 的 standalone fallback 当作缺失 catalog route 的兼容路径。`outputLimitTokens` 会继续进入 Graph 的 `llmOptions.max_tokens`，成功 attempt 的 `ContextUsageSnapshot` 使用同一组输入/输出预算。

自动 compaction 在这里仅完成 Host 装配，不在 Context build 内调用 LLM：Context Manager 只产出纯替换计划；Graph 逐条复用普通 reminder 已注入的完整 canonical Prompt，再追加一条瞬态 user-role 消息承载专用 compaction reminder，并以当前已锁定模型、同一工具 schema 顺序和 `tool_choice=none` 执行内部调用。Graph 随后调用 `applyCompaction(...)`，本 adapter 再把固定格式内容交给 Context Manager 校验并重跑同一上下文 pipeline，返回重建候选与 pending `history_summary` draft。最终容量接纳、Host durable-before-fanout 提交、progress end、唯一 publisher fan-out 与失败结算全部仍由 Graph / Flow 拥有。

主 Prompt 与 compaction 请求共用同一个 cache policy 形状：仅在 system prompt 末尾和最新 `history_summary` 末尾声明稳定 breakpoint；Provider wire 形态由 inference adapter 投影。本 adapter 不识别 Provider 名称，也不按 route 选择另一套压缩算法。

开启 `LINNYA_LLM_RUN_AUDIT` 时，这里会在 `formatAgentLlmMessages(...)` 后记录 after 快照：

- `contextMessages`：context-manager 产出的内部 `AiMessage[]`，用于检查裁剪、重排、参数截断是否正确
- `llmMessages`：真正发给模型的 materialized messages，用于排查 formatter / provider 协议问题

关键点是：runtime 只知道“这里有个 builder”，而不知道具体用了哪个 orchestrator、哪个 `ToolManager`、哪个 task resolver。builder 不拥有第二套摘要 Agent、模型 resolver 或 RuntimeEvent publisher。旧 chat 任务已迁到 tools-disabled `single_turn` agent，默认上下文构建器不再保留 chat 分支。

### 5.2 ToolContext 宿主注入链路

`toolContextFactory.ts` 的主链是：

1. 宿主传入：
   - `hostServices`
   - `hostPorts`
   - `request`
   - `runContext`
   - `toolContextPatch`
   - `history`
2. 先把宿主字段投影到 `ToolContext`
3. 再调用 runtime helper 安装：
   - `conversationView`
   - execution meta
4. 返回最终 `ToolContext`

这里的关键边界是：

- host services / ports 由宿主定义
- runtime capability 由 runtime-kernel 定义
- 本目录只负责“把两边接上”

### 5.3 EventBus ToolContext ports

`createRuntimeEventToolContextHostPorts(...)` 负责把：

- `createSubRunTracePublisher`
- `registeredChildRunInvoker`

注入为工具侧只读的 host ports。其中 trace publisher 由当前 run 的
`RuntimeEventSink` 创建；child invoker 必须由 composition root 创建并原样传入。
工具侧不需要知道 EventBus、Supervisor 或 EventStore 的装配细节，只消费窄端口。

`registeredChildRunInvoker` 不是这里按需创建的默认能力。root ToolContext 与递归
child 必须继承同一个 invoker 实例，确保它们引用同一次 runtime 装配；缺少端口说明
Host 装配不完整，应在 child admission 前失败，禁止回退模块级 invoker 或 Memory runtime。

---

## 6. 最容易放错层的改动

1. `ToolContext` runtime 最小字段定义
   - 不属于这里，属于 runtime-kernel/tools
2. `ToolManager` 产品策略本体
   - 不属于这里，属于 context-manager/product layer
3. `GraphExecutorContextBuilder` 最小接口合同
   - 不属于这里，属于 runtime-kernel/graph-engine
4. SSE / persistence / flow session 行为
   - 不属于这里，属于其他 host adapters

---

## 7. 开发注意事项

1. 如果改的是“默认怎么把 context-manager 接给 runtime”，优先改这里
2. 如果改的是 runtime capability 本身，不要在这里偷偷扩字段
3. `toolContextPatch` 只用于增量注入，不要把它重新变成“任意袋子”
4. 如果上层只需要工具摘要能力，应优先通过 `ToolManager` 暴露的较小视图消费，而不是继续向上透传完整 registry
5. 新增 runtime 执行能力时，先判断其 owner：属于 Host 生命周期的端口必须由 composition root 创建，经工厂显式注入；不得在本目录使用 global getter 或 lazy singleton
6. “继承同一个 invoker”只表示共享装配能力；每个 child 仍必须拥有独立 `run_id / execution_id / answer_id`，不能复用父 run 身份

---

## 8. 最小回归集合

改默认上下文构建链路时，至少补或复跑：

- `src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/toolContextFactory.test.ts`
- `src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.test.ts`：正式 route 预算、compaction policy/candidate、cache breakpoint 与重建合同
- `src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/summarizationEventEmitter.test.ts`：progress callback 不发布 durable summary 事实
- `src/app-hosts/linnya/adapters/flow/__integration-tests__/agentRunner.interrupted.integration.test.ts`
- `src/app-hosts/linnya/adapters/flow/__integration-tests__/flow.followup-tool-history.integration.test.ts`

如果改的是自动 compaction 接线，再加：

- `src/app-hosts/linnya/adapters/flow/__integration-tests__/summarization.e2e.test.ts`

如果改的是 `ToolManager` 接线，再加：

- `packages/linnkit/src/context-manager/profiles/agent/context/providers/__tests__/multiToolFollowup.integration.test.ts`

如果改的是 child invoker / runtime scope 接线，再加：

- `src/app-hosts/linnya/adapters/child-runs/__tests__/childRuntimeScopeIsolation.integration.test.ts`
- `packages/linnkit/src/runtime-kernel/child-runs/__tests__/childToolContext.test.ts`

---

## 9. 相关文档

- `packages/linnkit/src/runtime-kernel/README.md`
- `packages/linnkit/src/runtime-kernel/graph-engine/README.md`
- `packages/linnkit/src/runtime-kernel/tools/README.md`
- `src/app-hosts/linnya/adapters/tools/README.md`
- `packages/linnkit/src/context-manager/README.md`
- `src/app-hosts/linnya/context/README.md`
