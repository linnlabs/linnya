import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useConversationState } from './conversationState';
import { useConversationSelectors } from './selectors';
import { useProjectionStore } from './assistant/projectionStore';
import { useMessageWindowStore } from '../message-window';
import type { WindowMessageRow } from '../message-window';
import type { BaseMessage, Conversation } from '../types';
import {
  ConversationUiMessageSchema,
  type ConversationToolMessageMetadata,
} from '@app/schemas';
import {
  createTestAnswerMessage,
  createTestToolMessage,
  createTestUserMessage,
} from '../testing/functions/createConversationTestMessage';

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentProjectId: null,
  }),
}));

function createConversation(messages: BaseMessage[]): Conversation {
  return {
    id: 'conv-selector',
    title: 'Selector test',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages,
    selectedAgentId: null,
  };
}

function createMessage(overrides: {
  readonly id?: string;
  readonly role?: BaseMessage['role'];
  readonly type?: BaseMessage['type'];
  readonly content?: string;
  readonly timestamp?: number;
  readonly metadata?: Partial<ConversationToolMessageMetadata>;
}): BaseMessage {
  const common = {
    id: overrides.id ?? 'message',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
  };
  if (overrides.type === 'user_input') return createTestUserMessage(common);
  if (overrides.type === 'tool_calls') {
    return createTestToolMessage({ ...common, metadata: overrides.metadata });
  }
  return createTestAnswerMessage({ ...common, type: 'final_answer' });
}

function createWindowRow(overrides: {
  messageId: string;
  sortSeq: number;
  role?: BaseMessage['role'];
  type?: BaseMessage['type'];
  content?: string;
}): WindowMessageRow {
  const type = overrides.type ?? 'final_answer';
  const role = overrides.role ?? (type === 'user_input' ? 'user' : 'assistant');
  const content = overrides.content ?? '';
  const payload = type === 'user_input'
    ? null
    : {
        answer_id: overrides.messageId,
        is_complete: true,
        completion_reason: 'terminal' as const,
        first_token_at: overrides.sortSeq,
      };
  return {
    conversationId: 'conv-selector',
    messageId: overrides.messageId,
    sortSeq: overrides.sortSeq,
    revision: 9,
    dto: ConversationUiMessageSchema.parse({
      conversation_id: 'conv-selector',
      message_id: overrides.messageId,
      turn_id: 'turn-window',
      role,
      message_type: type,
      sort_seq: overrides.sortSeq,
      timestamp: overrides.sortSeq,
      content,
      payload,
      merge_key: null,
      presentation: null,
      run_id: 'run-window',
    }),
    message: createMessage({
      id: overrides.messageId,
      role,
      type,
      content,
      timestamp: overrides.sortSeq,
    }),
  };
}

describe('conversation selectors', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('returns a window and live merged view without writing window rows back to conversation.messages', () => {
    const conversationState = useConversationState();
    const windowStore = useMessageWindowStore();
    const selectors = useConversationSelectors(conversationState);

    const liveTool = createMessage({
      id: 'window-tool-event',
      type: 'tool_calls',
      content: 'live result',
      metadata: {
        tool_call_id: 'call-1',
        status: 'success',
      },
    });
    const liveOnly = createMessage({
      id: 'live-only',
      content: 'live only',
      timestamp: 3,
    });

    conversationState.conversations.push(createConversation([liveTool, liveOnly]));
    conversationState.setActiveConversation('conv-selector');
    windowStore.replaceWithSnapshot({
      conversationId: 'conv-selector',
      rows: [
        {
          conversationId: 'conv-selector',
          messageId: 'window-user',
          sortSeq: 1,
          revision: 9,
          dto: {
            conversation_id: 'conv-selector',
            message_id: 'window-user',
            turn_id: 'turn-window',
            role: 'user',
            message_type: 'user_input',
            sort_seq: 1,
            timestamp: 1,
            content: 'window user',
            payload: null,
            merge_key: null,
            presentation: null,
            run_id: 'run-window',
          },
          message: createMessage({
            id: 'window-user',
            role: 'user',
            type: 'user_input',
            content: 'window user',
            timestamp: 1,
          }),
        },
        {
          conversationId: 'conv-selector',
          messageId: 'window-tool-event',
          sortSeq: 2,
          revision: 9,
          dto: {
            conversation_id: 'conv-selector',
            message_id: 'window-tool-event',
            turn_id: 'turn-window',
            role: 'assistant',
            message_type: 'tool_calls',
            sort_seq: 2,
            timestamp: 2,
            content: null,
            payload: {
              tool_call_id: 'call-1',
              tool_name: 'test_tool',
              status: 'loading',
              phase: 'start',
              started_at: 2,
            },
            merge_key: 'tool:call-1',
            presentation: null,
            run_id: 'run-window',
          },
          message: createMessage({
            id: 'window-tool-event',
            type: 'tool_calls',
            timestamp: 2,
            metadata: {
              tool_call_id: 'call-1',
              tool_name: 'test_tool',
              status: 'loading',
            },
          }),
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      revision: 9,
    });

    expect(selectors.activeMessages.value.map(message => message.id)).toEqual([
      'window-user',
      'window-tool-event',
      'live-only',
    ]);
    expect(selectors.activeMessages.value[1]?.content).toBe('live result');
    expect(selectors.activeMessages.value[1]?.type).toBe('tool_calls');
    if (selectors.activeMessages.value[1]?.type !== 'tool_calls') throw new Error('Expected merged tool');
    expect(selectors.activeMessages.value[1].metadata.status).toBe('success');
    expect(conversationState.conversations[0]?.messages.map(message => message.id)).toEqual([
      'window-tool-event',
      'live-only',
    ]);
  });

  it('drops stale window tail after local truncate while allowing new live messages to append', () => {
    const conversationState = useConversationState();
    const windowStore = useMessageWindowStore();
    const selectors = useConversationSelectors(conversationState);

    conversationState.conversations.push(createConversation([]));
    conversationState.setActiveConversation('conv-selector');
    windowStore.replaceWithSnapshot({
      conversationId: 'conv-selector',
      rows: [
        createWindowRow({
          messageId: 'old-user-1',
          sortSeq: 1,
          role: 'user',
          type: 'user_input',
          content: 'old user',
        }),
        createWindowRow({
          messageId: 'edit-target',
          sortSeq: 2,
          role: 'user',
          type: 'user_input',
          content: 'old prompt',
        }),
        createWindowRow({
          messageId: 'old-answer',
          sortSeq: 3,
          content: 'stale answer',
        }),
      ],
      hasMoreBefore: true,
      hasMoreAfter: true,
      prevCursor: 1,
      nextCursor: 3,
      revision: 9,
    });

    windowStore.truncateAfterMessage('edit-target', { content: 'new prompt' });

    expect(selectors.activeMessages.value.map(message => [message.id, message.content])).toEqual([
      ['old-user-1', 'old user'],
      ['edit-target', 'new prompt'],
    ]);
    expect(windowStore.hasMoreAfter).toBe(false);

    const conversation = conversationState.conversations[0];
    conversation?.messages.push(createMessage({
      id: 'new-answer',
      content: 'new answer',
      timestamp: 5,
    }));

    expect(selectors.activeMessages.value.map(message => message.id)).toEqual([
      'old-user-1',
      'edit-target',
      'new-answer',
    ]);
  });

  it('uses the edited live message content when the target exists in both live and window slots', () => {
    const conversationState = useConversationState();
    const windowStore = useMessageWindowStore();
    const selectors = useConversationSelectors(conversationState);

    const liveTarget = createMessage({
      id: 'edit-target',
      role: 'user',
      type: 'user_input',
      content: 'old live prompt',
      timestamp: 4,
    });
    conversationState.conversations.push(createConversation([liveTarget]));
    conversationState.setActiveConversation('conv-selector');
    windowStore.replaceWithSnapshot({
      conversationId: 'conv-selector',
      rows: [
        createWindowRow({
          messageId: 'edit-target',
          sortSeq: 2,
          role: 'user',
          type: 'user_input',
          content: 'old window prompt',
        }),
        createWindowRow({
          messageId: 'old-answer',
          sortSeq: 3,
          content: 'stale answer',
        }),
      ],
      hasMoreBefore: false,
      hasMoreAfter: true,
      nextCursor: 3,
      revision: 9,
    });

    windowStore.truncateAfterMessage('edit-target', { content: 'new prompt' });
    liveTarget.content = 'new prompt';

    expect(selectors.activeMessages.value.map(message => [message.id, message.content])).toEqual([
      ['edit-target', 'new prompt'],
    ]);
  });

  it('clears live-only tail when editing a message that exists only in the window slot', () => {
    const conversationState = useConversationState();
    const projectionStore = useProjectionStore();
    const windowStore = useMessageWindowStore();
    const selectors = useConversationSelectors(conversationState);

    const conversationId = conversationState.createConversation({
      id: 'conv-selector',
      title: 'Selector test',
      autoActivate: true,
    });
    windowStore.replaceWithSnapshot({
      conversationId,
      rows: [
        createWindowRow({
          messageId: 'old-user-1',
          sortSeq: 1,
          role: 'user',
          type: 'user_input',
          content: 'old user',
        }),
        createWindowRow({
          messageId: 'edit-target',
          sortSeq: 2,
          role: 'user',
          type: 'user_input',
          content: 'old prompt',
        }),
        createWindowRow({
          messageId: 'old-answer',
          sortSeq: 3,
          content: 'stale answer',
        }),
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      revision: 9,
    });
    projectionStore.appendMessage(createMessage({
      id: 'live-user-after-window',
      role: 'user',
      type: 'user_input',
      content: 'newer live prompt',
      timestamp: 4,
    }), conversationId);
    projectionStore.appendMessage(createMessage({
      id: 'live-answer-after-window',
      content: 'newer live answer',
      timestamp: 5,
    }), conversationId);

    expect(selectors.activeMessages.value.map(message => message.id)).toEqual([
      'old-user-1',
      'edit-target',
      'old-answer',
      'live-user-after-window',
      'live-answer-after-window',
    ]);

    windowStore.truncateAfterMessage('edit-target', { content: 'edited prompt' });
    projectionStore.truncateProjectionStateAfterMessage(conversationId, 'edit-target');
    projectionStore.appendMessage(createMessage({
      id: 'new-answer',
      content: 'new streamed answer',
      timestamp: 6,
    }), conversationId);

    expect(selectors.activeMessages.value.map(message => [message.id, message.content])).toEqual([
      ['old-user-1', 'old user'],
      ['edit-target', 'edited prompt'],
      ['new-answer', 'new streamed answer'],
    ]);
  });
});
