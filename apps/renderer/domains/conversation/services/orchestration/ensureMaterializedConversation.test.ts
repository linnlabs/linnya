import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../../types';
import { ensureMaterializedConversation } from './ensureMaterializedConversation';

const titleFeature = vi.hoisted(() => ({
  registerAutomaticCandidate: vi.fn(),
}));

vi.mock('../../features/conversation-title', () => ({
  useConversationTitleFeature: () => titleFeature,
}));

describe('ensureMaterializedConversation', () => {
  it('默认新会话 materialize 时登记一次自动标题资格', () => {
    let activeConversation: Conversation | null = null;
    const assistantStore = {
      get activeConversation() {
        return activeConversation;
      },
      createNewConversation: vi.fn(() => {
        activeConversation = {
          id: 'conversation-1',
          title: '新对话',
          titleOrigin: 'default',
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          selectedAgentId: null,
        };
        return 'conversation-1';
      }),
    };
    const scopeStore = {
      currentScope: { kind: 'linnya-assistant' as const },
      materializeCurrentDraft: vi.fn(),
    };

    const result = ensureMaterializedConversation(assistantStore, scopeStore);

    expect(result?.id).toBe('conversation-1');
    expect(scopeStore.materializeCurrentDraft).toHaveBeenCalledWith('conversation-1');
    expect(titleFeature.registerAutomaticCandidate).toHaveBeenCalledWith('conversation-1');
  });

  it('已有会话和历史会话不会重新登记资格', () => {
    const conversation: Conversation = {
      id: 'history-conversation',
      title: '稳定标题',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
      selectedAgentId: null,
    };
    const assistantStore = {
      activeConversation: conversation,
      createNewConversation: vi.fn(() => 'unused'),
    };
    const scopeStore = {
      currentScope: { kind: 'linnya-assistant' as const },
      materializeCurrentDraft: vi.fn(),
    };
    titleFeature.registerAutomaticCandidate.mockClear();

    expect(ensureMaterializedConversation(assistantStore, scopeStore)).toBe(conversation);
    expect(titleFeature.registerAutomaticCandidate).not.toHaveBeenCalled();
  });
});
