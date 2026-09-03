import {
  nextTick,
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue';

export interface TableCellHandlePosition {
  top: number;
  left: number;
}

export interface TableCellHandleFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

interface UseTableCellHandlePositionOptions {
  showHandle: Readonly<Ref<boolean>>;
  activeCellPos: Readonly<Ref<number | null>>;
  editorRoot: Readonly<Ref<HTMLElement | null>>;
  getCellRect: (posInsideCell: number) => DOMRect | null;
  frame?: TableCellHandleFrameScheduler;
}

const HANDLE_RADIUS = 6;
const LAYOUT_TRANSITION_PROPERTIES = new Set([
  'margin-left',
  'margin-right',
  'transform',
  'width',
]);

function createDefaultFrameScheduler(): TableCellHandleFrameScheduler {
  return {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (id) => window.cancelAnimationFrame(id),
  };
}

/**
 * 计算并同步单元格选中柄的视口位置。
 *
 * 选中柄 Teleport 到 body 后与 getBoundingClientRect 使用同一坐标系；这里仅负责
 * 在滚动、容器尺寸变化和祖先布局过渡期间重新测量，不感知 app 层的布局状态。
 */
export function useTableCellHandlePosition(
  options: UseTableCellHandlePositionOptions
): Readonly<Ref<TableCellHandlePosition | null>> {
  const frame = options.frame ?? createDefaultFrameScheduler();
  const handlePosition = ref<TableCellHandlePosition | null>(null);

  let frameId: number | null = null;
  let activeLayoutTransitionCount = 0;
  let resizeObserver: ResizeObserver | null = null;
  let ancestorMutationObserver: MutationObserver | null = null;

  const measure = (): void => {
    const activeCellPos = options.activeCellPos.value;
    if (!options.showHandle.value || activeCellPos === null || !options.editorRoot.value) {
      handlePosition.value = null;
      return;
    }

    // nodeDOM 在单元格内容位置上解析最稳定，因此从 cell 起点向内偏移一位。
    const rect = options.getCellRect(activeCellPos + 1);
    if (!rect) {
      handlePosition.value = null;
      return;
    }

    const verticalOverscan = window.innerHeight;
    if (rect.bottom < -verticalOverscan || rect.top > window.innerHeight + verticalOverscan) {
      handlePosition.value = null;
      return;
    }

    handlePosition.value = {
      left: rect.left - HANDLE_RADIUS,
      top: rect.top - HANDLE_RADIUS,
    };
  };

  const scheduleMeasurement = (): void => {
    if (frameId !== null) return;

    frameId = frame.request(() => {
      frameId = null;
      measure();

      // transform 不会触发 ResizeObserver，祖先过渡期间必须逐帧跟随真实 DOM。
      if (activeLayoutTransitionCount > 0) {
        scheduleMeasurement();
      }
    });
  };

  const isRelevantAncestorTransition = (event: TransitionEvent): boolean => {
    const editorRoot = options.editorRoot.value;
    const target = event.target;
    return (
      editorRoot !== null
      && target instanceof Element
      && target.contains(editorRoot)
      && LAYOUT_TRANSITION_PROPERTIES.has(event.propertyName)
    );
  };

  const handleTransitionRun = (event: TransitionEvent): void => {
    if (!isRelevantAncestorTransition(event)) return;
    activeLayoutTransitionCount += 1;
    scheduleMeasurement();
  };

  const handleTransitionFinish = (event: TransitionEvent): void => {
    if (!isRelevantAncestorTransition(event)) return;
    activeLayoutTransitionCount = Math.max(0, activeLayoutTransitionCount - 1);
    scheduleMeasurement();
  };

  const disconnectLayoutObservers = (): void => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    ancestorMutationObserver?.disconnect();
    ancestorMutationObserver = null;
  };

  const removeLayoutListeners = (): void => {
    window.removeEventListener('resize', scheduleMeasurement);
    window.removeEventListener('scroll', scheduleMeasurement, true);
    document.removeEventListener('transitionrun', handleTransitionRun, true);
    document.removeEventListener('transitionend', handleTransitionFinish, true);
    document.removeEventListener('transitioncancel', handleTransitionFinish, true);
  };

  const stopLayoutSync = (): void => {
    activeLayoutTransitionCount = 0;
    removeLayoutListeners();
    disconnectLayoutObservers();
    if (frameId !== null) {
      frame.cancel(frameId);
      frameId = null;
    }
  };

  const startLayoutSync = (): void => {
    stopLayoutSync();

    const editorRoot = options.editorRoot.value;
    if (!options.showHandle.value || !editorRoot) return;

    window.addEventListener('resize', scheduleMeasurement);
    // scroll 不冒泡；捕获阶段统一覆盖编辑器内部的纵向和横向滚动容器。
    window.addEventListener('scroll', scheduleMeasurement, true);
    document.addEventListener('transitionrun', handleTransitionRun, true);
    document.addEventListener('transitionend', handleTransitionFinish, true);
    document.addEventListener('transitioncancel', handleTransitionFinish, true);

    resizeObserver = new ResizeObserver(scheduleMeasurement);
    resizeObserver.observe(editorRoot);

    ancestorMutationObserver = new MutationObserver(scheduleMeasurement);
    let ancestor = editorRoot.parentElement;
    while (ancestor && ancestor !== document.body) {
      ancestorMutationObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      ancestor = ancestor.parentElement;
    }
  };

  watch(
    [options.showHandle, options.activeCellPos, options.editorRoot],
    async (_values, _previousValues, onCleanup) => {
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      stopLayoutSync();
      if (!options.showHandle.value || options.activeCellPos.value === null) {
        handlePosition.value = null;
        return;
      }

      await nextTick();
      if (cancelled) return;
      startLayoutSync();
      scheduleMeasurement();
    },
    { immediate: true }
  );

  onUnmounted(stopLayoutSync);

  return handlePosition;
}
