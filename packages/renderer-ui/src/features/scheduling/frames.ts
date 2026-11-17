import { cancelOnScopeDispose } from './scope';

export type FrameCallback = (timestamp: number) => void;

/** 同一帧里多次请求只执行一次：滚动、拖拽、尺寸变化时合并读写。 */
export interface FrameBatch {
  /** 请求在下一帧执行；这一帧已经请求过就不变。 */
  request(): void;
  cancel(): void;
  readonly pending: boolean;
}

/** 每帧执行一次，直到 stop 或 callback 返回 false：动画、平滑进度。 */
export interface FrameLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * 有 requestAnimationFrame 就用它；没有帧的环境（Node 测试等）用定时器代替。
 * 每次调用时才读取全局函数，测试替换的假时钟才会生效。
 */
function requestFrame(callback: FrameCallback, fallbackDelayMs = 0): () => void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    const id = globalThis.requestAnimationFrame(callback);
    return () => globalThis.cancelAnimationFrame(id);
  }
  const handle = setTimeout(() => callback(performance.now()), fallbackDelayMs);
  return () => clearTimeout(handle);
}

/**
 * 下一帧执行一次，例如读布局、开始一段过渡。返回取消函数；
 * 不随组件卸载自动取消——组件里需要时在 onBeforeUnmount 里调用它。
 */
export function onNextFrame(callback: FrameCallback): () => void {
  return requestFrame(callback);
}

/** 等浏览器把当前改动画到屏幕上之后执行（两帧），例如初始样式生效后再触发过渡。返回取消函数。 */
export function onNextPaint(callback: FrameCallback): () => void {
  let cancelSecondFrame: (() => void) | undefined;
  const cancelFirstFrame = requestFrame(() => {
    cancelSecondFrame = requestFrame(callback);
  });
  return () => {
    cancelFirstFrame();
    cancelSecondFrame?.();
  };
}

/** `await nextFrame()`：等到下一帧。 */
export function nextFrame(): Promise<number> {
  return new Promise(resolve => {
    requestFrame(resolve);
  });
}

/** `await nextPaint()`：等到当前改动画到屏幕上之后。 */
export function nextPaint(): Promise<number> {
  return new Promise(resolve => {
    requestFrame(() => {
      requestFrame(resolve);
    });
  });
}

/** 组件外使用，由调用方在自己的收尾里 cancel；组件里用 useFrameBatch。 */
export function createFrameBatch(callback: FrameCallback): FrameBatch {
  let cancelFrame: (() => void) | undefined;

  function cancel(): void {
    cancelFrame?.();
    cancelFrame = undefined;
  }

  return {
    request() {
      if (cancelFrame) return;
      cancelFrame = requestFrame(timestamp => {
        cancelFrame = undefined;
        callback(timestamp);
      });
    },
    cancel,
    get pending() {
      return cancelFrame !== undefined;
    },
  };
}

/** 在组件 setup 里创建；卸载时自动取消。 */
export function useFrameBatch(callback: FrameCallback): FrameBatch {
  const batch = createFrameBatch(callback);
  return cancelOnScopeDispose(batch, () => batch.cancel());
}

/** 组件外使用，由调用方在自己的收尾里 stop；组件里用 useFrameLoop。 */
export function createFrameLoop(callback: (timestamp: number) => boolean | void): FrameLoop {
  let cancelFrame: (() => void) | undefined;

  function stop(): void {
    cancelFrame?.();
    cancelFrame = undefined;
  }

  function scheduleNext(): void {
    // 没有帧的环境按约 60Hz 推进，避免空转。
    cancelFrame = requestFrame(timestamp => {
      if (callback(timestamp) === false) {
        cancelFrame = undefined;
        return;
      }
      if (cancelFrame) scheduleNext();
    }, 16);
  }

  return {
    start() {
      if (cancelFrame) return;
      scheduleNext();
    },
    stop,
    get running() {
      return cancelFrame !== undefined;
    },
  };
}

/** 在组件 setup 里创建；卸载时自动停止。 */
export function useFrameLoop(callback: (timestamp: number) => boolean | void): FrameLoop {
  const loop = createFrameLoop(callback);
  return cancelOnScopeDispose(loop, () => loop.stop());
}
