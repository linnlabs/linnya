# Agent Registration Guide · Agent 注册与装配规范

> **What** · `AgentSpec` 静态蓝图 + `defineAgent` quickstart helper + `contextPolicy` 10 大分组 + 多 agent 协作。
> **When to read** · 第一次注册 agent；精细化控制上下文；多 agent 串接；做 agent 注册表。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)；建议先读 [`tool-development-guide.md`](./tool-development-guide.md) ⭐。
> **Key exports** · `AgentSpec` / `ToolBindingSpec` / `defineContextPolicy` from `@linnlabs/linnkit/contracts` · `defineAgent` / `runAgent` from `@linnlabs/linnkit/quickstart`。
> **Related** · [`context-engineering.md`](./context-engineering.md) ⭐ · [`context-fences.md`](./context-fences.md) ⭐ · [`child-runs.md`](./child-runs.md) · [`llm-provider.md`](./llm-provider.md)

linnkit 把 Agent 视为**一等对象**——一个 Agent 是**可序列化的静态蓝图**（`AgentSpec`），不是一段散落的配置 + prompt。这让它能进入 audit / replay / testkit 不变量校验路径。

---

## 0. 一句话分层

| 层 | 是什么 | 谁持有 |
|----|--------|--------|
| **`AgentSpec`** | 蓝图：id / version / 工具集 / contextPolicy / model hints | host 装配期注册到 registry |
| **`AgentInvocationRequest`** | 一次调用：query / history / fences / modelId | runtime 每次调用构造 |

修改 `AgentSpec` = 版本升级（需 audit）；修改 `AgentInvocationRequest` = 运行期决策（不需 audit）。

---

## 1. 在哪里定义 Agent · 示例

> **TL;DR**：一个 Agent 一个文件 / 子目录。**Quickstart** → `agents/<id>.ts`；**生产 host** → `agent-registry/<id>/spec.ts`。linnkit 不规定路径——下面是推荐形态。

### 1.1 Quickstart 形态（demo / 试用 / 单测）

```text
my-agent-demo/
├── tools/searchDocs.ts          # SearchDocsTool extends BaseTool
├── agents/
│   ├── pptAssistant.ts          # defineAgent({...})
│   └── emailWriter.ts
└── main.ts                       # runAgent(agent, { input, inference })
```

### 1.2 生产 host 形态（产品里长期维护）

```text
app-hosts/<your-app>/
├── agent-registry/
│   ├── index.ts                 # 集中导出 + 注册到 host registry
│   ├── pptAssistant/
│   │   ├── spec.ts              # AgentSpec.parse({...})
│   │   ├── prompt.ts            # systemPrompt（host 自管，不进 AgentSpec）
│   │   └── tools.ts             # toolId 字符串数组
│   └── emailWriter/spec.ts
├── adapters/{tools,inference}/
└── runtime-assembly/             # GraphExecutor 装配
```

### 1.3 新加一个 Agent · 三步走

| 步 | Quickstart | 生产 host |
|----|------------|----------|
| 1. 入口 API | `defineAgent()` from `@linnlabs/linnkit/quickstart` | `AgentSpec.parse()` from `@linnlabs/linnkit/contracts` |
| 2. 建文件 | `agents/<id>.ts` 一个文件 | `agent-registry/<id>/spec.ts` 一个子目录 |
| 3. 注册 | `import` 给 `runAgent()` | `agent-registry/index.ts` 集中 `AgentRegistry.register(spec)` |

> `AgentRegistry` 是 host 自己实现的（最简就是 `Map<string, AgentSpec>`）——linnkit 协议层不规定形状。详见 §6.1。

---

## 2. `AgentSpec` 字段速查

```ts
import { AgentSpec, defineContextPolicy } from '@linnlabs/linnkit/contracts';

const spec = AgentSpec.parse({
  id: 'pptAssistant',
  version: '1.2.3',
  capabilities: ['agent', 'createPpt'],
  tools: [{ toolId: 'search_docs', argsSchema: searchDocsTool.parameters }],
  contextPolicy: defineContextPolicy({
    profileId: 'agent',
  }),
  role: 'PPT 制作助手',           // ⚪
  audit: { redactionLevel: 'standard', pii: false }, // ⚪
  metadata: {},                    // ⚪ host 业务字段，不要升格为协议字段
});
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | host registry 唯一标识；audit / replay / telemetry 全部用它 |
| `version` | ✅ | semver；任何协议级改动 bump 这里（见 §7） |
| `capabilities` | ✅ | 能力声明字符串数组；host 路由 / 权限决策可用 |
| `tools` | ✅ | `ToolBindingSpec[]` —— 见 §3 |
| `contextPolicy` | ✅ | **必须**用 `defineContextPolicy()` helper —— 见 §4 |
| `role` / `description` / `audit` / `metadata` | ⚪ | 见上方示例 |

> 模型选择不在 `AgentSpec` 里用 hint 表达。生产 host 应在自己的 agent registry / model policy 层显式决定模型，并在运行时传入 `AgentInvocationRequest.model_id` 或装配自己的 `ModelResolver`。不要把“偏好模型 / fallback chain”写进静态 spec 后期待 framework 自动路由。

---

## 3. `tools` 字段：`ToolBindingSpec[]`

```ts
tools: [
  { toolId: 'search_docs', argsSchema: searchDocsTool.parameters },
  { toolId: 'search_docs', argsSchema: ..., bindingId: 'search_v2', config: { topK: 10 } },
]
```

**核心约束**：

1. **`argsSchema` 是可序列化 JSON Schema 副本**——直接塞 runtime `zod` 对象会被协议层拒绝（让 `AgentSpec` 不可 audit / replay）。
2. **`toolId` ≠ `BaseTool` 实例**——`AgentSpec` 只持名字字符串，实际工具实例由 host 的 `ToolRuntimePort` 管理。
3. **同一 `toolId` 可绑定多次**——用 `bindingId` 区分（如同一搜索工具配两套 `topK`）。
4. **`config` / `metadata` 是 host 自由字段**——framework 不解读。

---

## 4. `contextPolicy` 与 `defineContextPolicy()`

```ts
import { defineContextPolicy } from '@linnlabs/linnkit/contracts';

const contextPolicy = defineContextPolicy({
  profileId: 'agent',
  // 只有这个 Agent 确实需要比模型 route 更小的窗口/输出时才声明容量 cap。
  budget: { maxTokens: 128_000, reservedForResponse: 8_000 },
  toolHistory: { strategy: 'per-run', overflowStrategy: 'keep-latest' },
  compaction: { triggerRatio: 0.8, targetRatio: 0.5 },
});
```

10 大分组的详细说明见 [`context-engineering.md`](./context-engineering.md) ⭐。

如果你只是想确认“改预算要不要改很多地方”，先看 [`context-engineering.md §0.1`](./context-engineering.md#context-policy-source-of-truth)：模型 route 是容量真相源，`contextPolicy` 是 Agent 行为与可选容量上限的声明入口；运行时会先做三层合并，再由 adapter 拆给各消费点。

> ⚠️ **不要手写 `AgentSpecContextPolicy` 对象**——`defineContextPolicy()` 会补齐 framework 行为默认值并执行严格 schema 校验；但不会补造 `maxTokens / reservedForResponse`，因为缺失表示继承模型 route。

### 4.1 模型容量、Agent cap 与 token 估算分别由谁负责？

prepared model 的正式 route 提供 `context_window_tokens / max_output_tokens`。Agent 未声明容量 cap 时直接使用 route；显式声明 `maxTokens / reservedForResponse` 时只能进一步收窄。没有模型 route 的独立 Context Manager 接入使用 256K/16K framework fallback。

linnkit 内置默认 tokenizer（`tiktoken` + 字节比兜底），用于在已经解析好的 token 预算内估算消息占用。三种调整方式：

| 你的场景 | 推荐做法 |
|---------|---------|
| 试用 / 默认行为够用 | 不动 |
| GPT-4o 系 | `tokenEstimation: { encoding: 'o200k_base' }` |
| 中文为主 | `tokenEstimation: { avgCharsPerToken: 1.7 }` |
| 严格按真实 Claude/Gemini 计费做预算 | 注入自定义 `TokenizerPort`（见 [`context-engineering.md §9.4`](./context-engineering.md)） |

linnkit **不**做：跨 provider 统一计费 token 数协议（不同模型口径不一样）。计费 token 走 provider `usage`。

### 4.2 自动上下文压缩：`compaction`

长任务不再注册专用摘要 Agent，也不通过 Context build 内的 Provider 调模型。Graph 在主调用前计量最终 Prompt，达到阈值后用**当前 Agent 的模型与完整 Prompt**发起一次无工具压缩请求：原 Prompt 每条消息保持不变，最后新增一条瞬态 `role=user` 消息承载压缩专用 `<system-reminder>`。它不是 system-role message，也不持久化。压缩结果只有在重建后通过容量门禁才会提交为 durable `history_summary`；后者当前由 Context Manager 以 `role=system` 投放，二者不是同一个对象。

```ts
defineContextPolicy({
  profileId: 'agent',
  compaction: {
    enabled: true,
    triggerRatio: 0.8,
    targetRatio: 0.5,
    keepLatestToolGroups: 2,
    maxOutputTokens: 8192,
    maxCompactionsPerRun: 12,
  },
});
```

- `enabled` 默认为 `true`；显式 `false` 才关闭。
- `triggerRatio` 是软触发线，`targetRatio` 是压缩后的目标占比，且必须更低。
- `keepLatestToolGroups` 保护最近完整工具组；附件和不完整工具组也不进入可替换区段。
- `maxOutputTokens` 限制本次压缩输出；`maxCompactionsPerRun` 限制单次 run 真正到达 Provider 的压缩 attempt，失败调用也会消耗这项产品护栏。
- 压缩不增加 Agent 、工具或 Graph 节点，不重置步数预算，前端也无需新的配置与交互。
- System Reminder 的普通 tick 与压缩专用位置合同见 [`runtime-kernel/system-reminder/README.md`](../../src/runtime-kernel/system-reminder/README.md)。

---

## 5. 两种注册 API

### 5.1 生产：`AgentSpec.parse()`

```ts
// agent-registry/pptAssistant/spec.ts
import { AgentSpec, defineContextPolicy } from '@linnlabs/linnkit/contracts';

export const pptAssistantSpec = AgentSpec.parse({
  id: 'pptAssistant',
  version: '1.2.3',
  capabilities: ['agent', 'createPpt'],
  tools: [{ toolId: 'search_docs', argsSchema: searchDocsToolSchema }],
  contextPolicy: defineContextPolicy({ profileId: 'agent' }),
});
```

### 5.2 Quickstart：`defineAgent()`

```ts
import { defineAgent } from '@linnlabs/linnkit/quickstart';

export const pptAssistant = defineAgent({
  id: 'pptAssistant',
  version: '1.2.3',
  role: 'PPT 制作助手',
  systemPrompt: '你是 ...',
  modelId: 'claude-sonnet-4',
  capabilities: ['agent', 'createPpt'],
  tools: [new SearchDocsTool()],
  contextPolicy: {},
});
```

| 维度 | `defineAgent()` | `AgentSpec.parse()` |
|------|----------------|---------------------|
| 工具引用 | 持有 `BaseTool` 实例 | 只持 `toolId` 字符串 |
| systemPrompt | 必填，由 helper 持有 | 不存在（host 自管 prompt 装配）|
| modelId | helper 字段 | 生产 host 显式传入运行请求或在 host modelPolicy 中解析 |
| 用途 | demo / 测试 / 5 分钟入门 | 生产 host 接入 |

完整 quickstart demo 见 [`02-quickstart.md`](./02-quickstart.md)。

---

## 6. 生产 host 装配 · 三件事

### 6.1 实现 `AgentRegistry`

linnkit 不规定形状，host 自己实现。最小职责：`register(spec)` + `get(agentId)`。

| Pattern | 适用场景 |
|---------|----------|
| **A · 内存 Map** | 80% 场景；agent 集合在编译期确定（典型单进程宿主）。`new Map<string, AgentSpec>()` 即可 |
| **B · 启动时从 JSON 加载** | 让运维 / PM 改配置就能调 agent。boot 时 `AgentSpec.parse(json)` 校验 |
| **C · 数据库 + 动态更新** | 多租户 SaaS；UI 编辑 spec；要 audit trail |

> ⚠️ 无论用哪种 pattern，**`AgentSpec.parse()` 是必经入口**——保证进入 runtime 的 spec 100% 满足协议约束。绕过 = 让坏数据流到生产。

### 6.2 装配 GraphExecutor（进程级共享单例）

```ts
import { createDefaultGraphExecutor, LlmNode, LlmCaller } from '@linnlabs/linnkit/runtime-kernel';

const executor = createDefaultGraphExecutor({
  llmNode: new LlmNode({ llmCaller: new LlmCaller({ aiEngine }) }),
  toolRuntime,             // host 实现，见 tools.md
  observationPreview,      // host 实现，见 tools.md
});
```

所有 agent 共用一个 executor，每次调用通过 `agentSpec` 切换蓝图。

### 6.3 运行期入口 · `AgentInvocationRequest`

```ts
// HTTP / IPC / CLI handler
const spec = AgentRegistry.get(req.agentId);
if (!spec) throw new Error(`Unknown agent: ${req.agentId}`);

await executor.run({
  agentSpec: spec,
  runId: generateRunId(),
  query: req.userMessage,
  history: await loadHistory(req.conversationId),
  fences: await buildFences(req),    // 见 context-fences.md
  modelId: resolveModelIdForAgent(spec, req),
});
```

详细装配见 [`02-quickstart.md`](./02-quickstart.md) 与 [`run-supervisor.md`](./run-supervisor.md)。

---

## 7. AgentSpec 版本管理

`AgentSpec` 是协议层蓝图——任何修改都要 bump version：

| 修改 | 版本号 | 配套动作 |
|------|--------|----------|
| 加工具 / 加 capability | minor | audit log 记"能力扩展" |
| 改 `contextPolicy.budget` / `toolHistory.strategy` / `toolHistory.retentionMode` | minor | audit log；考虑 replay 验证 |
| 删工具 / 删 capability | **major** | audit log；既有 run 进 deprecated 路径 |
| 改 `metadata` / `role` / `description` 文案 | patch | 一般不需要 audit |

**对 replay 的影响**：未来 Replay SDK 按 `AgentSpec.version` 精确匹配——同一 runId 必须用**当时的 spec 版本**重演。这是 `version` 必填、spec 必须可序列化的原因。

---

## 8. 多 Agent 协作

linnkit 协议层只承认两种多 agent 形态——**不做** AgentMessageBus / role / backstory 这类"自由 chat"协议。所有多 agent 行为必须能映射到下面其一，才能 100% 可审计 / 可回放。

```ts
import { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

// 同步嵌入：子 run 的 cost 聚合到父 run
const result = await runSupervisor.invokeChildRun({
  parentRunId: context.runId,
  agentSpec: emailWriterSpec,
  input: { query: '写感谢信...' },
});

// 异步后台：立刻返回 handle，可 observe / cancel / waitForTerminal
const handle = runSupervisor.spawnDetached({
  agentSpec: backgroundAgentSpec,
  input: { task: '生成每日报告' },
});
```

详细对比见 [`child-runs.md`](./child-runs.md)。

---

## 9. 自查清单

- [ ] agent 文件位置正确（Quickstart `agents/<id>.ts` / 生产 `agent-registry/<id>/spec.ts`）
- [ ] 一个文件 / 子目录只放一个 Agent
- [ ] 已在入口处注册（`runAgent()` 引用 或 `AgentRegistry.register(spec)`）
- [ ] `AgentSpec.parse()` 是 registry 入口必经路径（生产 host）
- [ ] `id` 在 registry 中唯一；`version` 是 semver；`capabilities` 明确
- [ ] `argsSchema` 是可序列化 JSON Schema 副本（**不是** runtime `zod` 对象）
- [ ] `contextPolicy` 用 `defineContextPolicy()` 而**不是**手写
- [ ] 多 agent 协作走 `invokeChildRun` 或 `spawnDetached`，不自由 chat
- [ ] 有交互工具 → 配套 `WaitUserNode` 路径（见 [`tool-development-guide.md §7`](./tool-development-guide.md)）
- [ ] 配套写了 testkit 不变量测试（见 [`testing.md`](./testing.md)）

---

## 10. 与其他文档的关系

- [`tool-development-guide.md`](./tool-development-guide.md) — 工具内部设计规范
- [`tools.md`](./tools.md) — `ToolRuntimePort` / `ObservationPreviewPort` 接入面
- [`context-engineering.md`](./context-engineering.md) — 10 大分组 `contextPolicy` + `TokenizerPort`
- [`context-fences.md`](./context-fences.md) — fence 注册与注入（与 `mustKeep` 配合）
- [`run-supervisor.md`](./run-supervisor.md) — `RunHandle.cost()` / `observe` / `cancel`
- [`child-runs.md`](./child-runs.md) — `invokeChildRun` vs `spawnDetached`
- [`audit.md`](./audit.md) — Agent 调用 / spec 升级的审计 envelope
- [`testing.md`](./testing.md) — testkit 26 条 strict invariants
