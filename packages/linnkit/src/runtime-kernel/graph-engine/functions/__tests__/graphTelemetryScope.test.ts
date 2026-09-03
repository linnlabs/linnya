import { describe, expect, it } from 'vitest';

import { buildRuntimeTelemetryScope, resolveRuntimeRunId } from '../graphTelemetryScope';
import type { EngineState } from '../../types';
import { RunIdSchema } from '../../../../contracts';

function createState(local: EngineState['local'] = {}): EngineState {
  return {
    nodeId: 'test',
    local,
  };
}

describe('graphTelemetryScope', () => {
  it('优先使用运行态真实 runId', () => {
    expect(
      resolveRuntimeRunId({
        state: createState({ runId: RunIdSchema.parse('run-real') }),
        fallbackRunId: RunIdSchema.parse('checkpoint-key'),
      })
    ).toBe('run-real');
  });

  it('runId 缺失时回退到 checkpointKey', () => {
    expect(
      resolveRuntimeRunId({
        state: createState(),
        fallbackRunId: RunIdSchema.parse('checkpoint-key'),
      })
    ).toBe('checkpoint-key');
  });

  it('从 state.local 构造 telemetry scope 并保留已 admission 的身份', () => {
    expect(
      buildRuntimeTelemetryScope({
        state: createState({
          conversationId: 'conv-1',
          runId: RunIdSchema.parse('ignored-run'),
          parentRunId: RunIdSchema.parse('parent-run'),
          turnId: 'turn-1',
        }),
        runId: RunIdSchema.parse('run-1'),
      })
    ).toEqual({
      conversationId: 'conv-1',
      runId: 'run-1',
      parentRunId: 'parent-run',
      turnId: 'turn-1',
    });
  });
});
