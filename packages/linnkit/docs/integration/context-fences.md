# Context Engineering · Fence 注册 + 注入 ⭐

> **What** · 上下文围栏（fence）注册与注入 —— linnkit 一等接入面，host 把"项目状态 / 当前文件 / 引用段落 / 长记忆"等结构化上下文喂给 LLM 都走这里。
> **When to read** · 要把 host 状态喂给 agent；要 `mustKeep` 关键信息不被裁；要做"按生命周期管理上下文"（current-turn / persisted / boot-only）。
> **Prerequisites** · [`context-engineering.md`](./context-engineering.md) ⭐（先理解 `contextPolicy` 总体结构）。
> **Key exports** · `FenceRegistry` / `FenceDescriptor` / `FenceInjection` / `MustKeepPolicy` / `FenceLifetimePreprocessor` from `@linnlabs/linnkit/context-manager`。
> **Related** · [`context-engineering.md`](./context-engineering.md) ⭐ · [`agent-registration-guide.md`](./agent-registration-guide.md) ⭐

> **第一周必读**。如果你的产品需要把不同来源的上下文注入到 LLM 不同位置（"项目元信息塞 system 之后"、"被引用的段落塞当前用户输入之前"、"长记忆只塞当前轮"），**这是 linnkit 的一等接入面**。
>
> **不要**自己在 system prompt 里手工拼 `<my_tag>...</my_tag>`——会被 boundary guard 拦下，且生命周期治理失控。

> **当前预算边界**：placement、lifetime 与 formatter 已接线；`FenceDescriptor.mustKeep` / `maxBudgetFraction` 目前只表达注册意图并校验字段取值，尚未自动转成 `MustKeepPolicy` 或运行时容量裁决。当前轮 system/user fence 又会先组装进 `system_prompt` / 最新 `user_input`，因此 per-kind `truncationRules` 无法再按 `metadata.fenceKind` 命中。现在真正生效的硬约束只有整份最终 Prompt 的容量门禁；不要把 descriptor 上的比例当成已生效的 per-fence 上限。

## 1. 为什么有 fence 机制

linnkit 设计原则：

- **framework 不知道任何 host 产品语义**——`document_fragment` / `project_context` / `<additional_context>` 这种字面绝不出现在 framework 源码里
- **任意 host 都能注册自己的围栏家族**——例如 `<additional_context>`、`<memory-context>`、`<system-event>`、`<file_context>`，都通过同一套机制插入，不需要任何 host 改 framework 源码
- **注入消息有稳定协议载体**——`AiMessage.type = 'context_injection'` 是唯一通用类型，`metadata.fenceKind` 表达开放的 host kind

正确的做法：把每类上下文声明成一个"围栏家族"（fence kind），通过 `FenceRegistry` 注册，运行时由 `BaseAgentTask` 把 host 请求里的 `fences[]` 自动展开成 `context_injection` 消息，按 `placement` 落到正确位置；当前轮 prompt block 由 `CurrentTurnMessageAssembler` 先组装，旧轮 `lifetime: 'turn-only'` 的注入再由 `FenceLifetimePreprocessor` 自动剥离。

## 2. 概念三元组

| 概念 | 类型 | 谁产 | 谁消 |
|---|---|---|---|
| `FenceDescriptor` | 来自 `@linnlabs/linnkit/context-manager` | host 启动时声明（每类一个）| linnkit `MessageFormatter` / `FenceLifetimePreprocessor` / `MustKeepPolicy` |
| `FenceInjection` | 来自 `@linnlabs/linnkit/context-manager` | host 请求适配层每轮产 | linnkit `BaseAgentTask` 展开为 `context_injection` 消息 |
| `context_injection` 消息 | 来自 `@linnlabs/linnkit/contracts` 的 `AiMessage` 一种 type | linnkit 自动产 | 整条 context pipeline |

## 3. 注册一个 fence 家族（host 启动时一次）

```ts
// app-hosts/your-app/context/agent/registerFences.ts
import {
  createFenceRegistry,
  type FenceDescriptor,
  type FenceRegistry,
} from '@linnlabs/linnkit/context-manager';

export function createMyFenceRegistry(): FenceRegistry {
  return createFenceRegistry(createMyFenceDescriptors());
}

export function createMyFenceDescriptors(): FenceDescriptor[] {
  return [
    {
      kind: 'memory-context',                  // host 自定义 kebab-case
      llmRole: 'user',                         // 物理 role（注入时挂到 user 还是 system）
      placement: 'before-current-user',        // 在 system 后 / 当前 user 前 / 当前 user 后 / 上一组 tool result 后
      lifetime: 'turn-only',                   // 'turn-only' 只在本轮；'persisted' 进 history
      maxBudgetFraction: 0.2,                  // 当前仅声明预算意图，尚未形成运行时硬上限
      formatter: (content, attrs) =>
        `<memory-context source="${attrs.source ?? 'unknown'}">\n${content}\n</memory-context>`,
    },
    {
      kind: 'system-event',
      llmRole: 'system',
      placement: 'after-system',
      lifetime: 'persisted',
      mustKeep: true,                          // 当前仅声明必保留意图，尚未自动接入 MustKeepPolicy
      formatter: (content) => `<system-event>\n${content}\n</system-event>`,
    },
    // 想要多少类就声明多少类
  ];
}

export const myFenceRegistry = createMyFenceRegistry();
```

**约束**：

- `kind` 必须 kebab-case（`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`）
- `placement` 当前枚举：`'after-system'` / `'before-current-user'` / `'after-current-user'` / `'after-last-tool-result'`
- 同一个 `kind` 在同一个 registry 不能重复 register
- `maxBudgetFraction` 必须落在 `(0, 1]`；当前只做注册校验，不执行截断或拒绝

当前轮 user-side fence 会按实际注入内容组装到同一条 user request。比如 host 注册了 `document-fragment`：

```ts
{
  kind: 'document-fragment',
  llmRole: 'user',
  placement: 'before-current-user',
  lifetime: 'turn-only',
  formatter: content => `<document_fragment>\n${content}\n</document_fragment>`,
}
```

本轮只注入这一类 fence 时，最终给 LLM 的 user 内容是：

```xml
<document_fragment>
...
</document_fragment>

<user_request>
用户原始请求
</user_request>
```

没有注入的 fence 不会产生空 XML，也不会出现 `<formatter(before-current-user fence)>` 这类概念占位符。

如果 host 已经把当前用户请求预包装成：

```xml
<local_time>2026-06-18 14:35:27</local_time>

<user_request>
用户原始请求
</user_request>
```

`CurrentTurnMessageAssembler` 在合并当前轮 user-side fence 时会复用已有 `<user_request>`，不会再嵌套一层。这样 host 可以把某些历史事实持久化到 `user_input.content`，同时继续使用 fence 注入当前视图或选区。

## 4. 写一个 host 适配器：把请求字段转成 `FenceInjection[]`

这是把 host 自己的产品语义（"项目名"、"被选中的段落"、"用户引用的句子"等）翻成通用 fence 注入的关键一层。

```ts
// app-hosts/your-app/context/agent/createMyFenceInjections.ts
import type { FenceInjection } from '@linnlabs/linnkit/context-manager';
import type { MyAgentInvokeRequest } from './contracts';

export function createMyFenceInjections(request: MyAgentInvokeRequest): FenceInjection[] {
  const fences: FenceInjection[] = [];

  if (request.memorySnapshot?.trim()) {
    fences.push({
      kind: 'memory-context',
      content: request.memorySnapshot,
      attrs: { source: request.memorySource ?? 'memory-store' },
    });
  }

  if (request.systemEvent) {
    fences.push({ kind: 'system-event', content: request.systemEvent });
  }

  return [...fences, ...(request.fences ?? [])];
}

export function withMyFenceInjections(request: MyAgentInvokeRequest): MyAgentInvokeRequest {
  return { ...request, fences: createMyFenceInjections(request) };
}
```

**关键点**：

- 适配器**不直接拼字符串**——只产 `{ kind, content, attrs }` 三元组。字符串拼接由 `FenceDescriptor.formatter` 统一负责
- 必须保留 `request.fences` 旧值（外部已经显式塞过的注入不被吞掉）
- 不要在这里写 `<memory-context>` 字面 tag——tag 名归 fence descriptor 拥有，否则两边各拼一次会重复

## 5. 把 registry 接到运行时（一处装配，三处消费）

```ts
// app-hosts/your-app/adapters/context-injection/myContextBuilder.ts
import {
  formatAgentLlmMessages,
  agentOrchestration,
  contextPolicyToProviderOptions,
  mergeContextPolicy,
} from '@linnlabs/linnkit/context-manager';
import { myFenceRegistry } from '../../context/agent/registerFences';
import { withMyFenceInjections } from '../../context/agent/createMyFenceInjections';

const hostContextPolicyFallback = {
  mustKeep: {
    alwaysKeepFenceKinds: ['system-event'],   // 注：只列那些"事件本身就是事实"的 kind
    truncationRules: [
      { fenceKind: 'memory-context', maxBudgetFraction: 0.2, strategyName: 'memory-truncate' },
    ],
  },
};

const orchestrator = new agentOrchestration.AgentMessageOrchestrator({
  tokenBudget: { maxTokens: 32_000, reservedForResponse: 4_000 },
  processing: { debugMode: false, preserveMetadata: true },
  taskResolver: myAgentTaskResolver,
  providerRegistry: myProviderRegistry,
  fenceRegistry: myFenceRegistry,              // ← 关键：让 BaseAgentTask 认识 host 的 fence
  // provider replay 要求只能由 host 根据显式 inference route 注入，AgentSpec 不可覆盖。
  resolveToolReplayProtocolPolicy: ({ modelId }) => myToolReplayPolicy(modelId),
  resolveContextPolicy: request => mergeContextPolicy({
    hostFallback: hostContextPolicyFallback,
    agentSpec: myAgentRegistry.get(request.promptKey)?.config?.contextPolicy,
  }),
  createProviderRegistry: ({ contextPolicy, contextBuilderConfig }) =>
    createMyProviderRegistry({
      customConfig: contextBuilderConfig,
      providerOptions: contextPolicyToProviderOptions(contextPolicy),
    }),
});

// 调 orchestrator 之前，把 host 字段转成 fences
const requestWithFences = withMyFenceInjections(request);

const processingResult = await orchestrator.processAgentConversation(
  requestWithFences,
  history,
  toolManager,
  summarizationCallbacks,
  { generate },
);

// 出关到 LLM 时，fence formatter 会被调用，每个 context_injection 消息变成具体 tag
const llmMessages = formatAgentLlmMessages(processingResult.messages, {
  fenceRegistry: myFenceRegistry,
});
```

`FenceLifetimePreprocessor` 通常已经被 `createDefaultAgentPreprocessorPipeline` 内置（orchestrator 内部根据 `fenceRegistry` 自动接好）；你**不需要手动 new**，只要保证 orchestrator 拿到了同一个 `fenceRegistry` 实例。

如果你完全自定义了 preprocessor pipeline，那 `FenceLifetimePreprocessor` 要从 `@linnlabs/linnkit/context-manager` 导入并手动加进去（构造参数：`{ fenceRegistry }`）。

如果你完全自定义 pipeline，也要保留 `CurrentTurnMessageAssembler`，并让它在 `FenceLifetimePreprocessor` 之前执行。否则当前轮 `before-current-user` 的 turn-only fence 仍可能被后续生命周期清理误判为旧轮上下文。

## 6. 配 MustKeepPolicy（控制 working memory 裁剪）

`AgentCoreContextProvider` 通过 `contextPolicy.mustKeep` 决定哪些消息一律不被裁。它有两类输入：

1. `alwaysKeepTypes`：按 `AiMessage.type` 列表（`'system_prompt' | 'user_input' | ...`）。默认值 `DEFAULT_MUST_KEEP_POLICY`
2. `alwaysKeepFenceKinds`：按 fence kind 列表（host 注入的 `metadata.fenceKind`）

**搭配规则**（很重要）：

- `lifetime: 'persisted'` 的 fence kind，多半也想 must-keep → 加进 `alwaysKeepFenceKinds`
- `lifetime: 'turn-only'` 的 fence kind，本身就只在本轮，**不要**加进 `alwaysKeepFenceKinds`
- `truncationRules` 只会匹配仍保有 `metadata.fenceKind` 的独立消息；当前轮已组装进 system/user 的 fence 不会命中 per-kind 规则
- 当前若要限制生产者输入，应由 Host 在请求 admission 前自行校验；框架级 per-fence 硬预算仍待接线

推荐把全局业务默认放进 host fallback，把单个 agent 的差异写在 `AgentDefinition.config.contextPolicy`：

```ts
// host fallback：所有 agent 都默认保留 system-event
const hostContextPolicyFallback = {
  mustKeep: {
    alwaysKeepFenceKinds: ['system-event'],
  },
};

// 单个 agent：额外把 memory-context 限量保留
config: {
  contextPolicy: {
    profileId: 'agent',
    mustKeep: {
      alwaysKeepFenceKinds: ['system-event', 'memory-context'],
      truncationRules: [
        { fenceKind: 'memory-context', maxBudgetFraction: 0.2, strategyName: 'memory-truncate' },
      ],
    },
  },
}
```

开启 `contextTrace.enabled` 后，你可以在 `ContextBuildResult.contextTrace.events` 里看到 fence 对应消息为什么被 `kept_by_CORE_CONTEXT` 或被截断。

## 7. Fence 消费的全链路一图

```text
host invoke request (含 host 业务字段)
  │
  ▼
withMyFenceInjections()      ← 你写的适配
  │  request.fences: FenceInjection[] = [{ kind, content, attrs }, ...]
  ▼
AgentMessageOrchestrator     ← linnkit
  │  · BaseAgentTask 展开为 AiMessage(type='context_injection', metadata.fenceKind=...)
  │  · CurrentTurnMessageAssembler 把当前轮 user/system fence 组装进唯一 user_input / system_prompt
  │  · FenceLifetimePreprocessor 剥离旧轮 turn-only 注入
  │  · AgentCoreContextProvider 按 MustKeepPolicy 决定 working memory 是否裁掉
  ▼
formatAgentLlmMessages(..., { fenceRegistry })
  │  · 对尚未组装的 context_injection，找到 metadata.fenceKind → registry.get(kind).formatter(content, attrs)
  │  · 出关成具体 LLM messages（system / user 各按 llmRole）；不盲目合并相邻 user 消息
  ▼
CanonicalInferencePort.stream(canonicalRequest)
```

## 8. 你不要做的

- 不要把 `<my_tag>...</my_tag>` 写进 system prompt 字符串拼装（会绕过 fence lifetime / must-keep 治理）
- 不要在不同链路用两个不同的 `FenceRegistry`（注册侧和 formatter 侧必须是同一个实例）
- 不要借用 `document_fragment` / `context_before` / `context_after` 这类产品 type。Host 必须在进入 framework 前构造正式 fence，Linnkit 主链不兼容这些输入
- 不要把 fence 概念漏到 system prompt 文案里去——fence kind 是 host-internal 命名，对 LLM 不可见；LLM 只看 formatter 输出的标签

## 9. 最小验证

- 单测 1：注册 fence → `BaseAgentTask` 能展开成 `context_injection` 消息（断言"3 类 fence 注入后，最终 LLM messages 第 N 条是 system 角色 + 包含 `<my_tag>`"）
- 单测 2：`lifetime: 'turn-only'` 的 fence 在 history 里能被自动剥离
- 单测 3：仍保持独立消息身份、且被 `alwaysKeepFenceKinds` 列出的 fence 在 working memory 抽稀时不被裁

## 10. 设计原理（深度参考）

如果你想理解 fence 机制为什么这么设计，下面几条核心决策可以解释绝大部分疑惑：

**为什么 `FenceRegistry` 是 host 显式 register，而不是 framework 内置一组围栏？**

- "常用"本质是某个产品的需求——其他 agent 不一定需要 `<system-event>`
- 一旦 framework 内置 4 类，命名权落 framework，host 想换名字就破坏接口契约
- 内置等于"把 host 产品语义渗漏进 framework"——本质就是要避免的

**为什么不引入 FenceProvider 让 framework 自动生成 fence 内容？**

- 内容生成（去哪 query memory / 怎么做关键词 ranking / 是否依赖向量数据库）**纯属 host 产品决策**
- framework 提供"插槽"，host 提供"内容"——这是边界

**为什么要新增 `context_injection` type，而不是只放 `metadata.fenceKind`？**

- `AiMessage` 是 zod 闭合枚举，没有稳定 type 就只能继续借用 `document_fragment` / `user_input`
- 借用 `user_input` 会破坏一个重要不变量：用户真实输入和 host 注入上下文混在同一个消息里，生命周期管理时容易误删或正则改坏用户输入
- `metadata.fenceKind` 表达开放 kind；物理类别仍需要一个稳定 type

**`MustKeepPolicy` 为什么用配置对象而不是函数式 hook？**

- 函数 hook 把行为藏进闭包，难以审计 / 难以序列化进 telemetry
- 实际场景 99% 的判断就是"按 type 列表 + 按 fenceKind 列表"——配置对象足够，且能直接 dump 出来 debug
- 复杂场景留 escape hatch：未来需要时再加 `customMatcher?: (msg) => boolean`

## 11. 当前合同

linnkit 0.4.x 起，agent profile 的公开请求合同已经收窄：

- host 产品字段不再挂在 `AgentProfileRequest` 上
- `MessageFormatter` 也不再替 `document_fragment` / `additional_context` 这类产品语义做包装

接入方必须：

- 把 host 产品字段全部走 `fences[]` 通道
- 不引用 `chatContext` / `chatTasks` 等 namespace；单轮无工具能力使用 tools-disabled `AgentSpec`
- 不 deep import `profiles/chat/*`；chat profile 不属于当前公共扩展面
