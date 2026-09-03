import { describe, expect, it } from 'vitest';
import type { RenderParagraph, RunAdvanceProvider, RunMeasureStyle } from '@plugin/slides/shared';
import { breakParagraphIntoLines } from '../index';

const fixedAdvanceProvider: RunAdvanceProvider = {
  getClusterAdvances: (clusters) => ({
    advances: clusters.map(() => 0.1),
    source: 'heuristic',
  }),
};

const resolveStyle = (): RunMeasureStyle => ({
  fontFamily: 'Test',
  fontSizePt: 12,
  bold: false,
  italic: false,
});

function paragraph(text: string): RenderParagraph {
  return {
    runs: [{ text }],
  };
}

function lineTexts(lines: ReturnType<typeof breakParagraphIntoLines>): string[] {
  return lines.map((line) => line.slices.map((slice) => slice.text).join(''));
}

describe('breakParagraphIntoLines', () => {
  it('word wrap rolls back to the nearest break opportunity', () => {
    const lines = breakParagraphIntoLines(
      paragraph('aaa bb'),
      0.45,
      'word',
      fixedAdvanceProvider,
      resolveStyle,
    );

    expect(lineTexts(lines)).toEqual(['aaa ', 'bb']);
  });

  it('splits long words by cluster when no word break exists', () => {
    const lines = breakParagraphIntoLines(
      paragraph('aaaaaa'),
      0.45,
      'word',
      fixedAdvanceProvider,
      resolveStyle,
    );

    expect(lineTexts(lines)).toEqual(['aaaa', 'aa']);
  });

  it('char wrap may break at any cluster', () => {
    const lines = breakParagraphIntoLines(
      paragraph('aaab'),
      0.25,
      'char',
      fixedAdvanceProvider,
      resolveStyle,
    );

    expect(lineTexts(lines)).toEqual(['aa', 'ab']);
  });

  it('none wrap returns one unbroken line', () => {
    const lines = breakParagraphIntoLines(
      paragraph('aaaaaa'),
      0.25,
      'none',
      fixedAdvanceProvider,
      resolveStyle,
    );

    expect(lineTexts(lines)).toEqual(['aaaaaa']);
  });

  it('keeps run slices when a paragraph wraps across runs', () => {
    const lines = breakParagraphIntoLines(
      {
        runs: [{ text: 'aaa ' }, { text: 'bbb' }],
      },
      0.45,
      'word',
      fixedAdvanceProvider,
      resolveStyle,
    );

    expect(lines[0]?.slices).toEqual([
      expect.objectContaining({ runIndex: 0, text: 'aaa ' }),
    ]);
    expect(lines[1]?.slices).toEqual([
      expect.objectContaining({ runIndex: 1, text: 'bbb' }),
    ]);
  });

  it('does not count trailing whitespace in line width', () => {
    const lines = breakParagraphIntoLines(
      paragraph('aa bb'),
      0.35,
      'word',
      fixedAdvanceProvider,
      resolveStyle,
    );

    expect(lines[0]?.slices.map((slice) => slice.text).join('')).toBe('aa ');
    expect(lines[0]?.width).toBe(0.2);
  });

  it('preserves an OOXML soft break as a forced line break for every wrap policy', () => {
    for (const wrap of ['word', 'char', 'none'] as const) {
      const lines = breakParagraphIntoLines(
        { runs: [{ text: 'first' }, { text: '\n' }, { text: 'second' }] },
        10,
        wrap,
        fixedAdvanceProvider,
        resolveStyle,
      );
      expect(lineTexts(lines)).toEqual(['first', 'second']);
    }
  });
});
