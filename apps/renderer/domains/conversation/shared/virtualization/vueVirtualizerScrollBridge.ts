import { nextTick } from 'vue';
import {
  elementScroll,
  type ScrollToOptions,
  type Virtualizer,
} from '@tanstack/vue-virtual';

type ElementVirtualizer = Virtualizer<HTMLElement, HTMLElement>;
type ScrollBehavior = ScrollToOptions['behavior'];

interface PendingScrollRequest {
  readonly offset: number;
  readonly behavior: ScrollBehavior;
  readonly completesDeferredExplicitScroll: boolean;
}

export interface VueVirtualizerScrollBridge {
  readonly scrollToFn: (
    offset: number,
    options: { adjustments?: number; behavior?: ScrollBehavior },
    instance: ElementVirtualizer,
  ) => void;
  readonly flushAfterRender: (instance: ElementVirtualizer) => void;
}

/**
 * TanStack core 会在通知 Vue 更新虚拟画布高度之前写入滚动目标，浏览器可能把该写入
 * 钳位到旧的最大滚动位置。尺寸修正一律延后；prepend 事务中的显式锚点也延后并与
 * 同批修正合并，其余显式滚动立即执行。锚定、目标计算和滚动归因仍由 TanStack 持有。
 */
export function createVueVirtualizerScrollBridge(options: {
  readonly scheduleAfterRender?: (callback: () => void) => void;
  readonly shouldDeferExplicitScroll?: () => boolean;
  readonly onDeferredExplicitScrollApplied?: () => void;
} = {}): VueVirtualizerScrollBridge {
  const scheduleAfterRender = options.scheduleAfterRender ?? ((callback: () => void) => {
    void nextTick(callback);
  });
  let pendingRequest: PendingScrollRequest | null = null;
  let flushScheduled = false;

  const scrollToFn: VueVirtualizerScrollBridge['scrollToFn'] = (
    offset,
    scrollOptions,
    instance,
  ) => {
    const adjustment = scrollOptions.adjustments ?? 0;
    if (adjustment === 0) {
      if (options.shouldDeferExplicitScroll?.()) {
        // Vue 的 options watcher 早于 DOM patch。prepend 的新锚点可能超过旧画布的
        // 最大 scrollTop，必须等新画布落 DOM 后再提交；期间的尺寸残差合并到同一目标。
        pendingRequest = {
          offset,
          behavior: scrollOptions.behavior,
          completesDeferredExplicitScroll: true,
        };
        return;
      }

      // timeline、手动落底等显式滚动立即执行，并取消尚未提交的旧尺寸修正。
      pendingRequest = null;
      elementScroll(offset, scrollOptions, instance);
      return;
    }

    pendingRequest = {
      offset: offset + adjustment,
      behavior: scrollOptions.behavior,
      completesDeferredExplicitScroll:
        pendingRequest?.completesDeferredExplicitScroll ?? false,
    };
  };

  const flushAfterRender = (instance: ElementVirtualizer): void => {
    if (pendingRequest === null || flushScheduled) return;
    flushScheduled = true;
    scheduleAfterRender(() => {
      flushScheduled = false;
      const request = pendingRequest;
      pendingRequest = null;
      if (request === null) return;
      elementScroll(request.offset, { behavior: request.behavior }, instance);
      if (request.completesDeferredExplicitScroll) {
        options.onDeferredExplicitScrollApplied?.();
      }
    });
  };

  return { scrollToFn, flushAfterRender };
}
