import { describe, expect, it } from 'vitest';
import type { MathFormulaRenderProjection, RenderParagraph } from '../../index';
import { layoutTextNode } from '../orchestration/layoutTextNode';

const projection: MathFormulaRenderProjection = {
  canonicalSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 116 116"></svg>',
  contentHash: 'a'.repeat(64),
  viewBox: { x: 0, y: 0, width: 116, height: 116 },
  contentViewBox: { x: 8, y: 8, width: 100, height: 100 },
  metrics: {
    advanceWidth: 0.8,
    ascent: 0.42,
    descent: 0.18,
    inkBounds: { x: 0, y: -0.42, width: 0.8, height: 0.6 },
    nativeEnvelope: { ascentEm: 0.7, descentEm: 0.3 },
  },
  altText: '测试公式',
  align: 'center',
};

const paragraphs: RenderParagraph[] = [{
  runs: [
    { text: '前文 ', fontSize: 20 },
    { kind: 'formula', projection },
    { text: ' 后文', fontSize: 20 },
  ],
  lineSpacing: { kind: 'multiple', value: 1 },
}];

const provider = {
  getClusterAdvances(clusters: readonly string[]) {
    return { advances: clusters.map(() => 0.16), source: 'pretext' as const };
  },
};

describe('inline formula text layout', () => {
  it('keeps a formula atomic and expands only its line metrics', () => {
    const result = layoutTextNode({
      paragraphs,
      defaultFontFamily: 'Arial',
      contract: {
        sourceKind: 'generated',
        box: { x: 0, y: 0, w: 4, h: 2, unit: 'in' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        wrap: 'word',
        autoFitPolicy: 'none',
        overflow: 'clip',
        verticalAlign: 'top',
        profile: 'plain-textbox',
      },
    }, provider);
    const formulaSlice = result.lines[0]?.slices.find((slice) => slice.kind === 'inlineBox');
    expect(formulaSlice).toEqual(expect.objectContaining({
      kind: 'inlineBox',
      identity: `formula:${projection.contentHash}`,
      width: projection.metrics.advanceWidth,
      height: projection.metrics.ascent + projection.metrics.descent,
    }));
    expect(result.lines[0]?.height).toBeGreaterThanOrEqual(0.6);
  });

  it('fails closed when the formula is wider than the content box', () => {
    expect(() => layoutTextNode({
      paragraphs,
      defaultFontFamily: 'Arial',
      contract: {
        sourceKind: 'generated',
        box: { x: 0, y: 0, w: 0.5, h: 2, unit: 'in' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        wrap: 'word',
        autoFitPolicy: 'none',
        overflow: 'clip',
        verticalAlign: 'top',
        profile: 'plain-textbox',
      },
    }, provider)).toThrowError(expect.objectContaining({
      code: 'slides.formula.inline_formula_too_wide',
    }));
  });

  it('fails closed when exact line spacing cannot contain the formula', () => {
    expect(() => layoutTextNode({
      paragraphs: [{ ...paragraphs[0]!, lineSpacing: { kind: 'exactPt', value: 12 } }],
      defaultFontFamily: 'Arial',
      contract: {
        sourceKind: 'generated',
        box: { x: 0, y: 0, w: 4, h: 2, unit: 'in' },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        wrap: 'word',
        autoFitPolicy: 'none',
        overflow: 'clip',
        verticalAlign: 'top',
        profile: 'plain-textbox',
      },
    }, provider)).toThrowError(expect.objectContaining({
      code: 'slides.formula.inline_formula_line_height_insufficient',
    }));
  });
});
