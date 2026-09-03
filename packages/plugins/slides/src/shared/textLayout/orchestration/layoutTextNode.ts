import {
  NORM_AUTOFIT_FONT_SCALE_CANDIDATES,
  NORM_AUTOFIT_LINE_SPACING_REDUCTION_FACTOR,
  TITLE_TEXTBOX_MIN_AUTOFIT_SCALE,
  type TextLayoutContract,
} from '../definitions/contract';
import type {
  RenderTextLine,
  FontMetricsProvider,
  RunAdvanceProvider,
  TextLayoutInput,
  TextLayoutResult,
} from '../definitions/types';
import { combineTextLayoutAdvanceSources } from '../functions/advanceSource';
import { applyEllipsisOverflow } from '../functions/applyEllipsisOverflow';
import { layoutParagraph } from '../functions/layoutParagraph';

export function layoutTextNode(
  input: TextLayoutInput,
  provider: RunAdvanceProvider,
  fontMetricsProvider?: FontMetricsProvider,
): TextLayoutResult {
  if (input.contract.autoFitPolicy !== 'shrink-text') {
    return layoutAtScale(input, provider, fontMetricsProvider, 1, 0);
  }

  return layoutShrinkText(input, provider, fontMetricsProvider);
}

function layoutShrinkText(
  input: TextLayoutInput,
  provider: RunAdvanceProvider,
  fontMetricsProvider: FontMetricsProvider | undefined,
): TextLayoutResult {
  const candidates = resolveTextLayoutFontScaleCandidates(input.contract.autoFitPolicy, input.contract.profile);
  const usableHeight = usableContentHeight(input.contract);
  let lower = 0;
  let upper = candidates.length - 1;
  let best: TextLayoutResult | undefined;

  while (lower <= upper) {
    const index = Math.floor((lower + upper) / 2);
    const scale = candidates[index]!;
    const result = layoutAtScale(
      input,
      provider,
      fontMetricsProvider,
      scale,
      resolveNormAutofitLineSpacingReduction(scale),
    );

    if (result.contentHeightInches <= usableHeight) {
      best = result;
      upper = index - 1;
    } else {
      lower = index + 1;
    }
  }

  return best ?? layoutAtScale(
    input,
    provider,
    fontMetricsProvider,
    candidates[candidates.length - 1]!,
    resolveNormAutofitLineSpacingReduction(candidates[candidates.length - 1]!),
  );
}

function layoutAtScale(
  input: TextLayoutInput,
  provider: RunAdvanceProvider,
  fontMetricsProvider: FontMetricsProvider | undefined,
  scale: number,
  lineSpacingReduction: number,
): TextLayoutResult {
  const usableWidth = usableContentWidth(input.contract);
  let nextY = 0;
  const lines: RenderTextLine[] = [];
  const advanceSources: TextLayoutResult['advanceSource'][] = [];

  input.paragraphs.forEach((paragraph, paragraphIndex) => {
    const result = layoutParagraph({
      paragraph,
      paragraphIndex,
      usableWidthInches: usableWidth,
      wrap: input.contract.wrap,
      provider,
      fontMetricsProvider,
      startY: nextY,
      fontScale: scale,
      lineSpacingReduction,
      defaultFontFamily: input.defaultFontFamily,
    });
    lines.push(...result.lines);
    advanceSources.push(result.advanceSource);
    nextY = result.nextY;
  });

  const contentHeightInches = Number(nextY.toFixed(6));
  const verticalOffset = resolveVerticalOffset(
    usableContentHeight(input.contract),
    contentHeightInches,
    input.contract.verticalAlign,
  );
  const overflowResolution = applyEllipsisOverflow(
    lines,
    input.paragraphs,
    input.contract,
    provider,
    input.defaultFontFamily,
    scale,
  );

  return {
    lines: overflowResolution.lines.map((line) => ({
      ...line,
      y: Number((line.y + verticalOffset).toFixed(6)),
      slices: line.slices.map((slice) => ({
        ...slice,
        ...(slice.kind === 'inlineBox'
          ? { boxY: Number((slice.boxY + verticalOffset).toFixed(6)) }
          : { textY: Number((slice.textY + verticalOffset).toFixed(6)) }),
      })),
    })),
    contentHeightInches,
    ...(input.contract.autoFitPolicy === 'resize-shape'
      ? { requiredHeightInches: resolveRequiredHeight(input.contract, contentHeightInches) }
      : {}),
    appliedFontScale: scale,
    appliedLineSpacingReduction: lineSpacingReduction,
    advanceSource: combineTextLayoutAdvanceSources([
      ...advanceSources,
      overflowResolution.advanceSource,
    ]),
    overflow: overflowResolution.overflow,
  };
}

function resolveRequiredHeight(
  contract: TextLayoutContract,
  contentHeightInches: number,
): number {
  return Number((contract.padding.top + contentHeightInches + contract.padding.bottom).toFixed(6));
}

export function resolveTextLayoutFontScaleCandidates(
  autoFitPolicy: TextLayoutContract['autoFitPolicy'],
  profile: TextLayoutContract['profile'] = 'plain-textbox',
): number[] {
  if (autoFitPolicy !== 'shrink-text') {
    return [1];
  }
  const minScale = profile === 'title-textbox' ? TITLE_TEXTBOX_MIN_AUTOFIT_SCALE : 0;
  return NORM_AUTOFIT_FONT_SCALE_CANDIDATES.filter((scale) => scale >= minScale);
}

function resolveNormAutofitLineSpacingReduction(scale: number): number {
  return Number((NORM_AUTOFIT_LINE_SPACING_REDUCTION_FACTOR * (1 - scale)).toFixed(6));
}

function usableContentWidth(contract: TextLayoutContract): number {
  return Math.max(contract.box.w - contract.padding.left - contract.padding.right, 0.01);
}

function usableContentHeight(contract: TextLayoutContract): number {
  return Math.max(contract.box.h - contract.padding.top - contract.padding.bottom, 0);
}

function resolveVerticalOffset(
  usableHeight: number,
  contentHeight: number,
  verticalAlign: TextLayoutContract['verticalAlign'],
): number {
  if (verticalAlign === 'middle') {
    return Math.max((usableHeight - contentHeight) / 2, 0);
  }
  if (verticalAlign === 'bottom') {
    return Math.max(usableHeight - contentHeight, 0);
  }
  return 0;
}
