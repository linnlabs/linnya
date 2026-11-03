import { CANVAS_RENDER_PROTOCOL, type CanvasRenderBridge, type CanvasWorkerResult, type CanvasWorkerRequest } from '../../shared/rendering';
import { createLatestRasterQueue } from '../capabilities/textRasterization';
import { createCanvasWorkerExecutor } from './orchestration/createCanvasWorkerExecutor';
import '@linnya/markdown-document-core/style.css';

declare global { interface Window { __canvasRenderBridge: CanvasRenderBridge } }
const bridge = window.__canvasRenderBridge;
const execute = createCanvasWorkerExecutor();
if (!bridge) throw new Error('Canvas render preload is missing');
const queue = createLatestRasterQueue({
  capacity: 8,
  execute: async (request: CanvasWorkerRequest, signal) => {
    bridge.setPixelRatio(request.dpr);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return execute(request, signal);
  },
  disposeResult: (_result: CanvasWorkerResult) => undefined,
});
bridge.setCancelHandler((requestId) => queue.cancel(requestId));
bridge.setHandler(async (request) => {
  const result = await queue.enqueue(request.requestId, request);
  if (result.status === 'ready') return result.value;
  return { status: 'failure', requestId: request.requestId,
    code: result.status === 'cancelled' || result.status === 'superseded' ? 'cancelled'
      : result.status === 'failed' && result.error instanceof Error && result.error.message === 'resource_unavailable' ? 'resource_unavailable' : 'render_failed',
    message: result.status === 'failed' && result.error instanceof Error ? result.error.message : `Canvas render ${result.status}` };
});
void execute({ protocol: CANVAS_RENDER_PROTOCOL, requestId: 'canvas-measure-self-check', kind: 'measure',
  theme: 'light', dpr: 1, uiScale: 1, assets: {}, fontFamily: 'system-ui', fontSize: 14, width: 100,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '字体测量' }] }] } },
new AbortController().signal).then((result) => {
  if (result.status !== 'measured' || result.height <= 0) throw new Error('Canvas measurement self-check failed');
  bridge.ready();
});
