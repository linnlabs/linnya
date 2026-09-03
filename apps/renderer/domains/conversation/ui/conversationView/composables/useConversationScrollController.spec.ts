// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref, shallowRef, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseMessage } from '../../../types';
import { useConversationScrollController } from './useConversationScrollController';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';

type Controller = ReturnType<typeof useConversationScrollController>;

function userMessage(id: string): BaseMessage {
  return { id, role: 'user', type: 'user_input', content: id, timestamp: 0 };
}

async function mountHarness() {
  const messages = shallowRef<BaseMessage[]>([userMessage('user-1')]);
  const resetKey = ref('conv-1');
  const initialRenderableContentKey = ref<string | null>('conv-1:turn-1');
  const conversationRef = ref<HTMLElement>();
  const scrollContainerRef = ref<HTMLElement>();
  const scrollToEnd = vi.fn();
  const scrollToVisualTurn = vi.fn(async () => true);
  const controllerHolder: { current?: Controller } = {};

  const Host = defineComponent({
    setup() {
      controllerHolder.current = useConversationScrollController({
        conversationRef,
        scrollContainerRef,
        messages: computed(() => messages.value),
        initialRenderableContentKey: computed(() => initialRenderableContentKey.value),
        scrollEndThreshold: computed(() => 16),
        resetKey: computed(() => resetKey.value),
        virtualizer: { scrollToEnd, scrollToVisualTurn },
      });
      return () => h('div', { ref: conversationRef, tabindex: 0 });
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);

  const element = conversationRef.value;
  if (!element) throw new Error('controller harness did not mount');
  const metrics = { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 };
  let domWriteCount = 0;
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => { domWriteCount += 1; metrics.scrollTop = value; },
    },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
  });
  await nextTick();
  await nextTick();

  const controller = controllerHolder.current;
  if (!controller) throw new Error('controller harness did not mount');
  return {
    app,
    controller,
    element,
    messages,
    resetKey,
    initialRenderableContentKey,
    metrics,
    scrollToEnd,
    scrollToVisualTurn,
    readDomWriteCount: () => domWriteCount,
  };
}

describe('useConversationScrollController', () => {
  const mountedApps: App<Element>[] = [];

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('只处理挂载和 ready 会话切换，不从消息末项角色猜测发送意图', async () => {
    const harness = await mountHarness();
    mountedApps.push(harness.app);
    const mountedCalls = harness.scrollToEnd.mock.calls.length;

    harness.initialRenderableContentKey.value = null;
    harness.resetKey.value = 'conv-2';
    await nextTick();
    harness.initialRenderableContentKey.value = 'conv-2:turn-80';
    await nextTick();
    await nextTick();
    const callsAfterConversationReady = harness.scrollToEnd.mock.calls.length;
    harness.messages.value = [...harness.messages.value, userMessage('user-2')];
    await nextTick();
    await nextTick();

    expect(callsAfterConversationReady).toBeGreaterThanOrEqual(mountedCalls + 1);
    expect(harness.scrollToEnd).toHaveBeenCalledTimes(callsAfterConversationReady);
    expect(harness.readDomWriteCount()).toBe(0);
  });

  it('只有真实用户滚动意图会离开 follow-bottom，virtualizer 的 scroll 事件不会误改模式', async () => {
    const harness = await mountHarness();
    mountedApps.push(harness.app);

    harness.metrics.scrollTop = 300;
    harness.element.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(harness.controller.mode.value).toBe('follow-bottom');
    expect(harness.controller.showScrollToBottomBtn.value).toBe(true);

    harness.element.dispatchEvent(new WheelEvent('wheel'));
    harness.metrics.scrollTop = 280;
    harness.element.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(harness.controller.mode.value).toBe('anchored');

    harness.metrics.scrollTop = 700;
    harness.element.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(harness.controller.mode.value).toBe('follow-bottom');
    expect(harness.controller.showScrollToBottomBtn.value).toBe(false);
  });

  it('手动回底和 timeline 跳转只发布 virtualizer 意图', async () => {
    const harness = await mountHarness();
    mountedApps.push(harness.app);
    const before = harness.scrollToEnd.mock.calls.length;

    harness.controller.scrollToBottomManual();
    await nextTick();
    expect(harness.scrollToEnd).toHaveBeenCalledTimes(before + 1);

    await harness.controller.scrollToVisualTurn(
      conversationVisualTurnIdFromUserMessageId('42'),
    );
    expect(harness.scrollToVisualTurn).toHaveBeenCalledWith('visual_turn_42', undefined);
    expect(harness.controller.mode.value).toBe('free');
    expect(harness.readDomWriteCount()).toBe(0);
  });
});
