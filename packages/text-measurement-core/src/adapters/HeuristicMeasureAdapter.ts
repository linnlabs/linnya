import type {
  ClusterAdvanceMeasureResult,
  NormalizedTextMeasureInput,
  NormalizedClusterAdvanceRequest,
  TextMeasureAdapter,
  TextMeasureLine,
  TextMeasureResult,
  TextMeasureStyle,
  TextMeasureWrapMode,
} from '../definitions/types.js';
import { pointsToInches } from '../functions/UnitConverter.js';

const CJK_RANGES: Array<readonly [number, number]> = [
  [0x4E00, 0x9FFF],
  [0x3400, 0x4DBF],
  [0x3000, 0x303F],
  [0xFF00, 0xFFEF],
  [0x3040, 0x309F],
  [0x30A0, 0x30FF],
];

function isCjkCodePoint(codePoint: number): boolean {
  return CJK_RANGES.some(([lower, upper]) => codePoint >= lower && codePoint <= upper);
}

function isEmojiGrapheme(grapheme: string): boolean {
  return /\p{Extended_Pictographic}/u.test(grapheme);
}

function isWhitespace(grapheme: string): boolean {
  return /^\s$/u.test(grapheme);
}

function measureGraphemeWidthInches(grapheme: string, style: TextMeasureStyle): number {
  const fontSizeInches = pointsToInches(style.fontSizePt);
  if (grapheme.length === 0) {
    return 0;
  }
  if (isWhitespace(grapheme)) {
    return fontSizeInches * 0.32;
  }
  if (isEmojiGrapheme(grapheme)) {
    return fontSizeInches;
  }

  const codePoint = grapheme.codePointAt(0);
  if (typeof codePoint === 'number' && isCjkCodePoint(codePoint)) {
    return fontSizeInches;
  }
  if (/[.,:;'"`|!]/u.test(grapheme)) {
    return fontSizeInches * 0.24;
  }
  if (/[()[\]{}]/u.test(grapheme)) {
    return fontSizeInches * 0.3;
  }
  if (/[MW@#%&]/u.test(grapheme)) {
    return fontSizeInches * 0.82;
  }
  if (/[A-Z0-9]/u.test(grapheme)) {
    return fontSizeInches * 0.62;
  }
  return fontSizeInches * 0.56;
}

function measureTextWidthInches(text: string, style: TextMeasureStyle): number {
  const graphemes = Array.from(text);
  const letterSpacingInches = pointsToInches(style.letterSpacingPt ?? 0);
  return graphemes.reduce((sum, grapheme, index) => {
    const baseWidth = measureGraphemeWidthInches(grapheme, style);
    return sum + baseWidth + (index > 0 ? letterSpacingInches : 0);
  }, 0);
}

function measureClusterAdvanceInches(
  grapheme: string,
  style: TextMeasureStyle,
  index: number,
): number {
  const letterSpacingInches = pointsToInches(style.letterSpacingPt ?? 0);
  return measureGraphemeWidthInches(grapheme, style)
    + (index > 0 ? letterSpacingInches : 0);
}

function layoutRawLine(
  text: string,
  maxWidthInches: number,
  style: TextMeasureStyle,
  wrap: TextMeasureWrapMode,
): TextMeasureLine[] {
  if (wrap === 'none' || maxWidthInches <= 0) {
    return [{
      text,
      widthInches: measureTextWidthInches(text, style),
    }];
  }

  if (text.length === 0) {
    return [{ text: '', widthInches: 0 }];
  }

  const graphemes = Array.from(text);
  const lines: TextMeasureLine[] = [];
  const letterSpacingInches = pointsToInches(style.letterSpacingPt ?? 0);
  let lineStart = 0;
  let lineWidth = 0;
  let index = 0;
  let lastBreakIndex = -1;

  while (index < graphemes.length) {
    const grapheme = graphemes[index]!;
    const candidateWidth = lineWidth
      + measureGraphemeWidthInches(grapheme, style)
      + (lineWidth > 0 ? letterSpacingInches : 0);
    const breakable = wrap === 'char' || isWhitespace(grapheme);
    if (breakable) {
      lastBreakIndex = index;
    }

    if (lineWidth > 0 && candidateWidth > maxWidthInches) {
      if (wrap === 'word' && lastBreakIndex >= lineStart) {
        const lineText = graphemes.slice(lineStart, lastBreakIndex).join('').trimEnd();
        lines.push({
          text: lineText,
          widthInches: measureTextWidthInches(lineText, style),
        });
        index = lastBreakIndex + 1;
        while (index < graphemes.length && isWhitespace(graphemes[index]!)) {
          index += 1;
        }
      } else {
        const lineText = graphemes.slice(lineStart, index).join('');
        lines.push({
          text: lineText,
          widthInches: measureTextWidthInches(lineText, style),
        });
      }
      lineStart = index;
      lineWidth = 0;
      lastBreakIndex = -1;
      continue;
    }

    lineWidth = candidateWidth;
    index += 1;
  }

  const finalText = graphemes.slice(lineStart).join('');
  lines.push({
    text: finalText,
    widthInches: measureTextWidthInches(finalText, style),
  });

  return lines;
}

function layoutParagraph(
  text: string,
  maxWidthInches: number,
  style: TextMeasureStyle,
  wrap: TextMeasureWrapMode,
): TextMeasureLine[] {
  const hardLines = text.split('\n');
  const lines: TextMeasureLine[] = [];
  for (const hardLine of hardLines) {
    lines.push(...layoutRawLine(hardLine, maxWidthInches, style, wrap));
  }
  return lines.length > 0 ? lines : [{ text: '', widthInches: 0 }];
}

export class HeuristicMeasureAdapter implements TextMeasureAdapter {
  readonly kind = 'heuristic';

  measure(input: NormalizedTextMeasureInput): TextMeasureResult {
    const lineHeightInches = pointsToInches(input.style.fontSizePt) * input.style.lineHeightMultiplier;
    const contentLines: TextMeasureLine[] = [];
    let contentHeightInches = 0;
    let maxLineWidthInches = 0;

    for (const paragraph of input.paragraphs) {
      const paragraphWidth = Math.max(
        0.05,
        input.box.usableWidthInches - Math.max(paragraph.indentInches ?? 0, 0),
      );
      const lines = layoutParagraph(
        paragraph.text,
        paragraphWidth,
        input.style,
        input.box.wrap,
      );
      contentLines.push(...lines);
      contentHeightInches += pointsToInches(paragraph.spacingBeforePt ?? 0);
      contentHeightInches += pointsToInches(paragraph.spacingAfterPt ?? 0);
      contentHeightInches += lines.length * lineHeightInches;
      for (const line of lines) {
        maxLineWidthInches = Math.max(maxLineWidthInches, line.widthInches + Math.max(paragraph.indentInches ?? 0, 0));
      }
    }

    const totalHeightInches = contentHeightInches
      + input.box.padding.top
      + input.box.padding.bottom;
    const tolerance = 0.01;
    const fitsWidth = maxLineWidthInches <= input.box.usableWidthInches + tolerance;
    const fitsHeight = input.box.usableHeightInches == null
      ? undefined
      : totalHeightInches <= input.box.usableHeightInches + input.box.padding.top + input.box.padding.bottom + tolerance;

    return {
      lineCount: contentLines.length,
      contentHeightInches: Number(contentHeightInches.toFixed(3)),
      totalHeightInches: Number(totalHeightInches.toFixed(3)),
      maxLineWidthInches: Number(maxLineWidthInches.toFixed(3)),
      lines: contentLines,
      usedFallback: true,
      warnings: [],
      fitsWidth,
      fitsHeight,
    };
  }

  measureClusterAdvances(request: NormalizedClusterAdvanceRequest): number[] {
    return this.measureClusterAdvancesWithSource(request).advances;
  }

  measureClusterAdvancesWithSource(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    return {
      advances: this.measureClusterAdvancesWithoutSource(request),
      source: 'heuristic',
    };
  }

  private measureClusterAdvancesWithoutSource(request: NormalizedClusterAdvanceRequest): number[] {
    return request.clusters.map((cluster, index) =>
      measureClusterAdvanceInches(cluster, request.style, index));
  }
}
