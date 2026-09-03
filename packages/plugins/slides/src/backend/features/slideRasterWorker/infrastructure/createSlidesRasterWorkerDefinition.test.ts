import { describe, expect, it } from 'vitest';
import {
  SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  type SlideRasterRequest,
} from '@plugin/slides/shared/slideRasterization';
import { createSlidesRasterWorkerDefinition } from './createSlidesRasterWorkerDefinition';

function createRequest(): SlideRasterRequest {
  return {
    requestId: 'request-1',
    slide: {
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [],
    },
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    profile: {
      id: 'worker-v1',
      viewportWidthPx: 1280,
      viewportHeightPx: 720,
      pixelRatio: 1,
      format: 'png',
    },
  };
}

describe('createSlidesRasterWorkerDefinition', () => {
  it('restores request and response types only through runtime codecs', () => {
    const diagnostics: string[] = [];
    const definition = createSlidesRasterWorkerDefinition({
      runtime: {
        mode: 'artifact-runtime',
        packageRoot: '/plugin',
        rootSource: 'explicit',
      },
      recordDiagnostic: (message) => diagnostics.push(message),
    });
    const request = createRequest();
    const encoded = definition.createRequestPayload(request);

    expect(encoded.requestId).toBe(request.requestId);
    expect(definition.parseResponsePayload({
      requestId: request.requestId,
      protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
      result: {
        status: 'failure',
        requestId: request.requestId,
        error: {
          code: 'slides.raster.render_failed',
          message: 'Slide rendering failed',
        },
      },
    })).toEqual({
      requestId: request.requestId,
      response: {
        status: 'failure',
        requestId: request.requestId,
        error: {
          code: 'slides.raster.render_failed',
          message: 'Slide rendering failed',
        },
      },
    });

    expect(() => definition.createRequestPayload({ requestId: 'request-1' }))
      .toThrow('Invalid slide raster request');
    expect(diagnostics).toEqual([
      `[slides-raster-worker] registration mode=artifact-runtime rootSource=explicit protocol=${SLIDES_RASTER_WORKER_PROTOCOL_VERSION} html=dist/raster-worker/worker.html preload=dist/backend/raster-worker-preload.cjs`,
      '[slides-raster-worker] stage=backend-admission outcome=rejected reason=Invalid slide raster request slide',
    ]);
    expect(diagnostics.join('\n')).not.toContain('/plugin');
  });
});
