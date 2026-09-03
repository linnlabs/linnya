// @vitest-environment jsdom

import {
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  type App,
} from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestToolMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import type { BaseMessage } from '../../../types';
import { useStreamingWaitingIndicator } from './useStreamingWaitingIndicator';

type WaitingIndicator = ReturnType<typeof useStreamingWaitingIndicator>;

function mountWaitingIndicatorHarness(options?: {
  readonly messages?: BaseMessage[];
  readonly isStreaming?: boolean;
}) {
  const messages = shallowRef<BaseMessage[]>(
    options?.messages ?? [createTestUserMessage()],
  );
  const isStreaming = ref(options?.isStreaming ?? false);
  const indicatorHolder: { current?: WaitingIndicator } = {};

  const Host = defineComponent({
    setup() {
      indicatorHolder.current = useStreamingWaitingIndicator({
        messages: computed(() => messages.value),
        isStreaming: computed(() => isStreaming.value),
      });
      return () => h('div');
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);

  const indicator = indicatorHolder.current;
  if (!indicator) throw new Error('waiting indicator harness did not mount');
  return { app, indicator, isStreaming, messages };
}

describe('useStreamingWaitingIndicator', () => {
  const mountedApps: App<Element>[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));
  });

  afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount());
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('整轮生成保留状态槽，消息更新只隐藏图标而不移除槽位', async () => {
    const harness = mountWaitingIndicatorHarness();
    mountedApps.push(harness.app);

    expect(harness.indicator.isWaitingSlotActive.value).toBe(false);

    harness.isStreaming.value = true;
    await nextTick();
    expect(harness.indicator.isWaitingSlotActive.value).toBe(true);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(false);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(true);

    harness.messages.value = [createTestUserMessage({ content: '收到新的消息进度' })];
    await nextTick();
    expect(harness.indicator.isWaitingSlotActive.value).toBe(true);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(false);

    harness.isStreaming.value = false;
    await nextTick();
    expect(harness.indicator.isWaitingSlotActive.value).toBe(false);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(false);
  });

  it('消息自带 loading 结束后重新计时，不会立即闪出通用等待图标', async () => {
    const loadingTool = createTestToolMessage({
      id: 'tool-waiting',
      metadata: { status: 'loading' },
    });
    const harness = mountWaitingIndicatorHarness({
      messages: [loadingTool],
      isStreaming: true,
    });
    mountedApps.push(harness.app);

    expect(harness.indicator.isWaitingSlotActive.value).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(false);

    harness.messages.value = [createTestToolMessage({
      id: 'tool-waiting',
      timestamp: loadingTool.timestamp,
      metadata: {
        status: 'success',
        data: {},
      },
    })];
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.indicator.isWaitingIndicatorVisible.value).toBe(true);
  });
});
