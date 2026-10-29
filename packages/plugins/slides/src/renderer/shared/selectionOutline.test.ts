import { describe, expect, it } from 'vitest';
import { createSelectionOutlineGrid } from './selectionOutline';

describe('createSelectionOutlineGrid', () => {
  it('keeps every outline one screen pixel wide at any zoom', () => {
    for (const scale of [0.5, 1, 2.5]) {
      for (const dpr of [1, 2]) {
        const grid = createSelectionOutlineGrid(scale, dpr);
        expect(grid.strokeWidth * scale * dpr).toBeCloseTo(Math.round(dpr));
        expect(grid.dash.map(length => length * scale)).toEqual([4, 3]);
      }
    }
  });

  it('puts every edge on the same device-pixel phase so all four sides render alike', () => {
    for (const [scale, dpr] of [[0.83, 2], [1.37, 1], [1, 2]] as const) {
      const grid = createSelectionOutlineGrid(scale, dpr);
      const width = Math.round(dpr);
      for (const value of [10.13, 57.5, 311.92, 640.004]) {
        const device = grid.snap(value) * scale * dpr;
        // 线带的左边缘必须落在整数设备像素上。
        expect(Math.abs(device - width / 2 - Math.round(device - width / 2))).toBeLessThan(1e-6);
        expect(Math.abs(grid.snap(value) - value) * scale * dpr).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });
});
