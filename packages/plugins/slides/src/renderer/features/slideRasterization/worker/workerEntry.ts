import {
  createSlideRasterFailure,
  type SlideRasterErrorCode,
  type SlideRasterRequest,
  type SlideRasterResult,
  type SlideRasterWorkerBridge,
} from '@plugin/slides/shared/slideRasterization';
import { SlideRasterizationError } from '../definitions/slideRasterizationError';
import { assertSelfContainedRasterRequest } from '../functions/assertSelfContainedRasterRequest';
import { renderSlideRasterToPng } from '../orchestration/renderSlideRaster';

declare global {
  interface Window {
    __slidesRasterBridge: SlideRasterWorkerBridge;
  }
}

const SELF_CHECK_REQUEST: SlideRasterRequest = {
  requestId: 'slides-raster-self-check',
  slide: {
    slideId: 'self-check-slide',
    index: 0,
    layoutKey: 'blank',
    // ready 只能在当前 Paint + Konva 渐变映射真实完成 PNG 编码后发送。
    // 这能让旧 preload/browser worker 在 ready 阶段暴露，而不是把页面误报为 invalid_request。
    background: {
      paint: {
        type: 'linear',
        angle: 45,
        stops: [
          { color: '#FFFFFF', position: 0 },
          { color: '#2563EB', position: 1 },
        ],
      },
    },
    elements: [],
  },
  slideSize: { width: 1, height: 1, unit: 'in' },
  profile: {
    id: 'slides-raster-self-check-v1',
    viewportWidthPx: 2,
    viewportHeightPx: 2,
    pixelRatio: 1,
    format: 'png',
  },
};

const activeRasterRequests = new Map<string, AbortController>();

async function rasterizeWithSignal(
  request: SlideRasterRequest,
  signal: AbortSignal,
): Promise<SlideRasterResult> {
  try {
    signal.throwIfAborted();
    assertSelfContainedRasterRequest(request);
    return await renderSlideRasterToPng(request, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    const code = error instanceof SlideRasterizationError
      ? error.code
      : 'slides.raster.render_failed';
    console.warn('[slides-raster-worker] rasterization failed', {
      stage: 'render',
      code,
      detail: error instanceof Error ? error.message : String(error),
    });
    return createSlideRasterFailure(request.requestId, code, stableErrorMessage(code));
  }
}

async function rasterize(request: SlideRasterRequest): Promise<SlideRasterResult> {
  const abortController = new AbortController();
  activeRasterRequests.set(request.requestId, abortController);
  try {
    return await rasterizeWithSignal(request, abortController.signal);
  } finally {
    activeRasterRequests.delete(request.requestId);
  }
}

function cancelRasterization(requestId: string): void {
  activeRasterRequests.get(requestId)?.abort();
}

function stableErrorMessage(code: SlideRasterErrorCode): string {
  switch (code) {
    case 'slides.raster.invalid_request':
      return 'Slide raster request is invalid';
    case 'slides.raster.resource_load_failed':
      return 'Slide raster resources could not be loaded';
    case 'slides.raster.encode_failed':
      return 'Slide PNG encoding failed';
    case 'slides.raster.render_failed':
      return 'Slide rendering failed';
  }
}

async function bootstrap(): Promise<void> {
  const selfCheck = await rasterize(SELF_CHECK_REQUEST);
  if (selfCheck.status === 'failure') {
    throw new Error(`Slides raster worker self-check failed: ${selfCheck.error.code}`);
  }

  window.__slidesRasterBridge.setRasterHandler(rasterize);
  window.__slidesRasterBridge.setRasterCancelHandler(cancelRasterization);
  window.__slidesRasterBridge.notifyReady();
}

void bootstrap();
