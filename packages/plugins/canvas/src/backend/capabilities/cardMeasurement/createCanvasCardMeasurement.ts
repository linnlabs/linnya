import { CANVAS_RENDER_WORKER_ID, CanvasWorkerResultSchema, type CanvasMeasureRequest, type CanvasMeasureBatchRequest } from '../../../shared/rendering';
import { CanvasRenderingError, type CanvasRenderWorkerPort } from '../../definitions/canvasRenderWorkerPort';

export function createCanvasCardMeasurement(port: CanvasRenderWorkerPort) {
  return {
    async measureBatch(request: CanvasMeasureBatchRequest, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const result = CanvasWorkerResultSchema.parse(await port.invoke(CANVAS_RENDER_WORKER_ID, request, { signal }));
      if (result.status === 'failure') throw new CanvasRenderingError(result.code, result.message);
      if (result.status !== 'measuredBatch' || result.requestId !== request.requestId || result.cards.length !== request.cards.length
        || result.cards.some((card, i) => card.ref !== request.cards[i].ref || card.width !== request.cards[i].width)) {
        throw new CanvasRenderingError('invalid_result', 'Canvas measurement returned a different batch');
      }
      return result.cards;
    },
    async measure(request: CanvasMeasureRequest, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const result = CanvasWorkerResultSchema.parse(await port.invoke(CANVAS_RENDER_WORKER_ID, request, { signal }));
      if (result.status === 'failure') throw new CanvasRenderingError(result.code, result.message);
      if (result.status !== 'measured' || result.requestId !== request.requestId || result.width !== request.width) {
        throw new CanvasRenderingError('invalid_result', 'Canvas measurement returned a different request');
      }
      return { width: result.width, height: result.height };
    },
  };
}
