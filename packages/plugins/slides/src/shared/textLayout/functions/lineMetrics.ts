import type { RenderInlineRun, RenderLineSpacing, RenderParagraph, RenderTextRun } from '../../renderModel';
import { DEFAULT_TEXT_LINE_SPACING } from '../definitions/lineSpacing';
import type {
  FontLineMetrics,
  FontMetricsProvider,
  RunMeasureStyle,
  TextRunStyleResolver,
} from '../definitions/types';
import { MathFormulaError } from '../../mathFormula';
import { isRenderTextRun } from '../definitions/types';
import type { BrokenLine } from './breakLines';

const DEFAULT_FONT_SIZE_PT = 14;
const POINTS_PER_INCH = 72;

export interface TextLineMetrics {
  height: number;
  baseline: number;
  textTopByRunIndex: ReadonlyMap<number, number>;
}

export function measureLineMetrics(
  paragraph: RenderParagraph,
  line: BrokenLine,
  fontScale: number,
  lineSpacingReduction: number = 0,
  fontMetricsProvider?: FontMetricsProvider,
  resolveRunStyle?: TextRunStyleResolver,
): TextLineMetrics {
  const runIndexes = new Set(line.slices.map((slice) => slice.runIndex));
  if (runIndexes.size === 0) {
    runIndexes.add(0);
  }
  if (paragraph.bullet) {
    runIndexes.add(-1);
  }
  const runMetrics = Array.from(runIndexes, (runIndex) => measureRunLineMetrics(
    resolveMetricsRun(paragraph, runIndex),
    paragraph.lineSpacing,
    fontScale,
    lineSpacingReduction,
    fontMetricsProvider,
    resolveRunStyle,
    runIndex,
  ));
  const height = Math.max(...runMetrics.map((metrics) => metrics.height));
  const maxAscent = Math.max(...runMetrics.map((metrics) => metrics.ascent));
  const maxDescent = Math.max(...runMetrics.map((metrics) => metrics.descent));
  const baseline = maxAscent + Math.max(height - maxAscent - maxDescent, 0) / 2;
  return {
    height,
    baseline,
    textTopByRunIndex: new Map(runMetrics.map((metrics) => [
      metrics.runIndex,
      baseline - metrics.ascent,
    ])),
  };
}

interface ResolvedRunLineMetrics {
  runIndex: number;
  height: number;
  ascent: number;
  descent: number;
}

function measureRunLineMetrics(
  run: RenderInlineRun | undefined,
  paragraphLineSpacing: RenderLineSpacing | undefined,
  fontScale: number,
  lineSpacingReduction: number,
  fontMetricsProvider: FontMetricsProvider | undefined,
  resolveRunStyle: TextRunStyleResolver | undefined,
  runIndex: number,
): ResolvedRunLineMetrics {
  if (run && !isRenderTextRun(run)) {
    const ascent = run.projection.metrics.ascent * fontScale;
    const descent = run.projection.metrics.descent * fontScale;
    const naturalHeight = ascent + descent;
    const spacing = resolveEffectiveLineSpacing(paragraphLineSpacing);
    if (spacing.kind === 'exactPt' && spacing.value / POINTS_PER_INCH < naturalHeight) {
      throw new MathFormulaError(
        'slides.formula.inline_formula_line_height_insufficient',
        'The exact line height cannot contain the inline formula.',
      );
    }
    const lineSpacingHeight = spacing.kind === 'exactPt'
      ? spacing.value / POINTS_PER_INCH
      : naturalHeight * spacing.value;
    return {
      runIndex,
      height: Math.max(
        naturalHeight,
        lineSpacingHeight * Math.max(1 - lineSpacingReduction, 0),
      ),
      ascent,
      descent,
    };
  }
  const fontSizePt = (run?.fontSize ?? DEFAULT_FONT_SIZE_PT) * fontScale;
  const fontSizeInches = fontSizePt / POINTS_PER_INCH;
  const naturalMetrics = resolveNaturalLineMetrics(run, fontSizeInches, fontMetricsProvider, resolveRunStyle);
  const spacing = resolveEffectiveLineSpacing(paragraphLineSpacing);
  const reductionScale = Math.max(1 - lineSpacingReduction, 0);
  const height = resolveLineSpacingHeight(spacing, fontSizeInches) * reductionScale;
  return {
    runIndex,
    height,
    ascent: naturalMetrics.ascent,
    descent: naturalMetrics.descent,
  };
}

function resolveMetricsRun(paragraph: RenderParagraph, runIndex: number): RenderInlineRun | undefined {
  const fallbackRun = paragraph.runs[0];
  if (runIndex >= 0) {
    return paragraph.runs[runIndex] ?? fallbackRun;
  }
  if (!fallbackRun || !isRenderTextRun(fallbackRun) || paragraph.bullet?.fontSize == null) {
    return fallbackRun;
  }
  return {
    ...fallbackRun,
    fontSize: paragraph.bullet.fontSize,
  };
}

function resolveNaturalLineMetrics(
  run: RenderTextRun | undefined,
  fontSizeInches: number,
  fontMetricsProvider: FontMetricsProvider | undefined,
  resolveRunStyle: TextRunStyleResolver | undefined,
): FontLineMetrics {
  const style = run && resolveRunStyle ? resolveRunStyle(run) : undefined;
  const providerMetrics = style ? fontMetricsProvider?.getMetrics(style) : undefined;
  if (providerMetrics) {
    return providerMetrics;
  }
  return {
    ascent: fontSizeInches * 0.8,
    descent: fontSizeInches * 0.2,
    lineGap: 0,
  };
}

function resolveEffectiveLineSpacing(
  paragraphLineSpacing: RenderLineSpacing | undefined,
): RenderLineSpacing {
  if (paragraphLineSpacing) {
    return paragraphLineSpacing;
  }
  return DEFAULT_TEXT_LINE_SPACING;
}

function resolveLineSpacingHeight(
  spacing: RenderLineSpacing,
  fontSizeInches: number,
): number {
  if (spacing.kind === 'multiple') {
    return fontSizeInches * spacing.value;
  }
  return spacing.value / POINTS_PER_INCH;
}
