import { describe, expect, it } from 'vitest';
import {
  createSSEFinalAnswerEvent,
  createSSEToolCallDecisionEvent,
  createSSEToolOutputEvent,
  createUserInputEvent,
  type SSEThoughtEvent,
  RunIdSchema,
} from '@linnlabs/linnkit/contracts';

import type { Conversation } from '../../../types';
import { createInitialProjectionState, reduceEvent, type ProjectionEvent } from '../index';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';

function createConversation(): Conversation {
  return {
    id: 'conversation-activity-projection',
    title: '',
    titleOrigin: 'explicit',
    messages: [],
    selectedAgentId: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('activity binding projection', () => {
  it('把同一运行归属投影到 user、thought、tool 和 final answer 消息', () => {
    const state = createInitialProjectionState(createConversation());
    const activity = { runId: 'run-1', feature: 'table_fill' };
    const thought: SSEThoughtEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'thought',
      id: 'thought-1',
      timestamp: 2,
      conversation_id: state.conversation.id,
      turn_id: 'turn-1',
      content: '正在处理',
      is_complete: true,
      metadata: { activity },
    };
    const events: ProjectionEvent[] = [
      createUserInputEvent('user-1', state.conversation.id, 'turn-1', '处理表格', {
        timestamp: 1,
        metadata: { activity },
      }),
      thought,
      createSSEToolCallDecisionEvent(
        'decision-1',
        state.conversation.id,
        'turn-1',
        'subrun_batch',
        'call-1',
        'start',
        'loading',
        { ...PROJECTION_TEST_SCOPE, metadata: { activity }, args: {} }
      ),
      createSSEToolOutputEvent(
        'output-1',
        state.conversation.id,
        'turn-1',
        'subrun_batch',
        'call-1',
        { status: 'success', observation: 'completed', data: { status: 'completed' } },
        { ...PROJECTION_TEST_SCOPE, metadata: { activity } }
      ),
      {
        ...PROJECTION_TEST_SCOPE,
        type: 'final_answer_chunk',
        id: 'answer-chunk-1',
        timestamp: 4,
        conversation_id: state.conversation.id,
        turn_id: 'turn-1',
        answer_id: 'answer-1',
        seq: 0,
        chunk: '处理完成',
        is_last: true,
      },
      createSSEFinalAnswerEvent('answer-1', state.conversation.id, 'turn-1', '处理完成', {
        ...PROJECTION_TEST_SCOPE,
        completion_reason: 'terminal',
        metadata: { activity },
      }),
    ];

    for (const event of events) {
      expect(reduceEvent(state, event).success).toBe(true);
    }

    expect(
      state.conversation.messages.map(message => {
        switch (message.type) {
          case 'user_input':
            return { type: message.type, activity: message.metadata?.activity };
          case 'thought':
          case 'tool_calls':
          case 'final_answer':
          case 'tool_preamble':
          case 'partial_answer':
            return { type: message.type, activity: message.metadata.activity };
          case 'history_summary':
          case 'summarization_progress':
            return { type: message.type, activity: undefined };
        }
      })
    ).toEqual([
      { type: 'user_input', activity },
      { type: 'thought', activity },
      { type: 'tool_calls', activity },
      { type: 'final_answer', activity },
    ]);
  });
});
