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
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BaseMessage } from '../../../types';
import type { ConversationScrollMode } from '../functions/scrollPositionController';
import type { ConversationVisualRow } from '../../messageCanvas';
import { ConversationVisualTurnIdSchema } from '@app/schemas';
import { createTestAnswerMessage } from '../../../testing/functions/createConversationTestMessage';
import {
  shouldAdjustConversationScrollOnItemSizeChange,
  useConversationPrependRenderTransaction,
  useTanstackConversationVirtualizer,
} from './useTanstackConversationVirtualizer';

type Adapter = ReturnType<typeof useTanstackConversationVirtualizer>;

function createVisualRow(
  key: string,
  estimatedHeight: number,
  isTurnStart = true,
): ConversationVisualRow {
  const payload: BaseMessage = createTestAnswerMessage({ id: key, content: key, timestamp: 0 });
  return {
    key,
    kind: 'message',
    estimatedHeight,
    visualTurnId: ConversationVisualTurnIdSchema.parse(`visual_turn_${key}`),
    turnContext: {
      id: ConversationVisualTurnIdSchema.parse(`visual_turn_${key}`),
      userMessageId: null,
      sourceMessageIds: [key],
    },
    isTurnStart,
    isTurnEnd: true,
    role: payload.role,
    bounded: false,
    payload,
  };
}

function createScrollElement(height: number, initialScrollTop = 0, initialScrollHeight = 10_000) {
  const element = document.createElement('div');
  let scrollHeight = initialScrollHeight;
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height });
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 640 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  element.scrollTop = initialScrollTop;
  const scrollTo = vi.fn((options: ScrollToOptions | number, y?: number) => {
    if (typeof options === 'number') {
      element.scrollTop = y ?? 0;
    } else {
      element.scrollTop = options.top ?? element.scrollTop;
    }
    element.dispatchEvent(new Event('scroll'));
  });
  Object.defineProperty(element, 'scrollTo', { configurable: true, value: scrollTo });
  document.body.appendChild(element);
  return {
    element,
    scrollTo,
    setScrollHeight: (heightPx: number) => { scrollHeight = heightPx; },
  };
}

async function flushEstimateInvalidation(): Promise<void> {
  await nextTick();
  await nextTick();
  await nextTick();
}

describe('useTanstackConversationVirtualizer', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function mountAdapter(options: {
    items: ConversationVisualRow[];
    scrollTop?: number;
    scrollMargin?: number;
    scrollMode?: ConversationScrollMode;
    isStreaming?: boolean;
    scrollHeight?: number;
  }) {
    const items = shallowRef(options.items);
    const scrollMode = ref<ConversationScrollMode>(options.scrollMode ?? 'anchored');
    const estimationWidthPx = ref(720);
    const { element, scrollTo, setScrollHeight } = createScrollElement(
      120,
      options.scrollTop ?? 0,
      options.scrollHeight,
    );
    const scrollElement = ref<HTMLElement | null>(element);
    const adapterHolder: { value: Adapter | null } = { value: null };

    const Host = defineComponent({
      setup() {
        adapterHolder.value = useTanstackConversationVirtualizer({
          items: computed(() => items.value),
          enabled: computed(() => true),
          isStreaming: computed(() => options.isStreaming ?? false),
          scrollMode: computed(() => scrollMode.value),
          scrollElement,
          scrollMargin: computed(() => options.scrollMargin ?? 0),
          scrollEndThreshold: computed(() => 16),
          estimationWidthPx,
        });
        return () => h('div');
      },
    });

    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(Host);
    app.mount(mountPoint);
    const adapter = adapterHolder.value;
    if (!adapter) throw new Error('TanStack conversation adapter was not mounted');
    return {
      adapter,
      items,
      scrollMode,
      estimationWidthPx,
      element,
      scrollTo,
      setScrollHeight,
    };
  }

  it('projects visible items, paddings and total height from TanStack measurements', async () => {
    const fixture = mountAdapter({
      items: Array.from({ length: 24 }, (_, index) => createVisualRow(`row-${index}`, 100)),
      scrollMargin: 12,
    });
    await nextTick();

    expect(fixture.adapter.totalHeight.value).toBe(2400);
    expect(fixture.adapter.scrollOffset.value).toBe(0);
    expect(fixture.adapter.viewportHeight.value).toBe(120);
    expect(fixture.adapter.visibleItems.value[0]?.item.key).toBe('row-0');
    expect(fixture.adapter.paddingTop.value).toBe(0);
    expect(fixture.adapter.paddingBottom.value).toBeGreaterThan(0);
  });

  it('publishes live viewport metrics for history pagination decisions', async () => {
    const fixture = mountAdapter({
      items: Array.from({ length: 24 }, (_, index) => createVisualRow(`row-${index}`, 100)),
    });
    await nextTick();

    fixture.element.scrollTop = 180;
    fixture.element.dispatchEvent(new Event('scroll'));
    await nextTick();

    expect(fixture.adapter.scrollOffset.value).toBe(180);
    expect(fixture.adapter.viewportHeight.value).toBe(120);
  });

  it('invalidates unmeasured estimates after the settled content width changes', async () => {
    const fixture = mountAdapter({
      items: Array.from({ length: 20 }, (_, index) => createVisualRow(`row-${index}`, 100)),
    });
    await nextTick();
    expect(fixture.adapter.totalHeight.value).toBe(2_000);

    fixture.items.value = fixture.items.value.map(item => ({
      ...item,
      estimatedHeight: 60,
    }));
    fixture.estimationWidthPx.value = 480;
    await flushEstimateInvalidation();

    expect(fixture.adapter.totalHeight.value).toBe(1_200);
  });

  it('preserves the same anchored row offset across repeated width round trips', async () => {
    const fixture = mountAdapter({
      items: Array.from({ length: 20 }, (_, index) => createVisualRow(`row-${index}`, 100)),
      scrollTop: 850,
      scrollHeight: 2_000,
      scrollMode: 'anchored',
    });
    await nextTick();

    for (let round = 0; round < 3; round += 1) {
      fixture.items.value = fixture.items.value.map(item => ({ ...item, estimatedHeight: 120 }));
      fixture.setScrollHeight(2_400);
      fixture.estimationWidthPx.value = 480;
      await flushEstimateInvalidation();
      expect(fixture.element.scrollTop).toBe(1_010);

      fixture.items.value = fixture.items.value.map(item => ({ ...item, estimatedHeight: 100 }));
      fixture.setScrollHeight(2_000);
      fixture.estimationWidthPx.value = 720;
      await flushEstimateInvalidation();
      expect(fixture.element.scrollTop).toBe(850);
    }
  });

  it('keeps follow-bottom pinned across repeated width round trips', async () => {
    const fixture = mountAdapter({
      items: Array.from({ length: 20 }, (_, index) => createVisualRow(`row-${index}`, 100)),
      scrollTop: 1_880,
      scrollHeight: 2_000,
      scrollMode: 'follow-bottom',
    });
    await nextTick();

    for (let round = 0; round < 3; round += 1) {
      fixture.items.value = fixture.items.value.map(item => ({ ...item, estimatedHeight: 120 }));
      fixture.setScrollHeight(2_400);
      fixture.estimationWidthPx.value = 480;
      await flushEstimateInvalidation();
      expect(fixture.element.scrollTop).toBe(2_280);

      fixture.items.value = fixture.items.value.map(item => ({ ...item, estimatedHeight: 100 }));
      fixture.setScrollHeight(2_000);
      fixture.estimationWidthPx.value = 720;
      await flushEstimateInvalidation();
      expect(fixture.element.scrollTop).toBe(1_880);
    }
  });

  it('publishes turn timeline positions and scrolls to the turn index', async () => {
    const fixture = mountAdapter({
      items: [createVisualRow('a', 100), createVisualRow('b', 140, false)],
      scrollMargin: 12,
    });
    await nextTick();

    expect(fixture.adapter.timelinePositions.value).toEqual([
      { visualTurnId: 'visual_turn_a', top: 12, height: 100, measured: false },
    ]);
    await expect(fixture.adapter.scrollToVisualTurn(
      ConversationVisualTurnIdSchema.parse('visual_turn_a'),
    )).resolves.toBe(true);
    expect(fixture.scrollTo).toHaveBeenCalled();
  });

  it('keeps timeline navigation bound to the turn key when head insertion moves its index', async () => {
    const fixture = mountAdapter({
      items: [
        createVisualRow('a', 100),
        createVisualRow('b', 100),
        createVisualRow('target', 100),
        createVisualRow('d', 100),
      ],
    });
    await nextTick();

    const navigation = fixture.adapter.scrollToVisualTurn(
      ConversationVisualTurnIdSchema.parse('visual_turn_target'),
    );
    fixture.items.value = [
      createVisualRow('before-a', 100),
      createVisualRow('before-b', 100),
      ...fixture.items.value,
    ];
    await nextTick();

    await expect(navigation).resolves.toBe(true);
    const target = fixture.adapter.timelinePositions.value.find(
      position => position.visualTurnId === 'visual_turn_target',
    );
    expect(target).toBeDefined();
    expect(Math.abs(fixture.element.scrollTop - (target?.top ?? 0))).toBeLessThan(1);
  });

  it('adjusts only fully-above rows', () => {
    expect(shouldAdjustConversationScrollOnItemSizeChange({ end: 120 }, 150)).toBe(true);
    expect(shouldAdjustConversationScrollOnItemSizeChange({ end: 150 }, 150)).toBe(true);
    expect(shouldAdjustConversationScrollOnItemSizeChange({ end: 180 }, 150)).toBe(false);
  });

  it('keeps a stable-head prepend transaction open until its post-render scroll is applied', () => {
    const items = shallowRef([createVisualRow('c', 100), createVisualRow('d', 100)]);
    const holder: {
      transaction: ReturnType<typeof useConversationPrependRenderTransaction> | null;
    } = { transaction: null };
    const Host = defineComponent({
      setup() {
        holder.transaction = useConversationPrependRenderTransaction(items, item => item.key);
        return () => h('div');
      },
    });
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(Host);
    app.mount(mountPoint);

    items.value = [createVisualRow('a', 100), createVisualRow('b', 100), ...items.value];
    expect(holder.transaction?.active.value).toBe(true);
    expect(holder.transaction?.revision.value).toBe(1);

    holder.transaction?.complete();
    expect(holder.transaction?.active.value).toBe(false);
  });
});
