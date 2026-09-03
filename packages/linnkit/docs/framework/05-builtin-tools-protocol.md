# 05 · 框架级通用工具

> linnkit **不内置任何业务工具**（bash / web search / IM 等）。但**有几件"框架级通用工具"是值得考虑内置的语法糖**——它们都对应 linnkit 协议层概念，跨产品通用。
>
> **整体优先级显著靠后**：通用工具是协议层的**薄包装**，必须等对应协议层稳定下来才有意义；在那之前不做，避免给未定型协议加装饰层。本文先把候选清单立住，每件具体上线时机由对应协议层成熟度决定。

---

## 1. 设计原则

一件工具能进 linnkit 框架级，必须同时满足：

1. **是协议层概念的语法糖**——这个工具实际上调用 linnkit 内部协议，不是封装外部 API
2. **跨所有 agent 通用**——任何 agent 都可能用，不绑死任何业务场景
3. **对应协议已稳定**——否则就是给一组未定型协议加薄包装

如果只满足 (2) 但不满足 (1)，就是宿主层工具（譬如 `read_file`），不进框架。

如果 (1) (2) 都满足但 (3) 不满足，**先等协议稳定**，不急于内置工具。

---

## 2. 候选清单（**优先级靠后**，按需做）

| 工具 | 对应协议 | 前置 | 状态 |
|---|---|---|---|
| `todo` | 框架级 todo store + RuntimeEvent | RuntimeEvent 已稳 | 📋 候选，按需 |
| `delegate_to_agent` | child-run protocol | N-1 AgentSpec + N-3 RunSupervisor | 📋 等前置 |
| `memory_read` / `memory_write` | MemoryPort（N-4） | N-4 上线 | 📋 等前置 |
| `skills_list` / `skills_load` | Skill / Plugin 协议 | 协议尚未立项 | 📋 候选，等真实场景 |

> 所有工具的 `name` 用 `linnkit_*` 前缀（譬如 `linnkit_todo`），避开宿主自定义工具命名冲突——除非有强烈历史惯例理由不加前缀。本文示意名省略前缀。
>
> `context_checkpoint` 已从候选与 live API 退役。上下文压缩是 Graph tick pipeline 的自动能力，不再向 Agent 暴露工具。

---

## 3. 已删除的候选：`request_user_input`

> ❌ **明确不做**。

曾经的设想是：提供一个标准 `request_user_input` 工具让 LLM 直接说"我需要用户输入 X"，靠工具的 `control.requireUser=true` 触发 `wait_user`。

**为什么不做**：

1. **真正的交互式能力不能用"工具调用工具"的链式结构表达**——比如"问用户一个问题"在协议层就应该是 `wait_user`，不是 `tool_call(name='request_user_input', args)` 然后等下一轮回填
2. **加了 `request_user_input` 反而会鼓励错误模式**：LLM 会倾向用工具调用代替自然语言提问，让"问问题"这件事走一条不必要的协议路径
3. **协议层已有正确表达**：任何具体业务工具（如 `create_calendar_event`）需要用户确认就在自己的工具定义里设 `control.requireUser=true`；通用提问就让 LLM 直接说话——`wait_user` 由"LLM 没有 tool_call 且没有 final_answer 但暗示需要回应"自然触发，不是工具触发

**结论**：保留 `wait_user` 协议本身（已是核心能力），但**不再在框架级工具列表里加 `request_user_input`**。

---

## 4. `todo` 工具（候选）

### 4.1 为什么是框架级候选

几乎所有 agent prompt 都会让 LLM "把要做的事列出来"。各家做法五花八门：

- Claude Code：`TodoWrite` 工具 + 内部 store
- Codex：结构化 `Plan` 工具
- Cursor / 自己手写的 agent：让 LLM 在 prompt 里维护一个 markdown 列表（脆弱）

如果每个产品都重新设计 todo，会撞到同样的协议问题：**"todo 改了要不要进上下文"、"长 run 中途崩了恢复 todo"、"父子 agent 的 todo 怎么共享"**。

### 4.2 工具 schema（草案）

```ts
{
  name: 'todo',
  description: 'Manage your task list. Use this to plan, track progress, and stay organized across long-running tasks.',
  parameters: {
    type: 'object',
    properties: {
      action: { enum: ['list', 'add', 'update', 'complete', 'remove'] },
      items: { /* TodoItem[] */ }
    }
  }
}
```

### 4.3 协议交互

- todo 状态存在 `todoStore`（per runId / per conversationId 由 AgentSpec 决定）
- 任何 todo 变更发 `runtime.todo_changed` RuntimeEvent
- `eventGovernance`：默认 `persist=true / replayToUi=true / enterAgentContext=true`（todo 在窗口里始终可见）
- `realtimeChannel=true`，UI 可以实时刷新 todo 面板

### 4.4 与上下文的关系

- todo 列表通过上下文 provider **每轮自动注入**（参考 Claude Code 的 todo reminder）
- todo 进入上下文有专门的渲染策略（不重复占太多 token，只显示未完成 + 最近完成的几条）

---

## 5. 已退役：`context_checkpoint` 工具

早期方案曾考虑让 Agent 主动提交 checkpoint marker。该方向已经退役，不是待实现候选：

- Agent 不应承担上下文资源管理，也不需要看到平台控制工具；
- 手动工具把上下文压缩、TaskState 和 Graph 步数预算耦合在一起，边界不可维护；
- 当前唯一 live 机制是自动 compaction：Context Manager 选择完整可替换历史并生成纯计划，Graph 使用当前模型生成固定格式摘要、重建并重新计量，容量接纳后才提交 durable `history_summary`；
- 执行恢复继续只由 `Checkpointer` 拥有，自动 compaction 不写执行 marker、不重置 `maxSteps`。

旧工具、policy 字段、step-reset 和 UI 卡片均直接删除，不保留别名或兼容入口。当前合同见 [`context-engineering.md`](../integration/context-engineering.md) 与 [Graph Engine README](../../src/runtime-kernel/graph-engine/README.md)。

---

## 6. `delegate_to_agent` 工具（等 N-1 + N-3）

### 6.1 为什么是框架级候选

child-run 是 linnkit 的核心原语，但目前 agent 要调用子 agent 必须靠**宿主提供的工具**——每个宿主都要自己写一套，重复造轮子。

### 6.2 工具 schema（草案）

```ts
{
  name: 'delegate_to_agent',
  description: 'Delegate a task to another agent and wait for the result.',
  parameters: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'Target agent id (must be registered)' },
      task: { type: 'string', description: 'Task description for the child agent' },
      input: { type: 'object', description: 'Structured input' },
      mode: { enum: ['sync', 'detached'], default: 'sync' }
    }
  }
}
```

### 6.3 协议交互

- `mode: 'sync'`：调用 `RunSupervisor.spawnDetached` + 等待 child run 完成；阻塞父 run（其实是 wait_subagent 形态）
- `mode: 'detached'`：返回 child runId，父继续；child 通过 N-2 AgentMessageBus 推送结果回来

**与 N-1 + N-3 的耦合**：

- 必须先有 `AgentSpec` 才知道 agentId 合法
- 必须先有 `RunSupervisor` 本体才能 spawnDetached

---

## 7. `memory_read` / `memory_write`（等 N-4）

### 7.1 协议依赖

需要 N-4 MemoryPort 先上线。

### 7.2 工具 schema（草案）

```ts
{
  name: 'memory_write',
  description: 'Save a fact to long-term memory. Always include citations.',
  parameters: {
    type: 'object',
    required: ['fact', 'citations'],
    properties: {
      fact: { type: 'string' },
      type: { enum: ['episodic', 'semantic', 'procedural'] },
      importance: { type: 'number', minimum: 0, maximum: 1 },
      citations: { type: 'array', items: { /* CitationRef */ } }
    }
  }
}

{
  name: 'memory_read',
  description: 'Search long-term memory for relevant facts.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      scope: { enum: ['agent', 'conversation', 'tenant', 'shared'] },
      limit: { type: 'number', default: 5 }
    }
  }
}
```

### 7.3 协议不变量

- `memory_write` **强制 citations**——参考 Codex Memory Citation 协议；没有 citations 的 fact 不接收
- 写操作发 `memory.written` RuntimeEvent，自然进 EventStore + AuditEnvelope
- 读操作发 `memory.searched` RuntimeEvent（含 query 和 hits 的摘要），可审计 LLM 用了哪些 fact 做决策

---

## 8. `skills_list` / `skills_load`（候选，等协议立项）

### 8.1 为什么是候选

参考 Claude Code `ToolSearchTool` + `defer_loading` 思路：

- 当 agent 工具数量很多时（10+），全部塞 LLM tools 列表会污染上下文 + 让 LLM 选择失误
- `skills_list` 让 LLM 先看一眼有哪些"技能包"，按需 `skills_load` 把对应工具集激活

### 8.2 协议依赖

需要先确立 **Skill / Plugin 协议**（[`04 §5.3`](./04-protocol-roadmap.md)），让宿主可以注册"工具组"。AgentSpec 也需要 `defer_loaded_capabilities` 字段。

**结论**：协议未立项前不做。

---

## 9. 不会进框架的工具（明确划线）

这些都是**宿主 / 产品层**职责，linnkit 永远不会内置：

| 工具 | 为什么不进 |
|---|---|
| `read_file` / `write_file` / `edit_file` | 涉及文件系统抽象；不同产品（桌面 / IDE / sandbox）需求差异巨大 |
| `bash` / `shell_exec` | 涉及沙箱策略 / 安全审批；归 N-5 PermissionPort + SandboxPort 之上的产品层 |
| `web_search` / `browser` / `crawl` | 涉及 API key / 配额 / 缓存策略；不同产品需求差异大 |
| `kb_search` / `note_create` | 涉及知识库实现；归"知识工作平台"类产品 |
| `send_message` / `tg_reply` | 涉及具体通道；归"接 IM 的常驻 daemon"类产品 |
| `cron_register` / `schedule_task` | 涉及调度器实现；归宿主 daemon |
| `git_commit` / `gh_pr_create` | 涉及具体 SCM 集成；归专门 IDE 产品 |
| `request_user_input`（曾被考虑） | 真交互必须走 `wait_user` 协议级暂停，不能用工具链表达；详见 §3 |

**判断口诀**：

- 如果一个工具的实现需要 import 任何宿主特定 SDK / 调用任何外部服务 → 不是框架级。
- 如果一个能力必须靠"工具调用工具"才能表达 → 它本身就该是协议，不是工具。

---

## 10. 工具发布形态

### 10.1 在框架内的位置

```text
packages/linnkit/src/runtime-kernel/builtin-tools/
├── README.md
├── todo/
│   ├── tool.ts
│   ├── store.ts
│   └── __tests__/
├── delegate-to-agent/   # 等 N-1 + N-3
└── memory/              # 等 N-4
```

### 10.2 注册方式（草案）

```ts
import { runtimeKernel, builtinTools } from 'linnkit';

const tools = [
  ...builtinTools.essentials(),     // 候选：todo 等真正稳定的框架级薄包装
  ...builtinTools.multiAgent(),     // delegate_to_agent (要求 RunSupervisor + AgentSpec 实现)
  ...builtinTools.memory(),         // memory_read / memory_write (要求 MemoryPort 实现)
  ...customTools,
];

const agentSpec: AgentSpec = {
  // ...
  tools: tools.map(t => ({ id: t.name })),
};
```

### 10.3 关闭某个工具

宿主可以选择不注册框架级工具——这跟"任何 port 都可以 noop" 的设计哲学一致。

---

## 11. 路线图位置

参考 [`07 §2.4`](./07-roi-ranked-priorities.md)：通用工具优先级 **显著低于** 协议层（N-x）和治理升级（G-x）。**Phase F 不做任何通用工具**；Phase G 视协议层成熟度按需补；不允许"为了凑齐工具"提前做。
