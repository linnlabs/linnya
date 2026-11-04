import { afterEach, expect, it, vi } from 'vitest';
import { Sprite, Texture } from 'pixi.js';
import { CanvasCardIdSchema } from '../../../../../shared';
import { CanvasBitmapFades } from '../CanvasBitmapFades';
import type { CanvasBitmapLayer, CanvasBitmapRegion } from '../canvasBitmapResources';

const id = CanvasCardIdSchema.parse('c1');
function layer(): CanvasBitmapLayer {
  const bitmap: ImageBitmap = { width: 1, height: 1, close() {} }, frame = { x: 0, y: 0, width: 1, height: 1 };
  const region: CanvasBitmapRegion = { ...frame, scale: 1, sprite: new Sprite(Texture.EMPTY), texture: Texture.EMPTY,
    owner: { texture: Texture.EMPTY, bitmap, frame, references: 1 } };
  return { regions: [region], alpha: 1 };
}
afterEach(() => { vi.useRealTimers(); });
it('连续替换从当前混合权重接续，120ms结束后只释放退休层一次', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const release = vi.fn(), complete = vi.fn(), draw = vi.fn(), appeared = vi.fn(), fades = new CanvasBitmapFades({ resources: { release }, appeared, complete, requestDraw: draw });
  const first = layer(), second = layer(), third = layer();
  fades.start(id, first, second); expect(first.alpha).toBe(1); expect(second.alpha).toBe(0);
  expect(appeared).not.toHaveBeenCalled(); vi.advanceTimersByTime(7); expect(appeared).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(appeared).toHaveBeenCalledExactlyOnceWith(id);
  vi.advanceTimersByTime(56); expect(first.alpha).toBeCloseTo(1 - 64 / 120); expect(second.alpha).toBeCloseTo(64 / 120);
  const a = first.alpha, b = second.alpha;
  fades.start(id, second, third); expect(first.alpha).toBe(a); expect(second.alpha).toBe(b); expect(third.alpha).toBe(0);
  vi.advanceTimersByTime(64); expect(first.alpha).toBeCloseTo(a * (1 - 64 / 120)); expect(second.alpha).toBeCloseTo(b * (1 - 64 / 120));
  expect(appeared).toHaveBeenCalledTimes(2);
  expect(release).not.toHaveBeenCalled();
  vi.advanceTimersByTime(64);
  expect(third.alpha).toBe(1); expect(fades.readCount()).toBe(0); expect(complete).toHaveBeenCalledExactlyOnceWith(id);
  expect(release.mock.calls.flat()).toEqual([first.regions[0], second.regions[0]]); expect(vi.getTimerCount()).toBe(0); expect(draw).toHaveBeenCalled();
});
it('减少动效立即完成当前替换，取消只释放退休层，不把目标层二次释放', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const release = vi.fn(), complete = vi.fn(), fades = new CanvasBitmapFades({ resources: { release }, appeared: vi.fn(), complete, requestDraw() {} });
  const first = layer(), second = layer(); fades.start(id, first, second); vi.advanceTimersByTime(24); fades.setEnabled(false);
  expect(second.alpha).toBe(1); expect(release).toHaveBeenCalledExactlyOnceWith(first.regions[0]); expect(complete).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  fades.setEnabled(true); const third = layer(); fades.start(id, second, third); fades.cancel(id);
  expect(release).toHaveBeenLastCalledWith(second.regions[0]); expect(release).not.toHaveBeenCalledWith(third.regions[0]);
  expect(fades.readCount()).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
