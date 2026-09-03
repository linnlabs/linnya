import { describe, expect, it } from 'vitest';

import type { Conversation, UserMessage } from '../../../types';
import { createInitialProjectionState } from '..';
import { appendMessage } from './messageAccess';

function createUserMessage(id: string): UserMessage {
  return {
    id,
    role: 'user',
    type: 'user_input',
    content: 'hello',
    timestamp: 1,
  };
}

function createConversation(messages: readonly UserMessage[]): Conversation {
  return {
    id: 'conversation-message-index',
    title: 'message index',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [...messages],
    selectedAgentId: null,
  };
}

describe('MessageProjection message identity admission', () => {
  it('初始化投影时拒绝重复 message_id', () => {
    expect(() => createInitialProjectionState(createConversation([
      createUserMessage('message-duplicate'),
      createUserMessage('message-duplicate'),
    ]))).toThrow(
      'Duplicate conversation message id during projection initialization: message-duplicate',
    );
  });

  it('追加消息时拒绝覆盖已有 message_id 索引', () => {
    const state = createInitialProjectionState(createConversation([
      createUserMessage('message-existing'),
    ]));

    expect(() => appendMessage(state, createUserMessage('message-existing'))).toThrow(
      'Duplicate conversation message id during projection append: message-existing',
    );
    expect(state.conversation.messages).toHaveLength(1);
  });
});
