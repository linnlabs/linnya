import { describe, expect, it, vi } from 'vitest';

import type { RuntimeEvent, RuntimeEventRoutingIdentity } from '../../../../contracts';
import { LlmNode, type LlmNodeReasoner } from '../llmNode';
import type { EngineState } from '../../types';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';
import { RunIdSchema, ToolCallIdSchema } from '../../../../contracts';

const contextUsage = {
  basis: 'last_completed_llm_prompt' as const,
  budget_model_id: 'primary-model',
  served_model_id: 'primary-model',
  used_tokens: 900,
  components: {
    system_prompt_tokens: 200,
    conversation_tokens: 600,
    tool_definition_tokens: 100,
  },
  component_attribution: 'normalized_local_estimate' as const,
  input_budget_tokens: 1_000,
  remaining_tokens: 100,
  output_limit_tokens: 200,
  source: 'test-fixture' as const,
  confidence: 'estimate' as const,
  measured_at: 1,
};

const identity: RuntimeEventRoutingIdentity = {
  run_id: RunIdSchema.parse('run_test'),
  lane: 'foreground',
  visibility: 'conversation',
};

const runtimeEventSink = createRuntimeEventAdmissionSink('conv_test', identity.run_id);

function createState(local: NonNullable<EngineState['local']> = {}): EngineState {
  return {
    nodeId: 'llm',
    local: {
      conversationId: 'conv_test',
      turnId: 'turn_test',
      request: {
        query: '完成任务',
        promptKey: 'default',
        maxSteps: 10,
        enableTools: true,
      },
      history: [],
      runtimeEventSink,
      ...local,
    },
  };
}

function createReasoner(tick: LlmNodeReasoner['tick']): {
  reasoner: LlmNodeReasoner;
  tick: ReturnType<typeof vi.fn<LlmNodeReasoner['tick']>>;
} {
  const trackedTick = vi.fn<LlmNodeReasoner['tick']>(tick);
  return {
    reasoner: { tick: trackedTick },
    tick: trackedTick,
  };
}

describe('LlmNode orchestration', () => {
  it('把宿主注入的 RuntimeEvent 提交端口原样透传给单步推理', async () => {
    const runtimeEventCommitPort = vi.fn(async () => undefined);
    const { reasoner, tick } = createReasoner(async input => {
      expect(input.runtimeEventCommitPort).toBe(runtimeEventCommitPort);
      return { decision: { kind: 'yield' } };
    });
    const node = new LlmNode({ reasoner });

    await node.run(createState({ runtimeEventCommitPort }));

    expect(tick).toHaveBeenCalledOnce();
    expect(runtimeEventCommitPort).not.toHaveBeenCalled();
  });

  it('缺少合法 request 时直接 yield，不启动 reasoner', async () => {
    const { reasoner, tick } = createReasoner(async () => ({
      decision: { kind: 'yield' },
    }));
    const node = new LlmNode({ reasoner });
    const state: EngineState = {
      nodeId: 'llm',
      local: { conversationId: 'conv_test', history: [], runtimeEventSink },
    };

    await expect(node.run(state)).resolves.toEqual({ kind: 'yield', events: [] });
    expect(tick).not.toHaveBeenCalled();
  });

  it('工具决策写入 pendingToolCalls，并只路由到 tool', async () => {
    const toolCalls = [
      {
        id: ToolCallIdSchema.parse('call_1'),
        type: 'function' as const,
        function: { name: 'workspace_read', arguments: '{"path":"README.md"}' },
      },
    ];
    const { reasoner } = createReasoner(async () => ({
      decision: { kind: 'tool_calls', toolCalls },
    }));
    const node = new LlmNode({ reasoner });
    const state = createState();

    const result = await node.run(state);

    expect(result).toEqual({ kind: 'route', nextNodeId: 'tool', events: [] });
    expect(state.local?.pendingToolCalls).toEqual(toolCalls);
  });

  it('每次成功的模型调用都发布临时上下文快照，且不把它写入下一轮模型 history', async () => {
    const published: RuntimeEvent[] = [];
    const toolCalls = [
      {
        id: ToolCallIdSchema.parse('call_context_usage'),
        type: 'function' as const,
        function: { name: 'workspace_read', arguments: '{"path":"README.md"}' },
      },
    ];
    const { reasoner } = createReasoner(async () => ({
      decision: { kind: 'tool_calls', toolCalls },
      contextUsage,
    }));
    const node = new LlmNode({ reasoner });
    const admissionSink = createRuntimeEventAdmissionSink('conv_test', identity.run_id);
    const state = createState({
      runtimeEventSink: (event, source) => {
        const routed = admissionSink(event, source);
        published.push(routed);
        return routed;
      },
    });

    const result = await node.run(state);

    expect(result).toMatchObject({ kind: 'route', nextNodeId: 'tool' });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'context_usage_snapshot',
      ephemeral: true,
      context_usage: contextUsage,
      run_id: 'run_test',
    });
    expect(result.events).toEqual(published);
    expect(state.local?.contextUsage).toEqual(contextUsage);
    expect(state.local?.history).toEqual([]);
  });

  it('最终答案在 llm 节点结束，不再路由到独立 AnswerNode', async () => {
    const { reasoner } = createReasoner(async () => ({
      decision: { kind: 'final_answer', answer: '任务完成' },
    }));
    const node = new LlmNode({ reasoner });
    const state = createState();

    const result = await node.run(state);

    expect(result).toEqual({ kind: 'yield', events: [] });
    expect(state.local?.finalAnswer).toBe('任务完成');
  });

  it('发布后的同一 RuntimeEvent 同时进入 journal 与下一轮 history', async () => {
    const published: RuntimeEvent[] = [];
    const { reasoner } = createReasoner(async (_input, eventHandler) => {
      eventHandler?.({
        type: 'stream_chunk',
        id: 'chunk_0',
        timestamp: 1,
        answer_id: 'answer_provider',
        seq: 0,
        content: '任务',
      });
      eventHandler?.({
        type: 'final_answer',
        id: 'provider_final',
        timestamp: 2,
        answer_id: 'answer_provider',
        answer: '任务完成',
        completion_reason: 'terminal',
      });
      return {
        decision: { kind: 'final_answer', answer: '任务完成' },
      };
    });
    const node = new LlmNode({ reasoner });
    const admissionSink = createRuntimeEventAdmissionSink('conv_test', identity.run_id);
    const state = createState({
      runtimeEventSink: (event, source) => {
        const routed = admissionSink(event, source);
        published.push(routed);
        return routed;
      },
    });

    const result = await node.run(state);

    expect(published.map(event => event.type)).toEqual(['final_answer_chunk', 'final_answer']);
    expect(result.events).toEqual(published);
    expect(state.local?.history).toEqual(published);
    expect(published[1]).toMatchObject({
      id: 'answer_provider',
      answer_id: 'answer_provider',
      content: '任务',
      run_id: 'run_test',
    });
  });

  it('publisher 失败向上传播，失败事实不能进入 journal', async () => {
    const publishError = new Error('event bus unavailable');
    const { reasoner } = createReasoner(async (_input, eventHandler) => {
      eventHandler?.({
        type: 'stream_chunk',
        id: 'chunk_0',
        timestamp: 1,
        answer_id: 'answer_provider',
        seq: 0,
        content: '未发布内容',
      });
      return { decision: { kind: 'yield' } };
    });
    const node = new LlmNode({ reasoner });
    const state = createState({
      runtimeEventSink: () => {
        throw publishError;
      },
    });

    await expect(node.run(state)).rejects.toBe(publishError);
    expect(state.local?.history).toEqual([]);
  });

  it('force_final_answer 禁用工具，并拒绝底层返回的工具路由', async () => {
    const toolCalls = [
      {
        id: ToolCallIdSchema.parse('call_1'),
        type: 'function' as const,
        function: { name: 'workspace_read', arguments: '{}' },
      },
    ];
    const { reasoner, tick } = createReasoner(async input => {
      expect(input.forceFinalAnswer).toBe(true);
      expect(input.request.enableTools).toBe(false);
      expect(input.request.availableTools).toEqual([]);
      return {
        decision: { kind: 'tool_calls', toolCalls },
      };
    });
    const node = new LlmNode({ reasoner });
    const state = createState({
      executorLocal: { stepCount: 10, phase: 'force_final_answer' },
    });

    const result = await node.run(state);

    expect(tick).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: 'yield', events: [] });
    expect(state.local?.pendingToolCalls).toBeUndefined();
  });

  it('合并 executorLocalPatch 时不修改上一状态对象', async () => {
    const { reasoner } = createReasoner(async () => ({
      decision: { kind: 'yield' },
      executorLocalPatch: { runLockedModelId: 'cloud-deepseek-reasoner' },
    }));
    const node = new LlmNode({ reasoner });
    const previousExecutorLocal = {
      stepCount: 2,
      runLockedModelId: 'cloud-primary-model',
    };
    const state = createState({ executorLocal: previousExecutorLocal });

    await node.run(state);

    expect(previousExecutorLocal.runLockedModelId).toBe('cloud-primary-model');
    expect(state.local?.executorLocal).toEqual({
      stepCount: 2,
      runLockedModelId: 'cloud-deepseek-reasoner',
    });
    expect(state.local?.executorLocal).not.toBe(previousExecutorLocal);
  });
});
