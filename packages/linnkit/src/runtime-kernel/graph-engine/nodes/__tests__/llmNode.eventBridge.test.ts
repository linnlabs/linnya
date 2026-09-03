import { describe, expect, it } from 'vitest';
import { routeRuntimeEvent, type RuntimeEvent, ToolCallIdSchema } from '../../../../contracts';
import { LlmNodeEventBridge, type TickEvent } from '../llmNode.eventBridge';
import { initLlmNodeState, llmNodeReducer, type LlmNodeAction } from '../llmNode.state';

const identity = {
  run_id: 'run_test',
  lane: 'foreground' as const,
  visibility: 'conversation' as const,
};

function createSubject(options: { publishError?: Error } = {}) {
  let state = initLlmNodeState({ answerId: undefined, chunkSeq: 0 });
  const published: RuntimeEvent[] = [];
  const failureFacts: RuntimeEvent[] = [];
  const actions: LlmNodeAction[] = [];
  const bridge = new LlmNodeEventBridge({
    getState: () => state,
    dispatch: action => {
      actions.push(action);
      state = llmNodeReducer(state, action);
    },
    runtimeEventSink: event => {
      if (options.publishError) throw options.publishError;
      const routed = routeRuntimeEvent(event, identity);
      published.push(routed);
      return routed;
    },
    runtimeFailureFactSink: event => {
      failureFacts.push(event);
    },
    conversationId: 'conv_test',
    turnId: 'turn_test',
  });
  return { bridge, published, failureFacts, actions, getState: () => state };
}

function emit(bridge: LlmNodeEventBridge, event: TickEvent): void {
  bridge.handle(event);
}

describe('LlmNodeEventBridge runtime facts', () => {
  it('把已发布的 LLM 终态错误事实交给 lifecycle，且不创建第二份事实', () => {
    const { bridge, published, failureFacts } = createSubject();

    emit(bridge, {
      type: 'error',
      id: 'llm_failure_1',
      timestamp: 1,
      error: 'Canonical inference failed: provider_http_502',
      error_code: 'llm.provider_http_502',
      retryable: true,
    });

    expect(published).toHaveLength(1);
    expect(failureFacts).toEqual([published[0]]);
    expect(failureFacts[0]).toMatchObject({
      id: 'llm_failure_1',
      type: 'error',
      error_code: 'llm.provider_http_502',
      retryable: true,
      run_id: 'run_test',
    });
  });

  it('保持 provider 的 answer_id/seq，并用同一身份组装完整 final_answer', () => {
    const { bridge, published, getState } = createSubject();

    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_0',
      timestamp: 1,
      answer_id: 'answer_provider',
      seq: 0,
      content: ' 第一段',
    });
    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_1',
      timestamp: 2,
      answer_id: 'answer_provider',
      seq: 1,
      content: '第二段 ',
    });
    emit(bridge, {
      type: 'final_answer',
      id: 'provider_final',
      timestamp: 3,
      answer_id: 'different_sidecar_id',
      answer: '第一段第二段',
      completion_reason: 'terminal',
    });

    expect(published.map(event => event.type)).toEqual([
      'final_answer_chunk',
      'final_answer_chunk',
      'final_answer',
    ]);
    expect(published[0]).toMatchObject({ answer_id: 'answer_provider', seq: 0 });
    expect(published[1]).toMatchObject({ answer_id: 'answer_provider', seq: 1 });
    expect(published[2]).toMatchObject({
      id: 'answer_provider',
      answer_id: 'answer_provider',
      content: ' 第一段第二段 ',
      is_complete: true,
      completion_reason: 'terminal',
      run_id: 'run_test',
    });
    expect(getState().streamRuntimeEvents).toEqual(published);
  });

  it('工具决策前先结算已有答案段，保证历史顺序可直接回放', () => {
    const { bridge, published } = createSubject();
    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_0',
      timestamp: 1,
      answer_id: 'answer_before_tool',
      seq: 0,
      content: '先说明背景。',
    });
    emit(bridge, {
      type: 'tool_call_decision',
      id: 'decision_1',
      timestamp: 2,
      tool_name: 'search',
      tool_args: { query: '事实' },
      tool_call_id: ToolCallIdSchema.parse('call_1'),
      phase: 'start',
      status: 'loading',
    });

    expect(published.map(event => event.type)).toEqual([
      'final_answer_chunk',
      'final_answer',
      'tool_call_decision',
    ]);
    expect(published[1]).toMatchObject({
      answer_id: 'answer_before_tool',
      content: '先说明背景。',
      completion_reason: 'tool_call',
    });
  });

  it('非流式完整答案先发布 one-shot chunk，再发布 durable final_answer', () => {
    const { bridge, published } = createSubject();

    emit(bridge, {
      type: 'final_answer',
      id: 'provider_final',
      timestamp: 3,
      answer_id: 'answer_standalone',
      answer: '一次性答案',
      completion_reason: 'terminal',
    });

    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({
      type: 'final_answer_chunk',
      answer_id: 'answer_standalone',
      seq: 0,
      content: '一次性答案',
      is_last: true,
      ephemeral: true,
    });
    expect(published[1]).toMatchObject({
      type: 'final_answer',
      id: 'answer_standalone',
      answer_id: 'answer_standalone',
      content: '一次性答案',
      completion_reason: 'terminal',
    });
  });

  it('异常或取消只把在途文本封成 interrupted，不产生终态交付', () => {
    const { bridge, published } = createSubject();
    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_partial',
      timestamp: 1,
      answer_id: 'answer_partial',
      seq: 0,
      content: '处理中',
    });

    bridge.finalizePartialAnswer();

    expect(published[1]).toMatchObject({
      type: 'final_answer',
      answer_id: 'answer_partial',
      content: '处理中',
      is_complete: false,
      completion_reason: 'interrupted',
      meta: { partial: true, chunk_count: 1 },
    });
  });

  it('重试 reset 清空在途组装，最终只持久化成功 attempt 的答案', () => {
    const { bridge, published } = createSubject();
    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_partial',
      timestamp: 1,
      answer_id: 'answer_partial',
      seq: 0,
      content: '旧 attempt 的部分输出',
    });
    emit(bridge, {
      type: 'stream_reset',
      id: 'reset_partial',
      timestamp: 2,
      answer_id: 'answer_partial',
    });
    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_final',
      timestamp: 3,
      answer_id: 'answer_final',
      seq: 0,
      content: '新 attempt 的完整输出',
    });
    emit(bridge, {
      type: 'final_answer',
      id: 'provider_final',
      timestamp: 4,
      answer_id: 'answer_final',
      answer: '新 attempt 的完整输出',
      completion_reason: 'terminal',
    });

    expect(published.map(event => event.type)).toEqual([
      'final_answer_chunk',
      'final_answer_reset',
      'final_answer_chunk',
      'final_answer',
    ]);
    expect(published[1]).toMatchObject({
      type: 'final_answer_reset',
      answer_id: 'answer_partial',
    });
    const durableAnswers = published.filter(event => event.type === 'final_answer');
    expect(durableAnswers).toHaveLength(1);
    expect(durableAnswers[0]).toMatchObject({
      answer_id: 'answer_final',
      content: '新 attempt 的完整输出',
      is_complete: true,
    });
  });

  it('拒绝同一答案段的跳号 chunk，避免渲染与持久化静默分叉', () => {
    const { bridge, published } = createSubject();
    emit(bridge, {
      type: 'stream_chunk',
      id: 'chunk_0',
      timestamp: 1,
      answer_id: 'answer_1',
      seq: 0,
      content: 'A',
    });

    expect(() =>
      emit(bridge, {
        type: 'stream_chunk',
        id: 'chunk_2',
        timestamp: 2,
        answer_id: 'answer_1',
        seq: 2,
        content: 'C',
      })
    ).toThrow('sequence mismatch');
    expect(published).toHaveLength(1);
  });

  it('publisher 失败必须向上传播，且失败事实不能进入 graph journal', () => {
    const publishError = new Error('EventBus publish failed');
    const { bridge, actions } = createSubject({ publishError });

    expect(() =>
      emit(bridge, {
        type: 'thought',
        id: 'thought_1',
        timestamp: 1,
        content: '处理中',
        is_complete: false,
      })
    ).toThrow(publishError);
    expect(actions.some(action => action.type === 'RUNTIME_EVENT_BUFFERED')).toBe(false);
  });
});
