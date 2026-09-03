import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useConversationState } from './conversationState';

let currentProjectIdMock: string | null = null;
let currentConversationMessage = '新对话';

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    get currentProjectId() {
      return currentProjectIdMock;
    },
  }),
}));

vi.mock('../functions/resolveCurrentConversationMessage', () => ({
  resolveCurrentConversationMessage: () => currentConversationMessage,
}));

describe('conversationState.createNewConversation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    currentProjectIdMock = null;
    currentConversationMessage = '新对话';

    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
      configurable: true,
    });
  });

  it('undefined projectId 沿用当前项目', () => {
    currentProjectIdMock = 'project-current';
    const store = useConversationState();

    const conversationId = store.createNewConversation();
    const conversation = store.conversations.find((item) => item.id === conversationId);

    expect(conversation?.metadata?.projectId).toBe('project-current');
  });

  it('null projectId 表示明确创建 Linnya 助手无项目对话', () => {
    currentProjectIdMock = 'project-current';
    const store = useConversationState();

    const conversationId = store.createNewConversation(null);
    const conversation = store.conversations.find((item) => item.id === conversationId);

    expect(conversation?.metadata?.projectId).toBeUndefined();
  });

  it('默认对话标题由当前语言 resolver 生成一次', () => {
    currentConversationMessage = 'New chat';
    const store = useConversationState();

    const conversationId = store.createNewConversation();
    const conversation = store.conversations.find((item) => item.id === conversationId);

    expect(conversation?.title).toBe('New chat');
    expect(conversation?.titleOrigin).toBe('default');
  });

  it('自定义对话缺省标题也使用当前语言 resolver', () => {
    currentConversationMessage = 'New chat';
    const store = useConversationState();

    const conversationId = store.createConversation();
    const conversation = store.conversations.find((item) => item.id === conversationId);

    expect(conversation?.title).toBe('New chat');
    expect(conversation?.titleOrigin).toBe('default');
  });

  it('显式标题记录为真实标题来源', () => {
    const store = useConversationState();

    const conversationId = store.createConversation({ title: '项目规划' });
    const conversation = store.conversations.find((item) => item.id === conversationId);

    expect(conversation?.title).toBe('项目规划');
    expect(conversation?.titleOrigin).toBe('explicit');
  });
});
