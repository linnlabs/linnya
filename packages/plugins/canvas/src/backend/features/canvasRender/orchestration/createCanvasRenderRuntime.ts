import { CANVAS_RENDER_WORKER_ID, CanvasWorkerResultSchema, type CanvasRenderRequest } from '../../../../shared/rendering';
import type { CanvasRenderWorkerPort } from '../../../definitions/canvasRenderWorkerPort';
import { readCanvasRenderedImage } from '../functions/readCanvasRenderedImage';

/** 字节发布由会话文件 owner 执行，本用例只产出已验证的图像与来源版本。 */
export function createCanvasRenderRuntime(port: CanvasRenderWorkerPort) {
  return {
    async render(request: CanvasRenderRequest, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const result = CanvasWorkerResultSchema.parse(await port.invoke(CANVAS_RENDER_WORKER_ID, request, { signal }));
      return readCanvasRenderedImage(request, result);
    },
  };
}
