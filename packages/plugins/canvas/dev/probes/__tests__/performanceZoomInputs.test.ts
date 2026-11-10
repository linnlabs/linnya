// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { performance as clock } from 'node:perf_hooks';
import { createCanvasZoomTimeline } from '../performanceZoomTimeline';

const readState = () => ({ renders: 1, rasterCards: 36, bitmaps: 2500, bitmapBytes: 100, fadingCards: 0,
  pending: 2, running: true, completed: 4, activeImages: 0, activePreviews: 0, activeReferences: 0,
  camera: { x: 30, y: 30, zoom: 0.9 }, viewportCards: 36, identityBytes: 0, requestedTiles: 6, requestedPixels: 200, discarded: 0 });
beforeEach(() => { vi.stubGlobal('performance', clock); });
afterEach(() => { clock.clearMarks(); vi.unstubAllGlobals(); });

it('records actual received wheel times and same-frame demand, then removes its opt-in listener', () => {
  const trace = createCanvasZoomTimeline(readState, 'zoom', true);
  const event = new WheelEvent('wheel', { deltaY: -5, clientX: 800, clientY: 480, ctrlKey: true });
  document.dispatchEvent(event); trace.frame(performance.now());
  const result = trace.finish();
  expect(result.wheelInputs).toHaveLength(1);
  expect(result.wheelInputs?.[0]).toMatchObject({ timestamp: event.timeStamp, deltaY: -5, x: 800, y: 480, control: true });
  expect(result.wheelInputs?.[0].receivedAt).toBeGreaterThanOrEqual(result.startedAt);
  expect(result.frames[0].state).toMatchObject({ camera: { zoom: 0.9 }, viewportCards: 36, requestedTiles: 6 });
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: 5 }));
  expect(result.wheelInputs).toHaveLength(1);
});

it('preserves the ordinary zoom trace shape without collecting wheel input', () => {
  const trace = createCanvasZoomTimeline(readState);
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: -5 }));
  expect(trace.finish()).not.toHaveProperty('wheelInputs');
});
