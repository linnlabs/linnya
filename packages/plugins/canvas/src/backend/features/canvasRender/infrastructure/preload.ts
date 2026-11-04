import { contextBridge, ipcRenderer, webFrame } from 'electron';
import {
  CANVAS_RENDER_CHANNELS, CANVAS_RENDER_PROTOCOL, CanvasWorkerRequestSchema, CanvasWorkerResponseSchema,
  CanvasWorkerCancelSchema, type CanvasRenderBridge, type CanvasWorkerResult,
} from '../../../../shared/rendering';

let handler: Parameters<CanvasRenderBridge['setHandler']>[0] | null = null;
let cancel: Parameters<CanvasRenderBridge['setCancelHandler']>[0] | null = null;
const active = new Set<string>();
const cancelled = new Set<string>();
function send(result: CanvasWorkerResult): void {
  ipcRenderer.send(CANVAS_RENDER_CHANNELS.response, CanvasWorkerResponseSchema.parse({ protocol: CANVAS_RENDER_PROTOCOL, requestId: result.requestId, result }));
}
function failure(requestId: string, code: 'invalid_request' | 'render_failed', message: string): void {
  send({ status: 'failure', requestId, code, message });
}
ipcRenderer.on(CANVAS_RENDER_CHANNELS.cancel, (_event, value: unknown) => {
  const parsed = CanvasWorkerCancelSchema.safeParse(value);
  if (!parsed.success || !active.has(parsed.data.requestId)) return;
  cancelled.add(parsed.data.requestId);
  cancel?.(parsed.data.requestId);
});
ipcRenderer.on(CANVAS_RENDER_CHANNELS.request, async (_event, value: unknown) => {
  const parsed = CanvasWorkerRequestSchema.safeParse(value);
  if (!parsed.success) {
    if (typeof value === 'object' && value !== null) {
      const requestId: unknown = Reflect.get(value, 'requestId');
      if (typeof requestId === 'string' && requestId) failure(requestId, 'invalid_request', 'Canvas render request is invalid');
    }
    return;
  }
  const request = parsed.data;
  if (!handler || active.has(request.requestId)) {
    failure(request.requestId, 'invalid_request', 'Canvas worker is not ready or request is already active');
    return;
  }
  active.add(request.requestId);
  try {
    const result = await handler(request);
    if (!cancelled.has(request.requestId)) send(result);
  } catch {
    if (!cancelled.has(request.requestId)) failure(request.requestId, 'render_failed', 'Canvas rendering failed');
  } finally {
    active.delete(request.requestId);
    cancelled.delete(request.requestId);
  }
});
const displayScale = window.devicePixelRatio / webFrame.getZoomFactor();
const bridge: CanvasRenderBridge = {
  setHandler(next) { handler = next; },
  setCancelHandler(next) { cancel = next; },
  setPixelRatio(ratio) {
    if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) throw new Error('Invalid canvas pixel ratio');
    webFrame.setZoomFactor(ratio / displayScale);
  },
  async prepareViewport(size) { await ipcRenderer.invoke(CANVAS_RENDER_CHANNELS.viewport, size); },
  ready() { ipcRenderer.send(CANVAS_RENDER_CHANNELS.ready, { protocol: CANVAS_RENDER_PROTOCOL }); },
};
contextBridge.exposeInMainWorld('__canvasRenderBridge', bridge);
