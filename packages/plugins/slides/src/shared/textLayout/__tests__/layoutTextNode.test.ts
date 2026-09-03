import { describe, expect, it } from 'vitest';
import type {
  RunAdvanceProvider,
  TextLayoutContract,
  TextLayoutInput,
} from '@plugin/slides/shared';
import {
  NORM_AUTOFIT_FONT_SCALE_CANDIDATES,
  layoutTextNode,
  resolveTextLayoutFontScaleCandidates,
} from '../index';

const fixedAdvanceProvider: RunAdvanceProvider = {
  getClusterAdvances: (clusters) => ({
    advances: clusters.map(() => 0.1),
    source: 'heuristic',
  }),
};

function baseContract(overrides: Partial<TextLayoutContract> = {}): TextLayoutContract {
  return {
    profile: 'plain-textbox',
    sourceKind: 'generated',
    box: { x: 0, y: 0, w: 1, h: 1 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    wrap: 'word',
    lineBreak: 'office-compatible',
    autoFitPolicy: 'none',
    overflow: 'clip',
    verticalAlign: 'top',
    font: {},
    ...overrides,
  };
}

function layoutInput(overrides: Partial<TextLayoutInput> = {}): TextLayoutInput {
  return {
    defaultFontFamily: 'Arial',
    contract: baseContract(),
    paragraphs: [{
      lineSpacing: { kind: 'multiple', value: 1 },
      runs: [{
        text: 'aaaa aaaa aaaa',
        fontSize: 12,
      }],
    }],
    ...overrides,
  };
}

describe('layoutTextNode', () => {
  it('moves lines down for bottom vertical alignment', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 3, h: 1 },
          verticalAlign: 'bottom',
        }),
        paragraphs: [{
          lineSpacing: { kind: 'multiple', value: 1 },
          runs: [{ text: 'short', fontSize: 12 }],
        }],
      }),
      fixedAdvanceProvider,
    );

    expect(result.lines[0]?.y).toBeGreaterThan(0.7);
  });

  it('preserves justify alignment in line layout', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({ box: { x: 0, y: 0, w: 3, h: 1 } }),
        paragraphs: [{
          align: 'justify',
          runs: [{ text: 'justified text', fontSize: 12 }],
        }],
      }),
      fixedAdvanceProvider,
    );

    expect(result.lines[0]?.align).toBe('justify');
  });

  it('keeps narrow chart-axis glyphs aligned inside the outer box instead of pinning them to padding', () => {
    const axisAdvanceProvider: RunAdvanceProvider = {
      getClusterAdvances: (clusters) => ({
        advances: clusters.map(() => 0.058),
        source: 'heuristic',
      }),
    };
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 5.33, y: 2.68, w: 0.23, h: 0.14 },
          padding: { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 },
          autoFitPolicy: 'resize-shape',
          verticalAlign: 'middle',
        }),
        paragraphs: [{
          align: 'right',
          lineSpacing: { kind: 'multiple', value: 1.18 },
          runs: [{ text: '80', fontSize: 6.7 }],
        }],
      }),
      axisAdvanceProvider,
    );

    expect(result.lines.map((line) => line.slices.map((slice) => slice.text).join('')))
      .toEqual(['8', '0']);
    for (const line of result.lines) {
      const slice = line.slices[0];
      expect(slice?.x).toBeCloseTo(-0.028, 6);
      // 加回左 padding 后，完整字形仍落在 0.23in 的文本框外边界内。
      expect(0.1 + (slice?.x ?? 0)).toBeGreaterThanOrEqual(0);
      expect(0.1 + (slice?.x ?? 0) + (slice?.width ?? 0)).toBeLessThanOrEqual(0.23);
    }
    expect(result.overflow.horizontal).toBe(true);
    expect(result.requiredHeightInches).toBeGreaterThan(0.14);
  });

  it('shrinks text when shrink-text autofit is needed', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 0.45, h: 0.22 },
          autoFitPolicy: 'shrink-text',
        }),
      }),
      fixedAdvanceProvider,
    );

    expect(result.appliedFontScale).toBeLessThan(1);
    expect(result.contentHeightInches).toBeLessThanOrEqual(0.22);
    expect(result.appliedLineSpacingReduction).toBeCloseTo(0.2 * (1 - result.appliedFontScale), 6);
  });

  it('selects the largest fitting normAutofit scale from discrete candidates', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 3, h: 0.13 },
          autoFitPolicy: 'shrink-text',
        }),
        paragraphs: [{
          lineSpacing: { kind: 'multiple', value: 1 },
          runs: [{ text: 'short', fontSize: 12 }],
        }],
      }),
      fixedAdvanceProvider,
    );

    expect(result.appliedFontScale).toBe(0.8);
    expect(result.appliedLineSpacingReduction).toBeCloseTo(0.04, 6);
  });

  it('searches normAutofit candidates without linearly scanning every scale', () => {
    let advanceCalls = 0;
    const countingProvider: RunAdvanceProvider = {
      getClusterAdvances: (clusters) => {
        advanceCalls += 1;
        return {
          advances: clusters.map(() => 0.1),
          source: 'heuristic',
        };
      },
    };

    layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 3, h: 0.13 },
          autoFitPolicy: 'shrink-text',
        }),
        paragraphs: [{
          lineSpacing: { kind: 'multiple', value: 1 },
          runs: [{ text: 'short', fontSize: 12 }],
        }],
      }),
      countingProvider,
    );

    expect(advanceCalls).toBeLessThan(NORM_AUTOFIT_FONT_SCALE_CANDIDATES.length);
    expect(advanceCalls).toBeLessThanOrEqual(5);
  });

  it('uses the shared normAutofit scale list and title lower bound', () => {
    expect(resolveTextLayoutFontScaleCandidates('shrink-text')).toEqual([
      ...NORM_AUTOFIT_FONT_SCALE_CANDIDATES,
    ]);
    expect(resolveTextLayoutFontScaleCandidates('shrink-text', 'title-textbox')).toEqual([
      1,
      0.95,
      0.9,
    ]);
  });

  it('does not shrink resize-shape text', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 0.45, h: 0.22 },
          autoFitPolicy: 'resize-shape',
        }),
      }),
      fixedAdvanceProvider,
    );

    expect(result.appliedFontScale).toBe(1);
    expect(result.contentHeightInches).toBeGreaterThan(0.22);
    expect(result.requiredHeightInches).toBeCloseTo(result.contentHeightInches, 6);
  });

  it('returns required outer height for resize-shape text including padding', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 0.45, h: 0.22 },
          padding: { top: 0.05, right: 0, bottom: 0.07, left: 0 },
          autoFitPolicy: 'resize-shape',
        }),
      }),
      fixedAdvanceProvider,
    );

    expect(result.requiredHeightInches).toBeCloseTo(result.contentHeightInches + 0.12, 6);
  });

  it('returns an empty layout for empty paragraph input', () => {
    const result = layoutTextNode(
      layoutInput({ paragraphs: [] }),
      fixedAdvanceProvider,
    );

    expect(result.lines).toEqual([]);
    expect(result.contentHeightInches).toBe(0);
  });

  it('marks the whole layout heuristic when any run falls back from measured advances', () => {
    let callIndex = 0;
    const mixedProvider: RunAdvanceProvider = {
      getClusterAdvances: (clusters) => {
        callIndex += 1;
        return {
          advances: clusters.map(() => 0.1),
          source: callIndex === 1 ? 'pretext' : 'heuristic',
        };
      },
    };

    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({ box: { x: 0, y: 0, w: 3, h: 1 } }),
        paragraphs: [{
          runs: [
            { text: 'first', fontSize: 12 },
            { text: 'second', fontSize: 12 },
          ],
        }],
      }),
      mixedProvider,
    );

    expect(result.advanceSource).toBe('heuristic');
  });

  it('resolves vertical ellipsis in the shared layout result', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 0.45, h: 0.17 },
          overflow: 'ellipsis',
        }),
      }),
      fixedAdvanceProvider,
    );

    expect(result.overflow).toEqual({
      horizontal: false,
      vertical: true,
      hiddenLineCount: 2,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.slices.map((slice) => slice.text).join('')).toMatch(/…$/u);
  });

  it('resolves horizontal no-wrap ellipsis before the renderer', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({
          box: { x: 0, y: 0, w: 0.25, h: 1 },
          wrap: 'none',
          overflow: 'ellipsis',
        }),
      }),
      fixedAdvanceProvider,
    );

    expect(result.overflow.horizontal).toBe(true);
    expect(result.lines[0]?.slices.map((slice) => slice.text).join('')).toMatch(/…$/u);
    expect(result.lines[0]?.slices.reduce(
      (right, slice) => Math.max(right, slice.x + slice.width),
      0,
    )).toBeLessThanOrEqual(0.25);
  });

  it('reports clip overflow without dropping backend layout lines', () => {
    const result = layoutTextNode(
      layoutInput({
        contract: baseContract({ box: { x: 0, y: 0, w: 0.45, h: 0.17 } }),
      }),
      fixedAdvanceProvider,
    );

    expect(result.overflow.vertical).toBe(true);
    expect(result.lines).toHaveLength(3);
  });
});
