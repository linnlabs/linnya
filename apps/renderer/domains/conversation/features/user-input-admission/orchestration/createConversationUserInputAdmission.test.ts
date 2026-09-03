import { describe, expect, it, vi } from 'vitest';

import { createConversationUserInputAdmission } from './createConversationUserInputAdmission';

function createAck(overrides: Partial<{
  id: string;
  conversation_id: string;
  operation: 'append' | 'replace';
  replaced_from_message_id: string;
}> = {}) {
  return {
    type: 'user_input_committed' as const,
    id: overrides.id ?? 'message-1',
    timestamp: 2,
    conversation_id: overrides.conversation_id ?? 'conversation-1',
    turn_id: 'turn-1',
    operation: overrides.operation ?? 'append',
    ...(overrides.replaced_from_message_id
      ? { replaced_from_message_id: overrides.replaced_from_message_id }
      : {}),
    content: '用户输入',
    raw_content: '用户输入',
  };
}

describe('createConversationUserInputAdmission', () => {
  it('只把完全匹配的 durable ack 提交为正式用户消息', () => {
    const commitUserInput = vi.fn((event: ReturnType<typeof createAck>) => ({
      id: event.id,
      role: 'user' as const,
      type: 'user_input' as const,
      content: event.content,
      timestamp: event.timestamp,
    }));
    const admission = createConversationUserInputAdmission({
      expectation: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        operation: 'append',
      },
      commitUserInput,
    });

    const message = admission.accept(createAck());

    expect(message.id).toBe('message-1');
    expect(admission.committedMessage).toBe(message);
    expect(commitUserInput).toHaveBeenCalledOnce();
  });

  it('拒绝错误身份、错误 operation 与重复 ack，不做 ID 替换', () => {
    const commitUserInput = vi.fn((event: ReturnType<typeof createAck>) => ({
      id: event.id,
      role: 'user' as const,
      type: 'user_input' as const,
      content: event.content,
      timestamp: event.timestamp,
    }));
    const mismatched = createConversationUserInputAdmission({
      expectation: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        operation: 'append',
      },
      commitUserInput,
    });

    expect(() => mismatched.accept(createAck({ id: 'message-other' }))).toThrow(
      'unexpected durable commit ack',
    );
    expect(commitUserInput).not.toHaveBeenCalled();

    const admitted = createConversationUserInputAdmission({
      expectation: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        operation: 'append',
      },
      commitUserInput,
    });
    admitted.accept(createAck());
    expect(() => admitted.accept(createAck())).toThrow('received more than once');
    expect(commitUserInput).toHaveBeenCalledOnce();
  });
});
