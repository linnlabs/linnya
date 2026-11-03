import type { HiddenWorkerDefinition } from '@plugin/backend/hiddenWorkerRuntime';
import {
  CANVAS_RENDER_CHANNELS, CANVAS_RENDER_PROTOCOL, CANVAS_RENDER_WORKER_ID,
  CanvasWorkerRequestSchema, CanvasWorkerResponseSchema, CanvasWorkerReadySchema,
} from '../../../../shared/rendering';

export function createCanvasHiddenWorkerDefinition(paths: {
  readonly workerHtmlPath: string;
  readonly preloadPath: string;
}): HiddenWorkerDefinition {
  return {
    id: CANVAS_RENDER_WORKER_ID,
    requestChannel: CANVAS_RENDER_CHANNELS.request, responseChannel: CANVAS_RENDER_CHANNELS.response,
    readyChannel: CANVAS_RENDER_CHANNELS.ready, cancelChannel: CANVAS_RENDER_CHANNELS.cancel,
    workerHtmlPath: paths.workerHtmlPath, preloadPath: paths.preloadPath,
    renderingMode: 'offscreen', partition: 'hidden-worker:canvas-render',
    readyTimeoutMs: 15000, requestTimeoutMs: 30000, idleTimeoutMs: 5 * 60 * 1000,
    createRequestPayload(value) {
      const request = CanvasWorkerRequestSchema.parse(value);
      return { requestId: request.requestId, payload: request };
    },
    parseResponsePayload(value) {
      const response = CanvasWorkerResponseSchema.parse(value);
      return { requestId: response.result.requestId, response: response.result };
    },
    parseReadyPayload: (value) => { CanvasWorkerReadySchema.parse(value); },
    createCancelPayload: (requestId) => ({ protocol: CANVAS_RENDER_PROTOCOL, requestId }),
  };
}
