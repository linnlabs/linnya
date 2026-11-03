import type { CanvasRenderRequest, CanvasWorkerResult } from '../../../../shared/rendering';
import { CanvasRenderingError } from '../../../definitions/canvasRenderWorkerPort';

export function readCanvasRenderedImage(request: CanvasRenderRequest, result: CanvasWorkerResult) {
  if (result.status === 'failure') throw new CanvasRenderingError(result.code, result.message);
  if (result.status !== 'rendered' || result.requestId !== request.requestId || result.sequence !== request.snapshot.sequence
    || result.format !== request.format || result.width !== Math.ceil(request.width * request.dpr)
    || result.height !== Math.ceil(request.height * request.dpr)) {
    throw new CanvasRenderingError('invalid_result', 'Canvas render returned a different request or snapshot');
  }
  const prefix = `data:image/${result.format};base64,`;
  if (!result.dataUrl.startsWith(prefix)) throw new CanvasRenderingError('invalid_result', 'Canvas render format mismatch');
  const bytes = new Uint8Array(Buffer.from(result.dataUrl.slice(prefix.length), 'base64'));
  return { bytes, width: result.width, height: result.height, format: result.format, sequence: result.sequence };
}
