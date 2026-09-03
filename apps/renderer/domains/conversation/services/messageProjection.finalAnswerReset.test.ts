import { describe, expect, it } from 'vitest';

import { createInitialProjectionState, reduceEvent } from './messageProjection';
import { PROJECTION_TEST_SCOPE } from './messageProjection/__tests__/helpers/projectionTestScope';

describe('messageProjection final_answer_reset', () => {
  it('应删除失败 attempt 的在途答案与思考，并保留重试后的最终内容', () => {
    const state = createInitialProjectionState({
      id: 'conv_projection_reset',
      title: 'test',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      selectedAgentId: null,
    });

    const turnId = 'turn_reset';
    const failedAnswerId = 'answer_failed';
    const failedThoughtId = 'thought_failed';
    const successAnswerId = 'answer_success';

    reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought',
      id: 'evt_thought_delta_failed',
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 2,
      thought_message_id: failedThoughtId,
      delta: '思考中',
      is_complete: false,
    });

    reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_chunk',
      id: 'evt_chunk_failed',
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 3,
      answer_id: failedAnswerId,
      seq: 0,
      chunk: '失败前半段',
    });

    expect(state.conversation.messages).toHaveLength(2);

    const resetResult = reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_reset',
      id: 'evt_reset',
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 4,
      answer_id: failedAnswerId,
      thought_message_ids: [failedThoughtId],
    });

    expect(resetResult.success).toBe(true);
    expect(state.conversation.messages).toHaveLength(0);
    expect(state.messageIndex.size).toBe(0);
    const executionState = state.runStates
      .get(PROJECTION_TEST_SCOPE.run_id)
      ?.executionStates.get(PROJECTION_TEST_SCOPE.execution_id);
    expect(executionState?.answerState.has(failedAnswerId)).toBe(false);
    expect(executionState?.thoughtBuffers.has(turnId)).toBe(false);

    reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought',
      id: 'evt_thought_delta_success',
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 5,
      thought_message_id: 'thought_success',
      delta: '重试思考',
      is_complete: false,
    });

    reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_chunk',
      id: 'evt_chunk_success_0',
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 6,
      answer_id: successAnswerId,
      seq: 0,
      chunk: '最终',
    });

    reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer_chunk',
      id: 'evt_chunk_success_1',
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 7,
      answer_id: successAnswerId,
      seq: 1,
      chunk: '成功内容',
    });

    reduceEvent(state, {
      ...PROJECTION_TEST_SCOPE,
      type: 'final_answer',
      id: successAnswerId,
      conversation_id: 'conv_projection_reset',
      turn_id: turnId,
      timestamp: 8,
      answer_id: successAnswerId,
      content: '最终成功内容',
      completion_reason: 'terminal',
    });

    expect(state.conversation.messages.map((message) => message.type)).toEqual(['thought', 'final_answer']);
    expect(state.messageIndex.get('thought_success')).toBe(0);
    expect(state.conversation.messages.find((message) => message.type === 'final_answer')?.content).toBe('最终成功内容');
    const finalAnswerMessage = state.conversation.messages.find((message) => message.type === 'final_answer');
    expect(finalAnswerMessage ? state.messageIndex.get(finalAnswerMessage.id) : undefined).toBe(1);
    expect(state.conversation.messages.some((message) => message.content.includes('失败前半段'))).toBe(false);
    expect(state.conversation.messages.some((message) => message.content.includes('思考中'))).toBe(false);
  });
});
