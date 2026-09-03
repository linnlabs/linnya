import type { RenderSlideSize, SlideRenderModel } from '../types/render';

export interface ThumbnailBenchmarkSummary {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export interface ThumbnailRendererBenchmarkOptions {
  renderer: (
    slide: SlideRenderModel,
    slideSize: RenderSlideSize,
    thumbWidth: number,
  ) => Promise<unknown>;
  slides: readonly SlideRenderModel[];
  slideSize: RenderSlideSize;
  thumbWidth: number;
  iterations?: number;
}

export async function benchmarkThumbnailRenderer(
  options: ThumbnailRendererBenchmarkOptions,
): Promise<ThumbnailBenchmarkSummary> {
  const durations: number[] = [];
  const iterations = Math.max(options.iterations ?? 1, 1);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const slide of options.slides) {
      const startedAt = performance.now();
      await options.renderer(slide, options.slideSize, options.thumbWidth);
      durations.push(performance.now() - startedAt);
    }
  }

  return summarizeThumbnailBenchmark(durations);
}

export function summarizeThumbnailBenchmark(durations: readonly number[]): ThumbnailBenchmarkSummary {
  const count = durations.length;
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  return {
    count,
    totalMs,
    avgMs: count === 0 ? 0 : totalMs / count,
    maxMs: count === 0 ? 0 : Math.max(...durations),
  };
}
