import { describe, expect, it, vi } from 'vitest';

import { runWithLifecycleTelemetry } from '../runWithLifecycleTelemetry';
import type { EngineState } from '../../types';
import { RunIdSchema } from '../../../../contracts';

function createState(local: EngineState['local'] = {}): EngineState {
  return {
    nodeId: 'test',
    local,
  };
}

describe('runWithLifecycleTelemetry', () => {
  it('成功路径发送 spawned + completed，并用 finalState 刷新终态 scope', async () => {
    const emit = vi.fn();
    const initialState = createState({
      conversationId: 'conv-1',
      turnId: 'turn-initial',
    });
    const finalState = createState({
      conversationId: 'conv-1',
      turnId: 'turn-final',
    });

    const result = await runWithLifecycleTelemetry({
      checkpointKey: 'checkpoint-1',
      maxSteps: 8,
      telemetryPort: { emit },
      loadInitialState: vi.fn().mockResolvedValue(initialState),
      run: vi.fn().mockImplementation(async (_state, reportStepsUsed) => {
        reportStepsUsed(3);
        return { result: 'ok', finalState, terminalReason: 'completed' };
      }),
    });

    expect(result).toBe('ok');
    expect(emit.mock.calls.map(call => call[0].phase)).toEqual(['spawned', 'completed']);
    expect(emit.mock.calls[0][0]).toMatchObject({
      kind: 'run_lifecycle',
      runId: 'checkpoint-1',
      scope: {
        conversationId: 'conv-1',
        runId: 'checkpoint-1',
        turnId: 'turn-initial',
      },
    });
    expect(emit.mock.calls[1][0]).toMatchObject({
      kind: 'run_lifecycle',
      runId: 'checkpoint-1',
      stepsUsed: 3,
      maxSteps: 8,
      terminalReason: 'completed',
      scope: {
        conversationId: 'conv-1',
        runId: 'checkpoint-1',
        turnId: 'turn-final',
      },
    });
  });

  it('优先使用 initialState 中的真实 runId', async () => {
    const emit = vi.fn();
    const state = createState({
      runId: RunIdSchema.parse('run-real'),
      parentRunId: RunIdSchema.parse('run-parent'),
    });

    await runWithLifecycleTelemetry({
      checkpointKey: 'checkpoint-1',
      maxSteps: 8,
      telemetryPort: { emit },
      loadInitialState: vi.fn().mockResolvedValue(state),
      run: vi.fn().mockResolvedValue({
        result: 'ok',
        finalState: state,
        terminalReason: 'completed',
      }),
    });

    expect(emit.mock.calls.map(call => call[0].runId)).toEqual(['run-real', 'run-real']);
    expect(emit.mock.calls.every(call => call[0].scope.runId === 'run-real')).toBe(true);
    expect(emit.mock.calls.every(call => call[0].scope.parentRunId === 'run-parent')).toBe(true);
  });

  it('普通错误发送 failed 并继续抛出原错误', async () => {
    const emit = vi.fn();
    const error = new Error('boom');

    await expect(
      runWithLifecycleTelemetry({
        checkpointKey: 'checkpoint-1',
        maxSteps: 8,
        telemetryPort: { emit },
        loadInitialState: vi.fn().mockResolvedValue(createState()),
        run: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toBe(error);

    expect(emit.mock.calls.map(call => call[0].phase)).toEqual(['spawned', 'failed']);
    expect(emit.mock.calls[1][0]).toMatchObject({
      stepsUsed: 0,
      maxSteps: 8,
      terminalReason: 'failed',
    });
  });

  it('AbortError 发送 cancelled 并继续抛出原错误', async () => {
    const emit = vi.fn();
    const error = new Error('aborted');
    error.name = 'AbortError';

    await expect(
      runWithLifecycleTelemetry({
        checkpointKey: 'checkpoint-1',
        maxSteps: 8,
        telemetryPort: { emit },
        loadInitialState: vi.fn().mockResolvedValue(createState()),
        run: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toBe(error);

    expect(emit.mock.calls.map(call => call[0].phase)).toEqual(['spawned', 'cancelled']);
    expect(emit.mock.calls[1][0]).toMatchObject({ terminalReason: 'cancelled' });
  });

  it('初始状态加载失败时使用 checkpointKey 和空 scope 发送 spawned + failed', async () => {
    const emit = vi.fn();
    const error = new Error('load fail');
    const run = vi.fn();

    await expect(
      runWithLifecycleTelemetry({
        checkpointKey: 'checkpoint-1',
        maxSteps: 8,
        telemetryPort: { emit },
        loadInitialState: vi.fn().mockRejectedValue(error),
        run,
      })
    ).rejects.toBe(error);

    expect(run).not.toHaveBeenCalled();
    expect(emit.mock.calls.map(call => call[0])).toEqual([
      {
        kind: 'run_lifecycle',
        runId: 'checkpoint-1',
        phase: 'spawned',
        scope: {},
      },
      {
        kind: 'run_lifecycle',
        runId: 'checkpoint-1',
        phase: 'failed',
        stepsUsed: 0,
        maxSteps: 8,
        terminalReason: 'failed',
        scope: {},
      },
    ]);
  });

  it('容量错误保留真实步数并投影为 capacity_failed', async () => {
    const emit = vi.fn();
    const error = Object.assign(new Error('over budget'), {
      errorCode: 'llm.prompt.input_budget_exceeded',
    });

    await expect(runWithLifecycleTelemetry({
      checkpointKey: 'checkpoint-1',
      maxSteps: 8,
      telemetryPort: { emit },
      loadInitialState: vi.fn().mockResolvedValue(createState()),
      run: vi.fn().mockImplementation(async (_state, reportStepsUsed) => {
        reportStepsUsed(4);
        throw error;
      }),
    })).rejects.toBe(error);

    expect(emit.mock.calls[1][0]).toMatchObject({
      phase: 'failed',
      stepsUsed: 4,
      maxSteps: 8,
      terminalReason: 'capacity_failed',
    });
  });
});
