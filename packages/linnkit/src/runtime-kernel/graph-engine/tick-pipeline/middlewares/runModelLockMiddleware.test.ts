import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TickStage } from '../types';
import { createTestTickPipelineContext } from '../__tests__/createTestTickPipelineContext';
import { runTickPipeline } from '../runTickPipeline';

const loggerWarnMock = vi.fn();

vi.mock('../../../../shared/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    warn: loggerWarnMock,
  })),
}));

function createContext() {
  return createTestTickPipelineContext({
    request: { model_id: 'cloud-primary-model' },
    context: {
      executorLocal: { stepCount: 1 },
      modelId: 'cloud-primary-model',
      conversationId: 'conv_model_lock',
      turnId: 'turn_model_lock',
    },
  });
}

describe('runModelLockMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仅在 execute_llm 后根据 fallback 结果写回 runLockedModelId', async () => {
    const { runModelLockMiddleware } = await import('./runModelLockMiddleware');
    const ctx = createContext();
    const stage: TickStage = {
      id: 'execute_llm',
      reads: [],
      writes: ['cloudQuotaFallbackAppliedModelId'],
      async run() {
        return { cloudQuotaFallbackAppliedModelId: 'cloud-deepseek-reasoner' };
      },
    };

    await runTickPipeline(ctx, [stage], [runModelLockMiddleware]);

    expect(ctx.executorLocal?.runLockedModelId).toBeUndefined();
    expect(ctx.executorLocalPatch).toEqual({
      runLockedModelId: 'cloud-deepseek-reasoner',
    });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });
});
