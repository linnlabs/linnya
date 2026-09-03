import { describe, expect, it } from 'vitest';

import { prepareGraphStep } from '../graphStepPreparation';
import type { EngineState } from '../../types';
import { ToolCallIdSchema } from '../../../../contracts';

function createState(state: Partial<EngineState> = {}): EngineState {
  return {
    nodeId: 'tool',
    local: {},
    ...state,
  };
}

describe('graphStepPreparation.prepareGraphStep', () => {
  it('普通步骤注入 executorLocal 步数信息并保持 running phase', () => {
    const result = prepareGraphStep({
      state: createState({
        local: {
          executorLocal: {
            stepCount: 0,
            phase: 'custom_phase',
          },
        },
      }),
      maxSteps: 5,
      stepCount: 2,
    });

    expect(result.state.nodeId).toBe('tool');
    expect(result.executorLocal).toMatchObject({
      maxSteps: 5,
      stepCount: 2,
      remainingSteps: 3,
      phase: 'custom_phase',
    });
  });

  it('final_answer 只在真实 LLM 已不足以完成 ToolNode → LLM 闭环时进入强制收尾', () => {
    const allowed = prepareGraphStep({
      state: createState({ nodeId: 'llm' }),
      maxSteps: 800,
      stepCount: 798,
    });
    const forced = prepareGraphStep({
      state: createState({ nodeId: 'llm' }),
      maxSteps: 800,
      stepCount: 799,
    });

    expect(allowed.state.nodeId).toBe('llm');
    expect(allowed.executorLocal).toMatchObject({
      remainingSteps: 2,
      phase: 'running',
    });
    expect(forced.state.nodeId).toBe('llm');
    expect(forced.executorLocal).toMatchObject({
      remainingSteps: 1,
      phase: 'force_final_answer',
    });
  });

  it('final_answer 达到硬边界时仍保持已经接受的 ToolNode 与 pending batch', () => {
    const pendingToolCalls = [
      {
        id: ToolCallIdSchema.parse('call-1'),
        type: 'function' as const,
        function: { name: 'lookup', arguments: '{}' },
      },
    ];
    const result = prepareGraphStep({
      state: createState({
        nodeId: 'tool',
        local: {
          pendingToolCalls,
          pendingInteractionSpec: { kind: 'ask' },
          lastToolResult: { ok: true },
        },
      }),
      maxSteps: 800,
      stepCount: 800,
    });

    expect(result.state.nodeId).toBe('tool');
    expect(result.state.local).toMatchObject({
      executorLocal: {
        phase: 'running',
      },
      pendingToolCalls,
      pendingInteractionSpec: { kind: 'ask' },
      lastToolResult: { ok: true },
    });
  });

  it('force_tools 在真实 LLM 仍有两步时收敛，但不抢占 pending ToolNode', () => {
    const llm = prepareGraphStep({
      state: createState({
        nodeId: 'llm',
        local: {
          executorLocal: {
            stepCount: 0,
            finalStepPolicy: 'force_tools',
          },
        },
      }),
      maxSteps: 800,
      stepCount: 798,
    });
    const tool = prepareGraphStep({
      state: createState({
        nodeId: 'tool',
        local: {
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call-final'),
              type: 'function',
              function: { name: 'commit', arguments: '{}' },
            },
          ],
          executorLocal: {
            stepCount: 0,
            finalStepPolicy: 'force_tools',
            phase: 'force_tools',
          },
        },
      }),
      maxSteps: 800,
      stepCount: 799,
    });

    expect(llm.state.nodeId).toBe('llm');
    expect(llm.executorLocal.phase).toBe('force_tools');
    expect(tool.state.nodeId).toBe('tool');
    expect(tool.state.local?.pendingToolCalls).toHaveLength(1);
  });

  it('force_tools 的最终工具未终止任务时，最后一个 LLM 节点直接诚实收尾', () => {
    const result = prepareGraphStep({
      state: createState({
        nodeId: 'llm',
        local: {
          executorLocal: {
            stepCount: 0,
            finalStepPolicy: 'force_tools',
            phase: 'force_tools',
          },
        },
      }),
      maxSteps: 800,
      stepCount: 800,
    });

    expect(result.state.nodeId).toBe('llm');
    expect(result.executorLocal).toMatchObject({
      remainingSteps: 0,
      phase: 'force_final_answer',
    });
  });

  it('wait_user 和 answer 节点不被最后一步策略强制切换', () => {
    const waitUser = prepareGraphStep({
      state: createState({ nodeId: 'wait_user' }),
      maxSteps: 2,
      stepCount: 2,
    });
    const answer = prepareGraphStep({
      state: createState({ nodeId: 'answer' }),
      maxSteps: 2,
      stepCount: 2,
    });

    expect(waitUser.state.nodeId).toBe('wait_user');
    expect(answer.state.nodeId).toBe('answer');
  });

  it('进入 llm 节点时注入 LLM 调用语义并递增计数', () => {
    const first = prepareGraphStep({
      state: createState({ nodeId: 'llm' }),
      maxSteps: 4,
      stepCount: 1,
    });
    const second = prepareGraphStep({
      state: createState({
        nodeId: 'llm',
        local: {
          executorLocal: {
            stepCount: 0,
            llmInvocationCount: 1,
          },
        },
      }),
      maxSteps: 4,
      stepCount: 2,
    });

    expect(first.executorLocal).toMatchObject({
      llmInvocationKind: 'user_initiated',
      llmInvocationCount: 1,
    });
    expect(second.executorLocal).toMatchObject({
      llmInvocationKind: 'continuation',
      llmInvocationCount: 2,
    });
  });
});
