import type {
  SlideRasterErrorCode,
  SlideRasterFailure,
  SlideRasterRequest,
  SlideRasterResult,
} from './slideRasterization';

export const SLIDES_RASTER_WORKER_ID = 'slides-raster';
// v3 增加 transparentBackground，供原子 SVG fallback 保留 alpha。
// 旧 preload 必须在 ready 阶段失败，不能把当前请求误报为 invalid_request。
export const SLIDES_RASTER_WORKER_PROTOCOL_VERSION = 3 as const;
export const SLIDES_RASTER_WORKER_REQUEST_CHANNEL = 'slides:raster-worker:request';
export const SLIDES_RASTER_WORKER_RESPONSE_CHANNEL = 'slides:raster-worker:response';
export const SLIDES_RASTER_WORKER_READY_CHANNEL = 'slides:raster-worker:ready';
export const SLIDES_RASTER_WORKER_CANCEL_CHANNEL = 'slides:raster-worker:cancel';

export interface SlideRasterWorkerRequestPayload {
  requestId: string;
  protocolVersion: typeof SLIDES_RASTER_WORKER_PROTOCOL_VERSION;
  request: SlideRasterRequest;
}

export interface SlideRasterWorkerResponsePayload {
  requestId: string;
  protocolVersion: typeof SLIDES_RASTER_WORKER_PROTOCOL_VERSION;
  result: SlideRasterResult;
}

export interface SlideRasterWorkerReadyPayload {
  workerId: typeof SLIDES_RASTER_WORKER_ID;
  protocolVersion: typeof SLIDES_RASTER_WORKER_PROTOCOL_VERSION;
}

export interface SlideRasterWorkerCancelPayload {
  requestId: string;
  protocolVersion: typeof SLIDES_RASTER_WORKER_PROTOCOL_VERSION;
}

export interface SlideRasterWorkerBridge {
  setRasterHandler(
    handler: (
      request: SlideRasterRequest,
    ) => SlideRasterResult | Promise<SlideRasterResult>,
  ): void;
  /** 跨 contextBridge 只传稳定 requestId；AbortController 必须由 renderer 自己持有。 */
  setRasterCancelHandler(handler: (requestId: string) => void): void;
  notifyReady(): void;
}

export function createSlideRasterFailure(
  requestId: string,
  code: SlideRasterErrorCode,
  message: string,
): SlideRasterFailure {
  return {
    status: 'failure',
    requestId,
    error: { code, message },
  };
}
