import { describe, expect, it, vi } from 'vitest';

import type { DeckSpec } from '@plugin/slides/shared';
import { PptPresentationQueryService } from '../engine/coordinator/PptPresentationQueryService.js';
import type { PptxReaderPort, SlidesEngineRenderModelSnapshot } from '../engine/types.js';

const deckSpec: DeckSpec = {
  title: 'Imported deck',
  slides: [{
    slideNumber: 1,
    spec: { type: 'freeform', elements: [] },
  }],
};

function makeGeneratedVersion(): SlidesEngineRenderModelSnapshot {
  return {
    id: 'revision-1',
    nodeId: 'deck-1',
    versionNumber: 1,
    deckSpec,
    sourceKind: 'generated',
    title: deckSpec.title,
  };
}

function makeImportedVersion(): SlidesEngineRenderModelSnapshot {
  return {
    ...makeGeneratedVersion(),
    sourceKind: 'imported',
    pptxBuffer: Buffer.from('pptx-source'),
  };
}

describe('PptPresentationQueryService derived read sources', () => {
  it('builds generated previews from DeckSpec without reading the PPTX package', async () => {
    const pptxReader: PptxReaderPort = {
      parse: vi.fn(async () => {
        throw new Error('generated preview must not parse PPTX');
      }),
    };

    const preview = await new PptPresentationQueryService(pptxReader).getPreview(
      'deck-1',
      makeGeneratedVersion(),
    );

    expect(pptxReader.parse).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      nodeId: 'deck-1',
      versionNumber: 1,
      slides: [{ slideId: 's1', layoutName: 'freeform' }],
    });
  });

  it('keeps imported presentations on the PPTX canonical read path', async () => {
    const pptxReader: PptxReaderPort = {
      parse: vi.fn(async () => ({
        slideCount: 1,
        slideSize: { width: 10, height: 5.625 },
        slides: [{
          number: 1,
          layoutName: 'Imported layout',
          elements: [{
            name: 'Imported title',
            type: 'text',
            text: 'Read from OOXML',
            position: { x: 1, y: 1, w: 8, h: 1 },
          }],
        }],
        theme: {
          colors: { accent1: '#336699' },
          fonts: { major: 'Aptos Display', minor: 'Aptos' },
        },
        masters: [],
      })),
    };

    const queryService = new PptPresentationQueryService(pptxReader);
    const preview = await queryService.getPreview(
      'deck-1',
      makeImportedVersion(),
    );
    const renderModel = await queryService.getRenderModel(
      'deck-1',
      makeImportedVersion(),
    );

    expect(pptxReader.parse).toHaveBeenCalledTimes(2);
    expect(pptxReader.parse).toHaveBeenNthCalledWith(1, Buffer.from('pptx-source'));
    expect(pptxReader.parse).toHaveBeenNthCalledWith(2, Buffer.from('pptx-source'));
    expect(preview.slides[0]).toMatchObject({
      slideId: 's1',
      layoutName: 'Imported layout',
      elements: [{ type: 'text', text: 'Read from OOXML' }],
    });
    expect(renderModel).toMatchObject({
      presentationId: 'deck-1',
      sourceKind: 'imported',
      slides: [{ layoutKey: 'Imported layout', elements: [{ kind: 'text' }] }],
    });
  });
});
