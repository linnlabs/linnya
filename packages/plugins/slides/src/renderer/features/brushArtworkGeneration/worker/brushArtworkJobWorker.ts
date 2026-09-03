/// <reference lib="webworker" />

import * as brush from 'p5.brush/standalone';
import {
  createBrushArtworkRenderFailure,
  parseBrushArtworkRenderRequest,
  type BrushArtworkRenderResult,
} from '@plugin/slides/shared/brushArtwork';
import { renderBrushArtworkIntent } from '../functions/renderBrushArtworkIntent';

const workerScope: DedicatedWorkerGlobalScope = self;

workerScope.onmessage = (event: MessageEvent<unknown>): void => {
  void render(event.data);
};

async function render(value: unknown): Promise<void> {
  let requestId = 'invalid-brush-request';
  try {
    const request = parseBrushArtworkRenderRequest(value);
    requestId = request.requestId;
    warmRuntime(request.intent.backgroundColor);
    const canvas = new OffscreenCanvas(request.widthPx, request.heightPx);
    if (!canvas.getContext('webgl2')) {
      post(createBrushArtworkRenderFailure(
        request.requestId,
        'slides.brush.runtime_unavailable',
        'WebGL2 is unavailable for Brush artwork generation.',
      ));
      return;
    }
    brush.load(canvas);
    renderBrushArtworkIntent(request);
    let blob: Blob;
    try {
      blob = await canvas.convertToBlob({ type: 'image/png' });
    } catch {
      post(createBrushArtworkRenderFailure(
        request.requestId,
        'slides.brush.encode_failed',
        'Brush artwork PNG encoding failed.',
      ));
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    post({
      status: 'success',
      requestId: request.requestId,
      widthPx: request.widthPx,
      heightPx: request.heightPx,
      bytes,
    }, bytes.buffer);
  } catch {
    post(createBrushArtworkRenderFailure(
      requestId,
      'slides.brush.render_failed',
      'Brush artwork rendering failed.',
    ));
  }
}

/** 上游会延迟初始化笔尖与 compositor；同一 job worker 先预热再发布真实结果。 */
function warmRuntime(backgroundColor: string): void {
  const canvas = new OffscreenCanvas(96, 64);
  brush.load(canvas);
  renderBrushArtworkIntent({
    requestId: 'brush-warmup',
    widthPx: 96,
    heightPx: 64,
    intent: {
      seed: 0,
      backgroundColor,
      quality: 'draft',
      layers: [
        {
          stroke: { brush: 'HB', color: '#334155', weight: 1 },
          marks: [{ type: 'line', from: [8, 14], to: [92, 14] }],
        },
        {
          fill: { kind: 'watercolor', color: '#9A3412', opacity: 80 },
          marks: [{ type: 'ellipse', center: [24, 52], radiusX: 12, radiusY: 18 }],
        },
        {
          fill: { kind: 'mass', brush: 'pastel', color: '#475569', strength: 0.4 },
          hatch: { brush: 'rotring', color: '#334155', spacing: 4 },
          marks: [{ type: 'rect', x: 42, y: 34, width: 22, height: 34 }],
        },
        {
          fill: { kind: 'wash', color: '#C4B5FD', opacity: 80 },
          marks: [{ type: 'polygon', points: [[72, 34], [92, 48], [76, 70]] }],
        },
      ],
    },
  });
}

function post(result: BrushArtworkRenderResult, transfer?: ArrayBuffer): void {
  workerScope.postMessage(result, transfer ? [transfer] : []);
}
