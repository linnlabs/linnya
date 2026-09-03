import type { SlideRenderModel } from '../../../types/render';
import { logSlidesVerbose, warnSlides } from '../../../shared/diagnosticLogging';
import {
  RenderChartResourceError,
  type ChartResourceFailureMode,
  type LoadedRenderChart,
  type SlideChartResourceMap,
  type SlideChartResourceTarget,
} from '../definitions/renderChartResource';
import { collectSlideChartResourceTargets } from '../functions/collectSlideChartResourceTargets';
import {
  sharedRenderChartResourceRegistry,
  type RenderChartResourceRegistry,
} from './renderChartResourceRegistry';

export interface LoadSlideChartResourcesOptions {
  failureMode?: ChartResourceFailureMode;
  pixelRatio?: number;
  signal?: AbortSignal;
  registry?: RenderChartResourceRegistry;
}

export async function loadSlideChartResources(
  slide: SlideRenderModel,
  options: LoadSlideChartResourcesOptions = {},
): Promise<SlideChartResourceMap> {
  return await loadChartResourceTargets(
    collectSlideChartResourceTargets(slide),
    options,
  );
}

export async function loadChartResourceTargets(
  targets: readonly SlideChartResourceTarget[],
  options: LoadSlideChartResourcesOptions = {},
): Promise<SlideChartResourceMap> {
  options.signal?.throwIfAborted();
  const registry = options.registry ?? sharedRenderChartResourceRegistry;
  const pixelRatio = options.pixelRatio ?? resolveDefaultChartPixelRatio();
  const entries = await Promise.all(targets.map(target => loadTarget(
    target,
    registry,
    pixelRatio,
    options.failureMode ?? 'omit',
    options.signal,
  )));
  const charts = new Map<string, LoadedRenderChart>();
  for (const entry of entries) {
    if (entry) charts.set(entry.key, entry.chart);
  }
  return charts;
}

function resolveDefaultChartPixelRatio(): number {
  return typeof window === 'undefined' ? 2 : window.devicePixelRatio;
}

async function loadTarget(
  target: SlideChartResourceTarget,
  registry: RenderChartResourceRegistry,
  pixelRatio: number,
  failureMode: ChartResourceFailureMode,
  signal?: AbortSignal,
): Promise<{ key: string; chart: LoadedRenderChart } | null> {
  try {
    logSlidesVerbose('RenderChartResources', 'load target', {
      key: target.key,
      chartType: target.node.chartType,
      pixelRatio,
    });
    const chart = await registry.load(target.node, pixelRatio, signal);
    return { key: target.key, chart };
  } catch (error) {
    if (signal?.aborted) throw error;
    warnSlides('RenderChartResources', '页面图表资源加载失败', {
      key: target.key,
      chartType: target.node.chartType,
      pixelRatio,
      error,
    });
    if (failureMode === 'reject') throw new RenderChartResourceError(target.key);
    return null;
  }
}
