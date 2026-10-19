import { describe, expect, it } from 'vitest';
import { nextTick, watch } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useConversationWindowNavigation } from './useConversationWindowNavigation';
import { shouldTriggerLoadBefore } from '../functions/historyBackfillPolicy';
import { useMessageWindowStore } from '../../../message-window';
import { ensureHistoryWindowTailForBottom } from '../../../history';

function deferred() {
  let resolve: () => void = () => { throw new Error('not initialized'); };
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('conversation window navigation', () => {
  it('blocks automatic backfill between tail response admission and actual landing', async () => {
    setActivePinia(createPinia());
    const store = useMessageWindowStore();
    store.conversationId = 'conversation';
    store.status = 'ready';
    store.hasMoreAfter = true;
    store.hasMoreBefore = true;
    const navigation = useConversationWindowNavigation();
    const landed = deferred();
    let backfills = 0;
    const stop = watch(() => [store.status, store.hasMoreAfter], () => {
      if (shouldTriggerLoadBefore({
        scrollTop: 0, viewportHeight: 800, scrollHeight: 40_000, scrollMode: 'anchored',
        hasMoreBefore: store.hasMoreBefore, windowStatus: store.status,
        loadingMode: store.loadingMode, isNavigating: navigation.isNavigating.value,
      })) backfills += 1;
    }, { flush: 'post' });
    const pending = navigation.run(async signal => {
      const status = await ensureHistoryWindowTailForBottom('conversation', 80, {
        store, signal, loadTail: async () => { store.hasMoreAfter = false; },
      });
      expect(status).toBe('reloaded');
      await landed.promise;
    });
    await nextTick();
    expect(backfills).toBe(0);
    expect(navigation.isNavigating.value).toBe(true);
    landed.resolve();
    await pending;
    expect(navigation.isNavigating.value).toBe(false);
    stop();
  });

  it('new navigation cancels the old one, whose completion cannot unlock it; scope cancellation releases the lock', async () => {
    const navigation = useConversationWindowNavigation();
    const first = deferred();
    const second = deferred();
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    const old = navigation.run(async signal => { firstSignal = signal; await first.promise; });
    const current = navigation.run(async signal => { secondSignal = signal; await second.promise; });
    expect(firstSignal?.aborted).toBe(true);
    first.resolve();
    await old;
    expect(navigation.isNavigating.value).toBe(true);
    navigation.cancel();
    expect(secondSignal?.aborted).toBe(true);
    expect(navigation.isNavigating.value).toBe(false);
    second.resolve();
    await current;
  });
});
