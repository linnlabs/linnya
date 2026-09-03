import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';
import type { BaseMessage } from '../../types';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../testing/functions/createConversationTestMessage';
import { useConversationState } from '../conversationState';
import { useProjectionStore } from './projectionStore';

vi.mock('../../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({ currentProjectId: null }),
}));

function createCommittedEvent(
  overrides: Partial<ConversationUserInputCommittedEvent> = {},
): ConversationUserInputCommittedEvent {
  return {
    id: 'user-2',
    type: 'user_input_committed',
    timestamp: 20,
    conversation_id: 'conversation-1',
    turn_id: 'turn-2',
    operation: 'append',
    content: '',
    raw_content: '',
    attachments: [{
      id: 'attachment-1',
      kind: 'image',
      assetId: 'asset-1',
      mediaType: 'image/png',
      byteLength: 4,
      width: 2,
      height: 2,
      sha256: 'a'.repeat(64),
    }],
    ...overrides,
  };
}

function firstAttachment(): NonNullable<ConversationUserInputCommittedEvent['attachments']>[number] {
  return {
    id: 'attachment-1',
    kind: 'image',
    assetId: 'asset-1',
    mediaType: 'image/png',
    byteLength: 4,
    width: 2,
    height: 2,
    sha256: 'a'.repeat(64),
  };
}

describe('projectionStore.commitUserInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
      configurable: true,
    });
  });

  it('按稳定消息 ID 幂等追加，并保留 durable 附件身份与顺序', () => {
    const conversationState = useConversationState();
    conversationState.createConversation({ id: 'conversation-1', autoActivate: true });
    const projectionStore = useProjectionStore();
    const event = createCommittedEvent({
      attachments: [
        firstAttachment(),
        {
          id: 'attachment-2',
          kind: 'image',
          assetId: 'asset-2',
          mediaType: 'image/jpeg',
          byteLength: 8,
          width: 4,
          height: 3,
          sha256: 'b'.repeat(64),
        },
      ],
    });

    projectionStore.commitUserInput(event);
    projectionStore.commitUserInput(event);

    const messages = conversationState.conversations[0]?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('');
    expect(messages[0]?.attachments?.map(item => item.assetId)).toEqual(['asset-1', 'asset-2']);
  });

  it('replace 确认按同一 ID 截断后续消息并替换目标', () => {
    const conversationState = useConversationState();
    conversationState.createConversation({ id: 'conversation-1', autoActivate: true });
    const conversation = conversationState.conversations[0];
    if (!conversation) throw new Error('conversation should exist');
    conversation.messages = [
      createTestUserMessage({ id: 'user-1', content: 'first', timestamp: 1 }),
      createTestAnswerMessage({ id: 'answer-1', content: 'answer', timestamp: 2 }),
      createTestUserMessage({ id: 'user-2', content: 'old', timestamp: 3 }),
      createTestAnswerMessage({ id: 'answer-2', content: 'stale', timestamp: 4 }),
    ] satisfies BaseMessage[];
    const projectionStore = useProjectionStore();

    projectionStore.commitUserInput(createCommittedEvent({
      operation: 'replace',
      replaced_from_message_id: 'user-2',
      content: 'new',
      raw_content: 'new',
    }));

    expect(conversationState.conversations[0]?.messages.map(message => [message.id, message.content])).toEqual([
      ['user-1', 'first'],
      ['answer-1', 'answer'],
      ['user-2', 'new'],
    ]);
  });
});
