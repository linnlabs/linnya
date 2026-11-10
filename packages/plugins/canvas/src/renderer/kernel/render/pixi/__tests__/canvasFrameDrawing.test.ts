// @vitest-environment jsdom
import { Application } from 'pixi.js';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasFrameDrawing } from '../CanvasFrameDrawing';

// 原生 GPU 的像素与吞吐由 Electron probe 负责；这里只替换图形端口，验证时序和取消。
vi.mock('../CanvasIdentityAtlas', () => ({
  CanvasIdentityAtlasCapacityError: class extends Error {},
}));
vi.mock('pixi.js', () => {
  return {
    Rectangle: class {
      constructor(
        readonly x: number,
        readonly y: number,
        readonly width: number,
        readonly height: number
      ) {}
    },
    Application: class {
      readonly canvas = document.createElement('canvas');
      readonly stage = {};
      readonly renderer = {
        resolution: 2,
        extract: { base64: vi.fn(async () => 'data:image/png;base64,test') },
      };
      readonly render = vi.fn();
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('缺失身份牌先在独立任务准备，纯绘制帧只消费结果；销毁取消待办', () => {
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0,
    pending = true;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const app = new Application();
  const flush = vi.fn(() => {
    pending = false;
  });
  const drawing = new CanvasFrameDrawing(app, {
    readIdentities: () => ({ needsPreparation: () => pending, flush }),
    readCaptureFrame: () => ({ width: 100, height: 80, background: 0xf2f3ee }),
    software: false,
    restored() {},
  });
  drawing.schedule();
  drawing.schedule();
  expect(flush).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  vi.runOnlyPendingTimers();
  expect(flush).toHaveBeenCalledOnce();
  expect(flush).toHaveBeenCalledWith(2);
  expect(frames.size).toBe(1);
  expect(app.render).not.toHaveBeenCalled();
  const frame = frames.get(1);
  frames.delete(1);
  frame?.(10);
  expect(app.render).toHaveBeenCalledOnce();
  expect(drawing.readRenderCount()).toBe(1);
  expect(flush).toHaveBeenCalledOnce();
  drawing.schedule();
  drawing.stop();
  const remove = vi.fn();
  drawing.dispose(remove);
  expect(frames.size).toBe(0);
  expect(remove).toHaveBeenCalledOnce();
  pending = true;
  drawing.schedule();
  vi.runOnlyPendingTimers();
  expect(flush).toHaveBeenCalledOnce();
});

it('出图在准备后读取当前尺寸，出图期间丢失并恢复的上下文仍使该次出图失败', async () => {
  const app = new Application();
  let size = 80;
  let finish: (value: string) => void = () => {
    throw new Error('capture_not_started');
  };
  const capture = vi.spyOn(app.renderer.extract, 'base64').mockImplementation(
    () =>
      new Promise<string>(resolve => {
        finish = resolve;
      })
  );
  const restored = vi.fn();
  const drawing = new CanvasFrameDrawing(app, {
    readIdentities: () => ({
      needsPreparation: () => false,
      flush: () => {
        size = 120;
      },
    }),
    readCaptureFrame: () => ({ width: size, height: 60, background: 0x222723 }),
    software: false,
    restored,
  });
  const result = drawing.captureImage('jpeg', 0.8);
  expect(capture).toHaveBeenCalledWith(
    expect.objectContaining({
      frame: expect.objectContaining({ width: 120, height: 60 }),
      format: 'jpg',
      clearColor: '#222723',
    })
  );
  app.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  app.canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(restored).toHaveBeenCalledOnce();
  finish('data:image/jpeg;base64,old');
  await expect(result).rejects.toThrow('canvas_graphics_context_lost');
  drawing.stop();
  drawing.dispose(() => {});
});

it('改画布尺寸当场出帧：取消已排的动画帧，身份牌待准备时仍走分帧准备', () => {
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0,
    pending = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const app = new Application();
  const drawing = new CanvasFrameDrawing(app, {
    readIdentities: () => ({ needsPreparation: () => pending, flush: () => undefined }),
    readCaptureFrame: () => ({ width: 100, height: 80, background: 0xf2f3ee }),
    software: false,
    restored() {},
  });
  drawing.schedule();
  expect(frames.size).toBe(1);
  drawing.drawNow();
  expect(app.render).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  drawing.schedule();
  expect(frames.size).toBe(1);
  pending = true;
  drawing.drawNow();
  expect(app.render).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(1);
});
