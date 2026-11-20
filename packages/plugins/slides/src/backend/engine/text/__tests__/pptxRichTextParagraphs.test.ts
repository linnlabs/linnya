import { describe, expect, it } from 'vitest';
import { splitPptxRunsIntoParagraphs } from '../pptxRichTextParagraphs';

const lineSpacing = { lineSpacingMultiple: 1.5 };

describe('splitPptxRunsIntoParagraphs', () => {
  it('ends paragraphs only at line breaks and keeps the following run in the same paragraph', () => {
    const result = splitPptxRunsIntoParagraphs([
      { text: 'a\nb ', options: { bold: true } },
      { text: 'TOKEN', options: { fontFace: 'Cambria Math' } },
      { text: ' c' },
    ], lineSpacing);

    expect(result).toEqual([
      { text: 'a', options: { bold: true, lineSpacingMultiple: 1.5, breakLine: true } },
      { text: 'b ', options: { bold: true, lineSpacingMultiple: 1.5 } },
      { text: 'TOKEN', options: { fontFace: 'Cambria Math' } },
      { text: ' c', options: {} },
    ]);
  });

  it('puts paragraph options on a run that starts a paragraph after a break', () => {
    const result = splitPptxRunsIntoParagraphs([
      { text: 'a\n', options: {} },
      { text: 'TOKEN', options: { fontFace: 'Cambria Math' } },
    ], lineSpacing);

    expect(result).toEqual([
      { text: 'a', options: { lineSpacingMultiple: 1.5, breakLine: true } },
      { text: 'TOKEN', options: { fontFace: 'Cambria Math', lineSpacingMultiple: 1.5 } },
    ]);
  });

  it('keeps empty and trailing paragraphs as empty runs with the run style', () => {
    const result = splitPptxRunsIntoParagraphs([
      { text: 'a\n\nb\n', options: { fontSize: 20 } },
    ], lineSpacing);

    expect(result.map(run => [run.text, run.options?.breakLine ?? false])).toEqual([
      ['a', true],
      ['', true],
      ['b', true],
      ['', false],
    ]);
    expect(result.every(run => run.options?.fontSize === 20 && run.options.lineSpacingMultiple === 1.5)).toBe(true);
  });

  it('does not share option objects between pieces', () => {
    const options = { bold: true };
    const result = splitPptxRunsIntoParagraphs([{ text: 'a\nb', options }]);

    expect(result[0]?.options).not.toBe(result[1]?.options);
    expect(options).toEqual({ bold: true });
  });
});
