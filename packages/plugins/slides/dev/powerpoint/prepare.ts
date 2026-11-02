import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DeckAssembler } from '../../src/backend/engine/DeckAssembler';
import { FreeformCompiler } from '../../src/backend/engine/FreeformCompiler';
import { StructuredCompiler } from '../../src/backend/engine/StructuredCompiler';
import { RenderModelMapper } from '../../src/backend/engine/parser/RenderModelMapper';
import {
  applyTextLayoutToRenderModel,
  prewarmTextLayoutForRenderModel,
} from '../../src/backend/engine/text/renderModelTextLayout';
import type { SlideRasterRequest } from '../../src/shared/slideRasterization';
import { createConformanceSamples } from './samples';
import {
  chartObservationSchema,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  slideFile,
  type Manifest,
  type Region,
} from './definitions';

export async function prepareConformance(
  root: string,
  rasterize: (request: SlideRasterRequest) => Promise<Uint8Array>
): Promise<Manifest> {
  await mkdir(path.join(root, 'preview'), { recursive: true });
  const { deck, pageIds } = createConformanceSamples();
  const model = new RenderModelMapper().fromGeneratedDeck(
    'synthetic-conformance',
    1,
    deck.title,
    deck,
    { width: 10, height: 5.625 }
  );
  await prewarmTextLayoutForRenderModel(model, undefined, { prepareEditingMeasurements: false });
  applyTextLayoutToRenderModel(model, undefined, undefined, { prepareEditingMeasurements: false });
  const pptx = await new DeckAssembler(new StructuredCompiler(), new FreeformCompiler()).assemble(
    deck
  );
  await writeFile(path.join(root, 'sample.pptx'), pptx);
  const manifest: Manifest = {
    version: 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    deckSha256: createHash('sha256').update(pptx).digest('hex'),
    font: 'Arial',
    platform: process.platform,
    pages: [],
  };
  for (const [index, slide] of model.slides.entries()) {
    const regions: Region[] = slide.elements.map((node, elementIndex) => {
      const text = node.kind === 'text' ? node : node.kind === 'shape' ? node.innerText : undefined;
      if (node.kind !== 'chart' && !text?.layout)
        throw new Error('Conformance sample must have finalized text or chart');
      if (text?.layout?.advanceSource !== undefined && text.layout.advanceSource !== 'harfbuzz')
        throw new Error('Conformance requires real HarfBuzz font measurements');
      const box = {
        x: node.box.x * 96,
        y: node.box.y * 96,
        w: node.box.w * 96,
        h: node.box.h * 96,
      };
      const margin = 18;
      const probe = {
        x: Math.max(0, box.x - margin),
        y: Math.max(0, box.y - margin),
        w: Math.min(PAGE_WIDTH, box.x + box.w + margin) - Math.max(0, box.x - margin),
        h: Math.min(PAGE_HEIGHT, box.y + box.h + margin) - Math.max(0, box.y - margin),
      };
      return {
        id: `element-${elementIndex + 1}`,
        kind:
          node.kind === 'chart'
            ? 'chart'
            : text?.layout?.writingMode === 'vertical-rl'
              ? 'vertical'
              : 'text',
        box,
        probe,
        ...(node.kind === 'chart'
          ? {
              chart: chartObservationSchema.parse({
                type: node.chartType,
                legendPosition:
                  node.legend?.visible === false ? 'none' : (node.legend?.position ?? 'bottom'),
              }),
            }
          : {}),
        ...(text?.layout
          ? {
              previewLines: text.layout.lines.map(line =>
                line.slices
                  .map(slice => (slice.kind === 'inlineBox' ? '[formula]' : slice.text))
                  .join('')
              ),
              scale: text.layout.appliedFontScale,
              reduction: text.layout.appliedLineSpacingReduction,
            }
          : {}),
      };
    });
    const png = await rasterize({
      requestId: `conformance-${index}`,
      slide,
      slideSize: model.slideSize,
      profile: {
        id: 'office-conformance',
        viewportWidthPx: PAGE_WIDTH,
        viewportHeightPx: PAGE_HEIGHT,
        pixelRatio: 1,
        format: 'png',
      },
    });
    await writeFile(path.join(root, 'preview', slideFile(index)), png);
    manifest.pages.push({
      id: pageIds[index],
      regions,
    });
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(root, 'render-model.json'), JSON.stringify(model, null, 2));
  return manifest;
}
