import { describe, expect, it } from 'vitest';
import type { ContextUsageSnapshot } from '../../../../contracts';
import { evaluatePrimaryPromptCapacity } from '../evaluatePrimaryPromptCapacity';

function createSnapshot(usedTokens: number): ContextUsageSnapshot {
  return {
    basis: 'last_completed_llm_prompt',
    budget_model_id: 'primary-model',
    used_tokens: usedTokens,
    components: {
      system_prompt_tokens: 0,
      conversation_tokens: usedTokens,
      tool_definition_tokens: 0,
    },
    component_attribution: 'normalized_local_estimate',
    input_budget_tokens: 100,
    remaining_tokens: 100 - usedTokens,
    output_limit_tokens: 20,
    source: 'local-estimate',
    confidence: 'estimate',
    measured_at: 1,
  };
}

describe('evaluatePrimaryPromptCapacity', () => {
  it('等于输入预算时接纳，严格超出时返回确定性拒绝证据', () => {
    expect(evaluatePrimaryPromptCapacity(createSnapshot(100))).toEqual({ admitted: true });
    expect(evaluatePrimaryPromptCapacity(createSnapshot(101))).toEqual({
      admitted: false,
      usedTokens: 101,
      inputBudgetTokens: 100,
      exceededByTokens: 1,
    });
  });
});
