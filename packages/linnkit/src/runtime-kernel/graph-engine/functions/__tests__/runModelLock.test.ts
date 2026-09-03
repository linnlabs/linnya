import { describe, expect, it } from 'vitest';

import { decideRunModelLockPatch } from '../runModelLock';

describe('runModelLock.decideRunModelLockPatch', () => {
  it('仅在 execute_llm 阶段根据 quota fallback 生成 executorLocal patch', () => {
    expect(decideRunModelLockPatch({
      stageId: 'execute_llm',
      appliedFallbackModelId: 'cloud-deepseek-reasoner',
      currentRunLockedModelId: undefined,
    })).toEqual({
      executorLocalPatch: { runLockedModelId: 'cloud-deepseek-reasoner' },
      shouldLog: true,
    });
  });

  it('非 execute_llm 阶段不生成 patch', () => {
    expect(decideRunModelLockPatch({
      stageId: 'prepare_call',
      appliedFallbackModelId: 'cloud-deepseek-reasoner',
      currentRunLockedModelId: undefined,
    })).toEqual({ shouldLog: false });
  });

  it('已经锁定同一模型时不重复生成 patch', () => {
    expect(decideRunModelLockPatch({
      stageId: 'execute_llm',
      appliedFallbackModelId: 'cloud-deepseek-reasoner',
      currentRunLockedModelId: 'cloud-deepseek-reasoner',
    })).toEqual({ shouldLog: false });
  });
});
