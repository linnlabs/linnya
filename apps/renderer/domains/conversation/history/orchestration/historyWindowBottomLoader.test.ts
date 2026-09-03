import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ensureHistoryWindowTailForBottom } from './historyWindowBottomLoader';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';

describe('ensureHistoryWindowTailForBottom', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reloads tail before manual bottom when the current window is not at conversation tail', async () => {
    const store = useMessageWindowStore();
    store.conversationId = 'conv-window';
    store.status = 'ready';
    store.hasMoreAfter = true;

    let requestCount = 0;
    const status = await ensureHistoryWindowTailForBottom('conv-window', 80, {
      store,
      loadTail: async () => {
        requestCount += 1;
        store.hasMoreAfter = false;
      },
    });

    expect(status).toBe('reloaded');
    expect(requestCount).toBe(1);
  });

  it('keeps the current window when it already reaches the conversation tail', async () => {
    const store = useMessageWindowStore();
    store.conversationId = 'conv-window';
    store.status = 'ready';
    store.hasMoreAfter = false;

    const status = await ensureHistoryWindowTailForBottom('conv-window', 80, {
      store,
      loadTail: async () => {
        throw new Error('tail should not reload');
      },
    });

    expect(status).toBe('current');
  });
});
