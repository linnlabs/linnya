import { onBeforeUnmount, type Ref } from 'vue';
import {
  OverlayScrollbars,
  type OverlayScrollbars as OverlayScrollbarsInstance,
  type PartialOptions,
} from 'overlayscrollbars';

/**
 * 标准绑定对象：
 * - hostRef：OverlayScrollbars 的宿主节点
 * - viewportMountRef：业务显式保留的真实滚动 viewport
 * - viewportRef：对外暴露的“真实滚动元素”单一真源
 */
export interface OverlayScrollViewportBindings {
  hostRef: Ref<HTMLElement | null>;
  viewportMountRef: Ref<HTMLElement | null>;
  viewportRef: Ref<HTMLElement | null>;
}

/**
 * 标准接入参数：
 * - `bindings`：统一的 DOM 绑定集合
 * - `options`：局部覆盖滚动条选项
 */
export interface UseOverlayScrollViewportParams {
  bindings: OverlayScrollViewportBindings;
  options?: PartialOptions;
}

/**
 * 标准控制器接口：
 * - `init`：初始化或复用实例
 * - `update`：立即同步一次（非强制）
 * - `scheduleUpdate`：按帧合并更新
 * - `destroy`：销毁实例
 * - `getViewport`：读取当前真实 viewport
 * - `getInstance`：读取原始 OverlayScrollbars 实例（仅高级用法）
 */
export interface OverlayScrollViewportController {
  init: () => HTMLElement | null;
  update: () => HTMLElement | null;
  scheduleUpdate: () => void;
  beginStructureTransition: () => void;
  finishStructureTransition: () => void;
  destroy: () => void;
  getViewport: () => HTMLElement | null;
  getInstance: () => OverlayScrollbarsInstance | null;
}

interface ScrollbarMetricSnapshot {
  scrollbar: HTMLElement;
  viewportPercent: string;
  scrollPercent: string;
}

interface StructureTransitionScrollRangeSnapshot {
  viewport: HTMLElement;
  initialScrollHeight: number;
  initialClientHeight: number;
  basePaddingBottomPx: number;
  originalInlinePaddingBottom: string;
  appliedReservePx: number;
}

const STRUCTURE_METRIC_TRANSITION_MS = 420;
const STRUCTURE_METRIC_CLEANUP_BUFFER_MS = 40;

export const DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS: PartialOptions = {
  overflow: {
    x: 'hidden',
    y: 'scroll',
  },
  scrollbars: {
    theme: 'os-theme-linnya',
    visibility: 'auto',
    autoHide: 'leave',
    autoHideDelay: 120,
    autoHideSuspend: false,
    dragScroll: true,
    clickScroll: false,
    pointers: ['mouse', 'touch', 'pen'],
  },
};

const mergeOverlayScrollViewportOptions = (options?: PartialOptions): PartialOptions => {
  return {
    ...options,
    overflow: {
      ...DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS.overflow,
      ...options?.overflow,
    },
    scrollbars: {
      ...DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS.scrollbars,
      ...options?.scrollbars,
    },
  };
};

/**
 * 中文说明：
 * - 这不是“某个页面专用的小工具”，而是共享滚动基础设施；
 * - 核心职责只有一个：把 OverlayScrollbars 接到现有 DOM，同时把“真实滚动 viewport”收口成单一真源；
 * - 之所以显式传入 `viewportMountRef`，是因为很多业务（吸底、时间轴、虚拟列表）都要求保留现有滚动节点，
 *   不能让第三方库自行生成并替换滚动节点。
 */
export function useOverlayScrollViewport(
  params: UseOverlayScrollViewportParams,
): OverlayScrollViewportController {
  const { bindings, options } = params;
  const { hostRef, viewportMountRef, viewportRef } = bindings;
  let overlayInstance: OverlayScrollbarsInstance | null = null;
  let pendingUpdateRafId: number | null = null;
  let structureTransitionSnapshots: ScrollbarMetricSnapshot[] = [];
  let structureTransitionScrollRangeSnapshot: StructureTransitionScrollRangeSnapshot | null = null;
  let structureTransitionFreezeRafId: number | null = null;
  let structureTransitionCleanupTimeoutId: number | null = null;

  const structureMetricTransition = [
    'opacity 0.15s',
    'visibility 0.15s',
    'top 0.15s',
    'right 0.15s',
    'bottom 0.15s',
    'left 0.15s',
    `--os-viewport-percent ${STRUCTURE_METRIC_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
    `--os-scroll-percent ${STRUCTURE_METRIC_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
  ].join(', ');

  const syncViewportRef = (): HTMLElement | null => {
    const resolvedViewport = overlayInstance?.elements().viewport ?? viewportMountRef.value ?? null;
    viewportRef.value = resolvedViewport;
    return resolvedViewport;
  };

  const init = (): HTMLElement | null => {
    const hostEl = hostRef.value;
    const viewportEl = viewportMountRef.value;

    if (!hostEl || !viewportEl) {
      viewportRef.value = null;
      return null;
    }

    if (overlayInstance && OverlayScrollbars.valid(overlayInstance)) {
      // 中文说明：
      // - 禁止用 force=true；
      // - 高信号场景（如流式 chunk）若频繁强制更新，会无条件重走测量/同步链路，显著放大重排与重绘成本。
      overlayInstance.update();
      return syncViewportRef();
    }

    overlayInstance = OverlayScrollbars(
      {
        target: hostEl,
        elements: {
          viewport: viewportEl,
        },
      },
      mergeOverlayScrollViewportOptions(options),
    );

    return syncViewportRef();
  };

  const update = (): HTMLElement | null => {
    if (overlayInstance && OverlayScrollbars.valid(overlayInstance)) {
      overlayInstance.update();
    }
    return syncViewportRef();
  };

  const readScrollbarMetricSnapshot = (scrollbar: HTMLElement): ScrollbarMetricSnapshot => {
    const styles = window.getComputedStyle(scrollbar);
    return {
      scrollbar,
      viewportPercent: styles.getPropertyValue('--os-viewport-percent').trim() || '0',
      scrollPercent: styles.getPropertyValue('--os-scroll-percent').trim() || '0',
    };
  };

  const collectScrollbarMetricSnapshots = (): ScrollbarMetricSnapshot[] => {
    const instance = getInstance();
    if (!instance) return [];

    const { scrollbarHorizontal, scrollbarVertical } = instance.elements();
    return [
      readScrollbarMetricSnapshot(scrollbarHorizontal.scrollbar),
      readScrollbarMetricSnapshot(scrollbarVertical.scrollbar),
    ];
  };

  const readViewportPaddingBottomPx = (viewport: HTMLElement): number => {
    const paddingBottom = Number.parseFloat(window.getComputedStyle(viewport).paddingBottom);
    return Number.isFinite(paddingBottom) ? paddingBottom : 0;
  };

  const collectStructureTransitionScrollRangeSnapshot = (
  ): StructureTransitionScrollRangeSnapshot | null => {
    const viewport = getViewport();
    if (!viewport || viewport.scrollHeight <= viewport.clientHeight) return null;

    return {
      viewport,
      initialScrollHeight: viewport.scrollHeight,
      initialClientHeight: viewport.clientHeight,
      basePaddingBottomPx: readViewportPaddingBottomPx(viewport),
      originalInlinePaddingBottom: viewport.style.paddingBottom,
      appliedReservePx: 0,
    };
  };

  const applyStructureTransitionScrollRangeReserve = (): void => {
    const snapshot = structureTransitionScrollRangeSnapshot;
    if (!snapshot || !snapshot.viewport.isConnected) return;

    const {
      viewport,
      initialScrollHeight,
      initialClientHeight,
      basePaddingBottomPx,
      appliedReservePx,
    } = snapshot;
    if (initialScrollHeight <= initialClientHeight) return;

    const currentContentScrollHeight = viewport.scrollHeight - appliedReservePx;
    const nextReservePx = Math.max(0, initialScrollHeight - currentContentScrollHeight);
    if (nextReservePx === appliedReservePx) return;

    snapshot.appliedReservePx = nextReservePx;
    viewport.style.paddingBottom = `${basePaddingBottomPx + nextReservePx}px`;
  };

  const restoreStructureTransitionScrollRangeReserve = (): void => {
    const snapshot = structureTransitionScrollRangeSnapshot;
    if (!snapshot) return;

    if (snapshot.viewport.isConnected) {
      snapshot.viewport.style.paddingBottom = snapshot.originalInlinePaddingBottom;
    }

    structureTransitionScrollRangeSnapshot = null;
  };

  const applyScrollbarMetricSnapshots = (
    snapshots: ScrollbarMetricSnapshot[],
    transitionValue: string | null,
  ): void => {
    for (const snapshot of snapshots) {
      const { scrollbar, viewportPercent, scrollPercent } = snapshot;
      if (!scrollbar.isConnected) continue;

      if (transitionValue === null) {
        scrollbar.style.removeProperty('transition');
      } else {
        scrollbar.style.transition = transitionValue;
      }

      scrollbar.style.setProperty('--os-viewport-percent', viewportPercent);
      scrollbar.style.setProperty('--os-scroll-percent', scrollPercent);
    }
  };

  const cancelStructureTransitionFreeze = (): void => {
    if (structureTransitionFreezeRafId !== null) {
      cancelAnimationFrame(structureTransitionFreezeRafId);
      structureTransitionFreezeRafId = null;
    }

    if (structureTransitionCleanupTimeoutId !== null) {
      window.clearTimeout(structureTransitionCleanupTimeoutId);
      structureTransitionCleanupTimeoutId = null;
    }

    restoreStructureTransitionScrollRangeReserve();
  };

  /**
   * 中文说明：
   * - 结构折叠/展开时，OverlayScrollbars 会跟随 ResizeObserver 持续刷新真实 scroll metrics；
   * - 如果任由它中途刷新，用户会看到 thumb 长度突然跳变；
   * - 这里先冻结当前 metrics，等结构动画结束后再用一次 FLIP 把旧 metrics 补间到最终 metrics。
   */
  const beginStructureTransition = (): void => {
    cancelStructureTransitionFreeze();
    structureTransitionSnapshots = collectScrollbarMetricSnapshots();
    structureTransitionScrollRangeSnapshot = collectStructureTransitionScrollRangeSnapshot();
    if (structureTransitionSnapshots.length === 0 && !structureTransitionScrollRangeSnapshot) return;

    const freeze = (): void => {
      applyScrollbarMetricSnapshots(structureTransitionSnapshots, 'none');
      /*
       * 中文说明：折叠内容跨过“有滚动条 / 无滚动条”临界点时，浏览器会夹紧 scrollTop。
       * 临时保住旧滚动范围，可以避免视口中途跳动，让高度动画自然跑完。
       */
      applyStructureTransitionScrollRangeReserve();
      structureTransitionFreezeRafId = requestAnimationFrame(freeze);
    };

    freeze();
  };

  const finishStructureTransition = (): void => {
    const fromSnapshots = structureTransitionSnapshots;
    cancelStructureTransitionFreeze();

    if (fromSnapshots.length === 0) {
      scheduleUpdate();
      return;
    }

    update();
    const toSnapshots = collectScrollbarMetricSnapshots();
    const toSnapshotByElement = new Map(
      toSnapshots.map(snapshot => [snapshot.scrollbar, snapshot]),
    );

    applyScrollbarMetricSnapshots(fromSnapshots, 'none');
    for (const snapshot of fromSnapshots) {
      // 中文说明：读取布局用于提交上面的旧 metrics，确保下一帧的最终 metrics 能触发过渡。
      snapshot.scrollbar.getBoundingClientRect();
    }

    requestAnimationFrame(() => {
      for (const fromSnapshot of fromSnapshots) {
        const toSnapshot = toSnapshotByElement.get(fromSnapshot.scrollbar);
        if (!toSnapshot || !fromSnapshot.scrollbar.isConnected) continue;

        applyScrollbarMetricSnapshots([toSnapshot], structureMetricTransition);
      }

      structureTransitionCleanupTimeoutId = window.setTimeout(() => {
        for (const snapshot of fromSnapshots) {
          snapshot.scrollbar.style.removeProperty('transition');
        }
        structureTransitionSnapshots = [];
        structureTransitionCleanupTimeoutId = null;
        scheduleUpdate();
      }, STRUCTURE_METRIC_TRANSITION_MS + STRUCTURE_METRIC_CLEANUP_BUFFER_MS);
    });
  };

  /**
   * 中文说明：
   * - 流式输出、虚拟列表重算、容器尺寸变化，都可能在极短时间内高频请求刷新；
   * - 统一合并到 rAF，可将多次请求压缩为“每帧最多一次更新”，这是后续页面推广时的默认策略。
   */
  const scheduleUpdate = (): void => {
    if (pendingUpdateRafId !== null) return;

    pendingUpdateRafId = requestAnimationFrame(() => {
      pendingUpdateRafId = null;
      update();
    });
  };

  const destroy = (): void => {
    cancelStructureTransitionFreeze();
    structureTransitionSnapshots = [];

    if (pendingUpdateRafId !== null) {
      cancelAnimationFrame(pendingUpdateRafId);
      pendingUpdateRafId = null;
    }

    if (overlayInstance && OverlayScrollbars.valid(overlayInstance)) {
      overlayInstance.destroy();
    }

    overlayInstance = null;
    viewportRef.value = null;
  };

  const getViewport = (): HTMLElement | null => {
    return viewportRef.value ?? syncViewportRef();
  };

  const getInstance = (): OverlayScrollbarsInstance | null => {
    return overlayInstance && OverlayScrollbars.valid(overlayInstance) ? overlayInstance : null;
  };

  onBeforeUnmount(() => {
    destroy();
  });

  return {
    init,
    update,
    scheduleUpdate,
    beginStructureTransition,
    finishStructureTransition,
    destroy,
    getViewport,
    getInstance,
  };
}
