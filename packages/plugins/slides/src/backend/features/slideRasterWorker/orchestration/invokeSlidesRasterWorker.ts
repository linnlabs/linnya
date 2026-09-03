import { invokeHiddenWorker } from '@plugin/backend/hiddenWorkerRuntime';
import {
  SLIDES_RASTER_WORKER_ID,
  parseSlideRasterResult,
  type SlideRasterRequest,
  type SlideRasterResult,
} from '@plugin/slides/shared/slideRasterization';

export async function invokeSlidesRasterWorker(
  request: SlideRasterRequest,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SlideRasterResult> {
  const response = await invokeHiddenWorker(
    SLIDES_RASTER_WORKER_ID,
    request,
    options.signal ? { signal: options.signal } : undefined,
  );
  return parseSlideRasterResult(response);
}
