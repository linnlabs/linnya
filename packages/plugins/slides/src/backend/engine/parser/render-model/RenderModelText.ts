import type { TextStyle } from '@plugin/slides/shared';
import type {
  RenderBox,
  RenderParagraph,
  TextRenderNode,
} from '@plugin/slides/shared';
import {
  resolveTextLayoutContract,
} from '@plugin/slides/shared';
import {
  buildFreeformParagraphs,
  buildParagraphs,
  IDENTITY_TRANSFORM,
  applyFreeformTransform,
  buildGroupTransform,
  PPTX_DEFAULT_TEXT_INSET,
  resolveParagraphAlign,
  resolveTextStyleLineSpacing,
  textStyleToRun,
  textStyleToRuns,
  type FreeformTransform,
} from '../../text/generatedTextRenderInput';
import { resolveShapeTextLayout } from '../../visual/presentationVisualDefaults';
import type { RenderBaseNode } from './RenderModelShared.js';

export {
  buildFreeformParagraphs,
  buildParagraphs,
  IDENTITY_TRANSFORM,
  applyFreeformTransform,
  buildGroupTransform,
  PPTX_DEFAULT_TEXT_INSET,
  resolveParagraphAlign,
  resolveTextStyleLineSpacing,
  textStyleToRun,
  textStyleToRuns,
  type FreeformTransform,
};

export interface GeneratedTextNodeBase extends RenderBaseNode {
  kind: 'text';
  paragraphs: RenderParagraph[];
}

export function buildShapeTextNode(
  id: string,
  box: RenderBox,
  zIndex: number,
  text: string,
  style: TextStyle,
  defaultFontFamily: string,
  rotation: number | undefined,
  autoFitPolicy: TextRenderNode['autoFitPolicy'] = 'shrink-text',
  layoutOverrides: {
    padding?: TextRenderNode['padding'];
    wrap?: TextRenderNode['wrap'];
  } = {},
): TextRenderNode {
  const layout = resolveShapeTextLayout(
    { x: box.x, y: box.y, w: box.w, h: box.h },
    text,
    style,
    rotation != null,
  );
  const textStyle: TextStyle = {
    ...style,
    fontSize: layout.fontSize,
    align: layout.align,
    valign: layout.valign,
  };

  return {
    id,
    kind: 'text',
    box,
    zIndex,
    paragraphs: text.split('\n').map((line) => ({
      runs: textStyleToRuns(line, textStyle, defaultFontFamily, layout.fontSize),
      align: resolveParagraphAlign(layout.align),
      lineSpacing: resolveTextStyleLineSpacing(textStyle.lineSpacing),
    })),
    verticalAlign: resolveTextVerticalAlign(layout.valign),
    wrap: layoutOverrides.wrap ?? 'word',
    overflow: 'clip',
    autoFitPolicy,
    padding: layoutOverrides.padding ?? layout.paddingInches,
    visible: true,
  };
}

export function buildGeneratedTextRenderNode(
  base: GeneratedTextNodeBase,
  paragraphs: readonly RenderParagraph[],
  verticalAlign: TextRenderNode['verticalAlign'],
  layoutOverrides: {
    padding?: TextRenderNode['padding'];
    autoFitPolicy?: TextRenderNode['autoFitPolicy'];
    wrap?: TextRenderNode['wrap'];
  } = {},
): TextRenderNode {
  const contract = resolveTextLayoutContract({
    profile: 'plain-textbox',
    sourceKind: 'generated',
    box: base.box,
    paragraphs,
    padding: layoutOverrides.padding,
    autoFitPolicy: layoutOverrides.autoFitPolicy,
    wrap: layoutOverrides.wrap,
    verticalAlign,
  });
  return {
    ...base,
    // mapper 只建立语义模型；尺寸与断行必须由最终布局阶段一次性决定。
    box: base.box,
    verticalAlign: contract.verticalAlign,
    wrap: contract.wrap,
    overflow: contract.overflow,
    autoFitPolicy: contract.autoFitPolicy,
    padding: contract.padding,
  };
}

export function buildGeneratedShapeTextNode(
  base: RenderBaseNode,
  text: string,
  style: TextStyle,
  defaultFontFamily: string,
  rotation: number | undefined,
): TextRenderNode {
  const layout = resolveShapeTextLayout(
    { x: base.box.x, y: base.box.y, w: base.box.w, h: base.box.h },
    text,
    style,
    rotation != null,
  );
  const textStyle: TextStyle = {
    ...style,
    fontSize: layout.fontSize,
    align: layout.align,
    valign: layout.valign,
  };
  const paragraphs = text.split('\n').map((line) => ({
    runs: textStyleToRuns(line, textStyle, defaultFontFamily, layout.fontSize),
    align: resolveParagraphAlign(layout.align),
    lineSpacing: resolveTextStyleLineSpacing(textStyle.lineSpacing),
  }));

  return buildGeneratedTextRenderNode(
    {
      ...base,
      kind: 'text',
      paragraphs,
    },
    paragraphs,
    resolveTextVerticalAlign(layout.valign),
    {
      padding: layout.paddingInches,
      autoFitPolicy: 'shrink-text',
    },
  );
}

export function resolveTextVerticalAlign(
  valign: TextStyle['valign'] | undefined,
): TextRenderNode['verticalAlign'] {
  switch (valign) {
    case 'middle':
      return 'middle';
    case 'bottom':
      return 'bottom';
    case 'top':
    default:
      return 'top';
  }
}
