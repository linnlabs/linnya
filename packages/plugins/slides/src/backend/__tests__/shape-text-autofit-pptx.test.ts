import { defaultTextMeasureService } from '@plugin/backend/textMeasurement';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import {
  createPresentationBuildWorkerMaterializeRequest,
  parsePresentationBuildWorkerRequest,
} from '../features/presentationBuildExecution/functions/presentationBuildWorkerCodec';
import { readPresentationMaterializationInput } from '../features/presentationBuildExecution/functions/presentationMaterializationCodec';
import { materializePresentationPptx } from '../features/presentationBuildExecution/functions/materializePresentationPptx';
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { DeckSpec, FreeformShapeElement } from '@plugin/slides/shared';
import { resolveSlideSizeInches, visitRenderNodes } from '@plugin/slides/shared';
import { FreeformCompiler } from '../engine/FreeformCompiler';
import { DeckAssembler } from '../engine/DeckAssembler';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';
import {
  applyTextLayoutToRenderModel,
  prewarmTextLayoutForRenderModel,
} from '../engine/text/renderModelTextLayout';

function shape(
  content: FreeformShapeElement['content'],
  w: number,
  h: number
): FreeformShapeElement {
  return {
    type: 'shape',
    geometry: 'rect',
    content,
    position: { x: 1, y: 1, w, h },
    style: { fontFamily: 'Arial', fontSize: 24, lineSpacing: { kind: 'multiple', value: 1.2 } },
  };
}

for (const mode of ['freeform', 'mixed', 'worker'] as const) {
  describe(`${mode} shape text autofit artifact`, () => {
    it('persists the preview scale and spacing reduction, leaving unscaled shapes and text boxes clean', async () => {
      const deck: DeckSpec = {
        title: 'Synthetic shape autofit',
        layout: '16x9',
        theme: { fonts: { major: 'Arial', minor: 'Arial' } },
        slides: [
          {
            slideNumber: 1,
            spec: {
              type: 'freeform',
              elements: [
                shape('First line\nSecond line\nThird line\nFourth line', 2, 0.65),
                {
                  ...shape(
                    [
                      { text: 'Large words ', style: { fontSize: 30 } },
                      { text: '小字\nNext line', style: { fontSize: 18 } },
                    ],
                    1.6,
                    0.6
                  ),
                  style: {
                    ...shape('', 1, 1).style,
                    gradient: {
                      type: 'linear',
                      angle: 45,
                      stops: [
                        { color: '#FFFFFF', position: 0 },
                        { color: '#EEEEEE', position: 1 },
                      ],
                    },
                  },
                },
                {
                  type: 'group',
                  position: { x: 5, y: 1, w: 1.5, h: 0.5 },
                  children: [shape('Nested text\nSecond line\nThird line', 3, 1)],
                },
                shape('Fits', 4, 2),
                {
                  type: 'text',
                  content: 'Ordinary textbox',
                  position: { x: 1, y: 4, w: 4, h: 0.5 },
                },
              ],
            },
          },
        ],
      };
      if (mode !== 'freeform')
        deck.slides.push({ slideNumber: 2, spec: { type: 'structured', elements: [] } });
      const snapshot = structuredClone(deck);
      const model = new RenderModelMapper().fromGeneratedDeck(
        'autofit',
        1,
        deck.title,
        deck,
        resolveSlideSizeInches(deck.layout)
      );
      await prewarmTextLayoutForRenderModel(model);
      applyTextLayoutToRenderModel(model);
      const layouts: { scale: number; reduction: number }[] = [];
      visitRenderNodes(model.slides[0].elements, ({ node }) => {
        if (node.kind !== 'shape' || !node.innerText?.layout) return;
        layouts.push({
          scale: node.innerText.layout.appliedFontScale,
          reduction: node.innerText.layout.appliedLineSpacingReduction,
        });
      });
      expect(layouts).toHaveLength(4);
      expect(layouts.slice(0, 3).every(layout => layout.scale < 1 && layout.reduction > 0)).toBe(
        true
      );
      expect(layouts[3]).toEqual({ scale: 1, reduction: 0 });
      let bytes: Uint8Array;
      if (mode === 'worker') {
        const prepared = await preparePresentationMaterialization(deck, undefined, {});
        const request = parsePresentationBuildWorkerRequest(
          createPresentationBuildWorkerMaterializeRequest({
            requestId: 'shape-autofit',
            materialization: prepared,
          })
        );
        if (request.type !== 'materialize') throw new Error('Expected materialization request');
        // Worker 不允许再次访问字体测量，否则可能得到与 Host 预览不同的结果。
        const measure = vi
          .spyOn(defaultTextMeasureService, 'measureClusterAdvancesWithSource')
          .mockImplementation(() => {
            throw new Error('Worker must not measure fonts');
          });
        const prewarm = vi
          .spyOn(defaultTextMeasureService, 'prewarmClusterAdvances')
          .mockRejectedValue(new Error('Worker must not prewarm fonts'));
        try {
          bytes = new Uint8Array(
            await materializePresentationPptx(readPresentationMaterializationInput(request))
          );
        } finally {
          measure.mockRestore();
          prewarm.mockRestore();
        }
      } else {
        bytes =
          mode === 'freeform'
            ? await new FreeformCompiler().compileDeck(deck)
            : await new DeckAssembler(new StructuredCompiler(), new FreeformCompiler()).assemble(
                deck
              );
      }
      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('text');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const autofits = Array.from(doc.getElementsByTagName('a:normAutofit'));
      expect(autofits).toHaveLength(4);
      layouts.forEach((layout, index) => {
        expect(autofits[index].getAttribute('fontScale')).toBe(
          layout.scale < 1 ? String(Math.round(layout.scale * 100_000)) : null
        );
        expect(autofits[index].getAttribute('lnSpcReduction')).toBe(
          layout.reduction > 0 ? String(Math.round(layout.reduction * 100_000)) : null
        );
      });
      expect(doc.getElementsByTagName('a:spAutoFit')).toHaveLength(1);
      expect(xml).not.toContain('linnya-autofit:');
      expect(xml).toContain('<a:gradFill');
      expect(deck).toEqual(snapshot);
    });
  });
}

it('rejects missing and invalid prepared scales at the Worker boundary', async () => {
  const deck: DeckSpec = {
    title: 'Synthetic autofit admission',
    slides: [{ slideNumber: 1, spec: { type: 'freeform', elements: [shape('One\nTwo', 2, 0.5)] } }],
  };
  const prepared = await preparePresentationMaterialization(deck, undefined, {});
  const request = createPresentationBuildWorkerMaterializeRequest({
    requestId: 'autofit-admission',
    materialization: prepared,
  });
  for (const shapeTextAutofit of [
    undefined,
    [[]],
    [[{ fontScale: 1.1, lineSpacingReduction: 0 }]],
    [[{ fontScale: 0.5, lineSpacingReduction: NaN }]],
  ]) {
    expect(() => parsePresentationBuildWorkerRequest({ ...request, shapeTextAutofit })).toThrow(
      'shape text autofit is invalid'
    );
  }
});
