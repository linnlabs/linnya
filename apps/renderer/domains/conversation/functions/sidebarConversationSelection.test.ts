import { describe, expect, it } from 'vitest';
import { isSidebarConversationActive } from './sidebarConversationSelection';

describe('isSidebarConversationActive', () => {
  it('只有 selectionEnabled 时才展示当前打开的对话', () => {
    expect(isSidebarConversationActive({
      selectionEnabled: true,
      conversationId: 'conversation-1',
      activeConversationId: 'conversation-1',
    })).toBe(true);

    expect(isSidebarConversationActive({
      selectionEnabled: false,
      conversationId: 'conversation-1',
      activeConversationId: 'conversation-1',
    })).toBe(false);
  });

  it('activeConversationId 不匹配时不进入活动态', () => {
    expect(isSidebarConversationActive({
      selectionEnabled: true,
      conversationId: 'conversation-1',
      activeConversationId: 'conversation-2',
    })).toBe(false);
  });
});
