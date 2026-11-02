import { describe, expect, it } from 'vitest';
import type { RenderParagraph } from '../../renderModel';
import { resolveTextLayoutContract } from '../functions/resolveTextLayoutContract';
import { resizeVerticalTextBoxForAutoFit } from '../functions/resizeTextBoxForAutoFit';
import { buildVerticalGlyphRuns, classifyVerticalGlyph, resolveVerticalLineColumn } from '../functions/verticalText';
import { layoutTextNode } from '../orchestration/layoutTextNode';
import type { RunAdvanceProvider } from '../definitions/types';

const EM = 0.5;
const provider: RunAdvanceProvider = {
  getClusterAdvances: (clusters) => ({ advances: clusters.map(() => EM), source: 'heuristic' }),
};
const paragraphs: RenderParagraph[] = [{ runs: [{ text: '清风徐来水波不兴', fontSize: 36 }] }];
const padding = { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 };

function layout(overrides: Partial<Parameters<typeof resolveTextLayoutContract>[0]> = {}, input = paragraphs) {
  return layoutTextNode({
    paragraphs: input,
    defaultFontFamily: 'Arial',
    contract: resolveTextLayoutContract({
      profile: 'plain-textbox', sourceKind: 'generated', box: { x: 1, y: 1, w: 3, h: 2.1 },
      padding, writingMode: 'vertical-rl', ...overrides,
    }),
  }, provider);
}

describe('vertical-rl text layout', () => {
  it('breaks columns against the physical height and stacks them from the right', () => {
    const result = layout();
    expect(result.writingMode).toBe('vertical-rl');
    // 2.1 - 0.05 * 2 = 2in 容纳 4 字，8 字折成两列。
    expect(result.lines.map((line) => line.slices.map((slice) => 'text' in slice ? slice.text : ''))).toEqual([['清风徐来'], ['水波不兴']]);
    const contentWidth = 3 - padding.left - padding.right;
    const [first, second] = result.lines.map((line) => resolveVerticalLineColumn(line, contentWidth));
    expect(first!.x).toBeGreaterThan(second!.x);
    expect(first!.x + first!.width).toBeCloseTo(contentWidth);
  });

  it('keeps a single column per paragraph without wrapping and reports the required width', () => {
    const result = layout({ wrap: 'none', autoFitPolicy: 'resize-shape', box: { x: 1, y: 1, w: 0.1, h: 0.5 } });
    expect(result.lines).toHaveLength(1);
    expect(result.requiredWidthInches).toBeCloseTo(0.5 + padding.left + padding.right);
    // 列高与列宽都已由 required* 撑开，不残留旧外框造成的假溢出。
    expect(result.requiredHeightInches).toBeCloseTo(4 + padding.top + padding.bottom);
    expect(result.overflow).toMatchObject({ horizontal: false, vertical: false });
  });

  it('maps verticalAlign to the column block position', () => {
    const single: RenderParagraph[] = [{ runs: [{ text: '茶', fontSize: 36 }] }];
    const contentWidth = 3 - padding.left - padding.right;
    const column = (verticalAlign: 'top' | 'middle' | 'bottom') => resolveVerticalLineColumn(layout({ verticalAlign }, single).lines[0]!, contentWidth);
    expect(column('top').x + column('top').width).toBeCloseTo(contentWidth);
    expect(column('middle').x + column('middle').width / 2).toBeCloseTo(contentWidth / 2);
    expect(column('bottom').x).toBeCloseTo(0);
  });

  it('emits glyph runs only for vertical layouts', () => {
    const vertical = layout().lines[0]!.slices[0]!;
    expect('verticalGlyphRuns' in vertical && vertical.verticalGlyphRuns?.map((glyph) => glyph.offset)).toEqual([0, 0.5, 1, 1.5]);
    const horizontal = layout({ writingMode: undefined }).lines[0]!.slices[0]!;
    expect(horizontal).not.toHaveProperty('verticalGlyphRuns');
    expect(horizontal).not.toHaveProperty('clusters');
  });

  it('reports ellipsis as clip so glyph runs and source text stay in sync', () => {
    const result = layout({ overflow: 'ellipsis', box: { x: 1, y: 1, w: 0.7, h: 1.1 } });
    expect(result.overflow.vertical).toBe(true);
    expect(JSON.stringify(result.lines)).not.toContain('…');
  });
});

describe('vertical glyph orientation', () => {
  it.each([
    ['茶', 'upright'], ['か', 'upright'], ['한', 'upright'], ['Ａ', 'upright'], ['！', 'upright'],
    ['A', 'rotated'], ['7', 'rotated'], ['（', 'rotated'], ['》', 'rotated'], ['—', 'rotated'], ['…', 'rotated'],
    ['，', 'corner'], ['。', 'corner'], ['、', 'corner'],
  ])('%s -> %s', (text, orientation) => {
    expect(classifyVerticalGlyph(text)).toBe(orientation);
  });

  it('merges consecutive rotated clusters and keeps upright glyphs separate', () => {
    expect(buildVerticalGlyphRuns([
      { text: '第', advance: 1 }, { text: '2', advance: 0.5 }, { text: '0', advance: 0.5 }, { text: '回', advance: 1 },
    ])).toEqual([
      { text: '第', offset: 0, orientation: 'upright' },
      { text: '20', offset: 1, orientation: 'rotated' },
      { text: '回', offset: 2, orientation: 'upright' },
    ]);
  });
});

describe('resizeVerticalTextBoxForAutoFit', () => {
  const box = { x: 2, y: 1, w: 1, h: 4 };
  it.each([
    ['top', 1, 2], ['middle', 1.5, 2], ['bottom', 2, 2],
  ] as const)('%s anchors the growth', (verticalAlign, x, w) => {
    expect(resizeVerticalTextBoxForAutoFit(box, { requiredWidthInches: 2 }, verticalAlign)).toEqual({ ...box, x, w });
  });

  it('never shrinks an authored box', () => {
    expect(resizeVerticalTextBoxForAutoFit(box, { requiredWidthInches: 0.5, requiredHeightInches: 1 }, 'top')).toBe(box);
  });

  it('grows the column downwards when it does not wrap', () => {
    expect(resizeVerticalTextBoxForAutoFit(box, { requiredHeightInches: 5 }, 'middle')).toEqual({ ...box, h: 5 });
  });
});
