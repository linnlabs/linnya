import type {
  FreeformInlineRun,
  RenderInlineRun,
  RenderLineSpacing,
  RenderParagraph,
  RenderTextRun,
  StructuredElement,
  TextStyle,
} from '@plugin/slides/shared';
import {
  BULLET_HANGING_INDENT_INCHES,
  PPTX_DEFAULT_TEXT_INSET,
} from '@plugin/slides/shared';
import {
  classifyDominantScript,
  collectRequiredGlyphCodePoints,
  resolveFont,
} from '@plugin/backend/fontResolution';
import { compileMathFormula } from '../mathFormula/compiler/compileMathFormula';
export {
  applyFreeformTransform,
  buildFreeformGroupTransform as buildGroupTransform,
  IDENTITY_FREEFORM_TRANSFORM as IDENTITY_TRANSFORM,
  type FreeformTransform,
} from '../shared/freeformTransform';

export { PPTX_DEFAULT_TEXT_INSET };

export function buildParagraphs(
  text: string | FreeformInlineRun[],
  specElement: StructuredElement | undefined,
  style: TextStyle,
  defaultFontFamily: string,
): RenderParagraph[] {
  if (specElement?.type === 'bulletList' || specElement?.type === 'numberedList') {
    const lineSpacing = resolveTextStyleLineSpacing(specElement.style?.lineSpacing);
    return specElement.items.map((item) => ({
      runs: [textStyleToRun(item.text, specElement.style, defaultFontFamily)],
      align: resolveParagraphAlign(style.align),
      lineSpacing,
      indent: resolveBulletIndent(item.level),
      bullet: {
        type: specElement.type === 'bulletList' ? 'disc' : 'decimal',
        level: item.level ?? 0,
      },
    }));
  }

  const lineSpacing = resolveTextStyleLineSpacing(style.lineSpacing);
  if (Array.isArray(text)) {
    return [{
      runs: text.map((run) => freeformRunToRenderRun(run, style, defaultFontFamily)),
      align: resolveParagraphAlign(style.align),
      lineSpacing,
    }];
  }
  return text.split('\n').map((line) => ({
      runs: [textStyleToRun(line, style, defaultFontFamily)],
      align: resolveParagraphAlign(style.align),
      lineSpacing,
    }));
}

export function buildFreeformParagraphs(
  content: string | FreeformInlineRun[] | undefined,
  style: TextStyle,
  defaultFontFamily: string,
): RenderParagraph[] {
  if (typeof content === 'string') {
    const lineSpacing = resolveTextStyleLineSpacing(style.lineSpacing);
    return content.split('\n').map((line) => ({
      runs: [textStyleToRun(line, style, defaultFontFamily)],
      align: resolveParagraphAlign(style.align),
      lineSpacing,
    }));
  }

  if (Array.isArray(content)) {
    const lineSpacing = resolveTextStyleLineSpacing(style.lineSpacing);
    return [{
      runs: content.map((run) => freeformRunToRenderRun(run, style, defaultFontFamily)),
      align: resolveParagraphAlign(style.align),
      lineSpacing,
    }];
  }

  return [{
    runs: [textStyleToRun('', style, defaultFontFamily)],
    lineSpacing: resolveTextStyleLineSpacing(style.lineSpacing),
  }];
}

export function resolveTextStyleLineSpacing(
  lineSpacing: TextStyle['lineSpacing'],
): RenderLineSpacing | undefined {
  return lineSpacing;
}

export function textStyleToRun(
  text: string,
  style: TextStyle | undefined,
  defaultFontFamily: string,
  defaultFontSize?: number,
): RenderTextRun {
  const resolvedFontSize = style?.fontSize ?? defaultFontSize;
  const fontFamily = style?.fontFamily ?? defaultFontFamily;
  const fontScript = classifyDominantScript(text);
  const resolvedFont = resolveFont({
    family: fontFamily,
    bold: style?.bold === true,
    italic: style?.italic === true,
    script: fontScript,
    requiredCodePoints: collectRequiredGlyphCodePoints(text),
  });

  return {
    text,
    fontFamily,
    resolvedFontFamily: resolvedFont.resolvedFamily,
    fontScript,
    fontResolution: resolvedFont.resolution,
    fontFaceFingerprint: resolvedFont.resolved?.faceFingerprint,
    resolvedFontWeight: resolvedFont.resolved?.bold ? 'bold' : resolvedFont.resolved ? 'normal' : undefined,
    resolvedFontStyle: resolvedFont.resolved?.italic ? 'italic' : resolvedFont.resolved ? 'normal' : undefined,
    fontSize: resolvedFontSize,
    fontWeight: style?.bold ? 'bold' : undefined,
    fontStyle: style?.italic ? 'italic' : undefined,
    underline: style?.underline,
    color: style?.color,
    letterSpacing: style?.letterSpacing,
  };
}

function freeformRunToRenderRun(
  run: FreeformInlineRun,
  fallbackStyle: TextStyle,
  defaultFontFamily: string,
): RenderInlineRun {
  if ('formula' in run) {
    return {
      kind: 'formula',
      projection: compileMathFormula(run.formula).renderProjection,
    };
  }
  const mergedStyle: TextStyle = {
    ...fallbackStyle,
    ...run.style,
  };
  return textStyleToRun(run.text, mergedStyle, defaultFontFamily);
}

export function resolveParagraphAlign(
  align: TextStyle['align'] | undefined,
): RenderParagraph['align'] | undefined {
  switch (align) {
    case 'left':
    case 'center':
    case 'right':
      return align;
    default:
      return undefined;
  }
}

function resolveBulletIndent(level: number | undefined): number {
  return BULLET_HANGING_INDENT_INCHES * ((level ?? 0) + 1);
}
