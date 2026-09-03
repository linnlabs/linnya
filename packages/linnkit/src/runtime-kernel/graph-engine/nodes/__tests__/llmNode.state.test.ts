import { describe, expect, it } from 'vitest';
import { createThoughtEvent, routeRuntimeEvent } from '../../../../contracts';
import {
  buildLocalPatch,
  initLlmNodeState,
  llmNodeReducer,
} from '../llmNode.state';

describe('LlmNode stream state', () => {
  it('只接受 provider 提供的连续 chunk 序号', () => {
    let state = initLlmNodeState({ answerId: undefined, chunkSeq: 0 });
    state = llmNodeReducer(state, {
      type: 'STREAM_CHUNK_RECEIVED', answerId: 'answer_1', seq: 0,
    });
    state = llmNodeReducer(state, {
      type: 'STREAM_CHUNK_RECEIVED', answerId: 'answer_1', seq: 1,
    });

    expect(state).toMatchObject({ answerId: 'answer_1', chunkSeq: 2 });
    expect(() => llmNodeReducer(state, {
      type: 'STREAM_CHUNK_RECEIVED', answerId: 'answer_1', seq: 3,
    })).toThrow('expected=2, actual=3');
  });

  it('新 answer segment 必须从 seq=0 开始', () => {
    const state = initLlmNodeState({ answerId: 'answer_old', chunkSeq: 4 });
    const next = llmNodeReducer(state, {
      type: 'STREAM_CHUNK_RECEIVED', answerId: 'answer_new', seq: 0,
    });
    expect(next).toMatchObject({ answerId: 'answer_new', chunkSeq: 1 });
  });

  it('同一事实 ID 只进入 journal 一次', () => {
    const event = routeRuntimeEvent(
      createThoughtEvent('thought_1', 'conv_1', 'turn_1', '处理中'),
      { run_id: 'run_1', lane: 'foreground', visibility: 'conversation' },
    );
    let state = initLlmNodeState({ answerId: undefined, chunkSeq: 0 });
    state = llmNodeReducer(state, { type: 'RUNTIME_EVENT_BUFFERED', event });
    state = llmNodeReducer(state, { type: 'RUNTIME_EVENT_BUFFERED', event });
    expect(state.streamRuntimeEvents).toEqual([event]);
  });

  it('历史只追加经过发布 sink 的事实', () => {
    const prior = createThoughtEvent('prior', 'conv_1', 'turn_1', '之前');
    const streamed = routeRuntimeEvent(
      createThoughtEvent('streamed', 'conv_1', 'turn_1', '实时输出'),
      { run_id: 'run_1', lane: 'foreground', visibility: 'conversation' },
    );
    const state = llmNodeReducer(
      initLlmNodeState({ answerId: undefined, chunkSeq: 0 }),
      { type: 'RUNTIME_EVENT_BUFFERED', event: streamed },
    );
    const patch = buildLocalPatch(state, {
      conversationId: 'conv_1', turnId: 'turn_1', history: [prior],
    });
    expect(patch.history).toEqual([prior, streamed]);
  });

  it('一次性写回最近成功的 context usage，并允许 checkpoint 保留', () => {
    const contextUsage = {
      basis: 'last_completed_llm_prompt' as const,
      budget_model_id: 'main-model',
      used_tokens: 90,
      components: {
        system_prompt_tokens: 20,
        conversation_tokens: 60,
        tool_definition_tokens: 10,
      },
      component_attribution: 'normalized_local_estimate' as const,
      input_budget_tokens: 100,
      remaining_tokens: 10,
      output_limit_tokens: 20,
      source: 'local-estimate' as const,
      confidence: 'estimate' as const,
      measured_at: 123,
    };
    const patch = buildLocalPatch(
      initLlmNodeState({ answerId: undefined, chunkSeq: 0 }),
      {
        conversationId: 'conv_1',
        turnId: 'turn_1',
        history: [],
        contextUsage,
      },
    );

    expect(patch.contextUsage).toEqual(contextUsage);
  });
});
