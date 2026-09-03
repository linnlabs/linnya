import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LLM_MAX_TOTAL_ATTEMPTS,
  hasLlmAttemptBudgetRemaining,
  resolveLlmMaxTotalAttempts,
} from '../retryAttemptBudget';

describe('retry attempt budget', () => {
  it('默认总调用上限不少于 maxRetries + 1，同时给模型 fallback 留有限空间', () => {
    expect(resolveLlmMaxTotalAttempts({ maxRetries: 0 })).toBe(DEFAULT_LLM_MAX_TOTAL_ATTEMPTS);
    expect(resolveLlmMaxTotalAttempts({ maxRetries: 10 })).toBe(11);
  });

  it('允许宿主显式收窄总调用上限', () => {
    expect(resolveLlmMaxTotalAttempts({ maxRetries: 3, maxTotalAttempts: 2 })).toBe(2);
  });

  it('拒绝无意义的总调用上限', () => {
    expect(() => resolveLlmMaxTotalAttempts({ maxRetries: 3, maxTotalAttempts: 0 })).toThrow(
      'maxTotalAttempts must be a positive integer',
    );
    expect(() => resolveLlmMaxTotalAttempts({ maxRetries: 3, maxTotalAttempts: 1.5 })).toThrow(
      'maxTotalAttempts must be a positive integer',
    );
  });

  it('根据真实 LLM 调用次数判断预算是否还可继续', () => {
    expect(hasLlmAttemptBudgetRemaining({ actualAttempts: 1, maxTotalAttempts: 2 })).toBe(true);
    expect(hasLlmAttemptBudgetRemaining({ actualAttempts: 2, maxTotalAttempts: 2 })).toBe(false);
  });
});
