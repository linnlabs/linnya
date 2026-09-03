// @vitest-environment jsdom

import { elementScroll, Virtualizer } from '@tanstack/vue-virtual';
import { describe, expect, it, vi } from 'vitest';
import { createVueVirtualizerScrollBridge } from './vueVirtualizerScrollBridge';

function createHarness(options: {
  readonly maxScrollTop?: () => number;
  readonly shouldDeferExplicitScroll?: () => boolean;
  readonly onDeferredExplicitScrollApplied?: () => void;
} = {}) {
  const element = document.createElement('div');
  const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (typeof top === 'number') {
      element.scrollTop = Math.min(top, options.maxScrollTop?.() ?? Number.POSITIVE_INFINITY);
    }
  });
  Object.defineProperty(element, 'scrollTo', { configurable: true, value: scrollTo });

  const virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
    count: 0,
    estimateSize: () => 80,
    getScrollElement: () => element,
    scrollToFn: elementScroll,
    observeElementRect: () => () => undefined,
    observeElementOffset: () => () => undefined,
  });
  virtualizer._willUpdate();
  scrollTo.mockClear();

  const scheduled: Array<() => void> = [];
  const bridge = createVueVirtualizerScrollBridge({
    scheduleAfterRender: callback => scheduled.push(callback),
    shouldDeferExplicitScroll: options.shouldDeferExplicitScroll,
    onDeferredExplicitScrollApplied: options.onDeferredExplicitScrollApplied,
  });

  return { bridge, scheduled, scrollTo, virtualizer };
}

describe('createVueVirtualizerScrollBridge', () => {
  it('尺寸修正在 Vue render 完成后才写入最终目标', () => {
    const harness = createHarness();

    harness.bridge.scrollToFn(100, { adjustments: 29 }, harness.virtualizer);
    harness.bridge.flushAfterRender(harness.virtualizer);
    expect(harness.scrollTo).not.toHaveBeenCalled();

    harness.scheduled.shift()?.();
    expect(harness.scrollTo).toHaveBeenCalledOnce();
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 129, behavior: undefined });
  });

  it('同一批尺寸修正只提交最新目标', () => {
    const harness = createHarness();

    harness.bridge.scrollToFn(100, { adjustments: 29 }, harness.virtualizer);
    harness.bridge.flushAfterRender(harness.virtualizer);
    harness.bridge.scrollToFn(129, { adjustments: 31 }, harness.virtualizer);
    harness.bridge.flushAfterRender(harness.virtualizer);

    expect(harness.scheduled).toHaveLength(1);
    harness.scheduled.shift()?.();
    expect(harness.scrollTo).toHaveBeenCalledOnce();
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 160, behavior: undefined });
  });

  it('显式滚动立即执行并取消尚未提交的尺寸修正', () => {
    const harness = createHarness();

    harness.bridge.scrollToFn(100, { adjustments: 29 }, harness.virtualizer);
    harness.bridge.flushAfterRender(harness.virtualizer);
    harness.bridge.scrollToFn(400, { behavior: 'auto' }, harness.virtualizer);

    expect(harness.scrollTo).toHaveBeenCalledOnce();
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: 'auto' });
    harness.scheduled.shift()?.();
    expect(harness.scrollTo).toHaveBeenCalledOnce();
  });

  it('在新画布提交后一次落地 prepend 锚点与同批尺寸残差', () => {
    let maxScrollTop = 480;
    let prependActive = true;
    const onApplied = vi.fn(() => {
      prependActive = false;
    });
    const harness = createHarness({
      maxScrollTop: () => maxScrollTop,
      shouldDeferExplicitScroll: () => prependActive,
      onDeferredExplicitScrollApplied: onApplied,
    });

    // anchorTo 基于估高得到 1,000px；若此刻立即写入，只会被旧画布钳到 480px。
    harness.bridge.scrollToFn(1_000, {}, harness.virtualizer);
    // 六组 user(-5) + assistant(-45) 在同一 Vue patch 中把最终目标修正到 700px。
    for (let index = 0; index < 6; index += 1) {
      const currentOffset = 1_000 - index * 50;
      harness.bridge.scrollToFn(currentOffset, { adjustments: -5 }, harness.virtualizer);
      harness.bridge.scrollToFn(currentOffset - 5, { adjustments: -45 }, harness.virtualizer);
    }
    harness.bridge.flushAfterRender(harness.virtualizer);

    expect(harness.scrollTo).not.toHaveBeenCalled();
    maxScrollTop = 2_000;
    harness.scheduled.shift()?.();

    expect(harness.scrollTo).toHaveBeenCalledOnce();
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: undefined });
    expect(onApplied).toHaveBeenCalledOnce();
    expect(prependActive).toBe(false);
  });
});
