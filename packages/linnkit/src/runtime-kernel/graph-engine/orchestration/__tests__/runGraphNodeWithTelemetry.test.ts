import { describe, expect, it, vi } from 'vitest';

import { runGraphNodeWithTelemetry } from '../runGraphNodeWithTelemetry';
import type { EngineState, GraphNode } from '../../types';
import { RunIdSchema } from '../../../../contracts';

function createState(local: EngineState['local'] = {}): EngineState {
  return {
    nodeId: 'tool',
    local,
  };
}

function createClock(...ticks: number[]): () => number {
  let index = 0;
  return () => {
    const tick = ticks[index];
    if (tick === undefined) {
      throw new Error('unexpected clock tick');
    }
    index += 1;
    return tick;
  };
}

describe('runGraphNodeWithTelemetry', () => {
  it('执行节点并发送 graph_node telemetry', async () => {
    const emit = vi.fn();
    const node: GraphNode = {
      id: 'tool',
      run: vi.fn().mockResolvedValue({ kind: 'yield', events: [] }),
    };
    const state = createState({
      conversationId: 'conv-1',
      runId: RunIdSchema.parse('run-1'),
      parentRunId: RunIdSchema.parse('parent-1'),
      turnId: 'turn-1',
    });

    const result = await runGraphNodeWithTelemetry({
      node,
      state,
      checkpointKey: 'checkpoint-1',
      telemetryPort: { emit },
      now: createClock(100, 137),
    });

    expect(result).toEqual({ kind: 'yield', events: [] });
    expect(node.run).toHaveBeenCalledWith(state);
    expect(emit).toHaveBeenCalledWith({
      kind: 'graph_node',
      nodeId: 'tool',
      durationMs: 37,
      scope: {
        conversationId: 'conv-1',
        runId: 'run-1',
        parentRunId: 'parent-1',
        turnId: 'turn-1',
      },
    });
  });

  it('节点抛错时仍发送 graph_node telemetry', async () => {
    const emit = vi.fn();
    const node: GraphNode = {
      id: 'tool',
      run: vi.fn().mockRejectedValue(new Error('boom')),
    };

    await expect(
      runGraphNodeWithTelemetry({
        node,
        state: createState(),
        checkpointKey: 'checkpoint-1',
        telemetryPort: { emit },
        now: createClock(200, 245),
      })
    ).rejects.toThrow('boom');

    expect(emit).toHaveBeenCalledWith({
      kind: 'graph_node',
      nodeId: 'tool',
      durationMs: 45,
      scope: {
        conversationId: undefined,
        runId: 'checkpoint-1',
        parentRunId: undefined,
        turnId: undefined,
      },
    });
  });
});
