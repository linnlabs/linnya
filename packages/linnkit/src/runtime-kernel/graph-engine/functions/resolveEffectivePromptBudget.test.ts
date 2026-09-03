import { describe, expect, it } from 'vitest';
import { resolveEffectivePromptBudget } from './resolveEffectivePromptBudget';

describe('resolveEffectivePromptBudget', () => {
  it('默认 Agent 直接使用模型 route，并在 messages 前预留工具定义', () => {
    expect(resolveEffectivePromptBudget({
      modelContextWindowTokens: 32_000,
      modelMaxOutputTokens: 4_000,
      toolDefinitionTokens: 2_000,
    })).toEqual({
      effectiveWindowTokens: 32_000,
      outputLimitTokens: 4_000,
      inputBudgetTokens: 28_000,
      toolDefinitionTokens: 2_000,
      messageBudgetTokens: 26_000,
    });
  });

  it('模型 route 容量大于 framework fallback 时不被隐藏默认截断', () => {
    expect(resolveEffectivePromptBudget({
      modelContextWindowTokens: 1_000_000,
      modelMaxOutputTokens: 32_768,
      fallbackContextWindowTokens: 256_000,
      fallbackMaxOutputTokens: 16_384,
      toolDefinitionTokens: 0,
    })).toMatchObject({
      effectiveWindowTokens: 1_000_000,
      outputLimitTokens: 32_768,
      inputBudgetTokens: 967_232,
      messageBudgetTokens: 967_232,
    });
  });

  it('没有模型 route 时使用 256K/16K framework fallback', () => {
    expect(resolveEffectivePromptBudget({
      toolDefinitionTokens: 384,
    })).toEqual({
      effectiveWindowTokens: 256_000,
      outputLimitTokens: 16_384,
      inputBudgetTokens: 239_616,
      toolDefinitionTokens: 384,
      messageBudgetTokens: 239_232,
    });
  });

  it('Agent policy 更小时尊重 Agent policy', () => {
    expect(resolveEffectivePromptBudget({
      policyMaxTokens: 16_000,
      policyReservedForResponse: 2_000,
      modelContextWindowTokens: 128_000,
      modelMaxOutputTokens: 16_000,
      toolDefinitionTokens: 0,
    })).toMatchObject({
      effectiveWindowTokens: 16_000,
      outputLimitTokens: 2_000,
      inputBudgetTokens: 14_000,
      messageBudgetTokens: 14_000,
    });
  });

  it('拒绝输出预留耗尽窗口和工具定义耗尽输入预算', () => {
    expect(() => resolveEffectivePromptBudget({
      policyMaxTokens: 4_000,
      policyReservedForResponse: 4_000,
      modelContextWindowTokens: 8_000,
      modelMaxOutputTokens: 8_000,
      toolDefinitionTokens: 0,
    })).toThrow('有效模型窗口必须大于输出预留');

    expect(() => resolveEffectivePromptBudget({
      policyMaxTokens: 8_000,
      policyReservedForResponse: 2_000,
      modelContextWindowTokens: 8_000,
      modelMaxOutputTokens: 2_000,
      toolDefinitionTokens: 6_000,
    })).toThrow('Tool definitions 已占满 Prompt 输入预算');
  });
});
