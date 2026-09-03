import { describe, expect, it } from 'vitest';
import type { ConversationContextUsage } from '@app/schemas';
import type { BaseMessage, UserMessage } from '../../../types';
import {
  formatApproximateContextUsageTokens,
  formatContextUsagePercentage,
  formatContextUsageTokens,
  projectContextWindowUsage,
} from './projectContextWindowUsage';

function usage(overrides: Partial<ConversationContextUsage> = {}): ConversationContextUsage {
  return {
    budget_model_id: 'model-a',
    used_tokens: 65_000,
    components: {
      system_prompt_tokens: 5_000,
      conversation_tokens: 40_000,
      tool_definition_tokens: 20_000,
    },
    input_budget_tokens: 100_000,
    remaining_tokens: 35_000,
    output_limit_tokens: 20_000,
    source: 'local-estimate',
    confidence: 'estimate',
    ...overrides,
  };
}

function userMessage(id: string, contextUsage?: ConversationContextUsage): UserMessage {
  return {
    id,
    role: 'user',
    type: 'user_input',
    content: id,
    timestamp: 1,
    ...(contextUsage ? { metadata: { context_usage: contextUsage } } : {}),
  };
}

function project(input: {
  readonly messages?: readonly BaseMessage[];
  readonly hasActiveConversation?: boolean;
  readonly includesConversationTail?: boolean;
  readonly currentModelId?: string | null;
}) {
  return projectContextWindowUsage({
    messages: input.messages ?? [],
    hasActiveConversation: input.hasActiveConversation ?? true,
    includesConversationTail: input.includesConversationTail ?? true,
    currentModelId: input.currentModelId ?? 'model-a',
  });
}

describe('projectContextWindowUsage', () => {
  it('没有会话、没有快照与窗口不含尾部时给出明确不可用原因', () => {
    expect(project({ hasActiveConversation: false })).toEqual({ status: 'unavailable' });
    expect(project({})).toEqual({ status: 'unavailable' });
    expect(project({ includesConversationTail: false })).toEqual({ status: 'tail_unavailable' });
  });

  it('只读取尾窗中最近一次成功请求的快照', () => {
    const latest = usage({
      used_tokens: 90_000,
      remaining_tokens: 10_000,
      components: {
        system_prompt_tokens: 10_000,
        conversation_tokens: 60_000,
        tool_definition_tokens: 20_000,
      },
    });
    const result = project({
      messages: [userMessage('old', usage()), userMessage('pending'), userMessage('latest', latest)],
    });

    expect(result.status).toBe('current');
    if (!('usage' in result)) throw new Error('expected available context usage');
    expect(result.usage).toBe(latest);
    expect(result.contextWindowTokens).toBe(120_000);
    expect(result.level).toBe('elevated');
    expect(result.drawPercent).toBe(75);
    expect(result.segments.map(segment => segment.id)).toEqual([
      'system_prompt',
      'tool_definitions',
      'conversation',
    ]);
  });

  it('把 239616 输入预算与 16384 输出上限还原为用户配置的 256K 窗口', () => {
    const result = project({
      messages: [userMessage('route-budget', usage({
        used_tokens: 100_000,
        input_budget_tokens: 239_616,
        remaining_tokens: 139_616,
        output_limit_tokens: 16_384,
        components: {
          system_prompt_tokens: 10_000,
          conversation_tokens: 70_000,
          tool_definition_tokens: 20_000,
        },
      }))],
    });

    if (!('contextWindowTokens' in result)) {
      throw new Error('expected available context usage');
    }
    expect(result.contextWindowTokens).toBe(256_000);
    expect(formatContextUsageTokens(result.contextWindowTokens)).toBe('256K');
  });

  it('按 70% 与 90% 阈值分级，并识别历史模型', () => {
    const elevated = project({
      messages: [userMessage('elevated', usage({
        used_tokens: 84_000,
        remaining_tokens: 16_000,
        components: {
          system_prompt_tokens: 10_000,
          conversation_tokens: 54_000,
          tool_definition_tokens: 20_000,
        },
      }))],
    });
    const historical = project({
      messages: [userMessage('historical', usage())],
      currentModelId: 'model-b',
    });

    if (!('level' in elevated)) throw new Error('expected elevated context usage');
    expect(elevated.level).toBe('elevated');
    expect(historical.status).toBe('historical_model');
  });

  it('超过完整窗口时保持真实百分比，同时把三个组成压缩到完整轨道', () => {
    const result = project({
      messages: [userMessage('overflow', usage({
        used_tokens: 130_000,
        remaining_tokens: -30_000,
        components: {
          system_prompt_tokens: 20_000,
          conversation_tokens: 80_000,
          tool_definition_tokens: 30_000,
        },
      }))],
      currentModelId: 'model-b',
    });

    expect(result.status).toBe('overflow');
    if (result.status !== 'overflow') return;
    expect(result.ratio).toBe(130_000 / 120_000);
    expect(result.drawPercent).toBe(100);
    expect(result.isHistoricalModel).toBe(true);
    expect(result.segments.reduce((sum, segment) => sum + segment.share, 0)).toBe(1);
  });
});

describe('context usage formatting', () => {
  it('保留小于 1% 的正占用，并使用紧凑 token 单位', () => {
    expect(formatContextUsagePercentage(0)).toBe('0%');
    expect(formatContextUsagePercentage(0.004)).toBe('<1%');
    expect(formatContextUsagePercentage(0.534)).toBe('53%');
    expect(formatContextUsageTokens(999)).toBe('999');
    expect(formatContextUsageTokens(106_400)).toBe('106.4K');
    expect(formatContextUsageTokens(2_000_000)).toBe('2M');
    expect(formatApproximateContextUsageTokens(1_250)).toBe('~ 1.3K');
  });
});
