import type {
  BrushArtworkRenderRequest,
  BrushArtworkRenderResult,
} from './brushArtwork';

export const SLIDES_BRUSH_WORKER_ID = 'slides-brush';
export const SLIDES_BRUSH_WORKER_PROTOCOL_VERSION = 2 as const;
export const SLIDES_BRUSH_WORKER_REQUEST_CHANNEL = 'slides:brush-worker:request';
export const SLIDES_BRUSH_WORKER_RESPONSE_CHANNEL = 'slides:brush-worker:response';
export const SLIDES_BRUSH_WORKER_READY_CHANNEL = 'slides:brush-worker:ready';
export const SLIDES_BRUSH_WORKER_CANCEL_CHANNEL = 'slides:brush-worker:cancel';

export interface BrushArtworkWorkerRequestPayload {
  readonly requestId: string;
  readonly protocolVersion: typeof SLIDES_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly request: BrushArtworkRenderRequest;
}

export interface BrushArtworkWorkerResponsePayload {
  readonly requestId: string;
  readonly protocolVersion: typeof SLIDES_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly result: BrushArtworkRenderResult;
}

export interface BrushArtworkWorkerReadyPayload {
  readonly workerId: typeof SLIDES_BRUSH_WORKER_ID;
  readonly protocolVersion: typeof SLIDES_BRUSH_WORKER_PROTOCOL_VERSION;
}

export interface BrushArtworkWorkerCancelPayload {
  readonly requestId: string;
  readonly protocolVersion: typeof SLIDES_BRUSH_WORKER_PROTOCOL_VERSION;
}

export interface BrushArtworkWorkerBridge {
  setRenderHandler(
    handler: (
      request: BrushArtworkRenderRequest,
    ) => BrushArtworkRenderResult | Promise<BrushArtworkRenderResult>,
  ): void;
  setCancelHandler(handler: (requestId: string) => void): void;
  notifyReady(): void;
}
