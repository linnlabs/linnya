import { nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTimelineNavigationAbortError,
  waitForTimelineVisualTurnMounted,
} from './waitForTimelineVisualTurnMounted';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForTimelineVisualTurnMounted', () => {
  it('resolves only when the requested turn enters positions', async () => {
    const positions = ref([{ visualTurnId: conversationVisualTurnIdFromUserMessageId('1') }]);
    const controller = new AbortController();
    let resolved = false;
    const waiting = waitForTimelineVisualTurnMounted(
      positions,
      conversationVisualTurnIdFromUserMessageId('42'),
      controller.signal,
    )
      .then(() => {
        resolved = true;
      });

    positions.value = [{ visualTurnId: conversationVisualTurnIdFromUserMessageId('2') }];
    await nextTick();
    expect(resolved).toBe(false);

    positions.value = [{ visualTurnId: conversationVisualTurnIdFromUserMessageId('42') }];
    await waiting;
    expect(resolved).toBe(true);
  });

  it('cancels a superseded navigation', async () => {
    const controller = new AbortController();
    const waiting = waitForTimelineVisualTurnMounted(
      ref([]),
      conversationVisualTurnIdFromUserMessageId('42'),
      controller.signal,
    );
    controller.abort();
    const caught = await waiting.catch((error: unknown) => error);
    expect(isTimelineNavigationAbortError(caught)).toBe(true);
  });

  it('reports a target that never enters positions', async () => {
    vi.useFakeTimers();
    const waiting = waitForTimelineVisualTurnMounted(
      ref([]),
      conversationVisualTurnIdFromUserMessageId('42'),
      new AbortController().signal,
      100,
    );
    const assertion = expect(waiting).rejects.toThrow('timeline visual turn did not become ready');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
