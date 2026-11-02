import type { FreeformTextRun, TextStyle } from '@plugin/slides/shared';
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
  content: string | readonly FreeformTextRun[],
  style: TextStyle,
  defaultFontFamily: string,
  rotation: number | undefined,
): TextRenderNode {
  const plainText = typeof content === 'string' ? content : content.map((run) => run.text).join('');
  const layout = resolveShapeTextLayout(
    { x: base.box.x, y: base.box.y, w: base.box.w, h: base.box.h },
    plainText,
    style,
    rotation != null,
  );
  const textStyle: TextStyle = {
    ...style,
    fontSize: layout.fontSize,
    align: layout.align,
    valign: layout.valign,
  };
  // 分段 run 按其中的 \n 拆段；run 自身样式覆盖形状级样式，未声明的字段继承形状排版结果。
  const lines: Array<Array<{ text: string; style: TextStyle }>> = [[]];
  for (const run of typeof content === 'string' ? [{ text: content }] : content) {
    const runStyle: TextStyle = 'style' in run && run.style ? { ...textStyle, ...run.style } : textStyle;
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1]!.push({ text: part, style: runStyle });
    });
  }
  const paragraphs = lines.map((parts) => ({
    runs: parts.length > 0
      ? parts.flatMap((part) => textStyleToRuns(part.text, part.style, defaultFontFamily, layout.fontSize))
      : textStyleToRuns('', textStyle, defaultFontFamily, layout.fontSize),
    align: resolveParagraphAlign(layout.align),
    lineSpacing: resolveTextStyleLineSpacing(textStyle.lineSpacing),
  }));

  const node = buildGeneratedTextRenderNode(
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
  return { ...node, shapeTextSizing: { ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}), rotated: rotation != null } };
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
