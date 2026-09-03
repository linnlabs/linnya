import { describe, expect, it } from 'vitest';
import { createPresentationSvgGraphicFallbackRasterizer } from './createPresentationSvgGraphicFallbackRasterizer';

describe('createPresentationSvgGraphicFallbackRasterizer', () => {
  it('sends one transparent, self-contained SVG render request to the hidden worker', async () => {
    const requests: unknown[] = [];
    const rasterizer = createPresentationSvgGraphicFallbackRasterizer(async (request) => {
      requests.push(request);
      return {
        status: 'success',
        requestId: request.requestId,
        format: 'png',
        widthPx: 1920,
        heightPx: 1080,
        bytes: new Uint8Array([137, 80, 78, 71]),
      };
    });

    await expect(rasterizer.rasterizeSvgGraphic({
      canonicalSvg: '<svg viewBox="0 0 640 360"><path d="M0 0L1 1"/></svg>',
      contentHash: 'a'.repeat(64),
      viewBox: { width: 640, height: 360 },
    })).resolves.toMatchObject({ widthPx: 1920, heightPx: 1080 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      profile: { transparentBackground: true, viewportWidthPx: 1920, viewportHeightPx: 1080 },
      slide: {
        background: { paint: { type: 'none' } },
        elements: [{ kind: 'svgGraphic', fit: 'stretch', decorative: true }],
      },
    });
  });
});
