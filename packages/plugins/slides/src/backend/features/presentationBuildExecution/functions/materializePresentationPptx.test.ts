import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { materializePresentationPptx } from './materializePresentationPptx';
import { encodePresentationMaterializationInput, readPresentationMaterializationInput } from './presentationMaterializationCodec';
import { compileFlexInput } from '../../../codegen/compose/flex-layout/FlexLayoutCompiler';
import { initYoga } from '../../../codegen/compose/flex-layout/YogaAdapter';
import { buildDeckSpecFromDirectInput } from '../../../codegen/compose/presentationComposeInput';
import { RenderModelMapper } from '../../../engine/parser/RenderModelMapper';
import { LayoutLint } from '../../../engine/quality/LayoutLint';
import { renderModelToLintInfo } from '../../../engine/quality/renderModelToLintInfo';

describe('materializePresentationPptx', () => {
  it('拥挤布局的零高度保留到 PPTX、预览和 Inspect，不误报 worker 合同故障', async () => {
    await initYoga();
    const compiled = compileFlexInput({
      title: 'Collapsed layout',
      slides: [{ _type: 'Slide', children: [{
        _type: 'View', height: 0.2, padding: 0.2, flexDirection: 'column',
        children: [
          { _type: 'Text', content: 'Crowded heading', flex: 1, height: 0.26, _sourceSpan: { startLine: 4, endLine: 4 } },
          { _type: 'Table', rows: [['Category', 'Amount'], ['A', '10']], flex: 1, height: 1, _sourceSpan: { startLine: 5, endLine: 5 } },
        ],
      }] }],
    });
    if (!compiled.input) throw new Error(compiled.error);
    const deckSpec = buildDeckSpecFromDirectInput(compiled.input);
    expect(deckSpec.slides[0].spec.elements.map(e => e.position.h)).toEqual([0, 0]);
    const input = readPresentationMaterializationInput(encodePresentationMaterializationInput({
      deckSpec, svgAssets: [], svgFallbacks: [],
    }));
    const zip = await JSZip.loadAsync(await materializePresentationPptx(input));
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(slideXml).toContain('Crowded heading');
    expect(slideXml).toContain('Category');

    const model = new RenderModelMapper().fromGeneratedDeck('deck', 1, deckSpec.title, input.deckSpec, { width: 10, height: 5.625 });
    expect(model.slides[0].elements.map(e => e.box.h)).toEqual([0, 0]);
    expect(model.slides[0].elements[0].sourceSpan).toMatchObject({ startLine: 4 });
    const issues = new LayoutLint().lint(renderModelToLintInfo(model)).issues;
    expect(issues.filter(i => i.code === 'zero_sized_renderable')).toHaveLength(2);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'zero_sized_renderable', evidence: expect.objectContaining({ zeroAxes: ['vertical'] }) }),
    ]));

    const invalidDeck = structuredClone(deckSpec);
    invalidDeck.slides[0].spec.elements[0].position.h = -1;
    expect(() => encodePresentationMaterializationInput({ deckSpec: invalidDeck, svgAssets: [], svgFallbacks: [] })).toThrow('deck spec is invalid');
  });

  it('builds and sanitizes a real PPTX package from a self-contained DTO', async () => {
    const buffer = await materializePresentationPptx({
      deckSpec: {
        title: 'Worker materialization',
        layout: '16x9',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'text',
              position: { x: 1, y: 1, w: 4, h: 1 },
              content: 'PPTX work runs outside the App Server event loop.',
              style: { fontSize: 24, color: '#223344' },
            }],
          },
        }],
      },
      svgAssets: [],
      svgFallbacks: [],
    });

    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(slideXml).toContain('PPTX work runs outside the App Server event loop.');
  });
});
