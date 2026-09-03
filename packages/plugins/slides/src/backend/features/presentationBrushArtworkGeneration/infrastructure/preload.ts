import { contextBridge, ipcRenderer } from 'electron';
import {
  SLIDES_BRUSH_WORKER_CANCEL_CHANNEL,
  SLIDES_BRUSH_WORKER_READY_CHANNEL,
  SLIDES_BRUSH_WORKER_REQUEST_CHANNEL,
  SLIDES_BRUSH_WORKER_RESPONSE_CHANNEL,
  createBrushArtworkRenderFailure,
  createBrushArtworkWorkerReadyPayload,
  createBrushArtworkWorkerResponsePayload,
  extractBrushArtworkRequestId,
  parseBrushArtworkWorkerCancelPayload,
  parseBrushArtworkWorkerRequestPayload,
  type BrushArtworkRenderRequest,
  type BrushArtworkRenderResult,
  type BrushArtworkWorkerBridge,
} from '@plugin/slides/shared/brushArtwork';

type RenderHandler = (
  request: BrushArtworkRenderRequest,
) => BrushArtworkRenderResult | Promise<BrushArtworkRenderResult>;

let renderHandler: RenderHandler | null = null;
let cancelHandler: ((requestId: string) => void) | null = null;
const activeRequestIds = new Set<string>();
const cancelledRequestIds = new Set<string>();

ipcRenderer.on(SLIDES_BRUSH_WORKER_CANCEL_CHANNEL, (_event, payload: unknown) => {
  let requestId: string;
  try {
    requestId = parseBrushArtworkWorkerCancelPayload(payload).requestId;
  } catch {
    return;
  }
  if (!activeRequestIds.has(requestId)) return;
  cancelledRequestIds.add(requestId);
  cancelHandler?.(requestId);
});

ipcRenderer.on(SLIDES_BRUSH_WORKER_REQUEST_CHANNEL, async (_event, payload: unknown) => {
  const fallbackRequestId = extractBrushArtworkRequestId(payload);
  let request: BrushArtworkRenderRequest;
  try {
    request = parseBrushArtworkWorkerRequestPayload(payload).request;
  } catch {
    if (fallbackRequestId) {
      send(createBrushArtworkRenderFailure(
        fallbackRequestId,
        'slides.brush.invalid_request',
        'Brush artwork request is invalid.',
      ));
    }
    return;
  }
  if (!renderHandler) {
    send(createBrushArtworkRenderFailure(
      request.requestId,
      'slides.brush.runtime_unavailable',
      'Brush artwork worker is not ready.',
    ));
    return;
  }
  activeRequestIds.add(request.requestId);
  try {
    const result = await renderHandler(request);
    if (!cancelledRequestIds.has(request.requestId)) send(result);
  } catch {
    if (!cancelledRequestIds.has(request.requestId)) {
      send(createBrushArtworkRenderFailure(
        request.requestId,
        'slides.brush.render_failed',
        'Brush artwork rendering failed.',
      ));
    }
  } finally {
    activeRequestIds.delete(request.requestId);
    cancelledRequestIds.delete(request.requestId);
  }
});

function send(result: BrushArtworkRenderResult): void {
  ipcRenderer.send(
    SLIDES_BRUSH_WORKER_RESPONSE_CHANNEL,
    createBrushArtworkWorkerResponsePayload(result),
  );
}

const bridge: BrushArtworkWorkerBridge = {
  setRenderHandler(handler) {
    renderHandler = handler;
  },
  setCancelHandler(handler) {
    cancelHandler = handler;
  },
  notifyReady() {
    ipcRenderer.send(SLIDES_BRUSH_WORKER_READY_CHANNEL, createBrushArtworkWorkerReadyPayload());
  },
};

contextBridge.exposeInMainWorld('__slidesBrushBridge', bridge);
