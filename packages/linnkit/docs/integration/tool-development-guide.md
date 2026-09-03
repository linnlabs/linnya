# Tool Development Guide · 工具开发规范

> **What** · 写自定义工具的强制协议与设计规范 —— `data` / `observation` 分层、错误处理、幂等执行、`getExecutionSummary` 与长 observation 治理。
> **When to read** · 第一次写自定义工具；现有工具 token 偏多想优化；review 工具实现是否符合规范。
> **Prerequisites** · [`tools.md`](./tools.md)（工具接入面基础）；[`02-quickstart.md`](./02-quickstart.md)。
> **Key exports** · `BaseTool` / `ToolExecutionContext` from `@linnlabs/linnkit/runtime-kernel`。
> **Related** · [`tools.md`](./tools.md) · [`tool-history.md`](./tool-history.md) · [`context-engineering.md` §6](./context-engineering.md)

> 这份文档回答一个问题：**怎么写一个高质量的工具，让它既能被 linnkit 协议层接住，又能给 AI / UI 双方都提供恰到好处的信息密度？**

linnkit 在协议层守住"工具调用的边界"——`ToolRuntimePort` + `BaseTool` 抽象类 + tool 配对不变量（C10）+ `AuditEnvelope`。但**工具内部怎么设计参数、怎么组织返回结构、怎么治理超长输出、怎么响应失败**，是 host 的工程实践。

---

## 0. 设计哲学（一行话）

> **用最少的 token 传递最多的信息。**

linnkit 在协议层提供细粒度上下文工程能力（10 大分组 `contextPolicy` + `mustKeep` + fence + ContextTrace），但**这些只能管"已经进入上下文的消息怎么调度"**——**工具返回了什么、参数里塞了什么**，则是工具作者的工作。一个工具如果在 `parameters` 里塞 10 个可选字段、在返回值里嵌套四层 JSON，会让 LLM 上下文窗口被这一个工具吃掉 30%。这违背 linnkit 的产品特色：**对每一个发给 AI 的 token 进行精细化管理**。

派生原则：

| 原则 | 含义 |
|------|------|
| **工具是抽象的，复杂实现归上层** | 不在工具内部实现复杂业务函数；工具是"接受参数 → 调用 host 服务 → 返回结构化结果"的薄壳 |
| **数据合同优先选择最小且稳定的结构** | 中间推导物、展示噪音、上层可自由决定的字段，不进参数、不进返回值 |
| **不为"看起来更结构化"拆出多层嵌套** | 嵌套对象不是免费的，每一层 token 都要算账 |

---

## 1. 协议层强制约束

下表是 linnkit 协议层会**强制校验**的规则。违反会被运行时拒绝、被 testkit invariants 抓住、或导致 ContextTrace / AuditEnvelope 失真。

| 规则 | 校验机制 | 违反后果 |
|------|---------|---------|
| `name` / `description` / `parameters` 必填 | `BaseTool` 抽象类 | TS 编译失败 |
| `run(args, context): Promise<string>` 签名 | `BaseTool` 抽象类 | TS 编译失败 |
| `parameters.required[]` 声明的字段缺失 | `BaseTool.validateArguments()` 自动校验 | `ToolExecutionResult.errorKind = 'protocol'`，不进入 `run` |
| `run` 必须返回字符串（不是对象）| `BaseTool` 签名 | 下游解析失败 / 投影层崩溃 |
| 成功结果必须是 `{ data, observation }`，且 observation 为非空字符串 | `StructuredToolResult` 类型 + `ToolNode` 运行时校验 | `TOOL_RESULT_CONTRACT_VIOLATION`，结果按工具执行错误返回 |
| 工具配对：`tool_call` ↔ `tool_output` 严格 1:1 | tool 配对不变量 C10 + testkit invariant | 26 条 strict invariants 报错 |
| 失败必须 `throw`，不能返回伪装成功的 JSON | runtime 接住 throw → `tool_output.status = 'error'` | UI 状态与实际不一致（最难排查的 bug 类） |
| `tool_calls` / `tool_outputs` 不可单独删（只能成对压缩）| `toolHistoryCompressor` + `ToolReplayProtocolGuard` | provider replay 协议违反 → LLM 调用失败 |

---

## 2. `run` 的必填返回结构：`JSON.stringify({ data, observation })`

所有进入 Agent 工具循环的成功结果都必须使用 `data` / `observation` 分层。TypeScript 通过 `StructuredToolResult` 检查，ToolNode 在运行时再次校验，覆盖 JavaScript 工具、插件和缓存回放结果：

| 字段 | 服务对象 | 设计原则 |
|------|---------|---------|
| `data` | **UI 渲染** | 结构化、字段名稳定、避免重复正文；UI 不应做"二次加工"，前端只忠实渲染 |
| `observation` | **AI 上下文** | 必须包含非空白字符的纯文本，是模型唯一可见的业务结果；允许正文自然产生的首尾换行，**禁止**拼大段 JSON、**禁止**加 emoji 等噪音 |

**为什么这套分层重要**：

- 没有分层时，工具作者要么"AI 友好 UI 不友好"（observation 给前端解析 → 解析失败），要么"UI 友好 AI 不友好"（结构化 JSON 进 LLM 上下文 → token 爆炸 + 模型不擅长读嵌套 JSON）。
- 有了分层后，`linnkit` 的 `enterAgentContext` 治理（`eventGovernance`）+ `observationGovernance`（治理超长 observation 落盘）能精准地只让 `observation` 进入 AI 上下文，`data` 留给前端。
- 没有 UI 数据时，`data` 仍需返回空对象 `{}`；不得省略。工具真实执行失败应 `throw`，不要返回 `{ data: { error } }` 伪装成功。

### 2.1 最小返回值示例

```ts
async run(args: SumArgs, _context: ToolExecutionContext): Promise<string> {
  const sum = args.numbers.reduce((acc, n) => acc + n, 0);
  const result = {
    data: { sum },
    observation: `The sum of ${args.numbers.length} numbers is ${sum}.`,
  };
  return JSON.stringify(result);
}
```

### 2.2 真实工具示例（含 ToolExecutionContext 注入）

```ts
import {
  BaseTool,
  type ToolArgs,
  type ToolExecutionContext,
  type ToolParameterSchema,
} from '@linnlabs/linnkit/runtime-kernel';

interface SearchDocsArgs extends ToolArgs {
  query: string;
  topK?: number;
}

interface DocHit {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
}

interface DocumentSearchPort {
  search(query: string, topK: number): Promise<DocHit[]>;
}

interface SearchDocsToolContext extends ToolExecutionContext {
  documentSearch?: DocumentSearchPort;
}

function assertSearchDocsToolContext(
  context: ToolExecutionContext,
): asserts context is SearchDocsToolContext {
  if (!context || typeof context !== 'object' || !('documentSearch' in context)) {
    throw new Error('SearchDocsTool requires documentSearch in host ToolContext');
  }
}

export class SearchDocsTool extends BaseTool<SearchDocsArgs> {
  readonly name = 'search_docs';

  readonly description = `Search documents through the host catalog.

# When to Use

- When the user asks to find / search / look up content across documents.
- Prefer this over reading every document one by one.

# Output

Returns top-K documents ranked by relevance, each with id / title / snippet.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (natural language).' },
      topK: { type: 'integer', description: 'Max number of results.', default: 5 },
    },
    required: ['query'],
  };

  async run(args: SearchDocsArgs, context: ToolExecutionContext): Promise<string> {
    assertSearchDocsToolContext(context);
    const documentSearch = context.documentSearch;
    if (!documentSearch) {
      throw new Error('SearchDocsTool requires documentSearch in host ToolContext');
    }

    const hits: DocHit[] = await documentSearch.search(args.query, args.topK ?? 5);

    const result = {
      data: { hits },
      observation: hits.length === 0
        ? `No documents matched query: "${args.query}"`
        : `Found ${hits.length} documents for "${args.query}":\n` +
          hits.map((h, i) => `${i + 1}. [${h.documentId}] ${h.title} — ${h.snippet}`).join('\n'),
    };
    return JSON.stringify(result);
  }
}
```

注意几点：

1. **`description` 是写给 LLM 看的**：包含 "When to Use" / "Output" 等结构化指引，质量直接决定 LLM 的工具选择准确度。
2. **`context.documentSearch` 来自 host 扩展类型**：linnkit runtime 只定义 `ToolExecutionContext` 的执行期字段（如 `runId` / `conversationId` / `abortSignal` / child-run capability）。产品服务字段必须由 host 自己定义窄接口并注入，不要把具体存储、检索或 workflow 语义写回 framework。
3. **`observation` 包含完整可读信息，但不复制 `data` 的结构化 JSON 或大段正文**：同一业务事实可以分别以 UI 结构和自然语言出现；LLM 读完 `observation` 必须知道有哪些文档、引用 ID 是什么，不需要也不能依赖读取 `data`。
4. **失败 throw**：`documentSearch` 缺失是配置错误，不是业务失败——`throw` 让 `AuditEnvelope` 与 `tool_output.status` 准确反映"协议级错误"。

---

## 3. 错误处理协议

| 场景 | 正确做法 | 错误做法 |
|------|---------|---------|
| 工具执行失败（外部服务挂了 / 业务规则违反）| `throw new Error('...')`，runtime 标记 `tool_output.status = 'error'` | 返回 `{"data":{"error":"..."}}` 伪装成功 |
| 必填参数缺失 | 通过 `parameters.required[]` 声明，让 `validateArguments` 拦截 | 在 `run` 里 `if (!args.x) throw` 或返回错误 JSON |
| Schema 不匹配（类型错 / 多余字段）| `parameters.additionalProperties = false` + `validateArguments` 拦截 | 在 `run` 里手写校验 |
| 批量场景部分失败 | 整体 `success`，但 `data` 中给出每条 `{ status, message }`，`observation` 简短摘要 | 抛错让整个批次失败 |
| 增强步骤降级（主操作成功，附加步骤失败）| 整体 `success`，在 `data.warnings` / `observation` 标注降级 | 抛错让主操作的产出丢失 |
| LLM 产出坏掉的 `tool_call.arguments`（流式 JSON 损坏）| 不属于工具错误——runtime / LLM 调用层处理为协议错误 | 在 `run` 里返回"成功但 data.error=..." |

工具 owner 若存在需要被 UI、审计或自动化稳定识别的业务失败，可以在 Host 的
`ToolExecutionResult.errorCode` 中提供非空稳定码。Linnkit 只将它原样投影为
`tool_output.error_code`，不解释具体产品语义；自然语言 `error/observation` 仍用于模型继续决策。
禁止下游解析错误文案来恢复错误码，也不要给没有明确消费者的普通异常随意造码。

### 3.1 不允许"伪装成功的失败"

`tool_output.status` 是协议层契约，**驱动**三个下游消费者：

1. **UI 渲染**：失败应该红色卡片 + 错误信息；伪装成功 → UI 显示绿色，但内容是错误，用户困惑
2. **工具历史可选压缩**：当 agent 显式使用 `toolHistory.retentionMode: 'compress'` 时，失败的工具可以被压缩成 "tool X failed"，伪装成功会被当成成功结果保留正文
3. **`AuditEnvelope`**：tool retry / tool deny 等审计决策依赖 `tool_output.status` 准确

**违反这一条的 bug 是最难排查的一类**。`throw` 一次，三处一致；伪装一次，三处全错。

### 3.2 幂等执行合同

`BaseTool.idempotency` 只用于**有副作用，且同一业务 scope 内同参重试必须复用成功结果**的工具。只读工具和天然无副作用的计算工具不要声明，避免把普通缓存误建模成幂等合同。

```ts
class CreateArtifactTool extends BaseTool {
  readonly idempotency = { scope: 'conversation' } as const;
  // ...
}
```

强制语义：

- scope 只能是 `conversation` 或 `turn`；对应的 `ToolExecutionContext.conversationId` / `turnId` 缺失时明确失败，不回退到其它身份。
- key 由 scope identity、工具名和稳定序列化后的 args 生成，是 32 hex（128-bit）的 SHA-256 前缀。不要在 host 或具体工具复制 key 算法。
- ToolNode 只缓存成功 `tool_output`；失败结果不携带幂等 metadata，也不能阻止后续重试。
- 同一进程内会合并 in-flight 调用，并从 working history 复用最近的成功输出。跨进程、崩溃恢复和多实例并发的强幂等必须由 host 持久化锁或唯一索引保证。
- 历史 16 hex key 不做前缀匹配或双读；升级后的旧调用按 cache miss 处理，再按 32 hex 合同写入新结果。
- cache hit 复用的是原始结构化输出，不是旧 scope 下的 durable 附件。模型附件等后处理必须按当前 workspace/conversation scope 重新解析；解析失败时明确失败，不能重跑有副作用的工具，也不能降级成“文本成功、附件丢失”。

业务测试至少覆盖：相同 scope + 相同规范化 args 命中；不同 scope 或 args 不命中；缺 scope identity 明确失败；执行失败不进入成功缓存；若有模型附件，cache replay 重新执行 scope 与能力校验。

---

## 4. `parameters.required[]` 是强约束，不是提示

### 4.1 模型合同必须可直接审查

`parameters` 不只是运行时元数据，也是模型实际看到的调用合同。Concrete tool 应在自己的类文件中直接声明
顶层 `properties`、`required` 和完整合法分支，使代码评审者不用追踪 factory / builder 就能看清全部输入面。
独立、稳定的嵌套子合同可以提取复用；不要为了消除少量 `oneOf` 字段重复而隐藏整个模型 schema。

正式 parser / DTO 仍应归属于 host 的合同层。JSON Schema 与 parser 必须同构，但 Linnkit 不要求、也不提供
产品 schema builder：framework 无法替具体产品决定字段身份、错误码或分支语义。

任何业务上"没有它就不能执行"的字段，**必须**放进 `required`。

linnkit 的 `BaseTool.validateArguments()` 会在 `run` 之前自动校验：

```ts
const required = this.parameters.required || [];
for (const field of required) {
  if (!(field in args) || args[field] === undefined || args[field] === null) {
    return {
      success: false,
      error: `Missing required parameter: ${field}`,
    };
  }
}
```

这意味着：

- ✅ 缺失 required 字段 → `ToolExecutionResult.errorKind = 'protocol'`，不进入 `run`
- ❌ 在 `run` 里写 `if (!args.x) throw` → 协议级错误被误标为执行级错误，audit / telemetry / replay 全都失真

**强约束的好处**：LLM 看到 `required` 列表后，会有更强的"必须传"心智；运行时拦截也能让 token 用尽更早暴露（避免 `run` 里走了 1/3 才发现缺字段）。

### 4.2 判别联合必须与 owner admission 同构

对象的合法字段随 `type` 等判别值变化时，使用 `oneOf` 声明完整分支。每个分支都应列出自己的
`properties` / `required`，并设置 `additionalProperties: false`。不要把只属于某个分支的字段放进
共享 `properties`，再依赖 description 告诉模型“其他类型不要传”；description 不是结构约束。

`ToolParameterSchema` 支持嵌套 `oneOf`，Quickstart 与 provider adapter 会保留该结构。工具 owner 的
`validateArguments` 必须使用同一判别联合规则，并在失败结果中保留 `questions[1].field` 这类具体路径，
让模型能够修正原调用。

`ToolParameterSchema` 是正式的可移植 JSON Schema 子集，不是任意字典。当前仅允许
`string / number / integer / boolean / object / array`，以及合同中显式列出的长度、范围、`enum`、
`properties`、`items`、`required`、`additionalProperties` 和 `oneOf`。工具注册时会语义校验：

- root 必须是 object；
- array 必须明确声明 items；
- required 只能引用同一 object 已声明的字段；
- 约束关键字必须与 type 匹配；
- 超出子集的 schema 必须在注册/目录生成时失败，禁止在 Provider 请求时删字段或强制断言类型。

`BaseTool.validateArguments()` 只提供 required 与 additional-properties 的通用浅层检查。类型、格式、
跨字段互斥和判别联合必须由 concrete tool 覆盖 `validateArguments`，复用自己的正式 owner parser。
ToolNode 的固定顺序是“规范化 → owner admission → `tool_process(start)` → execute”；因此只在 `run()`
里 parse 会把协议错误错误地变成已经开始执行后的 execution failure。

测试也必须覆盖这条边界：直接调用 `Tool.run()` 可以验证 owner 业务，但无法证明 start 前 admission。
至少增加一条真实 `ToolNode + ToolRuntimeDefinition.validateArguments` 用例，断言无效参数不产生
`tool_process(start)`、不调用 `executeTool`，只产生配对的 `tool_output(error)`。

---

## 5. `getExecutionSummary` —— 可选压缩模式下的工具历史摘要

默认情况下，未进入保留窗口的旧工具组会被直接删除，不会生成摘要。只有当 agent 显式设置 `toolHistory.retentionMode: 'compress'` 时，`toolHistoryCompressor` 才会用 `getExecutionSummary(output)` 把历史轮次的工具产出**压缩成一行摘要**。

这条摘要只是进入后续 working memory 的候选历史工具交互，仍会受到工具组数量上限和 token budget 约束；不要把 `getExecutionSummary` 理解成“永久保留旧工具结果”的存储机制。

**默认实现**（`BaseTool.getExecutionSummary` 已提供）：

```ts
getExecutionSummary?(output: string): string {
  if (!output) return 'Tool returned no output.';
  if (output.length <= 200) return output;
  return `Tool returned ${output.length} characters of output.`;
}
```

默认实现对短输出原样保留、对长输出说"返回了 N 字符"——**信息量很弱**。每个工具都应当**自己实现** `getExecutionSummary`：

```ts
getExecutionSummary(output: string): string {
  try {
    const parsed = JSON.parse(output);
    const hits = parsed?.data?.hits ?? [];
    return `搜索到 ${hits.length} 篇文档：${hits.slice(0, 3).map((h: DocHit) => h.title).join('、')}${hits.length > 3 ? '…' : ''}`;
  } catch {
    return '搜索结果解析失败。';
  }
}
```

**对 token 的影响**：在 `retentionMode: 'compress'` 下，未进入保留窗口的历史轮次工具产出会被压成 `getExecutionSummary` 一行摘要；一个高质量的 summary 能把单组候选历史工具交互的 token 占用从几万压到几百，但摘要是否进入最终 prompt 仍取决于 working memory 预算。默认 `retentionMode: 'drop'` 则直接删除这些旧工具组，不调用 `getExecutionSummary`。

---

## 6. 超长 observation 治理（不要在工具内部截断）

**❌ 错误做法**：

```ts
async run(args, context) {
  const fullText = await fetchHugeContent(args);
  if (fullText.length > 20_000) {
    return JSON.stringify({
      data: { preview: fullText.slice(0, 20_000), truncated: true, blobPath: writeToDisk(fullText) },
      observation: fullText.slice(0, 20_000),
    });
  }
  return JSON.stringify({ data: { text: fullText }, observation: fullText });
}
```

每个工具都自己实现一遍截断 + 落盘 = 协议不一致、blob 路径不一致、replay 不一致。

**✅ 正确做法**：让 linnkit 协议层的 `toolOutput.observationGovernance` + host 的 `ObservationPreviewPort` 接管：

```ts
async run(args, context) {
  const fullText = await fetchHugeContent(args);
  return JSON.stringify({
    data: { sourceId: args.sourceId },
    observation: fullText,
  });
}
```

工具只负责取得完整内容并把它放进 `observation`；`data` 仍只承载该工具 owner 合同定义的程序化事实，不必复制正文。当 `observation` 超过 `contextPolicy.toolOutput.observationGovernance.maxChars`（默认 20,000）或 `maxLines`（默认 1,200）时，`ToolNode` 会自动调用 host 的 `ObservationPreviewPort.truncateObservation()` 把全文落盘、生成 `blob_id`、把 observation 替换成"短预览 + 续读指引"。blob 身份进入通用 `tool_output.metadata.observationTruncation.blobId`，不会污染具体工具的 owner `data`。

详见 [`tools.md §6`](./tools.md#6-observationpreviewport配置超长-observation-存储路径)。

**为什么协议化**：

- 全仓一致：所有工具共用同一套截断 / 落盘 / 续读协议
- 可观测：截断决策进入 ContextTrace，可解释"为什么这次 observation 这么短"
- 可配置：`contextPolicy.toolOutput.observationGovernance` 让每个 agent 独立配置阈值

---

## 7. 工具控制面（`control`）

`StructuredToolResult.control` 是工具返回给 runtime 的控制面。它不是发给模型的 observation，也不是 system reminder；它只影响 ToolNode 在写完 `tool_output` 后怎么推进本轮 run。

### 7.1 交互工具（`requireUser`）的单消息协议

如果你的工具需要用户输入（如确认操作、问卷、多选），**不能**自己写"先返回一段提示 → 等用户输入 → 再返回结果"——这会破坏 `tool_call` ↔ `tool_output` 1:1 配对，违反 C10 不变量。

**正确做法**：

1. **第 1 段**：工具返回完整 `StructuredToolResult`，并在 `result.control.requireUser = true` 声明"需要用户继续交互"。
2. **第 2 段**：`ToolNode` 不再持久化首条 `tool_output`，而是把 `pendingInteractionSpec` 写入 local state，然后 route 到 `wait_user` 节点。
3. **第 3 段**：`WaitUserNode` 发出 `requires_user_interaction` 事件，run 进入 `awaiting_user` 状态。
4. **第 4 段**：用户提交回复后，runtime 用**同一条** `tool_output` 事件继续——`metadata.interaction` 字段承载用户的 `approved / modified / submitted / skipped` 状态。

`metadata.interaction` 是持久化和 UI 的结构化事实，不会自动变成模型可见指令。Host 创建 terminal `tool_output` 时必须同时提供自包含的 observation：尤其 `approved` 要明确说明用户已经批准、原等待条件已经满足；不能只给模型裸的 `{ "action": "approve" }`。领域响应（例如问卷答案、修改后的计划）仍由对应交互 owner 组织 observation，Host 不得用通用文案覆盖。

**reload / replay 的关键**：交互卡片的初始内容**必须**能从 `tool_call.arguments` 直接重建——不要把"首次工具输出快照"当成唯一事实来源。

### 7.2 最终产物工具（`terminateRun` / `finalAnswer`）

有些工具执行完以后，本轮 run 就应该结束，不需要再回到 LLM 生成一段复述文本。典型例子是"工具结果就是最终答案/最终产物"：

- `control.terminateRun = true`：ToolNode 写完本次 `tool_output` 后直接 yield，结束当前 run loop。
- `control.finalAnswer = string`：请求 runtime 把这段文本投影成 `final_answer` 事件，供 UI / persistence / replay 使用。

两者常一起出现，例如最终报告写入工具、确定性组装工具、writer 子 agent 的收口工具。普通读取、检索、编辑工具不要设置 `terminateRun`，否则会提前截断 agent 的正常思考/编排。

```ts
const result: StructuredToolResult<{ report: string }> = {
  data: { report },
  observation: `Final report accepted (${report.length} chars).`,
  control: {
    finalAnswer: report,
    terminateRun: true,
    reason: 'write_report: final artifact produced',
  },
};
```

### 7.3 `observationPreviewMeta`

如果工具返回的 observation 可能被落盘为短预览，工具可以在 `StructuredToolResult.observationPreviewMeta` 中提供轻量元信息，例如 `filename` / `document_name` / `doc_type`。runtime 只负责把 meta 传给 host 的 `ObservationPreviewPort`，不按工具名猜业务含义。

这条规则很重要：不要在 ToolNode 里写 `if toolName === ...` 的产品特判；需要特殊展示信息时，由工具自己把 meta 放进返回值。

`observationPreviewMeta` 是 ToolNode 消费的执行期输入，不属于 Conversation 的业务工具结果。持久化消息只保留 `data`、`observation` 与通用的 `observationTruncation` 身份；Renderer 若需要业务展示事实，必须从工具 owner 的 strict `data` 合同读取，不能依赖 preview meta。

### 7.4 让模型读取工具产出的图片

工具不能直接返回 durable attachment，更不能返回本地路径、bytes、base64、hash 或 data URL。工具只在 `StructuredToolResult.modelInput.attachments` 中返回有序 asset selection；selection 只包含调用内 ID、稳定 asset URI 和可选展示标签。

host 必须通过 `ToolModelInputResolverPort` 把 selection 解析为当前 conversation/project 有权引用的 durable 图片身份，并通过 `ToolModelInputCapabilityValidatorPort` 按最近一次成功 LLM attempt 的真实模型做执行期校验。任一 selection 的 scope 或完整性失败时，整个工具结果失败，不产生半组附件。

静态只会产生图片的工具应在 definition 上声明 `tool_result_image` requirement，让 schema admission 和 fallback 提前排除不兼容模型。既能读文本又能读图片的动态工具不能把图片 requirement 写成静态要求；只有实际返回图片 selection 时，ToolNode 才执行 resolver 与二次能力门禁。

模型的 `image_input` 语义能力与 route placement 必须逐项相交。`user_image=true` 只能证明用户附件可编码，不能替代
`tool_result_image`；反过来也一样。产品不得为了让动态图片工具继续运行而把工具结果改写成 user message。动态图片结果
若属于主操作的必要输入，缺少 `tool_result_image` 时返回结构化 placement error；若只是可选增强，则使用下述
`when_supported` 合同。

如果工具的主操作不依赖模型读取图片，而图片只是成功后的增强反馈，应同时声明
`modelInputDelivery='when_supported'`。这类工具对不兼容模型仍然可见并可执行；ToolNode 根据最近一次
成功 LLM attempt 的真实模型和 route 写入 `ToolExecutionContext.modelInputAdmission`。工具必须在
`admitted=true` 时才创建 selection 及其临时授权；`admitted=false` 时返回完整的文字与结构化主结果，
不得先登记资源再靠 resolver capability error 降级。未配置 validator、模型不具备聊天资格、selection
越权或内容损坏都不属于“模型不支持图片”的正常分支，仍须明确失败。

`when_supported` 的增强附件也不属于工具幂等主结果。历史成功输出若来自视觉模型，当前非视觉模型
命中缓存时只复用文字与结构化主结果，不能复用旧附件；当前视觉模型命中一条没有附件的历史结果时，
也不为它补跑有副作用的工具或额外生成附件。

动态工具的 `resolveModelInputRequirement(args)` 必须是只依赖规范化参数的确定性规则，不得执行 I/O。若 resolver 抛错，ToolNode 会把本次 call 作为 capability deny，生成稳定的 error `tool_output` 和 `tool.deny` 审计后继续消费同批 sibling calls；宿主异常原文不会回显给模型。resolver 不能用异常表达“本次不需要图片”，该场景应正常返回 `undefined`。

历史 cache hit 不能直接复用旧 durable ref。它应复用原始结构化输出，再按当前 workspace scope 重新解析 selection；selection 已失效时明确失败，不能重跑有副作用的工具，也不能退化成“文本成功、图片丢失”。root 与 child runtime 应注入同一类窄 resolver/validator，child 仍受自己的模型和附件继承策略约束。

---

## 8. 注册到 host 的 `ToolRuntimePort`

工具写完之后，host 通过 `ToolRuntimePort` 把它装配进 runtime。最简单的做法是用 quickstart 提供的 `QuickstartMemoryToolRuntime`：

```ts
import { QuickstartMemoryToolRuntime } from '@linnlabs/linnkit/quickstart';

const toolRuntime = new QuickstartMemoryToolRuntime([
  new SearchDocsTool(),
  new EchoTool(),
]);
```

生产 host 通常自己实现 `ToolRuntimePort`（由 `ToolCatalogPort` + `ToolExecutionPort` 组成），把工具与 host 的服务、权限串起来。UI 渲染 registry 属于产品 Renderer，不经过 Linnkit 工具合同——详见 [`tools.md`](./tools.md)。

`ToolCatalogPort.getToolSchemas()` 接收 `ToolSchemaBuildRequest`。Linnkit 会转交本次通用 invocation，让 Host 能为 concrete tool 构建请求级 Schema；Linnkit 不读取其中的 Host 扩展字段。Host 必须在该边界完成字段验证，并派生只包含真实消费者所需字段的窄上下文；不要把 query/history 直接交给所有 concrete/plugin tools，也不要引入通用 `metadata`、`modelBindings` 或字符串 Map 来掩盖产品语义。

---

## 9. Host 层约定

下表同时包含运行时强制合同和 host 侧开发约定。`data` / `observation` 分层由 linnkit 协议层守门；其余项目由 host 的注册、评审和测试保证。

| 约定 | 说明 |
|------|------|
| **`name` 用 `snake_case`** | 所有工具名小写下划线，避免与 LLM 自由生成的工具调用名混淆 |
| **`description` 包含 "When to Use"** | 明确告诉 LLM 何时调用、避免误用 |
| **`data` / `observation` 分层强制** | linnkit 运行时校验；UI 字段稳定、observation 自包含且为纯文本（见 §2） |
| **`tag/badge` 慎用** | 只在创建态 / 审核态 / 风险态等强调操作时用 |
| **流式生命周期声明** | 工具通过通用 policy 显式声明是否需要早期占位或参数快照 |
| **`requireUser` 工具的单消息交互协议** | 见 §7 |
| **幂等只用于副作用重试** | scope 与 key 由 runtime 合同管理；跨进程强幂等由 host 持久化能力保证（见 §3.2） |

流式生命周期是 concrete tool 的显式 opt-in：在 `BaseTool.streaming` 声明
`emitPlaceholder` 或 `emitArgumentSnapshots`，由 host 把本次实际暴露工具的 policy
放进 invocation context。该字段不属于 provider options。Linnkit 只理解通用 policy，
不得按工具名、插件名或产品领域维护白名单。参数快照尚未完成 owner admission；host 的
展示层若消费它，必须使用独立的窄 lifecycle 合同，成功结果仍使用正式参数/结果 schema。

---

## 10. 与 linnkit 协议的边界对齐表

| 工具内部决策 | 由谁负责 | 协议接入点 |
|------------|---------|----------|
| 工具名 / 描述 / 参数 schema | host（工具作者）| `BaseTool` |
| 请求级动态参数 schema | host（工具注册表 + 工具 owner）| `ToolSchemaBuildRequest`；Linnkit 只转交通用 invocation |
| 返回值结构（`data` / `observation` 分层）| host（工具作者）| `BaseTool.run` 返回字符串 |
| 错误处理（throw vs 返回）| host（遵守 §3）| runtime 接住 throw → `tool_output.status = 'error'` |
| 顶层 required / unknown-field 浅校验 | linnkit 协议层 | `BaseTool.validateArguments()` 默认实现 |
| 类型、格式、判别联合与跨字段深层 admission | host（工具 owner）| concrete tool 覆盖 `validateArguments()`；ToolNode 在 start 前调用 |
| 幂等策略、key 与进程内复用 | linnkit 协议层 | `BaseTool.idempotency` + `computeToolIdempotencyKey` + ToolNode |
| 跨进程强幂等 | host | 持久化锁或唯一索引；Linnkit 不提供虚假保证 |
| 超长 observation 治理 | linnkit 协议层 + host | `contextPolicy.toolOutput.observationGovernance` + `ObservationPreviewPort` |
| 工具历史保留 / 可选压缩 | linnkit 协议层 | `contextPolicy.toolHistory.strategy` + `contextPolicy.toolHistory.retentionMode` + `getExecutionSummary` |
| 工具配对一致性 | linnkit 协议层 | tool 配对不变量 C10 + `ToolReplayProtocolGuard` |
| 交互工具的 wait_user 路由 | linnkit 协议层 | `WaitUserNode` + `requires_user_interaction` 事件 |
| 工具图片 selection 与解析 | host 工具 + host resolver | `StructuredToolResult.modelInput` + `ToolModelInputResolverPort` |
| 工具图片能力校验与可选交付 | linnkit + host model catalog | definition requirement/delivery + `ToolExecutionContext.modelInputAdmission` + `ToolModelInputCapabilityValidatorPort` |
| `data` 字段名约定 / 前端 registry 注册 | host（工具作者 + 前端工程师）| linnkit 不规定 |
| 工具的业务实现（数据库 / 外部服务调用）| host | linnkit 不规定 |

---

## 11. 自查清单

- [ ] `name` 用 `snake_case`，在 host 工具集中唯一
- [ ] `description` 包含 "When to Use"，写给 LLM 看
- [ ] 顶层 `parameters.properties`、`required` 和完整合法分支可在 concrete tool 文件中直接审查，没有藏进 schema builder
- [ ] 必填参数全部放进 `parameters.required[]`
- [ ] `additionalProperties: false`（如果不希望 LLM 传额外字段）
- [ ] 类型、格式、判别联合或跨字段规则由正式 owner parser 覆盖 `validateArguments`，与模型 JSON Schema 同构
- [ ] `run` 返回 `JSON.stringify({ data, observation })`
- [ ] `data` 给前端，`observation` 给 AI；不复制结构化 JSON 或大段正文，`observation` 自包含全部模型所需业务信息
- [ ] `observation` 是包含非空白字符的纯文本、无 emoji、信息密度高；正文自然首尾空白不应被 `.trim()` 改写
- [ ] 失败用 `throw new Error(...)`，**不**返回伪装成功的 JSON
- [ ] 如果声明幂等：工具确有副作用；scope identity 完整；覆盖成功复用、失败重试、跨 scope 隔离与 cache replay 后处理
- [ ] 实现 `getExecutionSummary(output)`，给 ToolHistoryCompressor 用
- [ ] 不在工具内部做超长截断 / 落盘——交给 `ObservationPreviewPort`
- [ ] 如果是交互工具：第一段返回 `result.control.requireUser = true`，复活路径只从 `tool_call.arguments` 重建
- [ ] 如果工具让模型读取图片：只返回稳定 asset selection，并验证 scope、cache replay、能力拒绝和附件顺序
- [ ] 如果图片只是增强反馈：声明 `when_supported`，并在创建受管副本/临时授权前消费 runtime admission
- [ ] 单测用 `createToolContextFixture()` 直接测 `tool.run(args, fixtureContext)`
- [ ] 深层 admission 另有真实 `ToolNode + ToolRuntimeDefinition.validateArguments` 用例，证明错误参数不会发布 start 或进入 execute
- [ ] 在 host 的 `ToolRuntimePort` 实例化里注册

---

## 12. 与其他文档的关系

- [`tools.md`](./tools.md) — `ToolRuntimePort` / `ObservationPreviewPort` 等**协议接入面**
- [`agent-registration-guide.md`](./agent-registration-guide.md) — 把工具集装进 `AgentSpec` / 注册到 host agent registry
- [`tool-history.md`](./tool-history.md) — `toolHistoryCompressor` 的 `per-pair` / `per-run` / `none` 三策略配置
- [`context-engineering.md`](./context-engineering.md) — 10 大分组 `contextPolicy` 总览，含 `toolOutput.observationGovernance`
- [`audit.md`](./audit.md) — tool retry / tool deny 等审计决策
- [`testing.md`](./testing.md) — testkit 提供的 26 条 strict invariants（含工具相关的 C10）
- [`../../src/runtime-kernel/tools/README.md`](../../src/runtime-kernel/tools/README.md) — runtime-kernel Tool 合同与幂等 owner
