import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { loadHistoryWindowBefore } from './historyWindowBeforeLoader';
import type { LoadBeforeResult } from '../../message-window/orchestration/messageWindowLoader';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';

describe('loadHistoryWindowBefore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('skips repeated triggers once the first request has moved the window into loading state', async () => {
    const store = useMessageWindowStore();
    store.conversationId = 'conv-window';
    store.status = 'ready';
    store.hasMoreBefore = true;
    store.prevCursor = 42;
    store.revision = 7;

    let requestCount = 0;
    let resolveFirstRequest: (result: LoadBeforeResult) => void = () => {
      throw new Error('first request resolver was not initialized');
    };
    const firstRequest = loadHistoryWindowBefore('conv-window', 80, {
      store,
      loadBefore: async () => {
        requestCount += 1;
        store.startLoading('conv-window', 'before');
        return new Promise<LoadBeforeResult>((resolve) => {
          resolveFirstRequest = resolve;
        });
      },
    });

    const secondRequest = await loadHistoryWindowBefore('conv-window', 80, {
      store,
      loadBefore: async () => {
        requestCount += 1;
        return 'prepended';
      },
    });

    expect(secondRequest).toBe('skipped');
    expect(requestCount).toBe(1);

    store.status = 'ready';
    store.loadingMode = null;
    resolveFirstRequest('prepended');
    await expect(firstRequest).resolves.toBe('prepended');
  });
});
