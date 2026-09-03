import {
  createBrushArtworkRenderFailure,
  type BrushArtworkRenderRequest,
  type BrushArtworkRenderResult,
  type BrushArtworkWorkerBridge,
} from '@plugin/slides/shared/brushArtwork';
import { BrushArtworkJobRuntime } from '../orchestration/BrushArtworkJobRuntime';

declare global {
  interface Window {
    __slidesBrushBridge: BrushArtworkWorkerBridge;
  }
}

const runtime = new BrushArtworkJobRuntime();

async function render(request: BrushArtworkRenderRequest): Promise<BrushArtworkRenderResult> {
  try {
    return await runtime.render(request);
  } catch {
    return createBrushArtworkRenderFailure(
      request.requestId,
      'slides.brush.render_failed',
      'Brush artwork rendering failed.',
    );
  }
}

async function bootstrap(): Promise<void> {
  const selfCheck = await render({
    requestId: 'slides-brush-self-check',
    widthPx: 32,
    heightPx: 24,
    intent: {
      seed: 1,
      backgroundColor: '#FFFDF8',
      quality: 'draft',
      layers: [{
        stroke: { brush: 'HB', color: '#334155', weight: 1 },
        marks: [{ type: 'line', from: [8, 50], to: [92, 50] }],
      }],
    },
  });
  if (selfCheck.status === 'failure') throw new Error(selfCheck.error.message);
  window.__slidesBrushBridge.setRenderHandler(render);
  window.__slidesBrushBridge.setCancelHandler((requestId) => runtime.cancel(requestId));
  window.__slidesBrushBridge.notifyReady();
}

void bootstrap();
