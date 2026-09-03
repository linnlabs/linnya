import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { loadHistoryWindowAfter } from './historyWindowAfterLoader';
import type { LoadAfterResult } from '../../message-window/orchestration/messageWindowLoader';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';

describe('loadHistoryWindowAfter', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('skips repeated triggers once the first request has moved the window into loading state', async () => {
    const store = useMessageWindowStore();
    store.conversationId = 'conv-window';
    store.status = 'ready';
    store.hasMoreAfter = true;
    store.nextCursor = 42;
    store.revision = 7;

    let requestCount = 0;
    let resolveFirstRequest: (result: LoadAfterResult) => void = () => {
      throw new Error('first request resolver was not initialized');
    };
    const firstRequest = loadHistoryWindowAfter('conv-window', 80, {
      store,
      loadAfter: async () => {
        requestCount += 1;
        store.startLoading('conv-window', 'after');
        return new Promise<LoadAfterResult>((resolve) => {
          resolveFirstRequest = resolve;
        });
      },
    });

    const secondRequest = await loadHistoryWindowAfter('conv-window', 80, {
      store,
      loadAfter: async () => {
        requestCount += 1;
        return 'appended';
      },
    });

    expect(secondRequest).toBe('skipped');
    expect(requestCount).toBe(1);

    store.status = 'ready';
    store.loadingMode = null;
    resolveFirstRequest('appended');
    await expect(firstRequest).resolves.toBe('appended');
  });
});
