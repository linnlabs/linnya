import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCardSchema } from '../../shared';
import { createCanvasRasterCadence } from '../functions/createCanvasRasterCadence';
import { prioritizeCanvasRasterCards } from '../functions/prioritizeCanvasRasterCards';
afterEach(() => { vi.useRealTimers(); });
it('缩放中每50ms重排，超过1500张或降级时暂停补图，停手后恢复正常批次', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const refresh = vi.fn(), cadence = createCanvasRasterCadence(refresh), camera = { x: 0, y: 0, zoom: 1 };
  cadence.observe(camera, 2); expect(cadence.moving()).toBe(false); expect(cadence.reorder()).toBe(true);
  vi.advanceTimersByTime(10); cadence.observe({ ...camera, zoom: 1.1 }, 2);
  expect(cadence.moving()).toBe(true); expect(cadence.paused(1500, false)).toBe(false);
  expect(cadence.paused(1501, false)).toBe(true); expect(cadence.paused(1, true)).toBe(true); expect(cadence.reorder()).toBe(false);
  vi.advanceTimersByTime(40); expect(refresh).toHaveBeenCalledOnce(); expect(cadence.reorder()).toBe(true);
  vi.advanceTimersByTime(60); expect(cadence.moving()).toBe(false); expect(cadence.paused(1501, true)).toBe(false);
  cadence.move(); expect(cadence.moving()).toBe(true); cadence.dispose(); expect(vi.getTimerCount()).toBe(0);
});
it('小面积指针附近正文优先于远处大卡，遮挡外框不抢优先级', () => {
  const source = { kind: 'user', conversationId: null, runId: null };
  const card = (id: string, x: number, width: number) => CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    x, y: 0, width, height: 100, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
  const far = card('c1', 1000, 400), near = card('c2', 0, 80);
  const ranked = prioritizeCanvasRasterCards([far, near], id => [{ x: 0, y: 0, width: id === far.id ? 400 : 80, height: 100 }], { x: 30, y: 30 });
  expect(ranked.get(near.id)).toBeLessThan(ranked.get(far.id) ?? Infinity);
});
