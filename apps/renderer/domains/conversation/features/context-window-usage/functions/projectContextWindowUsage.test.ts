import { describe, expect, it } from 'vitest';
import type { ConversationContextUsage } from '@app/schemas';
import type { UserMessage } from '../../../types';
import {
  findLiveContextUsage,
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

function userMessage(id: string, runId: string, contextUsage: ConversationContextUsage): UserMessage {
  return {
    id,
    role: 'user',
    type: 'user_input',
    content: id,
    timestamp: 1,
    metadata: { run_id: runId, context_usage: contextUsage },
  };
}

describe('projectContextWindowUsage', () => {
  it('只消费当前运行和预算模型的实时快照', () => {
    const latest = usage({ used_tokens: 90_000 });
    const messages = [
      userMessage('old', 'old-run', usage()),
      userMessage('current', 'current-run', latest),
      userMessage('other-model', 'current-run', usage({ budget_model_id: 'model-b' })),
    ];
    expect(findLiveContextUsage(messages, 'unknown-run', 'model-a')).toBeNull();
    expect(findLiveContextUsage(messages, 'current-run', 'model-a')).toBe(latest);
  });

  it('把 239616 输入预算与 16384 输出上限还原为用户配置的 256K 窗口', () => {
    const result = projectContextWindowUsage(usage({
      used_tokens: 100_000,
      input_budget_tokens: 239_616,
      remaining_tokens: 139_616,
      output_limit_tokens: 16_384,
      components: {
        system_prompt_tokens: 10_000,
        conversation_tokens: 70_000,
        tool_definition_tokens: 20_000,
      },
    }));

    if (!('contextWindowTokens' in result)) {
      throw new Error('expected available context usage');
    }
    expect(result.contextWindowTokens).toBe(256_000);
    expect(formatContextUsageTokens(result.contextWindowTokens)).toBe('256K');
  });

  it('按 70% 阈值分级', () => {
    const elevated = projectContextWindowUsage(usage({
      used_tokens: 84_000,
      remaining_tokens: 16_000,
      components: {
        system_prompt_tokens: 10_000,
        conversation_tokens: 54_000,
        tool_definition_tokens: 20_000,
      },
    }));

    if (!('level' in elevated)) throw new Error('expected elevated context usage');
    expect(elevated.level).toBe('elevated');
    expect(elevated.segments.map(segment => segment.id)).toEqual([
      'system_prompt', 'tool_definitions', 'conversation',
    ]);
  });

  it('超过完整窗口时保持真实百分比，同时把三个组成压缩到完整轨道', () => {
    const result = projectContextWindowUsage(usage({
      used_tokens: 130_000,
      remaining_tokens: -30_000,
      components: {
        system_prompt_tokens: 20_000,
        conversation_tokens: 80_000,
        tool_definition_tokens: 30_000,
      },
    }));

    expect(result.status).toBe('overflow');
    if (result.status !== 'overflow') return;
    expect(result.ratio).toBe(130_000 / 120_000);
    expect(result.drawPercent).toBe(100);
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
