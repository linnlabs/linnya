import type { ConversationContextUsage } from '@app/schemas';
import type { BaseMessage } from '../../../types';
import type {
  ContextWindowUsageLevel,
  ContextWindowUsagePresentation,
  ContextWindowUsageSegment,
} from '../definitions/contextWindowUsage';

export function findLiveContextUsage(
  messages: readonly BaseMessage[],
  runId: string,
  modelId: string,
): ConversationContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === 'user_input' && message.metadata?.run_id === runId
      && message.metadata.context_usage?.budget_model_id === modelId) {
      return message.metadata.context_usage;
    }
  }
  return null;
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
  usage: ConversationContextUsage,
): ContextWindowUsagePresentation {
  // 快照中的输入预算已经扣除输出额度；二者相加还原当次 route/policy 共同约束后的完整有效窗口。
  const contextWindowTokens = usage.input_budget_tokens + usage.output_limit_tokens;
  const ratio = usage.used_tokens / contextWindowTokens;
  return {
    status: ratio > 1 ? 'overflow' : 'current',
    usage,
    contextWindowTokens,
    level: resolveUsageLevel(ratio),
    ratio,
    drawPercent: Math.min(ratio * 100, 100),
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
