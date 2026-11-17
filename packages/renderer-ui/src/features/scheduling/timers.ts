import { cancelOnScopeDispose } from './scope';

/** 一次性的延迟执行：延迟、防抖、节流、自动关闭、悬停意图。 */
export interface Timer {
  /** delayMs 毫秒后执行 callback；还在等待的上一次会被取消，相当于重新计时。 */
  start(callback: () => void, delayMs: number): void;
  /** 没有等待中的那次时才开始计时；已经在等就不变，用来做“最多每隔多久一次”。 */
  startIfIdle(callback: () => void, delayMs: number): void;
  /** 取消等待中的那次。 */
  cancel(): void;
  /** 是否有一次在等待执行。 */
  readonly pending: boolean;
}

/** 按固定间隔重复执行：轮询、时钟。 */
export interface RepeatingTimer {
  /** 每隔 intervalMs 毫秒执行一次 callback；已在运行的会先停掉。 */
  start(callback: () => void, intervalMs: number): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * 组件外使用，由调用方在自己的收尾里 cancel；组件里用 useTimer。
 * 不要用它把某段逻辑“推迟一下”来避开时序问题——先找到状态真正就绪的信号。
 */
export function createTimer(): Timer {
  let handle: ReturnType<typeof setTimeout> | undefined;

  function cancel(): void {
    if (handle === undefined) return;
    clearTimeout(handle);
    handle = undefined;
  }

  function start(callback: () => void, delayMs: number): void {
    cancel();
    handle = setTimeout(() => {
      handle = undefined;
      callback();
    }, delayMs);
  }

  return {
    start,
    startIfIdle(callback, delayMs) {
      if (handle === undefined) start(callback, delayMs);
    },
    cancel,
    get pending() {
      return handle !== undefined;
    },
  };
}

/** 在组件 setup 里创建一次，在事件里 start / cancel；卸载时自动取消。 */
export function useTimer(): Timer {
  const timer = createTimer();
  return cancelOnScopeDispose(timer, () => timer.cancel());
}

/** 组件外使用，由调用方在自己的收尾里 stop；组件里用 useRepeatingTimer。 */
export function createRepeatingTimer(): RepeatingTimer {
  let handle: ReturnType<typeof setInterval> | undefined;

  function stop(): void {
    if (handle === undefined) return;
    clearInterval(handle);
    handle = undefined;
  }

  return {
    start(callback, intervalMs) {
      stop();
      handle = setInterval(callback, intervalMs);
    },
    stop,
    get running() {
      return handle !== undefined;
    },
  };
}

/** 在组件 setup 里创建；卸载时自动停止。 */
export function useRepeatingTimer(): RepeatingTimer {
  const timer = createRepeatingTimer();
  return cancelOnScopeDispose(timer, () => timer.stop());
}
