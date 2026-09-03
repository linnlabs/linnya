import { describe, expect, it } from 'vitest';
import type { TextRenderNode } from '../../../../../types/render';
import { buildTextGroupConfig, buildTextLineConfigs } from '../textBuilder';

function makeTextNode(overrides: Partial<TextRenderNode> = {}): TextRenderNode {
  return {
    id: 'text-1',
    kind: 'text',
    box: { x: 1, y: 1, w: 3, h: 1, unit: 'in' },
    zIndex: 0,
    paragraphs: [{
      runs: [
        {
          text: 'Red',
          fontFamily: 'Missing Sans',
          resolvedFontFamily: 'Resolved Sans',
          fontSize: 12,
          color: '#FF0000',
        },
        {
          text: ' Bold',
          fontFamily: 'Missing Serif',
          resolvedFontFamily: 'Resolved Serif',
          fontSize: 14,
          fontWeight: 'bold',
          color: '#0000FF',
        },
      ],
    }],
    padding: { top: 0.1, left: 0.2, right: 0.1, bottom: 0.1 },
    wrap: 'word',
    ...overrides,
  };
}

describe('textBuilder', () => {
  it('renders backend layout slices without Konva wrapping', () => {
    const node = makeTextNode({
      layout: {
        lines: [{
          paragraphIndex: 0,
          y: 0.15,
          baseline: 0.13,
          height: 0.2,
          width: 1,
          align: 'left',
          slices: [
            { paragraphIndex: 0, runIndex: 0, text: 'Red', x: 0, width: 0.3, textY: 0.15 },
            { paragraphIndex: 0, runIndex: 1, text: ' Bold', x: 0.3, width: 0.5, textY: 0.15 },
          ],
        }],
        contentHeightInches: 0.2,
        appliedFontScale: 0.8,
        appliedLineSpacingReduction: 0,
        advanceSource: 'heuristic',
        overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
      },
    });

    const configs = buildTextLineConfigs(node);

    expect(configs).toHaveLength(2);
    expect(configs[0]).toEqual(expect.objectContaining({
      text: 'Red',
      wrap: 'none',
      x: 0.2 * 96,
      y: (0.1 + 0.15) * 96,
      fontFamily: 'Resolved Sans',
      fill: '#FF0000',
      fontSize: 12 * 0.8 * (96 / 72),
    }));
    expect(configs[1]).toEqual(expect.objectContaining({
      text: ' Bold',
      wrap: 'none',
      x: (0.2 + 0.3) * 96,
      fontFamily: 'Resolved Serif',
      fontStyle: 'bold',
      fill: '#0000FF',
      fontSize: 14 * 0.8 * (96 / 72),
    }));
    expect(configs[0]?.width).toBeUndefined();
    expect(configs[0]?.align).toBe('left');
  });

  it('only delegates justify spacing to Konva after backend layout', () => {
    const node = makeTextNode({
      layout: {
        lines: [{
          paragraphIndex: 0,
          y: 0,
          baseline: 0.13,
          height: 0.2,
          width: 1,
          align: 'justify',
          slices: [
            { paragraphIndex: 0, runIndex: 0, text: 'Red', x: 0, width: 0.3, textY: 0 },
          ],
        }],
        contentHeightInches: 0.2,
        appliedFontScale: 1,
        appliedLineSpacingReduction: 0,
        advanceSource: 'heuristic',
        overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
      },
    });

    expect(buildTextLineConfigs(node)[0]).toMatchObject({
      align: 'justify',
      width: 0.3 * 96 + 1,
    });
  });

  it('paints the resolved face style when it differs from the author request', () => {
    const node = makeTextNode({
      paragraphs: [{
        runs: [{
          text: '正文',
          fontFamily: 'Missing CJK',
          resolvedFontFamily: 'Resolved CJK',
          fontWeight: 'normal',
          resolvedFontWeight: 'bold',
          resolvedFontStyle: 'normal',
          fontSize: 18,
        }],
      }],
      layout: {
        lines: [{
          paragraphIndex: 0,
          y: 0,
          baseline: 0.2,
          height: 0.25,
          width: 0.5,
          align: 'left',
          slices: [{ paragraphIndex: 0, runIndex: 0, text: '正文', x: 0, width: 0.5, textY: 0 }],
        }],
        contentHeightInches: 0.25,
        appliedFontScale: 1,
        appliedLineSpacingReduction: 0,
        advanceSource: 'harfbuzz',
        overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
      },
    });

    expect(buildTextLineConfigs(node)[0]).toMatchObject({
      fontFamily: 'Resolved CJK',
      fontStyle: 'bold',
    });
  });

  it('does not use backend advance as a Konva paint clipping boundary', () => {
    const node = makeTextNode({
      box: { x: 0.7, y: 1.23, w: 2.15, h: 0.22, unit: 'in' },
      paragraphs: [{
        runs: [{
          text: 'DESIGNED TENSION',
          fontFamily: 'Avenir Next',
          resolvedFontFamily: 'Avenir Next',
          fontSize: 6.8,
          fontWeight: 'bold',
          letterSpacing: 1.55,
        }],
      }],
      layout: {
        lines: [{
          paragraphIndex: 0,
          y: 0,
          baseline: 0.075556,
          height: 0.094444,
          width: 1.231472,
          align: 'left',
          slices: [{
            paragraphIndex: 0,
            runIndex: 0,
            text: 'DESIGNED TENSION',
            x: 0,
            width: 1.231468,
            textY: 0,
          }],
        }],
        contentHeightInches: 0.094444,
        appliedFontScale: 1,
        appliedLineSpacingReduction: 0,
        advanceSource: 'heuristic',
        overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
      },
    });

    expect(buildTextLineConfigs(node)[0]).toMatchObject({
      text: 'DESIGNED TENSION',
      align: 'left',
      wrap: 'none',
    });
    expect(buildTextLineConfigs(node)[0]).not.toHaveProperty('width');
    expect(buildTextGroupConfig(node)).toMatchObject({
      clipWidth: 2.15 * 96,
    });
  });

  it('requires shared backend layout instead of running a renderer wrap fallback', () => {
    expect(() => buildTextLineConfigs(makeTextNode()))
      .toThrow('missing shared text layout');
  });

  it('clips clip/ellipsis nodes to the outer text box so glyphs may enter padding', () => {
    const clipConfig = buildTextGroupConfig(makeTextNode({ overflow: 'clip' }));
    expect(clipConfig.clipX).toBe(0);
    expect(clipConfig.clipY).toBe(0);
    expect(clipConfig.clipWidth).toBeCloseTo(3 * 96);
    expect(clipConfig.clipHeight).toBeCloseTo(1 * 96);

    const narrowAxisLabel = buildTextGroupConfig(makeTextNode({
      box: { x: 5.18, y: 2.98, w: 0.18, h: 0.84, unit: 'in' },
      padding: { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 },
      overflow: 'clip',
    }));
    expect(narrowAxisLabel.clipWidth).toBeCloseTo(0.18 * 96);
    expect(buildTextGroupConfig(makeTextNode({ overflow: 'visible' })))
      .not.toHaveProperty('clipWidth');
  });
});
