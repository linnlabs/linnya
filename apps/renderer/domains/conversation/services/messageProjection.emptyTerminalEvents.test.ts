import { describe, expect, it } from 'vitest';

import { createInitialProjectionState, reduceEvent } from './messageProjection';
import { PROJECTION_TEST_SCOPE } from './messageProjection/__tests__/helpers/projectionTestScope';

describe('messageProjection empty terminal events', () => {
  it('空的 complete thought 不应投影成空白消息', () => {
    const state = createInitialProjectionState({
      id: 'conv_projection_empty_thought',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      selectedAgentId: null,
    });

    const result = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought',
      id: 'evt_empty_thought',
      conversation_id: 'conv_projection_empty_thought',
      turn_id: 'turn_empty_thought',
      timestamp: 2,
      content: '',
      is_complete: true,
    });

    expect(result.success).toBe(true);
    expect(state.conversation.messages).toHaveLength(0);
  });

  it('没有已有 chunk 的空 final_answer 不应投影成空白消息', () => {
    const state = createInitialProjectionState({
      id: 'conv_projection_empty_answer',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      selectedAgentId: null,
    });

    const result = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer',
      id: 'answer_empty',
      conversation_id: 'conv_projection_empty_answer',
      turn_id: 'turn_empty_answer',
      timestamp: 2,
      answer_id: 'answer_empty',
      content: '',
      completion_reason: 'terminal',
    });

    expect(result.success).toBe(true);
    expect(state.conversation.messages).toHaveLength(0);
  });

  it('空 chunk 后出现不一致的完整正文必须失败，不能用 durable 内容补造 live 消息', () => {
    const state = createInitialProjectionState({
      id: 'conv_projection_empty_answer_chunk',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      selectedAgentId: null,
    });

    const chunkResult = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_chunk',
      id: 'evt_empty_answer_chunk',
      conversation_id: 'conv_projection_empty_answer_chunk',
      turn_id: 'turn_empty_answer_chunk',
      timestamp: 2,
      answer_id: 'answer_empty_chunk',
      seq: 0,
      chunk: '',
      is_last: false,
    });

    expect(chunkResult.success).toBe(true);
    expect(state.conversation.messages).toHaveLength(0);

    const finalResult = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer',
      id: 'answer_empty_chunk',
      conversation_id: 'conv_projection_empty_answer_chunk',
      turn_id: 'turn_empty_answer_chunk',
      timestamp: 3,
      answer_id: 'answer_empty_chunk',
      content: 'visible content',
      completion_reason: 'terminal',
    });

    expect(finalResult).toMatchObject({
      success: false,
      reason: 'final_answer answer_empty_chunk content does not match its live chunk stream',
    });
    expect(state.conversation.messages).toHaveLength(0);
  });
});
