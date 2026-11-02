import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDeckSpecFromDirectInput, compileFlexInput, initYoga } from '../codegen/index.js';
import type { LayoutSlideNode, LayoutTextNode } from '../codegen/compose/flex-layout/LayoutTypes';
import { FreeformCompiler } from '../engine/FreeformCompiler';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { PptxReader } from '../engine/parser/PptxReader';
import { materializeIntrinsicTextBoxes } from '../engine/text/materializeIntrinsicTextBoxes';
import { applyTextLayoutToRenderModel, prewarmTextLayoutForRenderModel } from '../engine/text/renderModelTextLayout';
import { buildFinalTextLineOccupancies } from '../engine/quality/functions/buildTextLineOccupancy';
import { isSlideRenderModel } from '@plugin/slides/shared/renderModel';
import { renderDeck } from './helpers/render-model-mapping-harness';

function compileText(text: Partial<LayoutTextNode>) {
  const slide: LayoutSlideNode = { _type: 'Slide', children: [{ _type: 'Text', content: '清风徐来', fontSize: 36, ...text }] };
  const result = compileFlexInput({ title: 'Vertical', slides: [slide] } as Parameters<typeof compileFlexInput>[0]);
  if ('error' in result) throw new Error(result.error);
  return buildDeckSpecFromDirectInput(result.input);
}

describe('vertical text', () => {
  beforeAll(async () => {
    await initYoga();
  });

  it('materializes an unconstrained absolute column from the final layout', async () => {
    const deck = compileText({ writingMode: 'vertical-rl', left: 8, top: 1 });
    await materializeIntrinsicTextBoxes(deck);
    const element = deck.slides[0]!.spec.elements[0]!;
    expect(element.type === 'text' && element.textWrap).toBe('none');
    expect(element.position.x).toBe(8);
    expect(element.position.y).toBe(1);
    // 4 字 36pt：列高约 2in + 上下 inset，列宽约一个字号 + 左右 inset。
    expect(element.position.h).toBeGreaterThan(2);
    expect(element.position.w).toBeLessThan(1);
    expect(element.position.h).toBeGreaterThan(element.position.w);

    const model = renderDeck(deck);
    await prewarmTextLayoutForRenderModel(model);
    applyTextLayoutToRenderModel(model);
    const node = model.slides[0]!.elements[0]!;
    expect(node.kind === 'text' && node.writingMode).toBe('vertical-rl');
    expect(node.kind === 'text' && node.layout?.overflow).toMatchObject({ horizontal: false, vertical: false });
    expect(isSlideRenderModel(JSON.parse(JSON.stringify(model.slides[0])))).toBe(true);
  });

  it('wraps into a new column at the declared height', async () => {
    const deck = compileText({ writingMode: 'vertical-rl', content: '清风徐来水波不兴', left: 4, top: 1, height: 2.2 });
    const element = deck.slides[0]!.spec.elements[0]!;
    expect(element.type === 'text' && element.textWrap).toBe('word');
    const model = renderDeck(deck);
    await prewarmTextLayoutForRenderModel(model);
    applyTextLayoutToRenderModel(model);
    const node = model.slides[0]!.elements[0]!;
    if (node.kind !== 'text') throw new Error('expected text');
    expect(node.layout?.lines.length).toBe(2);
    expect(node.box.h).toBe(2.2);
    expect(node.layout?.overflow.vertical).toBe(false);
    const occupancy = buildFinalTextLineOccupancies({
      type: 'text', position: { x: node.box.x, y: node.box.y, w: node.box.w, h: node.box.h }, textLayout: node.layout,
    } as Parameters<typeof buildFinalTextLineOccupancies>[0]);
    expect(occupancy[0]!.box.x).toBeGreaterThan(occupancy[1]!.box.x);
    expect(occupancy[0]!.box.h).toBeGreaterThan(occupancy[0]!.box.w);
  });

  it('rejects inline formulas in vertical text', () => {
    expect(() => compileText({
      writingMode: 'vertical-rl',
      content: [{ formula: 'x^2' }] as LayoutTextNode['content'],
    })).toThrow('竖排 Text 不支持行内公式');
  });

  it('does not mark horizontal-tb as vertical', () => {
    const element = compileText({ writingMode: 'horizontal-tb', left: 1, top: 1 }).slides[0]!.spec.elements[0]!;
    expect(element.type === 'text' && element.style?.writingMode).toBeUndefined();
  });

  it('round-trips through a real PPTX and reads eaVert back on import', async () => {
    const deck = compileText({ writingMode: 'vertical-rl', left: 8, top: 1 });
    const buffer = deck.slides[0]!.spec.type === 'structured'
      ? await new StructuredCompiler().compileDeck(deck)
      : await new FreeformCompiler().compileDeck(deck);
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('vert="eaVert"');
    const info = await new PptxReader().parse(buffer);
    const element = info.slides[0]!.elements.find((candidate) => candidate.text?.includes('清风徐来'));
    expect(element?.textBody?.writingMode).toBe('vertical-rl');
  });
});
