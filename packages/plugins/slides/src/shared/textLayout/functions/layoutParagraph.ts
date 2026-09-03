import type { RenderParagraph, RenderTextRun } from '../../renderModel';
import {
  BULLET_HANGING_INDENT_INCHES,
  type TextWrapPolicy,
} from '../definitions/contract';
import type {
  RenderInlineLineSlice,
  RenderLineSlice,
  RenderTextLine,
  FontMetricsProvider,
  RunAdvanceProvider,
  RunMeasureStyle,
  TextLayoutResult,
} from '../definitions/types';
import { isRenderTextRun } from '../definitions/types';
import { combineTextLayoutAdvanceSources } from './advanceSource';
import { breakParagraphIntoLines } from './breakLines';
import { measureLineMetrics } from './lineMetrics';

const DEFAULT_FONT_SIZE_PT = 14;

export interface LayoutParagraphOptions {
  paragraph: RenderParagraph;
  paragraphIndex: number;
  usableWidthInches: number;
  wrap: TextWrapPolicy;
  provider: RunAdvanceProvider;
  fontMetricsProvider?: FontMetricsProvider;
  startY: number;
  fontScale: number;
  lineSpacingReduction?: number;
  defaultFontFamily: string;
}

export interface LayoutParagraphResult {
  lines: RenderTextLine[];
  nextY: number;
  advanceSource: TextLayoutResult['advanceSource'];
}

export function layoutParagraph(options: LayoutParagraphOptions): LayoutParagraphResult {
  const spacingBefore = pointsToInches(options.paragraph.spacingBefore ?? 0) * options.fontScale;
  const spacingAfter = pointsToInches(options.paragraph.spacingAfter ?? 0) * options.fontScale;
  const indent = Math.max(options.paragraph.indent ?? 0, 0);
  const textWidth = Math.max(options.usableWidthInches - indent, 0.01);
  const brokenLines = breakParagraphIntoLines(
    options.paragraph,
    textWidth,
    options.wrap,
    options.provider,
    (run) => resolveRunMeasureStyle(run, options.defaultFontFamily, options.fontScale),
    options.paragraphIndex,
    options.fontScale,
  );

  let y = options.startY + spacingBefore;
  const lines: RenderTextLine[] = [];

  for (const [lineIndex, brokenLine] of brokenLines.entries()) {
    const metrics = measureLineMetrics(
      options.paragraph,
      brokenLine,
      options.fontScale,
      options.lineSpacingReduction ?? 0,
      options.fontMetricsProvider,
      (run) => resolveRunMeasureStyle(run, options.defaultFontFamily, options.fontScale),
    );
    const alignOffset = resolveAlignOffset(
      options.paragraph.align,
      textWidth,
      brokenLine.width,
    );
    const textSlices: RenderInlineLineSlice[] = brokenLine.slices.map((slice) => {
      const x = roundInches(indent + alignOffset + slice.x);
      if (slice.kind === 'inlineBox') {
        const run = options.paragraph.runs[slice.runIndex];
        if (!run || isRenderTextRun(run)) {
          throw new Error('Inline formula slice lost its source run.');
        }
        const ascent = run.projection.metrics.ascent * options.fontScale;
        const descent = run.projection.metrics.descent * options.fontScale;
        return {
          ...slice,
          x,
          boxY: roundInches(y + metrics.baseline - ascent),
          height: roundInches(ascent + descent),
        };
      }
      return {
        ...slice,
        x,
        textY: roundInches(y + (metrics.textTopByRunIndex.get(slice.runIndex) ?? 0)),
      };
    });
    const slices = lineIndex === 0
      ? prependBulletSlice(
        options.paragraph,
        options.paragraphIndex,
        textSlices,
        y + (metrics.textTopByRunIndex.get(-1) ?? 0),
        options.fontScale,
      )
      : textSlices;

    lines.push({
      paragraphIndex: options.paragraphIndex,
      slices,
      y: roundInches(y),
      baseline: roundInches(metrics.baseline),
      height: roundInches(metrics.height),
      // width 表达文本本身占用的宽度，不能混入对齐偏移；否则右对齐行会被
      // 误记成“铺满内容区”，也无法识别超宽字形向 padding 区域延伸的事实。
      width: roundInches(indent + brokenLine.width),
      align: options.paragraph.align ?? 'left',
    });
    y += metrics.height;
  }

  return {
    lines,
    nextY: y + spacingAfter,
    advanceSource: combineTextLayoutAdvanceSources(
      brokenLines.map((line) => line.advanceSource),
    ),
  };
}

export function resolveRunMeasureStyle(
  run: RenderTextRun,
  defaultFontFamily: string,
  fontScale: number,
): RunMeasureStyle {
  return {
    fontFamily: run.resolvedFontFamily ?? run.fontFamily ?? defaultFontFamily,
    fontSizePt: (run.fontSize ?? DEFAULT_FONT_SIZE_PT) * fontScale,
    bold: (run.resolvedFontWeight ?? run.fontWeight) === 'bold',
    italic: (run.resolvedFontStyle ?? run.fontStyle) === 'italic',
    text: run.text,
    letterSpacingPt: run.letterSpacing == null ? undefined : run.letterSpacing * fontScale,
    script: classifyTextLayoutScript(run.text),
  };
}

function classifyTextLayoutScript(text: string): RunMeasureStyle['script'] {
  let latinCount = 0;
  let eastAsianCount = 0;
  let complexCount = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) {
      continue;
    }
    if (isEastAsianCodePoint(codePoint)) {
      eastAsianCount += 1;
    } else if (isComplexScriptCodePoint(codePoint)) {
      complexCount += 1;
    } else if (/[A-Za-z0-9]/u.test(char)) {
      latinCount += 1;
    }
  }

  if (eastAsianCount >= latinCount && eastAsianCount >= complexCount && eastAsianCount > 0) {
    return 'eastAsian';
  }
  if (complexCount > latinCount && complexCount > 0) {
    return 'complex';
  }
  return 'latin';
}

function isEastAsianCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x2E80 && codePoint <= 0x9FFF)
    || (codePoint >= 0x3040 && codePoint <= 0x30FF)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7AF)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFF00 && codePoint <= 0xFFEF);
}

function isComplexScriptCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x0590 && codePoint <= 0x08FF)
    || (codePoint >= 0x0900 && codePoint <= 0x0D7F)
    || (codePoint >= 0x0E00 && codePoint <= 0x0E7F);
}

function resolveAlignOffset(
  align: RenderParagraph['align'],
  usableWidthInches: number,
  lineWidthInches: number,
): number {
  if (align === 'center') {
    // PowerPoint 会继续相对内容区居中超宽字形，让字形进入两侧 padding；
    // 不能钳制为 0，否则极窄坐标轴标签会整体偏到右侧并被裁掉。
    return (usableWidthInches - lineWidthInches) / 2;
  }
  if (align === 'right') {
    return usableWidthInches - lineWidthInches;
  }
  return 0;
}

function prependBulletSlice(
  paragraph: RenderParagraph,
  paragraphIndex: number,
  textSlices: RenderInlineLineSlice[],
  textY: number,
  fontScale: number,
): RenderInlineLineSlice[] {
  const marker = resolveBulletMarker(paragraph.bullet, paragraphIndex);
  if (marker == null) {
    return textSlices;
  }
  const indent = Math.max(paragraph.indent ?? BULLET_HANGING_INDENT_INCHES, 0);
  const bulletWidth = BULLET_HANGING_INDENT_INCHES * fontScale;
  return [{
    paragraphIndex,
    runIndex: -1,
    text: marker,
    x: Math.max(indent - bulletWidth, 0),
    width: bulletWidth,
    textY: roundInches(textY),
    isBulletMarker: true,
  }, ...textSlices];
}

function resolveBulletMarker(
  bullet: RenderParagraph['bullet'],
  paragraphIndex: number,
): string | undefined {
  if (bullet == null) {
    return undefined;
  }
  if (bullet.char != null && bullet.char.length > 0) {
    return bullet.char;
  }
  if (bullet.type === 'decimal') {
    return `${paragraphIndex + 1}.`;
  }
  return '•';
}

function pointsToInches(value: number): number {
  return value / 72;
}

function roundInches(value: number): number {
  return Number(value.toFixed(6));
}
