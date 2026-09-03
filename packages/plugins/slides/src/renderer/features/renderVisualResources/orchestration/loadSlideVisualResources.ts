import type { SlideRenderModel } from '../../../types/render';
import { loadSlideChartResources } from '../../renderChartResources';
import { loadSlideImageResources } from '../../renderImageResources';
import type { SlideVisualResources } from '../definitions/slideVisualResources';

export type VisualResourceFailureMode = 'omit' | 'reject';

export interface LoadSlideVisualResourcesOptions {
  failureMode?: VisualResourceFailureMode;
  chartPixelRatio?: number;
  signal?: AbortSignal;
}

/** 同时准备图片和图表；调用方只能消费完整结果，不能提前提交其中一类资源。 */
export async function loadSlideVisualResources(
  slide: SlideRenderModel,
  options: LoadSlideVisualResourcesOptions = {},
): Promise<SlideVisualResources> {
  const failureMode = options.failureMode ?? 'omit';
  const [imageResources, chartResources] = await Promise.all([
    loadSlideImageResources(slide, {
      failureMode,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
    loadSlideChartResources(slide, {
      failureMode,
      ...(options.chartPixelRatio !== undefined
        ? { pixelRatio: options.chartPixelRatio }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  ]);
  return { imageResources, chartResources };
}
