import type {
  RenderBox,
  RenderPadding,
  RenderParagraph,
  RenderTextRun,
  TextRenderNode,
} from '../../renderModel';
import {
  DEFAULT_TEXT_AUTOFIT_POLICY,
  DEFAULT_TEXT_LINE_BREAK_POLICY,
  DEFAULT_TEXT_OVERFLOW_POLICY,
  DEFAULT_TEXT_VERTICAL_ALIGN,
  DEFAULT_TEXT_WRAP_POLICY,
  PPTX_DEFAULT_TEXT_INSET,
  type TextAutoFitPolicy,
  type TextBoxInsets,
  type TextLayoutContract,
  type TextLayoutProfile,
  type TextWrapPolicy,
} from '../definitions/contract';

export interface ResolveTextLayoutContractInput {
  profile: TextLayoutProfile;
  sourceKind: TextLayoutContract['sourceKind'];
  box: RenderBox | TextLayoutContract['box'];
  paragraphs?: readonly RenderParagraph[];
  padding?: RenderPadding | TextBoxInsets;
  wrap?: TextWrapPolicy;
  autoFitPolicy?: TextAutoFitPolicy;
  overflow?: TextLayoutContract['overflow'];
  verticalAlign?: TextLayoutContract['verticalAlign'];
  font?: TextLayoutContract['font'];
}

export function resolveTextLayoutContract(
  input: ResolveTextLayoutContractInput,
): TextLayoutContract {
  const primaryRun = pickPrimaryRun(input.paragraphs);
  return {
    profile: input.profile,
    sourceKind: input.sourceKind,
    box: {
      x: input.box.x,
      y: input.box.y,
      w: input.box.w,
      h: input.box.h,
    },
    padding: normalizePadding(input.padding),
    wrap: input.wrap ?? DEFAULT_TEXT_WRAP_POLICY,
    lineBreak: input.wrap === 'none' ? 'none' : DEFAULT_TEXT_LINE_BREAK_POLICY,
    autoFitPolicy: input.autoFitPolicy ?? DEFAULT_TEXT_AUTOFIT_POLICY,
    overflow: input.overflow ?? DEFAULT_TEXT_OVERFLOW_POLICY,
    verticalAlign: input.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN,
    font: input.font ?? {
      declaredFontFamily: primaryRun?.fontFamily,
      resolvedFontFamily: primaryRun?.resolvedFontFamily,
    },
  };
}

export function resolveTextLayoutContractFromNode(
  node: TextRenderNode,
  options: {
    profile?: TextLayoutProfile;
    sourceKind: TextLayoutContract['sourceKind'];
  },
): TextLayoutContract {
  return resolveTextLayoutContract({
    profile: options.profile ?? 'plain-textbox',
    sourceKind: options.sourceKind,
    box: node.box,
    paragraphs: node.paragraphs,
    padding: node.padding,
    wrap: node.wrap,
    autoFitPolicy: node.autoFitPolicy,
    overflow: node.overflow,
    verticalAlign: node.verticalAlign,
  });
}

function pickPrimaryRun(paragraphs: readonly RenderParagraph[] | undefined): RenderTextRun | undefined {
  return paragraphs?.flatMap((paragraph) => paragraph.runs).find((run) => 'text' in run);
}

function normalizePadding(padding: RenderPadding | TextBoxInsets | undefined): TextBoxInsets {
  return {
    top: padding?.top ?? PPTX_DEFAULT_TEXT_INSET.top,
    right: padding?.right ?? PPTX_DEFAULT_TEXT_INSET.right,
    bottom: padding?.bottom ?? PPTX_DEFAULT_TEXT_INSET.bottom,
    left: padding?.left ?? PPTX_DEFAULT_TEXT_INSET.left,
  };
}
