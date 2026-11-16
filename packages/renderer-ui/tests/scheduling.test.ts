import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import {
  createFrameBatch,
  createFrameLoop,
  createRepeatingTimer,
  createTimer,
  nextPaint,
  onNextFrame,
  onNextPaint,
  useFrameBatch,
  useFrameLoop,
  useRepeatingTimer,
  useTimer,
} from '@linnya/renderer-ui';

const FRAME_MS = 16;

function useFakeFrames(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
    setTimeout(() => callback(performance.now()), FRAME_MS) as unknown as number
  ));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    clearTimeout(id);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createTimer', () => {
  it('start 重新计时，只执行最后一次', () => {
    const timer = createTimer();
    const calls: string[] = [];

    timer.start(() => calls.push('first'), 100);
    vi.advanceTimersByTime(60);
    timer.start(() => calls.push('second'), 100);
    vi.advanceTimersByTime(60);
    expect(calls).toEqual([]);
    expect(timer.pending).toBe(true);

    vi.advanceTimersByTime(40);
    expect(calls).toEqual(['second']);
    expect(timer.pending).toBe(false);
  });

  it('startIfIdle 在等待中时保持原来的计时', () => {
    const timer = createTimer();
    const callback = vi.fn();

    timer.startIfIdle(callback, 100);
    vi.advanceTimersByTime(60);
    timer.startIfIdle(callback, 100);
    vi.advanceTimersByTime(40);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancel 后不再执行', () => {
    const timer = createTimer();
    const callback = vi.fn();

    timer.start(callback, 100);
    timer.cancel();
    vi.advanceTimersByTime(200);
    expect(callback).not.toHaveBeenCalled();
    expect(timer.pending).toBe(false);
  });

  it('useTimer 随组件 scope 销毁取消，createTimer 不绑定 scope', () => {
    const scope = effectScope();
    const bound = vi.fn();
    const unbound = vi.fn();
    const [useTimerInstance, createTimerInstance] = scope.run(() => [useTimer(), createTimer()] as const)!;

    useTimerInstance.start(bound, 100);
    createTimerInstance.start(unbound, 100);
    scope.stop();
    vi.advanceTimersByTime(200);
    expect(bound).not.toHaveBeenCalled();
    expect(unbound).toHaveBeenCalledTimes(1);
  });
});

describe('createRepeatingTimer', () => {
  it('按间隔重复执行，stop 或 scope 销毁后停止', () => {
    const scope = effectScope();
    const callback = vi.fn();
    const timer = scope.run(() => useRepeatingTimer())!;

    timer.start(callback, 50);
    vi.advanceTimersByTime(160);
    expect(callback).toHaveBeenCalledTimes(3);
    expect(timer.running).toBe(true);

    scope.stop();
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(3);
    expect(timer.running).toBe(false);
  });

  it('重新 start 会先停掉上一个间隔', () => {
    const timer = createRepeatingTimer();
    const first = vi.fn();
    const second = vi.fn();

    timer.start(first, 50);
    timer.start(second, 50);
    vi.advanceTimersByTime(50);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    timer.stop();
  });
});

describe('frames', () => {
  it('onNextFrame 下一帧执行，onNextPaint 两帧后执行', () => {
    useFakeFrames();
    const calls: string[] = [];

    onNextFrame(() => calls.push('frame'));
    onNextPaint(() => calls.push('paint'));
    vi.advanceTimersByTime(FRAME_MS);
    expect(calls).toEqual(['frame']);
    vi.advanceTimersByTime(FRAME_MS);
    expect(calls).toEqual(['frame', 'paint']);
  });

  it('返回的取消函数能取消；不随 scope 销毁取消', () => {
    useFakeFrames();
    const cancelled = vi.fn();
    const kept = vi.fn();
    const scope = effectScope();

    const cancel = onNextPaint(cancelled);
    scope.run(() => onNextFrame(kept));
    vi.advanceTimersByTime(FRAME_MS / 2);
    cancel();
    scope.stop();
    vi.advanceTimersByTime(FRAME_MS * 3);
    expect(cancelled).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('nextPaint 在两帧后完成', async () => {
    useFakeFrames();
    let settled = false;
    void nextPaint().then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(settled).toBe(true);
  });

  it('没有 requestAnimationFrame 时用定时器代替', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const callback = vi.fn();

    onNextFrame(callback);
    vi.advanceTimersByTime(0);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('createFrameBatch', () => {
  it('同一帧里的多次请求只执行一次，执行后可以再次请求', () => {
    useFakeFrames();
    const callback = vi.fn();
    const batch = createFrameBatch(callback);

    batch.request();
    batch.request();
    batch.request();
    expect(batch.pending).toBe(true);
    vi.advanceTimersByTime(FRAME_MS);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(batch.pending).toBe(false);

    batch.request();
    vi.advanceTimersByTime(FRAME_MS);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('cancel 和 useFrameBatch 的 scope 销毁都取消还没执行的那一帧', () => {
    useFakeFrames();
    const callback = vi.fn();
    const batch = createFrameBatch(callback);
    const scope = effectScope();
    const boundBatch = scope.run(() => useFrameBatch(callback))!;

    batch.request();
    boundBatch.request();
    batch.cancel();
    scope.stop();
    vi.advanceTimersByTime(FRAME_MS * 2);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('createFrameLoop', () => {
  it('每帧执行直到 stop', () => {
    useFakeFrames();
    const callback = vi.fn();
    const loop = createFrameLoop(callback);

    loop.start();
    loop.start();
    vi.advanceTimersByTime(FRAME_MS * 3);
    expect(callback).toHaveBeenCalledTimes(3);

    loop.stop();
    vi.advanceTimersByTime(FRAME_MS * 3);
    expect(callback).toHaveBeenCalledTimes(3);
    expect(loop.running).toBe(false);
  });

  it('callback 返回 false 时自动停止', () => {
    useFakeFrames();
    let frames = 0;
    const loop = createFrameLoop(() => {
      frames += 1;
      return frames < 2;
    });

    loop.start();
    vi.advanceTimersByTime(FRAME_MS * 5);
    expect(frames).toBe(2);
    expect(loop.running).toBe(false);
  });

  it('在 scope 里创建时随 scope 销毁停止', () => {
    useFakeFrames();
    const callback = vi.fn();
    const scope = effectScope();
    const loop = scope.run(() => useFrameLoop(callback))!;

    loop.start();
    vi.advanceTimersByTime(FRAME_MS);
    scope.stop();
    vi.advanceTimersByTime(FRAME_MS * 3);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
