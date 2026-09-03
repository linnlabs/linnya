import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../types';
import { createInitialProjectionState, reduceEvent } from './index';
import { RunIdSchema } from 'linnkit/contracts';

function createConversation(): Conversation {
  return {
    id: 'conversation-1',
    title: '稳定标题',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

describe('messageProjection ownership', () => {
  it('durable user_input 回放保持事件身份且不改写会话标题', () => {
    const state = createInitialProjectionState(createConversation());

    const result = reduceEvent(state, {
      id: 'message-1',
      type: 'user_input',
      version: 1,
      source: 'user',
      content: '第二轮追问',
      timestamp: 2,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      run_id: RunIdSchema.parse('run-1'),
      lane: 'foreground',
      visibility: 'conversation',
    });

    expect(result.newState?.conversation.title).toBe('稳定标题');
    expect(result.newState?.conversation.titleOrigin).toBe('explicit');
    expect(result.newState?.conversation.messages).toMatchObject([
      {
        id: 'message-1',
        content: '第二轮追问',
      },
    ]);
  });
});
