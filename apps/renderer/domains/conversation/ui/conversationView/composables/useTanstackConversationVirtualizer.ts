import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance,
  type ComputedRef,
  type Ref,
} from 'vue';
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type Virtualizer,
  type VirtualItem,
} from '@tanstack/vue-virtual';
import { createVueVirtualizerScrollBridge } from '../../../shared/virtualization/vueVirtualizerScrollBridge';
import type { ConversationScrollMode } from '../functions/scrollPositionController';
import type { ConversationVisualRow } from '../../messageCanvas';
import type { ConversationVisualTurnId } from '@app/schemas';

export interface TanstackConversationVisibleItem {
  readonly item: ConversationVisualRow;
  readonly index: number;
  readonly virtualItem: VirtualItem;
}

export interface TanstackConversationTimelinePosition {
  readonly visualTurnId: ConversationVisualTurnId;
  readonly top: number;
  readonly height: number;
  readonly measured: boolean;
}

const PINNED_STREAMING_TAIL_COUNT = 3;
const TIMELINE_SCROLL_SETTLE_EPSILON_PX = 1;
const TIMELINE_SCROLL_STABLE_FRAME_COUNT = 2;
const TIMELINE_SCROLL_TIMEOUT_MS = 5_000;

interface ConversationEstimateInvalidationAnchor {
  readonly rowKey: string;
  readonly offsetFromRowStartPx: number;
}

function createTimelineScrollAbortError(): Error {
  const error = new Error('timeline scroll cancelled');
  error.name = 'AbortError';
  return error;
}

export function shouldAdjustConversationScrollOnItemSizeChange(
  item: Pick<VirtualItem, 'end'>,
  scrollOffset: number | null,
): boolean {
  // anchorTo 负责估高下的结构归位；真实尺寸与估高的残差仍必须补偿。
  return item.end <= (scrollOffset ?? 0);
}

export function requireConversationVirtualItemKey(
  items: readonly ConversationVisualRow[],
  index: number,
): string {
  const item = items[index];
  if (!item) {
    throw new Error(`Conversation virtualizer requested an unknown row index: ${index}`);
  }
  return item.key;
}

export interface ConversationPrependRenderTransaction {
  readonly active: Readonly<Ref<boolean>>;
  readonly revision: Readonly<Ref<number>>;
  readonly complete: () => void;
}

export function useConversationPrependRenderTransaction<T>(
  items: Ref<T[]>,
  getKey: (item: T) => string,
): ConversationPrependRenderTransaction {
  const active = ref(false);
  const revision = ref(0);

  watch(
    () => {
      const first = items.value[0];
      return first ? getKey(first) : null;
    },
    (firstKey, previousFirstKey) => {
      if (previousFirstKey === null || firstKey === previousFirstKey) return;
      const previousFirstIndex = items.value.findIndex(item => getKey(item) === previousFirstKey);
      if (previousFirstIndex <= 0) return;

      active.value = true;
      revision.value += 1;
    },
    { flush: 'sync' },
  );

  return {
    active,
    revision,
    complete: () => {
      active.value = false;
    },
  };
}

function extractConversationRange(range: Range, pinStreamingTail: boolean): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  if (pinStreamingTail) {
    const firstPinnedIndex = Math.max(0, range.count - PINNED_STREAMING_TAIL_COUNT);
    for (let index = firstPinnedIndex; index < range.count; index += 1) {
      indexes.add(index);
    }
  }
  return Array.from(indexes).sort((left, right) => left - right);
}

function captureEstimateInvalidationAnchor(
  instance: Virtualizer<HTMLElement, HTMLElement>,
): ConversationEstimateInvalidationAnchor | null {
  const scrollOffset = instance.scrollOffset ?? instance.scrollElement?.scrollTop ?? 0;
  const anchorItem = instance.getVirtualItemForOffset(scrollOffset);
  if (!anchorItem || typeof anchorItem.key !== 'string') return null;
  return {
    rowKey: anchorItem.key,
    offsetFromRowStartPx: scrollOffset - anchorItem.start,
  };
}

function restoreEstimateInvalidationAnchor(input: {
  readonly anchor: ConversationEstimateInvalidationAnchor | null;
  readonly instance: Virtualizer<HTMLElement, HTMLElement>;
  readonly items: readonly ConversationVisualRow[];
  readonly scrollMode: ConversationScrollMode;
}): void {
  if (input.scrollMode === 'follow-bottom') {
    input.instance.scrollToEnd();
    return;
  }

  const anchor = input.anchor;
  if (!anchor) return;
  const index = input.items.findIndex(item => item.key === anchor.rowKey);
  if (index < 0) return;
  // measure() 只标记 memo 失效；先通过公开读取物化新 measurements，随后再解析 anchor offset。
  input.instance.getTotalSize();
  const offsetInfo = input.instance.getOffsetForIndex(index, 'start');
  if (!offsetInfo) return;
  input.instance.scrollToOffset(offsetInfo[0] + anchor.offsetFromRowStartPx);
}

export function useTanstackConversationVirtualizer(params: {
  readonly items: Ref<ConversationVisualRow[]>;
  readonly enabled: ComputedRef<boolean>;
  readonly isStreaming: ComputedRef<boolean>;
  readonly scrollMode: ComputedRef<ConversationScrollMode>;
  readonly scrollElement: Ref<HTMLElement | null | undefined>;
  readonly scrollMargin: ComputedRef<number>;
  readonly scrollEndThreshold: ComputedRef<number>;
  readonly estimationWidthPx: Readonly<Ref<number>>;
  readonly onScrollApplied?: (deltaPx: number, isSizeAdjustment: boolean) => void;
}) {
  const activeTimelineScrollCleanups = new Set<() => void>();
  let estimateInvalidationRevision = 0;
  const prependTransaction = useConversationPrependRenderTransaction(
    params.items,
    item => item.key,
  );
  const scrollBridge = createVueVirtualizerScrollBridge({
    shouldDeferExplicitScroll: () => prependTransaction.active.value,
    onDeferredExplicitScrollApplied: prependTransaction.complete,
    onScrollApplied: params.onScrollApplied,
  });
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(computed(() => ({
    count: params.items.value.length,
    getScrollElement: () => params.scrollElement.value ?? null,
    initialOffset: () => params.scrollElement.value?.scrollTop ?? 0,
    estimateSize: (index: number) => params.items.value[index]?.estimatedHeight ?? 80,
    getItemKey: (index: number) => requireConversationVirtualItemKey(params.items.value, index),
    enabled: params.enabled.value,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: params.scrollEndThreshold.value,
    scrollMargin: params.scrollMargin.value,
    paddingEnd: 0,
    rangeExtractor: range => extractConversationRange(range, params.isStreaming.value),
    overscan: 8,
    useAnimationFrameWithResizeObserver: false,
    // 首测缩短画布时浏览器可能直接钳位 scrollTop；原生 scrollend 重读真实位置，
    // 避免默认 debounce 把上一次 scroll 捕获的旧 offset 写回，导致顶部漏挂载。
    useScrollendEvent: true,
    scrollToFn: scrollBridge.scrollToFn,
    onChange: instance => scrollBridge.flushAfterRender(instance),
  })));

  watch(
    params.estimationWidthPx,
    (widthPx, previousWidthPx) => {
      if (widthPx === previousWidthPx) return;
      const instance = virtualizer.value;
      const scrollMode = params.scrollMode.value;
      const anchor = scrollMode === 'follow-bottom'
        ? null
        : captureEstimateInvalidationAnchor(instance);
      const revision = ++estimateInvalidationRevision;
      // virtual-core 不把 estimateSize 闭包变化作为 measurements memo 的依赖。
      // 先等待 width 对应的 rows/options 完整提交，再通过公开 API 清除旧几何；下一次
      // Vue 提交画布高度后，仍由 virtualizer 恢复底部或稳定 row key。
      void nextTick(() => {
        if (revision !== estimateInvalidationRevision) return;
        instance.measure();
        void nextTick(() => {
          if (revision !== estimateInvalidationRevision) return;
          restoreEstimateInvalidationAnchor({
            anchor,
            instance,
            items: params.items.value,
            scrollMode,
          });
        });
      });
    },
    // 必须同步捕获旧 geometry；若等到 pre/post flush，builder 已写入新估高，旧视口身份会丢失。
    { flush: 'sync' },
  );

  watch(
    prependTransaction.revision,
    () => scrollBridge.flushAfterRender(virtualizer.value),
    { flush: 'post' },
  );

  // virtual-core 3.17.3 只读实例属性；完整位于视口上方的首测误差始终需要补偿。
  virtualizer.value.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    return shouldAdjustConversationScrollOnItemSizeChange(
      item,
      instance.scrollOffset,
    );
  };

  const visibleItems = computed<TanstackConversationVisibleItem[]>(() => (
    virtualizer.value.getVirtualItems().flatMap((virtualItem) => {
      const item = params.items.value[virtualItem.index];
      return item ? [{ item, index: virtualItem.index, virtualItem }] : [];
    })
  ));
  const totalHeight = computed(() => virtualizer.value.getTotalSize());
  const scrollOffset = computed(() => (
    virtualizer.value.scrollOffset
    ?? params.scrollElement.value?.scrollTop
    ?? 0
  ));
  const viewportHeight = computed(() => (
    virtualizer.value.scrollRect?.height
    ?? params.scrollElement.value?.clientHeight
    ?? 0
  ));
  const paddingTop = computed(() => {
    const first = visibleItems.value[0]?.virtualItem;
    return first ? Math.max(first.start - params.scrollMargin.value, 0) : 0;
  });
  const paddingBottom = computed(() => {
    const last = visibleItems.value[visibleItems.value.length - 1]?.virtualItem;
    return last
      ? Math.max(totalHeight.value - (last.end - params.scrollMargin.value), 0)
      : 0;
  });
  const timelinePositions = computed<TanstackConversationTimelinePosition[]>(() => {
    virtualizer.value.getTotalSize();
    const positions: TanstackConversationTimelinePosition[] = [];
    for (let index = 0; index < params.items.value.length; index += 1) {
      const item = params.items.value[index];
      const measurement = virtualizer.value.measurementsCache[index];
      if (!item?.isTurnStart || !measurement) continue;
      positions.push({
        visualTurnId: item.visualTurnId,
        top: measurement.start,
        height: measurement.size,
        measured: virtualizer.value.itemSizeCache.has(measurement.key),
      });
    }
    return positions;
  });

  const measureElement = (element: Element | ComponentPublicInstance | null): void => {
    if (element instanceof HTMLElement) virtualizer.value.measureElement(element);
  };

  const findVisualTurnIndex = (visualTurnId: ConversationVisualTurnId): number => (
    params.items.value.findIndex(item => item.isTurnStart && item.visualTurnId === visualTurnId)
  );

  const scrollToTarget = (
    target: { readonly kind: 'turn'; readonly visualTurnId: ConversationVisualTurnId } | { readonly kind: 'end' },
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const targetIndex = (): number => target.kind === 'turn'
      ? findVisualTurnIndex(target.visualTurnId)
      : params.items.value.length - 1;
    const initialIndex = targetIndex();
    if (target.kind === 'end' && initialIndex < 0) return Promise.resolve(true);
    if (initialIndex < 0) return Promise.resolve(false);

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let frameId: number | null = null;
      let currentIndex = initialIndex;
      let previousTargetOffset: number | null = null;
      let stableFrameCount = 0;
      const startedAt = window.performance.now();

      const finish = (result: boolean, error?: Error): void => {
        if (settled) return;
        settled = true;
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        signal?.removeEventListener('abort', handleAbort);
        activeTimelineScrollCleanups.delete(cancelForUnmount);
        if (error) reject(error);
        else resolve(result);
      };
      const handleAbort = (): void => finish(false, createTimelineScrollAbortError());
      const cancelForUnmount = (): void => finish(false);

      const issueScroll = (index: number): void => {
        currentIndex = index;
        previousTargetOffset = null;
        stableFrameCount = 0;
        if (target.kind === 'end') virtualizer.value.scrollToEnd();
        else virtualizer.value.scrollToIndex(index, { align: 'start' });
      };

      const verify = (now: number): void => {
        const latestIndex = targetIndex();
        if (latestIndex < 0) {
          finish(false);
          return;
        }
        // 窗口 prepend/trim 会移动数字 index；导航身份始终由稳定 visual turn key 决定。
        if (latestIndex !== currentIndex) issueScroll(latestIndex);

        const offsetInfo = virtualizer.value.getOffsetForIndex(latestIndex, target.kind === 'end' ? 'end' : 'start');
        const actualOffset = params.scrollElement.value?.scrollTop
          ?? virtualizer.value.scrollOffset
          ?? 0;
        const targetOffset = offsetInfo?.[0];
        const targetUnchanged = targetOffset !== undefined
          && previousTargetOffset !== null
          && Math.abs(targetOffset - previousTargetOffset) < TIMELINE_SCROLL_SETTLE_EPSILON_PX;
        const landed = targetOffset !== undefined
          && Math.abs(actualOffset - targetOffset) < TIMELINE_SCROLL_SETTLE_EPSILON_PX;

        // 流式输出期间底部仍可增长；连续贴底即可完成导航，不要求内容停止增长。
        stableFrameCount = (target.kind === 'end' || targetUnchanged) && landed ? stableFrameCount + 1 : 0;
        previousTargetOffset = targetOffset ?? null;
        if (stableFrameCount >= TIMELINE_SCROLL_STABLE_FRAME_COUNT) {
          finish(true);
          return;
        }
        if (now - startedAt >= TIMELINE_SCROLL_TIMEOUT_MS) {
          finish(false, new Error(`conversation scroll did not settle: ${target.kind === 'turn' ? target.visualTurnId : 'end'}`));
          return;
        }
        frameId = window.requestAnimationFrame(verify);
      };

      activeTimelineScrollCleanups.add(cancelForUnmount);
      signal?.addEventListener('abort', handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      issueScroll(initialIndex);
      frameId = window.requestAnimationFrame(verify);
    });
  };

  onUnmounted(() => {
    estimateInvalidationRevision += 1;
    for (const cleanup of [...activeTimelineScrollCleanups]) cleanup();
    activeTimelineScrollCleanups.clear();
  });

  return {
    visibleItems,
    virtualRows: visibleItems,
    paddingTop,
    paddingBottom,
    totalHeight,
    scrollOffset,
    viewportHeight,
    timelinePositions,
    measureElement,
    scrollToVisualTurn: (visualTurnId: ConversationVisualTurnId, signal?: AbortSignal) => (
      scrollToTarget({ kind: 'turn', visualTurnId }, signal)
    ),
    scrollToEndAndWait: (signal: AbortSignal) => scrollToTarget({ kind: 'end' }, signal),
    scrollToEnd: () => virtualizer.value.scrollToEnd(),
    getDistanceFromEnd: () => virtualizer.value.getDistanceFromEnd(),
  };
}
