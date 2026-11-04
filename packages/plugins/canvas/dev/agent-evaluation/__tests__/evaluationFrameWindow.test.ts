import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasEvaluationFrameMetrics } from '../createCanvasEvaluationFrameMetrics';

function frameClock() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let now = 0, id = 0;
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
  vi.stubGlobal('performance', { timeOrigin: 1000, now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (value: number) => { callbacks.delete(value); });
  return {
    advance(time: number) {
      now = time;
      const pending = [...callbacks]; callbacks.clear();
      for (const [, callback] of pending) callback(time);
    },
    pending: () => callbacks.size,
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

it('显式工作窗保留跨提交起点的长帧，不混入之后模型等待的空闲帧', () => {
  const clock = frameClock(), frames = createCanvasEvaluationFrameMetrics();
  for (const at of [100, 205, 213, 221, 229, 237, 10000, 10008]) clock.advance(at);
  const window = frames.readWindow(1105, 1230);
  expect(window).toMatchObject({ retentionComplete: true, sampleCount: 5, worstFrameMs: 105,
    boundarySamples: [{ at: 1205, interval: 105 }, { at: 1237, interval: 8 }], contained: { sampleCount: 3, worstFrameMs: 8 } });
  expect(window.samples.map(sample => sample.at)).toEqual([1205, 1213, 1221, 1229, 1237]);
  frames.dispose(); expect(clock.pending()).toBe(0);
});

it('未采到终点、ring覆盖丢失及生命周期重置都明确不完整，空窗不填FPS', () => {
  const clock = frameClock(), frames = createCanvasEvaluationFrameMetrics();
  clock.advance(0); clock.advance(8);
  expect(frames.readWindow(1000, 1010)).toMatchObject({ retentionComplete: false });
  clock.advance(16);
  expect(frames.readWindow(1000, 1010)).toMatchObject({ retentionComplete: true });
  for (let at = 24; at <= 32800; at += 8) clock.advance(at);
  expect(frames.readWindow(1000, 1010)).toMatchObject({ retentionComplete: false, sampleCount: 0, averageFps: null, frameP95Ms: null, worstFrameMs: null });
  frames.reset();
  expect(frames.readWindow(33700, 33800)).toMatchObject({ retentionComplete: false, sampleCount: 0 });
  frames.dispose(); expect(clock.pending()).toBe(0);
});
