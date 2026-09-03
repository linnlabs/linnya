import { describe, expect, it } from 'vitest';
import type { SlideRasterRequest } from '@plugin/slides/shared/slideRasterization';
import { assertSelfContainedRasterRequest } from './assertSelfContainedRasterRequest';

function createRequest(): SlideRasterRequest {
  return {
    requestId: 'request-1',
    slide: {
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'structured',
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

describe('assertSelfContainedRasterRequest', () => {
  it('accepts slides without images and image data URIs', () => {
    const request = createRequest();
    request.slide.elements.push({
      id: 'image-1',
      kind: 'image',
      box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
      zIndex: 1,
      assetRef: { type: 'data', dataUri: 'data:image/png;base64,iVBORw0KGgo=' },
    });

    expect(() => assertSelfContainedRasterRequest(request)).not.toThrow();
  });

  it('rejects local and remote sources before entering the sandbox worker', () => {
    const localRequest = createRequest();
    localRequest.slide.elements.push({
      id: 'local-image',
      kind: 'image',
      box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
      zIndex: 1,
      assetRef: { type: 'embedded', partPath: '/tmp/local.png' },
    });
    expect(() => assertSelfContainedRasterRequest(localRequest)).toThrowError(
      expect.objectContaining({ code: 'slides.raster.resource_load_failed' }),
    );

    const remoteRequest = createRequest();
    remoteRequest.slide.background.imageSrc = 'https://example.com/background.png';
    expect(() => assertSelfContainedRasterRequest(remoteRequest)).toThrowError(
      expect.objectContaining({ code: 'slides.raster.resource_load_failed' }),
    );
  });
});
