# 12 · TokenizerPort 实施计划（指挥官 → 实施者）

> **本文档面向**：linnkit 维护方的代码实施者。它是"我（指挥官）告诉你（实施者）'怎么把 TokenizerPort 加进 linnkit'"的完整任务单。
> 
> **不在 npm tarball 内**——这是内部档案。
>
> **实施状态（2026-05-13）**：✅ 已按 0.8.0 开发线落地，本文档转为**实施档案 + 历史溯源**。实施时发现并修正了一个架构误差：`GraphExecutor` 不负责构建上下文，tokenizer 不应该接到 `createDefaultGraphExecutor()`；实际接入点是 `ContextManagerBase` 以及创建 `AgentMessageOrchestrator` / `ChatMessageOrchestrator` 的 host runtime assembly。完整 release 信息见 `docs/release/RELEASE.md` §0（0.8.0 draft notes），外部接入文档见 `docs/integration/context-engineering.md §9.4` + `docs/integration/agent-registration-guide.md §3.1.3`。

---

## 0. 任务一句话

加一个**可选**的 `TokenizerPort` 协议接口，让外部接入方**用自定义 tokenizer 替换 linnkit 默认实现**（默认 = 当前的 `TokenCalculator`，基于 tiktoken OpenAI-编码族 + 字节比兜底）。host 不注入时走默认实现—— **0.7.x 行为零变化**。

> **术语统一**：本文档把"计算 token 的方法"统称为 **tokenizer**。它是个**总称**——linnkit 已经内置了一个默认 tokenizer（当前实现 = `TokenCalculator`），本次任务是新增 `TokenizerPort` 协议接口，让 host 可以用自己的实现替换默认。**`DefaultTokenizerPort` 和 host 自定义实现都是 tokenizer**，它们都实现同一个 `TokenizerPort` 接口。

---

## 1. 为什么要做

### 1.1 现状（0.7.0 起 · linnkit 已有默认 tokenizer）

- linnkit **内置一个默认 tokenizer**（实现位于 `packages/linnkit/src/shared/TokenCalculator.ts` + `tiktoken@^1.0.22` 硬依赖）。
- 支持的编码：`gpt2 / r50k_base / p50k_base / p50k_edit / cl100k_base / o200k_base`（**全是 OpenAI 编码族**）。
- 非 OpenAI 模型（Claude / Gemini / DeepSeek）→ 默认映射 `cl100k_base` 近似。
- host 可通过 `contextPolicy.tokenEstimation` 调三个参数调整默认 tokenizer 的行为：`encoding / avgCharsPerToken / toolCallOverhead`。

### 1.2 默认 tokenizer 不够用的场景

- ❌ host 想用 Anthropic 官方 `claude-tokenizer`（精确 token 数）—— 当前**无法替换默认**。
- ❌ host 想用 Gemini 官方 tokenizer —— 当前**无法替换默认**。
- ❌ host 想用 DeepSeek 官方 tokenizer —— 当前**无法替换默认**。
- ❌ host 用 OpenAI 不发布的内部模型 / 私有 tokenizer —— 当前**无法替换默认**。

### 1.3 做了之后

- ✅ host 可以实现 `TokenizerPort` 接口、注入自定义 tokenizer 替换默认；linnkit 上下文预算决策走 host 的实现。
- ✅ 不注入的 host 行为不变（继续走 `DefaultTokenizerPort`，等价于 0.7.x 默认 tokenizer 行为）。
- ✅ 0.x 版本号策略上 = **bump minor**（`0.7.0 → 0.8.0`，加新 export）。
- ✅ 零 breaking。

---

## 2. 协议设计

### 2.1 `TokenizerPort` 接口（新加在 `packages/linnkit/src/ports/`）

```ts
// packages/linnkit/src/ports/tokenizer.ts

import type { LlmRequestMessage } from './ai-engine.types';

/**
 * TokenizerPort · "tokenizer"（计算 token 的方法）的协议接口。
 *
 * 中文备注：
 * - `tokenizer` 是计算 token 的方法统称——linnkit 默认实现 (`DefaultTokenizerPort`)
 *   和 host 注入的自定义实现都实现这个接口。
 * - 这是 0.8.0 新增的可选 port。如果 host 不注入自定义实现，linnkit 自动用
 *   `DefaultTokenizerPort`（包装 `TokenCalculator`：tiktoken OpenAI-编码族 + 字节比兜底）。
 * - 仅用于 contextPolicy.budget 决策（"这条消息塞下了多少 token，还能塞多少"）。
 * - 不用于计费——计费 token 数由 provider 返回的 `usage` 字段决定，host 自己消费。
 * - 设计原则：host 在多模型场景下，应当根据 modelId 选择对应 tokenizer
 *   （Claude Sonnet 用 claude-tokenizer，GPT-4o 用 tiktoken o200k_base 等）。
 */
export interface TokenizerPort {
  /**
   * 估算单段纯文本的 token 数。
   *
   * - 默认实现 `DefaultTokenizerPort`：tiktoken 编码（默认 cl100k_base）+ avgCharsPerToken 兜底。
   * - host 自定义实现可以基于 modelId 选择不同 tokenizer。
   */
  estimateText(text: string, modelId?: string): number;

  /**
   * 估算单条 LlmRequestMessage 的 token 数。
   * 
   * 必须包含以下额外开销（与默认实现的层级一致）：
   * - message overhead：每条消息 ≥ 5 token 的协议开销
   * - tool_call overhead：每个 tool_call 至少 N token（默认 50）+ name token + arguments token
   * - tool_call_id：如果 message 有 tool_call_id，加上其 estimateText 结果
   *
   * 如果 host 自定义实现不包含这些层级，contextPolicy.budget 决策会失真——
   * linnkit 在 0.8.0 不强制校验，但在文档里强烈推荐。
   */
  estimateMessage(message: LlmRequestMessage, modelId?: string): number;
}
```

### 2.2 默认实现（真实实现放 `shared/`，公开桥在 `runtime-kernel/llm/`）

```ts
// packages/linnkit/src/shared/defaultTokenizerPort.ts

import { TokenCalculator } from './TokenCalculator';
import type { TokenizerPort } from '../ports/tokenizer';
import type { LlmRequestMessage } from '../ports/ai-engine.types';

export interface DefaultTokenizerPortConfig {
  /** tiktoken encoding 名（默认 'cl100k_base'，对 GPT-3.5/4/Claude/Gemini/DeepSeek 通用近似）。 */
  encoding?: string;
  /** tiktoken 不可用或未指定 encoding 时的字符/token 兜底比（默认 2.0）。 */
  avgCharsPerToken?: number;
  /** 单个 tool_call 的额外 token 开销估算（默认 50）。 */
  toolCallOverhead?: number;
}

/**
 * linnkit 默认 tokenizer 实现（实现 TokenizerPort 接口）。
 *
 * 中文备注：
 * - 完全等价于 0.7.x 起的 TokenCalculator 行为；本质是 TokenCalculator 的薄壳包装；
 * - host 不注入自定义 tokenizer 时，由 linnkit 自动构造该实例。
 */
export class DefaultTokenizerPort implements TokenizerPort {
  constructor(private readonly config: DefaultTokenizerPortConfig = {}) {}

  estimateText(text: string, _modelId?: string): number {
    return TokenCalculator.estimateTokens(text, {
      encoding: this.config.encoding,
      avgCharsPerToken: this.config.avgCharsPerToken,
    });
  }

  estimateMessage(message: LlmRequestMessage, _modelId?: string): number {
    return TokenCalculator.estimateMessageTokens(message, {
      encoding: this.config.encoding,
      avgCharsPerToken: this.config.avgCharsPerToken,
      toolCallOverhead: this.config.toolCallOverhead,
    });
  }
}

export function createDefaultTokenizerPort(config: DefaultTokenizerPortConfig = {}): TokenizerPort {
  return new DefaultTokenizerPort(config);
}
```

公开入口使用 `packages/linnkit/src/runtime-kernel/llm/defaultTokenizerPort.ts` 作为 re-export 桥；该桥文件只转发，不写实现。

### 2.3 `ContextManagerBase` 接入点

```ts
// packages/linnkit/src/context-manager/shared/context-manager-base.ts

import type { TokenizerPort } from '../../ports/tokenizer';
import { createDefaultTokenizerPort } from '../../shared/defaultTokenizerPort';
import type { LlmRequestMessage } from '../../ports/ai-engine.types';

export interface ContextManagerBaseOptions<TConfig, TRegistry> {
  debugMode?: boolean;
  customConfig?: Partial<TConfig>;
  providerRegistry?: TRegistry;
  tokenizer?: TokenizerPort;  // 新增：可选 tokenizer 注入
}

export abstract class ContextManagerBase<...> {
  protected readonly tokenizer: TokenizerPort;
  
  protected constructor(options, init) {
    // ... 已有逻辑（config / debugMode / providerRegistry / logger 初始化）
    
    // 中文备注：tokenizer 是装配期一次性注入——无论默认还是 host 自定义都是 tokenizer。
    // - host 注入时优先使用 host 自定义实现；
    // - 不注入时，用 config 的 encoding/avg/overhead 构造默认 tokenizer，等价 0.7.x 行为。
    this.tokenizer = options.tokenizer ?? createDefaultTokenizerPort({
      encoding: this.config.TOKEN_ENCODING_NAME,
      avgCharsPerToken: this.config.AVG_CHARS_PER_TOKEN,
      toolCallOverhead: this.config.TOOL_CALL_OVERHEAD_TOKENS,
    });
  }
  
  protected estimateTokens(message: AiMessage): number {
    // 中文备注：把 AiMessage 视为 LlmRequestMessage 兼容形态（与 0.7.x estimateMessageTokens 一致）。
    return this.tokenizer.estimateMessage(message as LlmRequestMessage);
  }

  updateTokenizerModelId(modelId: string | undefined): void {
    this.tokenizerModelId = modelId;
  }
}
```

### 2.4 装配点透传

需要把 `tokenizer` 选项**透传**进所有创建 ContextManager 的入口：

| 装配入口 | 改动 |
|---------|------|
| `AgentContextManager` 构造器 | 加 `tokenizer?: TokenizerPort` 可选参数，透传给 `super(...)` |
| `ChatContextManager` 构造器 | 同上 |
| `AgentMessageOrchestrator` / `ChatMessageOrchestrator` | 加 `tokenizer?: TokenizerPort` 可选参数，创建 ContextManager 时透传 |
| host 自定义 `GraphExecutorContextBuilder` | 在创建 orchestrator 时传入 `tokenizer`；`GraphExecutor` 本身不接 tokenizer |
| `runtimeKernel.runContextPipeline` | 检查是否需要透传 tokenizer（多数情况下用 `ContextManagerBase.tokenizer` 即可） |

### 2.5 testkit harness 接入

testkit 必须支持自定义 tokenizer 注入，否则外部接入方测自定义 tokenizer 时没有干净入口：

| testkit 入口 | 改动 |
|-------------|------|
| `createContextPipelineHarness` | 加 `tokenizer?: TokenizerPort` 可选 |
| 新增 `createMockTokenizerPort(opts)` | 让测试用户能注入"固定每条返回 N token"的 mock tokenizer |

`createMockTokenizerPort` 设计：

```ts
// packages/linnkit/src/testkit/mocks/tokenizerPort.ts

export interface MockTokenizerPortOptions {
  /** 每条 text 返回固定 token 数（默认 10）。 */
  tokensPerText?: number;
  /** 每条 message 返回固定 token 数（默认 50）。 */
  tokensPerMessage?: number;
  /** 可选：按 text/message 计算回调（覆盖固定数字）。 */
  estimateText?: (text: string, modelId?: string) => number;
  estimateMessage?: (message: LlmRequestMessage, modelId?: string) => number;
}

export function createMockTokenizerPort(opts: MockTokenizerPortOptions = {}): TokenizerPort {
  // ... 实现
}
```

---

## 3. 实施步骤（按依赖顺序）

### 步骤 1 · 协议层定义（约 30 分钟）

- [x] **新建** `packages/linnkit/src/ports/tokenizer.ts` —— 定义 `TokenizerPort` 接口（详见 §2.1）
- [x] **修改** `packages/linnkit/src/ports/index.ts` —— 导出 `TokenizerPort` type
- [x] **新建** `packages/linnkit/src/runtime-kernel/llm/defaultTokenizerPort.ts` —— `DefaultTokenizerPort` 类 + `createDefaultTokenizerPort` factory（详见 §2.2）
- [x] **修改** `packages/linnkit/src/runtime-kernel/llm/index.ts` —— 导出 `DefaultTokenizerPort` + `createDefaultTokenizerPort` + `DefaultTokenizerPortConfig`
- [x] **修改** `packages/linnkit/src/runtime-kernel/index.ts` —— 通过 `runtime-kernel/llm` 透出；`runtime-kernel` 根入口已有 `export * from './llm'`
- [x] **补充** `runtime-kernel/llm/defaultTokenizerPort.ts` 顶部注释 —— 明确它只是公开 re-export 桥，真实实现位于 `shared/defaultTokenizerPort.ts`，避免未来误在桥文件里写逻辑

### 步骤 2 · ContextManagerBase 接入（约 45 分钟）

- [x] **修改** `packages/linnkit/src/context-manager/shared/context-manager-base.ts`：
  - `ContextManagerBaseOptions` 加 `tokenizer?: TokenizerPort`
  - 构造器：`this.tokenizer = options.tokenizer ?? createDefaultTokenizerPort({...})`
  - `estimateTokens(message)` 改用 `this.tokenizer.estimateMessage(message)`
  - 增加 `updateTokenizerModelId(modelId)`，让高级接入方复用同一个 context-manager 跑不同模型时能显式刷新 modelId
- [x] **修改** `packages/linnkit/src/context-manager/profiles/agent/context/AgentContextManager.ts` —— options 加 `tokenizer?`，透传给 `super(...)`
- [x] **修改** `packages/linnkit/src/context-manager/profiles/chat/context/ContextManager.ts` —— 同上

### 步骤 3 · 装配点 + testkit harness（约 45 分钟）

- [x] **修改** `AgentMessageOrchestrator` / `ChatMessageOrchestrator` 装配点 —— 选项加 `tokenizer?`，透传给 ContextManager 装配
- [x] **修改** linnya host 的 `defaultGraphExecutorContextBuilder` —— 接受 `TokenizerPort` 并在创建 orchestrator 时传入
- [x] **修改** `testkit/context-harness/contextPipelineHarness.ts` —— 接受 `tokenizer?` 注入
- [x] **新建** `testkit/mocks/tokenizerPort.ts` —— `createMockTokenizerPort` helper（详见 §2.5）
- [x] **修改** `testkit/index.ts` —— 导出 `createMockTokenizerPort`

### 步骤 4 · 单元测试（约 1 小时）

- [x] **新建** `packages/linnkit/src/runtime-kernel/llm/__tests__/defaultTokenizerPort.test.ts`：
  - 验证 `DefaultTokenizerPort` 等价于直接调 `TokenCalculator.estimateMessageTokens`
- [x] **新建** `packages/linnkit/src/testkit/__tests__/mockTokenizerPort.test.ts`：
  - 验证 `createMockTokenizerPort({ tokensPerText: 100 })` 返回固定值
- [x] **新建** `packages/linnkit/src/context-manager/shared/__tests__/contextManagerBase.tokenizerInjection.test.ts`：
  - 注入自定义 tokenizer → `estimateTokens` 结果来自自定义实现
  - 不注入 tokenizer → 行为等价 0.7.x（用 `tokenEstimation` 三参数）
- [x] **跑现有** `__tests__/contextManagerBase.tokenEstimation.test.ts`：确保 `tokenEstimation` 三参数对 `DefaultTokenizerPort` 仍生效
- [ ] **后续可补** budget 决策路径集成测试：注入 `mockTokenizer` 返回每条 50 token → 装下 N 条消息 → 第 N+1 条触发 overflow

### 步骤 5 · strict invariants 不破坏（约 30 分钟）

- [x] 跑 `testkit` 相关单测与 smoke；新增 mock tokenizer 覆盖
- [x] 新增 invariant C12：**`如果 host 注入 tokenizer，所有 budget 决策必须用 host tokenizer 估的数字`**。实现位置：`testkit/context-harness/invariants`；校验 `message-decision.tokens` 与 `finalTokens` 是否等于 host tokenizer 对原始 / 最终消息的估算。

### 步骤 6 · 文档（约 45 分钟）

- [x] **修改** `packages/linnkit/docs/integration/context-engineering.md`：
  - 加 "9. TokenizerPort（host 自定义 tokenizer）" 章节
  - 包含：何时该用、3 参数 vs TokenizerPort 选哪个、注入示例代码、replay 时的 tokenizer 重建职责
- [x] **修改** `packages/linnkit/docs/integration/agent-registration-guide.md` §3：
  - 加 "3.1 maxTokens 怎么实现"：默认 tiktoken 估算 / host 可调 3 参数 / host 可注入 TokenizerPort
- [x] **修改** `packages/linnkit/docs/integration/tools.md`：
  - §1 "linnkit 给你的合同" 表加一行 `TokenizerPort`（标 0.8.0+）
- [x] **修改** `packages/linnkit/docs/release/RELEASE.md`：
  - 加 0.8.0 release notes 草稿（New: `TokenizerPort` + `DefaultTokenizerPort` + `createDefaultTokenizerPort` + `createMockTokenizerPort`；Internal: ContextManagerBase 接入；零 breaking）

### 步骤 7 · snapshot 测试更新（约 15 分钟）

- [x] `packages/linnkit/__tests__/package.shell.test.ts` —— 版本期望更新到 0.8.0
- [x] `packages/linnkit/src/ports/__tests__/index.exports.snapshot.test.ts` —— 运行通过；`TokenizerPort` 是 type-only，不产生运行时 snapshot 项
- [x] `packages/linnkit/src/runtime-kernel/__tests__/index.exports.snapshot.test.ts` —— 已 `-u`，新增 `createDefaultTokenizerPort` / `DefaultTokenizerPort`
- [x] `packages/linnkit/src/testkit/__tests__/index.exports.snapshot.test.ts` —— 已 `-u`，新增 `createMockTokenizerPort`

### 步骤 8 · 验收（约 15 分钟）

- [x] `npm --prefix packages/linnkit run typecheck` 通过
- [x] `npm --prefix packages/linnkit run test:smoke` 通过
- [x] `npm --prefix packages/linnkit run test:smoke:dist` 通过
- [x] `npm run guard:agent-boundary` 通过
- [x] `git diff --check` 通过
- [x] `npm --prefix packages/linnkit run publish:dry-run` 输出 sanity check
- [ ] 后续发布 PR / release note 列出"新 export 清单 + 默认行为零变化 + snapshot 已 -u 并 review"

---

## 4. 版本号 + 风险

### 4.1 版本号

- `0.7.0 → 0.8.0` —— 按 0.x semver 策略，加新 export = bump minor
- 不能 patch（patch 不允许加 export）
- 0.7.x → 0.8.0 是零 breaking

### 4.2 已知风险

| # | 风险 | 缓解措施 |
|---|------|---------|
| 1 | `ContextManagerBase.getConfig()` / `updateConfig()` 现有热替换路径 | tokenizer **不走 config**——只在构造器接收一次性注入，不支持运行时替换；文档明确说明 |
| 2 | tokenizer 不可序列化 → 未来 Replay SDK 重演时无法直接恢复 | Replay SDK（按需触发，未实现）将由 host 负责重新注入 tokenizer；这是 host 责任，不是 framework 协议负担 |
| 3 | `tokenEstimation` 三参数 + 自定义 tokenizer 共存的优先级 | **tokenizer 优先**：host 注入后，三参数只作为 `DefaultTokenizerPort` 的配置，不再影响决策；如果 host 既注入 tokenizer 又设置 `tokenEstimation`，linnkit 内部用 host tokenizer，三参数被忽略 |
| 4 | host 自定义 tokenizer 层级不一致（漏算 message overhead）| 文档说明 + `TokenizerPort.estimateMessage` 注释强调"必须包含 message overhead / tool_call overhead / tool_call_id" |
| 5 | testkit strict invariants 误抓 host 自定义 tokenizer 的合法低估 | C12 只核对“trace 使用的数字是否来自 host tokenizer”，不评价 tokenizer 自身是否接近 provider 计费 usage；计费 token 仍以 provider usage 为准 |

### 4.3 不做的事（产品决策，不是遗漏）

- ❌ **不在 framework 内置** Claude / Gemini / DeepSeek 官方 tokenizer—— host 自接，按 npm package 单独依赖（如 `@anthropic-ai/tokenizer`）；linnkit 只内置一个 OpenAI 编码族 + 字节比兜底的**默认** tokenizer
- ❌ **不发明跨 provider 统一 token 数协议**—— host 决定用什么 tokenizer
- ❌ **不强制自定义 tokenizer 的精度**—— estimate 偏差 ±30% 都是合法的（budget 决策有 reservedForResponse 安全垫）

---

## 5. 实施前 sanity check 问题清单

实施前请你（实施者）回答：

1. ✅ `TokenizerPort` 是否带 `modelId` 参数？**是**——host 多模型场景需要按 modelId 选对应 tokenizer 实现。
2. ✅ `tokenEstimation` 三参数留不留？**留**——服务"沿用默认 tokenizer"的 host，作为 `DefaultTokenizerPort` 的配置点。
3. ✅ testkit 是否要加 `createMockTokenizerPort` helper？**是**——让测试用户能注入固定数字 mock。
4. ✅ 是否要加新 invariant C12（"host 注入 tokenizer 后，预算决策必须使用 host tokenizer"）？**已加**——用 ContextTrace 校验每条 message-decision 与 finalTokens 的 token 数都来自 host tokenizer。
5. ⚠️ snapshot test 更新后是否需要单独 review？**是**——`-u` 不要无脑提交，必须人工 review 新增的 export 列表确实只增加了预期项。

---

## 6. 完成后通知指挥官的事项

实施完成后，请反馈以下信息，指挥官会同步收口文档：

1. ✅ 最终新 export 清单（namespace 路径 + 名称）
2. ✅ 新 invariant 编号（如果加了 C12）
3. ✅ 是否所有现有 snapshot 都已 -u + 人工 review
4. ✅ linnya host 跑通的范围（哪些 test suite 通过）
5. ⚠️ 任何与本计划不一致的实际改动 + 理由

指挥官收到这些信息后，会：

- 把 `topic-agent-framework-comparison-2026.md` 的 §0.5.2 #21 / §17.8 / §16 / §14.5 进一步收口（从"软化"升级为"已实现"）
- 把 `integration/context-engineering.md` §9 / `agent-registration-guide.md` §3 升级为正式产品文档（去掉"未来"措辞）
- 把 0.8.0 release notes 从草稿升级为正式发布

---

## 7. 文档自身的状态约定

| 状态 | 含义 |
|------|------|
| **本文档当前** | "已实施 · 待发布"——保留为 0.8.0 TokenizerPort 的设计与实施档案 |
| **实际架构修正** | tokenizer 接入 context-manager / orchestrator，不接 `GraphExecutor` |
| **`11-upgrade-plan-next.md`** | 已避让 0.8.0 版本号；后续阶段重新排期到 0.9.0+ |
