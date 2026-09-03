// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, watch, type App, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_WIDTH_SETTLE_DELAY_MS,
  useSettledConversationContentWidth,
} from './useSettledConversationContentWidth';
import {
  createTestAnswerMessage,
  createTestThoughtMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { createAppendOnlyConversationVisualRowsBuilder } from '../logic/appendOnlyConversationVisualRowsBuilder';

class TestResizeObserver implements ResizeObserver {
  static latest: TestResizeObserver | null = null;

  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.latest = this;
  }

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}

  emit(): void {
    this.callback([], this);
  }
}

function createContentColumn(initialWidth: number): {
  readonly element: HTMLElement;
  readonly setWidth: (widthPx: number) => void;
} {
  let widthPx = initialWidth;
  const element = document.createElement('div');
  element.style.setProperty('--conversation-content-side-gap', '22px');
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    get: () => widthPx,
  });
  document.body.appendChild(element);
  return {
    element,
    setWidth: nextWidthPx => { widthPx = nextWidthPx; },
  };
}

describe('useSettledConversationContentWidth', () => {
  let app: App<Element> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    TestResizeObserver.latest = null;
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function mountWidthCoordinator(initialWidth: number): {
    readonly committedWidthPx: Readonly<Ref<number>>;
    readonly isChanging: Readonly<Ref<boolean>>;
    readonly resetKey: Ref<string>;
    readonly setWidth: (widthPx: number) => void;
  } {
    const column = createContentColumn(initialWidth);
    const contentColumnRef = ref<HTMLElement | null>(column.element);
    const resetKey = ref('conversation-a');
    const holder: {
      committedWidthPx: Readonly<Ref<number>> | null;
      isChanging: Readonly<Ref<boolean>> | null;
    } = {
      committedWidthPx: null,
      isChanging: null,
    };
    const Host = defineComponent({
      setup() {
        const width = useSettledConversationContentWidth({
          contentColumnRef,
          resetKey,
        });
        holder.committedWidthPx = width.committedWidthPx;
        holder.isChanging = width.isChanging;
        return () => h('div');
      },
    });
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(Host);
    app.mount(mountPoint);
    if (!holder.committedWidthPx || !holder.isChanging) {
      throw new Error('Width coordinator was not mounted');
    }
    return {
      committedWidthPx: holder.committedWidthPx,
      isChanging: holder.isChanging,
      resetKey,
      setWidth: column.setWidth,
    };
  }

  it('commits the real initial content width immediately', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();

    expect(fixture.committedWidthPx.value).toBe(756);
  });

  it('coalesces a resize burst into one final precise width', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();
    const committedWidths: number[] = [];
    let previousWidth = fixture.committedWidthPx.value;

    for (let frame = 1; frame <= 18; frame += 1) {
      fixture.setWidth(800 - frame * 10);
      TestResizeObserver.latest?.emit();
      vi.advanceTimersByTime(16);
      if (fixture.committedWidthPx.value !== previousWidth) {
        committedWidths.push(fixture.committedWidthPx.value);
        previousWidth = fixture.committedWidthPx.value;
      }
    }

    expect(committedWidths).toEqual([]);
    expect(fixture.isChanging.value).toBe(true);
    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS);
    expect(fixture.committedWidthPx.value).toBe(576);
    expect(fixture.isChanging.value).toBe(false);
  });

  it('limits an 80-row production projection to one rebuild after a width burst', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();
    const longThoughtBody = 'analysis '.repeat(8_000);
    const messages = Array.from({ length: 80 }, (_, index) => (
      index < 16
        ? createTestThoughtMessage({
          id: `completed-thought-${index}`,
          content: longThoughtBody,
        })
        : createTestAnswerMessage({
          id: `answer-${index}`,
          content: `answer ${index}`,
        })
    ));
    const builder = createAppendOnlyConversationVisualRowsBuilder({
      estimateMessageLayout: () => ({ estimatedHeight: 56, containsTable: false }),
    });
    builder.apply(messages, { widthPx: fixture.committedWidthPx.value });
    const stop = watch(
      fixture.committedWidthPx,
      widthPx => builder.apply(messages, { widthPx }),
      { flush: 'sync' },
    );

    for (let frame = 1; frame <= 18; frame += 1) {
      fixture.setWidth(800 - frame * 10);
      TestResizeObserver.latest?.emit();
      vi.advanceTimersByTime(16);
    }

    expect(builder.getDiagnostics().fullRebuilds).toBe(1);
    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS);
    expect(builder.getDiagnostics().fullRebuilds).toBe(2);
    stop();
  });

  it('cancels the previous conversation pending commit on reset', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();

    fixture.setWidth(620);
    TestResizeObserver.latest?.emit();
    vi.advanceTimersByTime(60);
    expect(fixture.isChanging.value).toBe(true);

    fixture.setWidth(700);
    fixture.resetKey.value = 'conversation-b';
    await nextTick();
    expect(fixture.committedWidthPx.value).toBe(656);
    expect(fixture.isChanging.value).toBe(false);

    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS * 2);
    expect(fixture.committedWidthPx.value).toBe(656);
  });

  it('does not publish the same final width twice', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();
    const committedWidths: number[] = [];
    const stop = watch(
      fixture.committedWidthPx,
      widthPx => committedWidths.push(widthPx),
      { flush: 'sync' },
    );

    fixture.setWidth(760);
    TestResizeObserver.latest?.emit();
    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS);
    TestResizeObserver.latest?.emit();
    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS);

    expect(committedWidths).toEqual([716]);
    stop();
  });

  it('does not let an unmounted observer commit its pending width', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();

    fixture.setWidth(620);
    TestResizeObserver.latest?.emit();
    expect(fixture.isChanging.value).toBe(true);
    app?.unmount();
    app = null;
    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS * 2);

    expect(fixture.committedWidthPx.value).toBe(756);
    expect(fixture.isChanging.value).toBe(false);
  });

  it('ignores ResizeObserver notifications when the real column width did not change', async () => {
    const fixture = mountWidthCoordinator(800);
    await nextTick();

    TestResizeObserver.latest?.emit();

    expect(fixture.isChanging.value).toBe(false);
    vi.advanceTimersByTime(CONVERSATION_WIDTH_SETTLE_DELAY_MS);
    expect(fixture.committedWidthPx.value).toBe(756);
  });
});
