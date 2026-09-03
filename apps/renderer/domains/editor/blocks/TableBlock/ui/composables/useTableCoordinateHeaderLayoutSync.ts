import { onUnmounted, watch, type WatchSource } from 'vue';

export interface TableCoordinateHeaderFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
  now(): number;
}

export interface UseTableCoordinateHeaderLayoutSyncOptions {
  sidebarVisible: WatchSource<unknown>;
  sidebarWidth: WatchSource<unknown>;
  measure: () => void;
  frame?: TableCoordinateHeaderFrameScheduler;
  sidebarTransitionMs?: number;
}

const DEFAULT_SIDEBAR_TRANSITION_MS = 300;

function createDefaultFrameScheduler(): TableCoordinateHeaderFrameScheduler {
  return {
    request(callback) {
      if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(callback);
      }
      return window.setTimeout(() => callback(performance.now()), 16);
    },
    cancel(id) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
        return;
      }
      window.clearTimeout(id);
    },
    now() {
      return typeof performance !== 'undefined' ? performance.now() : Date.now();
    },
  };
}

/**
 * 表格坐标头与应用侧边栏布局的同步器。
 *
 * 中文说明：
 * - 只负责“何时重新测量”，不读取表格 DOM，也不直接渲染 UI；
 * - 侧边栏开合期间逐帧测量，宽度拖拽只合批到下一帧；
 * - 用 generation 取消旧动画循环，避免快速开合侧边栏时旧 rAF 继续改写坐标头位置。
 */
export function useTableCoordinateHeaderLayoutSync(
  options: UseTableCoordinateHeaderLayoutSyncOptions
): void {
  const frame = options.frame ?? createDefaultFrameScheduler();
  const sidebarTransitionMs = options.sidebarTransitionMs ?? DEFAULT_SIDEBAR_TRANSITION_MS;

  let transitionFrameId: number | null = null;
  let pendingWidthFrameId: number | null = null;
  let transitionGeneration = 0;

  const cancelTransitionFrame = (): void => {
    if (transitionFrameId === null) return;
    frame.cancel(transitionFrameId);
    transitionFrameId = null;
  };

  const cancelPendingWidthFrame = (): void => {
    if (pendingWidthFrameId === null) return;
    frame.cancel(pendingWidthFrameId);
    pendingWidthFrameId = null;
  };

  const runMeasuredTransition = (durationMs: number): void => {
    transitionGeneration += 1;
    const generation = transitionGeneration;
    const startedAt = frame.now();
    cancelTransitionFrame();

    const tick = (currentTime: number): void => {
      if (generation !== transitionGeneration) return;

      options.measure();
      if (currentTime - startedAt < durationMs) {
        transitionFrameId = frame.request(tick);
        return;
      }

      transitionFrameId = null;
    };

    transitionFrameId = frame.request(tick);
  };

  const requestWidthMeasurement = (): void => {
    if (pendingWidthFrameId !== null) return;

    pendingWidthFrameId = frame.request(() => {
      pendingWidthFrameId = null;
      options.measure();
    });
  };

  watch(options.sidebarVisible, () => runMeasuredTransition(sidebarTransitionMs));
  watch(options.sidebarWidth, requestWidthMeasurement);

  onUnmounted(() => {
    transitionGeneration += 1;
    cancelTransitionFrame();
    cancelPendingWidthFrame();
  });
}
