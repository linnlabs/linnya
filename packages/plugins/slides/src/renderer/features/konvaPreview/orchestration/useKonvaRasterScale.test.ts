// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { useKonvaRasterScale } from './useKonvaRasterScale';

describe('useKonvaRasterScale', () => {
  it('commits raster scale immediately with max-scale clamping', () => {
    const controller = useKonvaRasterScale({
      maxRasterScale: 2,
      settleDelayMs: 120,
    });

    controller.commitKonvaRasterScale(3);

    expect(controller.konvaRasterScale.value).toBe(2);
  });

  it('schedules the latest raster scale and cancels stale pending commits', () => {
    vi.useFakeTimers();
    try {
      const controller = useKonvaRasterScale({
        maxRasterScale: 2,
        settleDelayMs: 120,
      });

      controller.scheduleKonvaRasterScaleCommit(1.5);
      controller.scheduleKonvaRasterScaleCommit(1.75);
      vi.advanceTimersByTime(119);

      expect(controller.konvaRasterScale.value).toBe(1);

      vi.advanceTimersByTime(1);

      expect(controller.konvaRasterScale.value).toBe(1.75);
    } finally {
      vi.useRealTimers();
    }
  });
});
