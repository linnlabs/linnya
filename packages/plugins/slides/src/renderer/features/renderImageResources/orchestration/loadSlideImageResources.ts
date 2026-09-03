import type { SlideRenderModel } from '../../../types/render';
import {
  logSlidesVerbose,
  warnSlides,
} from '../../../shared/diagnosticLogging';
import {
  RenderImageResourceError,
  type ImageResourceFailureMode,
  type LoadedRenderImage,
  type SlideImageResourceMap,
  type SlideImageResourceTarget,
} from '../definitions/renderImageResource';
import { collectSlideImageResourceTargets } from '../functions/collectSlideImageResourceTargets';
import {
  sharedRenderImageResourceRegistry,
  type RenderImageResourceRegistry,
} from './renderImageResourceRegistry';
import { summarizeRenderableImageSource } from '../../../services/renderAssetSource';

export interface LoadSlideImageResourcesOptions {
  failureMode?: ImageResourceFailureMode;
  signal?: AbortSignal;
  registry?: RenderImageResourceRegistry;
}

export async function loadSlideImageResources(
  slide: SlideRenderModel,
  options: LoadSlideImageResourcesOptions = {},
): Promise<SlideImageResourceMap> {
  return await loadImageResourceTargets(
    collectSlideImageResourceTargets(slide),
    options,
  );
}

export async function loadImageResourceTargets(
  targets: readonly SlideImageResourceTarget[],
  options: LoadSlideImageResourcesOptions = {},
): Promise<SlideImageResourceMap> {
  options.signal?.throwIfAborted();
  const registry = options.registry ?? sharedRenderImageResourceRegistry;
  const entries = await Promise.all(targets.map(target => loadTarget(
    target,
    registry,
    options.failureMode ?? 'omit',
    options.signal,
  )));
  const images = new Map<string, LoadedRenderImage>();
  for (const entry of entries) {
    if (entry) {
      images.set(entry.key, entry.image);
    }
  }
  return images;
}

async function loadTarget(
  target: SlideImageResourceTarget,
  registry: RenderImageResourceRegistry,
  failureMode: ImageResourceFailureMode,
  signal?: AbortSignal,
): Promise<{ key: string; image: LoadedRenderImage } | null> {
  try {
    logSlidesVerbose('RenderImageResources', 'load target', {
      key: target.key,
      source: summarizeRenderableImageSource(target.source),
    });
    const image = await registry.load(target.source, signal);
    return { key: target.key, image };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    warnSlides('RenderImageResources', '页面图片资源加载失败', {
      key: target.key,
      source: summarizeRenderableImageSource(target.source),
      error,
    });
    if (failureMode === 'reject') {
      throw new RenderImageResourceError(target.key);
    }
    return null;
  }
}
