import { describe, expect, it, vi } from 'vitest';
import {
  benchmarkThumbnailRenderer,
  summarizeThumbnailBenchmark,
} from './thumbnailRendererPerf';

describe('thumbnailRendererPerf', () => {
  it('summarizes renderer timings with avg and max values', () => {
    expect(summarizeThumbnailBenchmark([5, 15, 10])).toEqual({
      count: 3,
      totalMs: 30,
      avgMs: 10,
      maxMs: 15,
    });
  });

  it('benchmarks a renderer across all slides and iterations', async () => {
    const renderer = vi.fn(async () => undefined);
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(9)
      .mockReturnValueOnce(9)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(20);

    const result = await benchmarkThumbnailRenderer({
      renderer,
      slides: [{ slideId: 's1' }, { slideId: 's2' }],
      slideSize: { width: 10, height: 5.625, unit: 'in' },
      thumbWidth: 158,
      iterations: 2,
    });

    expect(renderer).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      count: 4,
      totalMs: 20,
      avgMs: 5,
      maxMs: 8,
    });

    now.mockRestore();
  });
});
