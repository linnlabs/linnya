import { describe, expect, it } from 'vitest';

import { preparePresentationMaterialization } from './preparePresentationMaterialization';

describe('preparePresentationMaterialization', () => {
  it('resolves Host-owned images on a clone and leaves the author DeckSpec unchanged', async () => {
    const deckSpec = {
      title: 'Prepared deck',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform' as const,
          elements: [{
            type: 'image' as const,
            position: { x: 1, y: 1, w: 2, h: 2 },
            src: { kind: 'generated_asset' as const, assetId: 'image-1' },
          }],
        },
      }],
    };

    const prepared = await preparePresentationMaterialization(
      deckSpec,
      undefined,
      {
        imageSourceResolver: {
          async resolveImageSource() {
            return { kind: 'data_uri', dataUri: 'data:image/png;base64,iVBORw0KGgo=' };
          },
        },
      },
    );

    expect(deckSpec.slides[0]?.spec.elements[0]?.src).toEqual({
      kind: 'generated_asset',
      assetId: 'image-1',
    });
    expect(prepared.deckSpec.slides[0]?.spec.elements[0]).toMatchObject({
      src: { kind: 'data_uri' },
    });
  });
});
