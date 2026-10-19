import type { ConversationContextUsage, ConversationContextUsageSource } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type {
  ContextWindowUsageLevel,
  ContextWindowUsagePresentation,
  ContextWindowUsageSegment,
} from '../definitions/contextWindowUsage';

export interface ProjectContextWindowUsageInput {
  readonly hasActiveConversation: boolean;
  readonly messages: readonly BaseMessage[];
  readonly durableUsage: ConversationContextUsageSource | null;
  readonly includesConversationTail: boolean;
  readonly currentModelId: string | null;
}

export function findLatestContextUsage(
  messages: readonly BaseMessage[],
  durableUsage: ConversationContextUsageSource | null = null,
): ConversationContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === 'user_input' && message.metadata?.context_usage) {
      // 相同来源采用 window ∪ live 的最新投影；旧 live 轮次不能覆盖窗口外更新的 durable 来源。
      return !durableUsage || message.id === durableUsage.user_message_id
        || message.timestamp >= durableUsage.timestamp
        ? message.metadata.context_usage
        : durableUsage.usage;
    }
  }
  return durableUsage?.usage ?? null;
}

function resolveUsageLevel(ratio: number): ContextWindowUsageLevel {
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.7) return 'elevated';
  return 'normal';
}

function buildSegments(
  usage: ConversationContextUsage,
  contextWindowTokens: number,
): readonly ContextWindowUsageSegment[] {
  // 超预算时用实际占用作为分母，把三个组成压缩到完整轨道；否则轨道尾部自然表达剩余预算。
  const denominator = Math.max(usage.used_tokens, contextWindowTokens);
  return [
    {
      id: 'system_prompt',
      tokens: usage.components.system_prompt_tokens,
      share: usage.components.system_prompt_tokens / denominator,
    },
    {
      id: 'tool_definitions',
      tokens: usage.components.tool_definition_tokens,
      share: usage.components.tool_definition_tokens / denominator,
    },
    {
      id: 'conversation',
      tokens: usage.components.conversation_tokens,
      share: usage.components.conversation_tokens / denominator,
    },
  ];
}

export function projectContextWindowUsage(
  input: ProjectContextWindowUsageInput,
): ContextWindowUsagePresentation {
  if (!input.hasActiveConversation) return { status: 'unavailable' };
  if (!input.includesConversationTail) return { status: 'tail_unavailable' };

  const usage = findLatestContextUsage(input.messages, input.durableUsage);
  if (!usage) return { status: 'unavailable' };

  // 快照中的输入预算已经扣除输出额度；二者相加还原当次 route/policy 共同约束后的完整有效窗口。
  const contextWindowTokens = usage.input_budget_tokens + usage.output_limit_tokens;
  const ratio = usage.used_tokens / contextWindowTokens;
  const isHistoricalModel = input.currentModelId !== null
    && input.currentModelId !== usage.budget_model_id;
  const status = ratio > 1
    ? 'overflow'
    : isHistoricalModel
      ? 'historical_model'
      : 'current';

  return {
    status,
    usage,
    contextWindowTokens,
    level: resolveUsageLevel(ratio),
    ratio,
    drawPercent: Math.min(ratio * 100, 100),
    isHistoricalModel,
    segments: buildSegments(usage, contextWindowTokens),
  };
}

export function formatContextUsagePercentage(ratio: number): string {
  if (ratio > 0 && ratio < 0.01) return '<1%';
  return `${Math.round(ratio * 100)}%`;
}

export function formatContextUsageTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  const divisor = tokens >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? 'M' : 'K';
  const value = Math.round((tokens / divisor) * 10) / 10;
  return `${value}${suffix}`;
}

export function formatApproximateContextUsageTokens(tokens: number): string {
  return `~ ${formatContextUsageTokens(tokens)}`;
}
