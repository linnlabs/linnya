import { describe, expect, it } from 'vitest';
import { evaluateFallbackPromptCapacity } from '../evaluateFallbackPromptCapacity';

describe('evaluateFallbackPromptCapacity', () => {
  it('要求候选 route 同时容纳既定输出上限和 route-aware Prompt', () => {
    expect(evaluateFallbackPromptCapacity({
      contextWindowTokens: 32_000,
      maxOutputTokens: 4_000,
      requiredOutputLimitTokens: 4_000,
      estimatedPromptTokens: 28_000,
    })).toEqual({ admitted: true });

    expect(evaluateFallbackPromptCapacity({
      contextWindowTokens: 32_000,
      maxOutputTokens: 2_000,
      requiredOutputLimitTokens: 4_000,
      estimatedPromptTokens: 20_000,
    })).toEqual({ admitted: false, reason: 'fallback_output_limit_unsupported' });

    expect(evaluateFallbackPromptCapacity({
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      requiredOutputLimitTokens: 4_000,
      estimatedPromptTokens: 13_000,
    })).toEqual({ admitted: false, reason: 'fallback_context_window_exceeded' });
  });
});
