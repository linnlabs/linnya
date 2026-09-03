# Tool History · 工具历史保留策略

> **What** · 工具历史保留策略配置 —— `per-pair` / `per-run` / `none` 三种选择窗口 + `retentionMode` 处理旧工具组 + `overflowStrategy` 溢出兜底。
> **When to read** · 上下文里工具调用反复占满 token；想配置工具调用历史的压缩窗口；做长 run 任务的成本控制。
> **Prerequisites** · [`tools.md`](./tools.md) · [`context-engineering.md` §5](./context-engineering.md)。
> **Key exports** · `toolHistory` field in `AgentSpec.contextPolicy` from `@linnlabs/linnkit` · `ToolHistoryCompressor` preprocessor 由 framework 内置自动注入。
> **Related** · [`context-engineering.md`](./context-engineering.md) ⭐ · [`tools.md`](./tools.md) · [`agent-registration-guide.md`](./agent-registration-guide.md) ⭐

linnkit 的 agent preprocessor 支持三种工具历史保留窗口，host 可在 `AgentDefinition.config.contextPolicy.toolHistory` 中显式声明。未进入保留窗口的旧工具组默认直接删除；确实需要旧摘要线索的 agent 可以显式设置 `retentionMode: 'compress'`。

注意：`retentionMode: 'compress'` 只表示**预处理阶段先把旧工具组替换成摘要**，不表示这些摘要会永久进入后续每一次 LLM 输入。压缩摘要在 working memory 阶段仍被当作“历史工具交互”计数，会继续受到工具组上限和 token budget 约束。

## 1. 三种策略对比

| 策略 | 适用场景 | 行为 | 风险 |
|------|----------|------|------|
| `per-pair` | 4K/8K 小上下文模型；需要强力控 token | 全局保留最近 N 组完整工具交互，其余按 `retentionMode` 处理 | 可能跨 run 腰斩同一轮工具链，prompt cache prefix 不稳定 |
| **`per-run`**（默认推荐）| 多步 agent、review、workspace 操作 | 按 `user_input` 划 run，完整保留最近 K 个历史 run 的工具序列，其余按 `retentionMode` 处理 | token 使用量可能高于 per-pair |
| `none` | 200K+ 长上下文模型；调试回放；审计敏感链路 | 不做常规压缩，只保留安全阀 | 长历史会明显涨 token |

**未传配置时默认走 `per-run` + `keepLatestRuns: 1`**。host 仍应在各自的 `AgentDefinition.config.contextPolicy.toolHistory` 中显式声明策略，避免依赖全局默认。

## 2. 默认值汇总

| 字段 | 默认 |
|------|------|
| `toolHistory.strategy` | `'per-run'` |
| `toolHistory.retentionMode` | `'drop'`（未保留旧工具组直接删除；可显式设 `'compress'` 兼容旧摘要行为）|
| `toolHistory.keepLatestRuns` | `1`（保留上一个 run 完整工具序列）|
| `toolHistory.keepLatestToolPairs` | `2`（仅 `strategy='per-pair'` 时生效）|
| `toolHistory.maxInteractionGroups` | `12` |
| `toolHistory.overflowStrategy` | `'keep-latest'` |

## 3. 压缩与不压缩的行为边界

`toolHistory` 分两步生效，读配置时不要把这两步混在一起：

| 阶段 | `retentionMode: 'drop'` | `retentionMode: 'compress'` |
|------|--------------------------|------------------------------|
| Preprocessor | 保留窗口外的旧完整工具组被整组删除，不生成替代消息 | 保留窗口外的旧完整工具组被替换成一条 `assistant.final_answer` 摘要 |
| Working memory | 已删除的旧工具组不会再进入最终 prompt | 压缩摘要作为一组“历史工具交互”参与 P3 填充，仍受 `maxInteractionGroups` 和 token budget 限制 |
| Provider replay | 只剩保留窗口内的 raw 工具组具备结构化 replay 能力 | 压缩摘要只保留自然语言线索，不再具备结构化 replay 能力 |

因此旧策略可以概括为：**K 轮外先压缩，但压缩摘要不保证一直保留**。新默认策略可以概括为：**K 轮外直接删除，不再制造摘要消息**。

## 4. 安全阀

所有策略共用：

- `maxInteractionGroups`：硬上限，默认 12
- `overflowStrategy: 'keep-latest'`：预处理阶段的保留窗口超过上限时保留最近工具组，更旧组按 `retentionMode` 删除或压缩
- `overflowStrategy: 'fail-fast'`：超过上限时抛 `ContextProviderError`，`code = 'TOOL_HISTORY_OVERFLOW'`，适合 CI 或生产 invariant

Working memory 阶段还会再用同一个 `maxInteractionGroups` 控制最终 prompt 中的历史工具交互数量。此处的历史工具交互同时包括 raw 工具组和 `retentionMode: 'compress'` 生成的压缩摘要。

构建期不再提供 `maxPairTokens` / `maxOutputSummaryTokens`。最近 2 个 turn 内的 tool input 原样保留；tool output 的尺寸治理只由执行期 `toolOutput.observationGovernance` 负责；超出 turn 窗口的旧 raw 工具组整组删除。

注意：“原样保留工具组”不是说超长 output 可以无限进入上下文。工具执行完成时会先经过 observation governance，默认超过 `20_000` 字符或 `1_200` 行就落盘并替换为 preview；working memory 只是不再把这个 preview 再摘要成另一段文本。

工具结果附件没有独立保留策略。图片与其他附件都随其 `tool_output` 所属的完整工具交互组一起进入、删除或压缩；
不能只删附件，也不能因为工具组含图就绕过 `toolHistory`。退出活动上下文不会删除 durable 工具事实或资源。

## 5. `AgentSpecContextPolicy.toolHistory` 字段

```ts
interface AgentSpecContextPolicy {
  profileId: string;

  budget?: {
    maxTokens?: number;
    reservedForResponse?: number;
    workingMemoryBudgetPercentage?: number;
  };

  toolHistory?: {
    /**
     * 保留窗口策略类型（默认 'per-run'）
     * - 'per-pair'：按工具对个数裁（旧默认；适合 4K/8K 等超紧上下文模型）
     * - 'per-run'：按 user_input 划 run 边界，保留最近 K 个 run 完整工具序列（prompt cache 友好；通用默认）
     * - 'none'：不压缩（适合 200K+ 长 context 模型；仅靠执行期 observationGovernance 兜底）
     *
     * 注：当前 run（最后一条 user_input 之后）所有工具对永不压缩，不受 strategy 影响。
     */
    strategy?: 'per-pair' | 'per-run' | 'none';

    /**
     * 未进入保留窗口的旧工具组如何处理（默认 'drop'）
     * - 'drop'：整组删除旧 tool_calls/tool_output，不生成摘要；更利于减少 token 与避免伪 assistant answer
     * - 'compress'：兼容旧行为，把旧工具组替换为自然语言摘要
     */
    retentionMode?: 'drop' | 'compress';

    /** strategy='per-pair' 时：保留最近 N 组完整工具对（默认 2）*/
    keepLatestToolPairs?: number;

    /** strategy='per-run' 时：保留最近 K 个 run 完整工具序列（默认 1）*/
    keepLatestRuns?: number;

    /** 工作记忆层最多保留的工具交互组总数硬上限（所有 strategy 共用，默认 12）*/
    maxInteractionGroups?: number;

    /**
     * 溢出 maxInteractionGroups 时的处置（默认 'keep-latest'）
     * - 'keep-latest'：按 originalIndex 倒序截，留尾不留头（保证最近行动可见）
     * - 'fail-fast'：抛 ContextProviderError，让 host 显式处理
     */
    overflowStrategy?: 'keep-latest' | 'fail-fast';

  };

  summarization?: {
    enabled?: boolean;
    triggerThreshold?: number;
    budgetPercentage?: number;
    oldestMessagesPercentage?: number;
    agentId?: string;
    failureBehavior?: 'fail-fast' | 'continue-if-within-budget';
  };
}
```

## 6. AgentSpec 装配

AgentSpec schema 已落到 `@linnlabs/linnkit/contracts`，host 装配时可用 `contextPolicy.toolHistory` 控制策略：

```ts
import type { AgentSpec } from '@linnlabs/linnkit/contracts';

const myAgentSpec: AgentSpec = {
  id: 'my-research-agent',
  version: '1.0.0',
  capabilities: ['llm', 'tools'],
  tools: [],
  contextPolicy: {
    profileId: 'agent',
    toolHistory: {
      strategy: 'per-run',
      keepLatestRuns: 2,            // 高密度子调度 agent 建议 K=2-3
      maxInteractionGroups: 12,
      overflowStrategy: 'keep-latest',
    },
  },
};
```

## 7. 低层 preprocessor 注入

测试或自定义 registry 也可以直接从默认 preprocessor registry 注入：

```ts
import { createDefaultAgentPreprocessorRegistry } from '@linnlabs/linnkit/context-manager';

const registry = createDefaultAgentPreprocessorRegistry({
  toolHistory: {
    strategy: 'per-run',
    keepLatestRuns: 1,
    maxInteractionGroups: 12,
    overflowStrategy: 'keep-latest',
  },
});
```

## 8. 默认值变更的兼容声明

`strategy` 默认从历史隐式的 `per-pair`（N=2）→ `'per-run'`（K=1），`retentionMode` 默认从旧摘要行为 → `'drop'`。对所有 host 来说：

- 不改变当前 run 和保留窗口内 raw 工具组的结构化 replay 行为
- 窗口外旧工具组不再保留摘要线索；依赖旧摘要做长程回忆的 agent 需要显式设 `retentionMode: 'compress'`
- 未保留的旧工具组不再变成 assistant 摘要，prompt cache 前缀更稳定，也避免伪 `final_answer` 污染真实对话历史
- prompt cache 命中率上升
- host 想保持旧行为：在 AgentSpec 显式设 `toolHistory.strategy: 'per-pair'`
- host 想保持旧摘要行为：显式设 `toolHistory.retentionMode: 'compress'`

## 9. 每个 agent 显式声明（推荐做法）

每个 agent 在自己的 `index.ts` 显式声明 `contextPolicy`，**不走预设模板、不依赖全局默认**：

```ts
// app-hosts/your-app/agent-registry/agents/research-agent/index.ts
import type { AgentDefinition } from '../../types';
import type { AgentSpecContextPolicy } from '@linnlabs/linnkit/contracts';

const RESEARCH_AGENT_CONTEXT_POLICY: AgentSpecContextPolicy = {
  profileId: 'agent',
  toolHistory: {
    strategy: 'per-run',
    keepLatestRuns: 3,            // 深度子调度，保留更多上下文
  },
};

export const researchAgent: AgentDefinition = {
  // ...
  config: {
    contextPolicy: RESEARCH_AGENT_CONTEXT_POLICY,
  },
};
```

**理由**：

- agent 作者最了解自己的预期工具密度 + 配置的模型 ctx + 工具结果体量
- 全局默认 per-run K=1 是合理兜底，但高密度子调度 agent 应该显式 K=2-3；translation / autocomplete / 内部子 agent 应该显式 N=0 极致省 token
- 预设模板会增加间接耦合——换模型时不知道哪些预设需要联动改

## 10. 用 ContextTrace 验证策略真的生效

`toolHistory` 最终会影响 preprocessor 与 working-memory provider 的消息选择。调试时建议临时打开：

```ts
contextPolicy: {
  profileId: 'agent',
  toolHistory: {
    strategy: 'per-run',
    keepLatestRuns: 2,
  },
  contextTrace: {
    enabled: true,
    includeMessageIds: true,
    includeTokenBreakdown: true,
    maxTraceEvents: 200,
  },
}
```

然后检查 `ContextBuildResult.contextTrace.events`：

- `provider` 事件能看到 working-memory 阶段保留消息数与 token delta。
- `message-decision` 事件能看到每条 `tool_calls` / `tool_output` 的 keep/drop 决策。
- 如果 trace `overflowed=true`，说明这次上下文太大，先提高 `maxTraceEvents` 做一次诊断；不要长期把它开太大。
