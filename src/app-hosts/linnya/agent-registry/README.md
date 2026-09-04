# Agent Registry 模块架构文档

> 核心：`agent-registry` 是 Linnya 后端 Agent 的产品层注册中心。  
> 它不拥有 runtime 协议，也不拥有 host 装配；它只负责声明“有哪些 agent/chat/internal 定义，以及这些定义如何接到产品主链里”。
>
> 当前真实 owner：  
> `src/app-hosts/linnya/agent-registry/`

---

## 模块定位

`agent-registry` 负责三件事：

1. 声明产品可用的 `AgentDefinition / ChatDefinition / internal definition`
2. 把 prompt、task、integrations、tool whitelist、model policy、step policy 内聚到定义本身
3. 让主链通过“注册式分发”拿配置，而不是在 flow、child-run、tool、skills 等位置散落硬编码分支

它**不负责**：

- graph loop / node protocol / event lifecycle
- ToolContext runtime capability
- child-run history / trace / lifecycle protocol
- realtime / persistence / flow host session
- 工具运行时装配

所以它既不属于 `runtime-kernel`，也不属于 `host-adapters`；它属于：

- `src/app-hosts/linnya/agent-registry/*`

---

## 概念模型

可以把 `agent-registry` 看成 Linnya Agent 的“产品语义注册表”。

runtime-kernel 提供的是：

- graph-engine
- llm
- events
- tools runtime protocol
- child-run protocol

host-adapters 提供的是：

- flow
- context-injection
- child-run default assembly
- persistence / realtime

而 `agent-registry` 提供的是：

- 这个产品有哪些 agent
- 每个 agent/chat/internal key 对应什么 prompt / task / integrations
- 每个定义允许哪些工具
- 默认模型、stepPolicy、系统提醒、技能暴露等产品规则

模型选择边界：

- 前端显式传入的 `model_id` 优先，表示用户本次操作已经解析好的模型选择。
- agent registry 的 `modelPolicy` 负责“未显式传模型时”的后端默认，例如注册 agent 指定固定模型或按 capability 选择。
- 后台 worker 只读 job payload / 索引事实，不读取 renderer Pinia 或 localStorage。
- registry 只选择模型身份，不声明该模型的理论容量。Graph 锁定 prepared model 后，从正式 inference route 读取上下文窗口和最大输出；definition 的 `contextPolicy.budget` 只有显式声明时才作为 Agent 上限，不能在 registry 里复制模型容量或按模型名猜值。

Default Agent 的上下文压缩边界：

- Linnkit 的自动上下文压缩是唯一 live compaction owner。
- Agent 注册只声明业务能力，不承载上下文压缩工具或压缩编排。
- Default Agent benchmark 必须复用正式 runtime 的同一套自动压缩链路。

一句话说：

- runtime-kernel 决定“怎么跑”
- host-adapters 决定“怎么接宿主”
- agent-registry 决定“跑谁、按什么产品语义跑”

---

## 核心数据流

### 一次 Agent 请求的数据流

```text
promptKey / mode
  -> agent-registry 找到 definition
  -> definition 提供 prompt / task / integrations / config
  -> context-manager 构建 request / messages
  -> host flow 装配 GraphExecutor / ToolRuntime / ChildRunInvoker
  -> runtime-kernel 执行
```

这里 `agent-registry` 真正负责的是第二步：

- 找 definition
- 提供 definition 所声明的 product-level config

它不应该跨过这条边界，去直接参与：

- graph tick 决策
- ToolNode 执行
- SSE 发射
- history persistence

### 一次 Chat 请求的数据流

```text
promptKey
  -> chats/index.ts 聚合定义
  -> chat/tasks/index.ts 分发 task
  -> context-manager/chat 构建上下文
  -> host flow / runtime 执行
```

`chat` 的本质也是注册式分发，只是定义树位于 `chats/*`。

### 一次 Child-run 的数据流

```text
tool / parent flow
  -> registeredAgentResolver
  -> agent-registry 找到 agent definition
  -> childRunInvokerFactory 装配默认 invoker
  -> runtime-kernel/child-runs 执行
```

这里 `agent-registry` 只负责：

- 让 resolver 能找到目标 agent definition

它不负责：

- child-run trace policy
- seed history policy
- parent tool context 缩减

这些都已经收在 独立 Linnkit 仓的 `src/runtime-kernel/child-runs/*` 和 `src/app-hosts/linnya/adapters/child-runs/*`。

---

## 关键边界 / 不变量

### 1. registry 只声明，不执行

definition 可以声明：

- `availableTools`
- `modelPolicy`
- `maxSteps`
- `stepPolicy`
- `task`
- `integrations`

但 definition 本身不执行工具，也不拥有 runtime capability。

### 1.1 `stepPolicy.force_tools` 与工具 `control` 的分工

当某个 agent 的最终产物必须由指定工具产出时，definition 可以声明：

```ts
stepPolicy: {
  kind: 'force_tools',
  forcedTools: ['assemble_documents'],
  lastStepsHintThreshold: 3,
}
```

这只解决一件事：在接近步数上限时，runtime 会把模型往这些工具上收口，避免最后一步变成普通文本回答。
收口只发生在真实 LLM 调用前；已经进入 ToolNode 的普通工具批次不会被跳过。`maxSteps` 统计 Graph
节点，同一批工具由一个 ToolNode 按顺序排空。

工具执行后是否结束循环，不属于 registry，也不应该写成 runtime 的工具名特判。这个决策必须由工具返回值声明：

- `control.terminateRun=true`：该工具结果已经闭环，ToolNode 写完 `tool_output` 后结束本轮 run。
- `control.finalAnswer='...'`：该工具产物需要投影为 `final_answer` 事件。

典型组合是 deep search / deep research 的收口工具：`deep_search` 的 `assemble_documents` 用 `terminateRun` 结束子 run；deep research 的 `write_report` 会同时给 `finalAnswer` 和 `terminateRun`。普通检索、读取、编辑工具不要结束循环。

长任务预算也应由 definition 声明。当前 Default Agent 与 Slides Agent 使用 `maxSteps: 800`；未声明的
Agent 继续继承 Linnkit 的 80 步框架默认值。Host 的 root 与 registered child-run 装配都消费同一个
definition 字段，Renderer 和 wire DTO 不维护另一份默认值。root runner 把 HistoryBuilder 已解析的
`request.maxSteps` 显式传给共享 GraphExecutor 的 `startSession` / `resumeSession`；GraphExecutor 构造
参数只负责未声明预算时的框架默认值。

### 2. child-run 只能触发“已注册 agent”

这是当前系统的硬约束。

工具、leader、task 等上层调用子 agent 时，必须最终落到 registry 中已有的 definition。  
禁止在工具或 flow 里临时拼一个“匿名 agent”绕过 registry。

### 3. promptKey 的 wire contract 是 string，运行时由 registry 校验

`prompt.types.ts` 是产品层聚合入口。内置 key 仍优先使用 `@app/schemas` 的 `PromptKeys` 常量，避免散落字符串。  
插件 key 由插件自己的 shared contract 声明，并通过 app-host registry 贡献注册。请求 schema 只校验 `promptKey` 是字符串；真正“有没有这个能力”的判断在 agent/chat registry。

### 4. integrations 是产品声明，不是宿主装配

`RequestEnricher`、`HistoryBuilderExtender` 等 integrations 可以在 definition 里声明，
但具体怎么被 flow/context-manager 消费，是 host/product 主链的事情。

不要把：

- sqlite 查询
- persistence 读写
- realtime 行为

直接塞回 registry 本体。

### 5. 一个 definition 目录应尽量自洽

对单个 agent/chat 而言，优先内聚：

- `index.ts`
- `prompt.ts`
- task 特化实现（如有）
- 与该定义强相关的局部配置

而不是把 prompt、task、工具名单、扩展点分散到多个 unrelated 目录。

### 6. 顶层场景 agent 与领域 Skill 必须分责

以 Slides 为例：场景 Agent 只定义角色、激活 `slides-design` Skill 和最终结果要求；共享 Skill 负责计划审批、Workspace source、CLI 与验收流程。Default Agent 与 Slides Agent 因而使用同一份领域合同，不再维护 Slides 专用执行子 Agent。

同一原则适用于 Workspace Markdown：任何会用 `edit_file` 修改、或用 `write_file` 覆盖已有正式 Markdown 的 AgentDefinition，都必须暴露 `skill` tool 与 Catalog，使模型可以按需激活 `linnya-markdown`。具体兼容规则只写在 Skill 中，不能复制到每个 Agent prompt；`requiredSkills` 只表示配置依赖，不代表自动激活。

---

## 目录树

```text
src/app-hosts/linnya/agent-registry/
├── README.md
├── types.ts
├── registry.ts
├── GenericAgentTask.ts
├── modelPolicyResolver.ts
├── prompt.builder.ts
├── prompt.types.ts
├── builtin/
│   ├── builtin-agent-definitions.ts
│   └── index.ts
├── agents/
│   ├── index.ts
│   ├── __tests__/
│   ├── default/
│   ├── deep_search/
│   ├── deep_research/
│   ├── slides_agent/
│   ├── review/
│   ├── mindmap/
│   ├── subagent_document_editor/
│   ├── subagent_mindmap_editor/
│   ├── subagent_general/
│   ├── project_planning/
│   ├── single_turn/
│   │   ├── annotation/
│   │   ├── audio_summary/
│   │   ├── autocomplete/
│   │   ├── conversation_title/
│   │   ├── translation/
│   │   └── writing/
│   ├── table_ai_fill/
│   ├── writing/
│   └── ...
├── internals/
│   ├── index.ts
│   ├── ingestion/
│   ├── transcription/
│   └── knowledge_graph_extraction/
├── system/
│   └── llm_fallback/
└── utils/
    └── currentTime.ts
```

### 目录职责

- `agents/*`
  - 面向 `mode=agent` 的产品定义
  - 顶层场景 agent 与 task 子 agent 可以共存，但职责必须明确分开
  - 通用研究委派由 `subagent_general` 承担；Knowledge 多轮检索由
    `knowledge_search(deep_search=true)` 内部的 `deep_search` Agent 承担，不再维护两者之间的重复研究子 Agent
- `agents/single_turn/*`
  - 面向无状态单轮任务的产品定义，例如自动补全、翻译和新对话标题生成
  - 这类任务仍通过统一 agent registry 注册；前端请求应显式传入已解析的辅助模型 ID
- `internals/*`
  - 宿主内部使用、但仍通过统一 prompt/definition 体系管理的定义
- `builtin/*`
  - 注册入口与内置定义聚合
- 根目录下的 `types / registry / prompt.builder / GenericAgentTask`
  - 是 definition 体系的公共骨架

---

## 关键文件说明

### `types.ts`

定义：

- `AgentDefinition`
- `AgentConfiguration`
- `AgentRegistryDependencies`

这是 registry 的核心合同。  
如果这里改动，通常会影响：

- `flow` 的 request build
- `registeredAgentResolver`
- `GenericAgentTask`
- `skills / review / deep_research` 等产品模块

### `registry.ts`

这是产品注册中心。  
它不该长出运行时逻辑；这里只能做：

- 注册
- 查找
- 聚合

### `GenericAgentTask.ts`

这是“默认 agent task 实现”。  
它的职责是：

- 基于 definition 生成默认系统提示与请求行为

但它不是一个“万能宿主入口”。  
如果某类 agent 明显有专用产品规则，应使用专门 task，而不是不断向 `GenericAgentTask` 塞特例。

### `prompt.builder.ts`

负责 prompt template 的装配。  
这里只做 template 级拼接，不要把：

- flow session 逻辑
- context pipeline 逻辑
- tool runtime 逻辑

塞进 prompt builder。

---

## 开发注意事项

### 新增一个 agent 时

优先按这个顺序做：

1. 在 `agents/<name>/` 新建目录
2. 放 `prompt.ts`
3. 放 `index.ts`，导出 `AGENT_DEFINITION`
4. 在 `agents/index.ts` 聚合
5. 需要特殊行为时，再引入专用 task / enricher / extender

如果这个 agent 的最终答案必须来自某个工具，额外检查两件事：

1. 在 definition 里配置 `stepPolicy.kind='force_tools'` 和明确的 `forcedTools`。
2. 在对应工具的 `StructuredToolResult.control` 里声明 `terminateRun`，必要时声明 `finalAnswer`。

不要把“某工具执行后结束循环”写进 runtime-kernel 的工具名分支；这会让 linnkit 重新耦合 Linnya 业务语义。

不要一开始就在：

- flow
- context-manager
- tool
- integrations

到处散落条件分支。

### 新增一个 chat task 时

优先在：

- `chats/<promptKey>/`

下内聚：

- `prompt.ts`
- `task.ts`
- `index.ts`

不要把 chat 规则写回 `context-manager/chat/tasks/index.ts` 之外的分发链路。

### 何时该用 `GenericAgentTask`

适用于：

- 只有 prompt + config 差异
- 不需要额外 request build 特化
- 不需要特殊持久化/注入链

不适用于：

- review 这类强产品语义任务
- 明显需要专用 buildMessages / request enrich 的任务

### 何时该声明 `RequestEnricher`

只有当某个定义确实需要：

- 基于请求补充 injected context
- 基于产品数据源动态增强 request

才在 definition 里声明。  
不要把普通 prompt 组装误做成 enricher。

### 何时该声明 `HistoryBuilderExtender`

只有当这个定义真的需要影响 history build options 时才使用。
如果只是工具白名单或模型偏好变化，不应该走 extender。

---

## 常见放错层的位置

### 错误 1：把运行时协议改动塞进 registry

例如：

- 想支持新的 child-run trace 字段
- 想改 ToolContext capability
- 想改 tool_output preview

这些都不属于 registry，应该去：

- `runtime-kernel`
- `host-adapters`

### 错误 2：把产品特例堆进 flow

如果某个 agent 需要特殊策略，优先先问：

- 能不能通过 definition 声明解决？
- 能不能通过 task / enricher / extender 解决？

不要第一时间把 `if (promptKey === ...)` 堆到 flow 或 run-preparation。

### 错误 3：把跨产品通用能力伪装成 product rule

如果未来发现某类声明机制在多个产品都会复用，再考虑抽 shared/product-neutral core。  
当前不要为了“看起来通用”而提前把 Linnya 语义伪装成 framework 层。

---

## 代码评审清单

改 `agent-registry` 时，至少检查：

1. 这个改动是产品层声明，还是 runtime/host 行为？
2. 有没有把执行逻辑塞进 definition/registry？
3. 新增定义是否已经在聚合入口注册？
4. prompt、task、config 是否仍保持内聚？
5. 内置 key 是否仍用 `@app/schemas` 的 `PromptKeys`，插件 key 是否经 registry 注册？
6. 是否无意中让 flow/context-manager 背上新的 `if promptKey === ...` 分支？

---

## 最小验证集合

改 registry 主链后，最小应跑：

- [singleTurnAgents.test.ts](./agents/__tests__/singleTurnAgents.test.ts)
- [slidesAgent.test.ts](./agents/__tests__/slidesAgent.test.ts)
- [deepResearchAgents.test.ts](./agents/__tests__/deepResearchAgents.test.ts)
- [mindmapWorkflowLeader.test.ts](./agents/__tests__/mindmapWorkflowLeader.test.ts)
- [agentSkillExposure.test.ts](../../../features/skills/__tests__/agentSkillExposure.test.ts)

如果改动影响 child-run / tool 调用主链，还应补跑：

- [subagentRunner.integration.test.ts](../../../tools/agent_control/subrun/shared/__tests__/subagentRunner.integration.test.ts)
- [subagentTool.failure-recovery.integration.test.ts](../../../tools/agent_control/subrun/subagent/__tests__/subagentTool.failure-recovery.integration.test.ts)
- [researchSubagentWorkspace.integration.test.ts](../../../tools/deep_research/__tests__/researchSubagentWorkspace.integration.test.ts)
- [mindmapSubagentTools.test.ts](../../../../packages/plugins/mindmap/src/backend/tools/mindmap/__tests__/mindmapSubagentTools.test.ts)

---

## 推荐阅读顺序

1. [runtime-kernel README](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/README.md)
2. [context-manager README](https://github.com/linnlabs/linnkit/blob/main/src/context-manager/README.md)
3. [Linnya context README](../context/README.md)
4. 本文档

一句话总结：

`agent-registry` 的价值不在“帮 runtime 执行”，而在“把产品定义收成一个稳定、可检查、可迁移的注册式声明层”。
