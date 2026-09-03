import { contextBridge, ipcRenderer } from 'electron';
import {
  SLIDES_RASTER_WORKER_READY_CHANNEL,
  SLIDES_RASTER_WORKER_REQUEST_CHANNEL,
  SLIDES_RASTER_WORKER_RESPONSE_CHANNEL,
  SLIDES_RASTER_WORKER_CANCEL_CHANNEL,
  createSlideRasterFailure,
  createSlideRasterWorkerReadyPayload,
  createSlideRasterWorkerResponsePayload,
  extractSlideRasterRequestId,
  parseSlideRasterWorkerRequestPayload,
  parseSlideRasterWorkerCancelPayload,
  SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  type SlideRasterRequest,
  type SlideRasterResult,
  type SlideRasterWorkerBridge,
} from '@plugin/slides/shared/slideRasterization';

type RasterHandler = (
  request: SlideRasterRequest,
) => SlideRasterResult | Promise<SlideRasterResult>;
type RasterCancelHandler = (requestId: string) => void;

let handler: RasterHandler | null = null;
let cancelHandler: RasterCancelHandler | null = null;
const activeRequestIds = new Set<string>();
const cancelledRequestIds = new Set<string>();

ipcRenderer.on(SLIDES_RASTER_WORKER_CANCEL_CHANNEL, (_event, payload: unknown) => {
  let requestId: string;
  try {
    requestId = parseSlideRasterWorkerCancelPayload(payload).requestId;
  } catch {
    return;
  }
  if (!activeRequestIds.has(requestId)) {
    return;
  }
  cancelledRequestIds.add(requestId);
  cancelHandler?.(requestId);
});

ipcRenderer.on(SLIDES_RASTER_WORKER_REQUEST_CHANNEL, async (_event, payload: unknown) => {
  const fallbackRequestId = extractSlideRasterRequestId(payload);
  let request: SlideRasterRequest;
  try {
    request = parseSlideRasterWorkerRequestPayload(payload).request;
  } catch {
    console.warn(
      '[slides-raster-worker]'
      + ` stage=preload-admission protocol=${SLIDES_RASTER_WORKER_PROTOCOL_VERSION}`
      + ' outcome=rejected',
    );
    if (fallbackRequestId) {
      sendResult(createSlideRasterFailure(
        fallbackRequestId,
        'slides.raster.invalid_request',
        'Slide raster request is invalid',
      ));
    }
    return;
  }

  if (!handler) {
    sendResult(createSlideRasterFailure(
      request.requestId,
      'slides.raster.render_failed',
      'Slide raster worker is not ready',
    ));
    return;
  }

  activeRequestIds.add(request.requestId);
  try {
    const result = await handler(request);
    if (!cancelledRequestIds.has(request.requestId)) sendResult(result);
  } catch {
    if (!cancelledRequestIds.has(request.requestId)) {
      console.warn(
        '[slides-raster-worker]'
        + ` stage=renderer-callback protocol=${SLIDES_RASTER_WORKER_PROTOCOL_VERSION}`
        + ' outcome=failed',
      );
      sendResult(createSlideRasterFailure(
        request.requestId,
        'slides.raster.render_failed',
        'Slide rendering failed',
      ));
    }
  } finally {
    activeRequestIds.delete(request.requestId);
    cancelledRequestIds.delete(request.requestId);
  }
});

function sendResult(result: SlideRasterResult): void {
  ipcRenderer.send(
    SLIDES_RASTER_WORKER_RESPONSE_CHANNEL,
    createSlideRasterWorkerResponsePayload(result),
  );
}

const bridge: SlideRasterWorkerBridge = {
  setRasterHandler(nextHandler) {
    handler = nextHandler;
  },
  setRasterCancelHandler(nextHandler) {
    cancelHandler = nextHandler;
  },
  notifyReady() {
    ipcRenderer.send(
      SLIDES_RASTER_WORKER_READY_CHANNEL,
      createSlideRasterWorkerReadyPayload(),
    );
  },
};

contextBridge.exposeInMainWorld('__slidesRasterBridge', bridge);
