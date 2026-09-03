import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { loadTailMock } = vi.hoisted(() => ({
  loadTailMock: vi.fn<(conversationId: string) => Promise<void>>(),
}));

vi.mock('./messageWindowLoader', () => ({
  loadTail: loadTailMock,
}));

import { useMessageWindowStore } from '../store/messageWindowStore';
import { reconcileTerminalConversationWindow } from './reconcileTerminalConversationWindow';

describe('reconcileTerminalConversationWindow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loadTailMock.mockReset();
    loadTailMock.mockResolvedValue();
  });

  it('只刷新仍由已结算会话拥有的当前 message window', async () => {
    const store = useMessageWindowStore();
    store.startLoading('conversation-settled', 'tail');

    await reconcileTerminalConversationWindow('conversation-settled');

    expect(loadTailMock).toHaveBeenCalledOnce();
    expect(loadTailMock).toHaveBeenCalledWith(
      'conversation-settled',
      {},
      expect.objectContaining({ store }),
    );
  });

  it('用户已切换会话时不允许旧结算流程抢占当前 window', async () => {
    const store = useMessageWindowStore();
    store.startLoading('conversation-current', 'tail');

    await reconcileTerminalConversationWindow('conversation-settled');

    expect(loadTailMock).not.toHaveBeenCalled();
    expect(store.conversationId).toBe('conversation-current');
  });
});
