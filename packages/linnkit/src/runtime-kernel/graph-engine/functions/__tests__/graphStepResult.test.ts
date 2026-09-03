import { describe, expect, it } from 'vitest';

import { createToolOutputEvent, routeRuntimeEvent } from '../../../../contracts';
import { resolveGraphStepResult } from '../graphStepResult';
import type { EngineState, NodeResult } from '../../types';

const routedToolOutput = routeRuntimeEvent(
  createToolOutputEvent(
    'tool_output_1',
    'conversation_1',
    'turn_1',
    'search',
    'tool_call_1',
    { status: 'success', observation: 'done', data: {} },
  ),
  {
    run_id: 'run_1',
    lane: 'foreground',
    visibility: 'conversation',
  },
);

function createState(state: Partial<EngineState> = {}): EngineState {
  return {
    nodeId: 'tool',
    local: {},
    ...state,
  };
}

describe('graphStepResult.resolveGraphStepResult', () => {
  it('route 结果切换到目标节点并透传事件', () => {
    const result = resolveGraphStepResult({
      state: createState({ nodeId: 'tool' }),
      result: {
        kind: 'route',
        nextNodeId: 'llm',
        events: [routedToolOutput],
      },
    });

    expect(result.state.nodeId).toBe('llm');
    expect(result.events).toEqual([routedToolOutput]);
    expect(result.action).toEqual({
      kind: 'route',
      fromNodeId: 'tool',
      nextNodeId: 'llm',
    });
  });

  it('route 缺省 nextNodeId 时沿用 user 兜底语义', () => {
    const result = resolveGraphStepResult({
      state: createState({ nodeId: 'custom' }),
      result: { kind: 'route' },
    });

    expect(result.state.nodeId).toBe('user');
    expect(result.action).toEqual({
      kind: 'route',
      fromNodeId: 'custom',
      nextNodeId: 'user',
    });
  });

  it('yield 和 pause 保持当前节点并返回对应动作', () => {
    const yieldResult = resolveGraphStepResult({
      state: createState({ nodeId: 'wait' }),
      result: { kind: 'yield' },
    });
    const pauseResult = resolveGraphStepResult({
      state: createState({ nodeId: 'wait_user' }),
      result: { kind: 'pause' },
    });

    expect(yieldResult.state.nodeId).toBe('wait');
    expect(yieldResult.action).toEqual({ kind: 'yield' });
    expect(pauseResult.state.nodeId).toBe('wait_user');
    expect(pauseResult.action).toEqual({ kind: 'pause' });
  });
});
