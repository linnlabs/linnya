import { describe, expect, it } from 'vitest';
import { snapCanvasTranslation } from './snapCanvasTranslation';

describe('snapCanvasTranslation', () => {
  it('draws a guide between the moving object and the peer it aligns with, and across the slide for slide anchors', () => {
    const result = snapCanvasTranslation({
      bounds: { x: 1, y: 3, w: 0.8, h: 1 }, peers: [{ x: 4.02, y: 0.5, w: 1, h: 1 }],
      slideSize: { width: 10, height: 5.625 }, delta: { dx: 3, dy: 0 }, renderScale: 1, disabled: false, axisLock: false,
    });
    expect(result.delta.dx).toBeCloseTo(3.02);
    expect(result.guides).toEqual([{ axis: 'x', position: 4.02, from: 0.5, to: 4 }]);

    const centered = snapCanvasTranslation({
      bounds: { x: 4.48, y: 1.3, w: 1, h: 1 }, peers: [], slideSize: { width: 10, height: 5.625 },
      delta: { dx: 0, dy: 0 }, renderScale: 1, disabled: false, axisLock: false,
    });
    expect(centered.guides).toEqual([{ axis: 'x', position: 5, from: 0, to: 5.625 }]);
  });
});
