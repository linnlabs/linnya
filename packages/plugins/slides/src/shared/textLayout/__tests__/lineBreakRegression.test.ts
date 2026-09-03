import { describe, expect, it } from 'vitest';
import type { RenderParagraph, RunAdvanceProvider, RunMeasureStyle } from '@plugin/slides/shared';
import { breakParagraphIntoLines } from '../index';

const ADVANCE_INCHES = 0.1;

const fixedAdvanceProvider: RunAdvanceProvider = {
  getClusterAdvances: (clusters) => ({
    advances: clusters.map(() => ADVANCE_INCHES),
    source: 'heuristic',
  }),
};

const resolveStyle = (): RunMeasureStyle => ({
  fontFamily: 'Regression',
  fontSizePt: 12,
  bold: false,
  italic: false,
});

function paragraph(text: string): RenderParagraph {
  return {
    runs: [{ text }],
  };
}

function lineTexts(
  text: string,
  usableClusters: number,
  wrap: 'word' | 'char' | 'none' = 'word',
): string[] {
  return breakParagraphIntoLines(
    paragraph(text),
    usableClusters * ADVANCE_INCHES,
    wrap,
    fixedAdvanceProvider,
    resolveStyle,
  ).map((line) => line.slices.map((slice) => slice.text).join(''));
}

describe('line-break regressions', () => {
  it('keeps pass@1 together and breaks only after the token boundary', () => {
    expect(lineTexts('pass@1 status', 'pass@1'.length)).toEqual([
      'pass@1 ',
      'status',
    ]);
  });

  it('keeps currency amounts such as £720 together', () => {
    expect(lineTexts('£720 due', '£720'.length)).toEqual([
      '£720 ',
      'due',
    ]);
  });

  it('keeps email addresses together when the full token fits', () => {
    const email = 'ops@example.com';

    expect(lineTexts(`${email} ok`, email.length)).toEqual([
      `${email} `,
      'ok',
    ]);
  });

  it('keeps URL tokens together unless an explicit break opportunity is introduced', () => {
    const url = 'https://linnya.ai/a1';

    expect(lineTexts(`${url} ok`, url.length)).toEqual([
      `${url} `,
      'ok',
    ]);
  });

  it('uses CJK break opportunities without requiring whitespace', () => {
    expect(lineTexts('中文混排继续', 3)).toEqual([
      '中文混',
      '排继续',
    ]);
  });

  it('keeps mixed CJK and punctuation decisions inside the shared engine', () => {
    expect(lineTexts('价格£720，然后继续', 5)).toEqual([
      '价格',
      '£720，',
      '然后继续',
    ]);
  });

  it('does not place closing punctuation at the beginning of a line', () => {
    const lines = lineTexts('你好，世界', 2);

    expect(lines).toEqual(['你', '好，', '世界']);
    expect(lines.every((line) => !line.startsWith('，'))).toBe(true);
  });

  it('does not leave opening punctuation at the end of a line', () => {
    const lines = lineTexts('他说（你好）', 3);

    expect(lines.every((line) => !line.endsWith('（'))).toBe(true);
  });

  it('applies kinsoku filtering to char wrap as well as word wrap', () => {
    expect(lineTexts('A（B', 2, 'char')).toEqual([
      'A',
      '（B',
    ]);
  });

  it('splits a long English word by cluster only when no token boundary exists', () => {
    expect(lineTexts('superlongword', 5)).toEqual([
      'super',
      'longw',
      'ord',
    ]);
  });
});
