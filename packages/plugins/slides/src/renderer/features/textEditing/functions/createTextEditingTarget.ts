import { resolveLineHeightEm } from '@plugin/slides/shared/textLayout';
import type { RenderNode, TextRenderNode } from '../../../types/render';
import type { RenderNodeSelectionGeometry } from '../../renderNodeSelection';
import type { TextEditingTarget } from '../definitions/textEditingTypes';

const DEFAULT_FONT_SIZE_PT = 14;
const DEFAULT_TEXT_COLOR = '#000000';

export function createTextEditingTarget(
  geometry: RenderNodeSelectionGeometry<RenderNode>,
): TextEditingTarget | null {
  const { node: owner, polygon } = geometry;
  const node = owner.kind === 'text' ? owner : owner.kind === 'shape' ? owner.innerText : undefined;
  const authoringRef = owner.authoringRef;
  const text = owner.authoringEdit?.text;
  if (!node || !authoringRef || !text || text.content === undefined
    || !owner.authoringEdit?.capabilities.includes('set_text_content')) return null;
  if (authoringRef.targetKind !== 'text' && authoringRef.targetKind !== 'shape') return null;

  const origin = polygon[0];
  const horizontalEnd = polygon[1];
  const verticalEnd = polygon[3];
  if (!origin || !horizontalEnd || !verticalEnd) return null;

  const firstRun = findFirstTextRun(node);
  const rich = text.kind === 'rich_text';
  const fontSizePt = rich ? text.baseStyle?.fontSize ?? DEFAULT_FONT_SIZE_PT : firstRun?.fontSize ?? DEFAULT_FONT_SIZE_PT;
  const appliedFontScale = node.layout?.appliedFontScale ?? 1;
  const padding = {
    top: node.padding?.top ?? 0,
    right: node.padding?.right ?? 0,
    bottom: node.padding?.bottom ?? 0,
    left: node.padding?.left ?? 0,
  };
  const innerHeight = Math.max(0, node.box.h - padding.top - padding.bottom);
  const contentHeight = node.layout?.contentHeightInches ?? 0;
  const remainingHeight = Math.max(0, innerHeight - contentHeight);
  const vertical = node.writingMode === 'vertical-rl';
  const firstLineHeight = node.layout?.lines[0]?.height;
  const scaledFontHeight = fontSizePt / 72 * appliedFontScale;
  const lineHeight = !rich && firstLineHeight && scaledFontHeight > 0
    ? firstLineHeight / scaledFontHeight
    : resolveLineHeightEm(rich ? text.baseStyle?.lineSpacing : undefined, fontSizePt);
  const verticalOffset = vertical ? 0 : resolveFirstLineTop(node, lineHeight, scaledFontHeight) ?? (
    node.verticalAlign === 'bottom'
      ? remainingHeight
      : node.verticalAlign === 'middle'
        ? remainingHeight / 2
        : 0);

  const textDecoration = rich ? (text.baseStyle?.underline ? 'underline' : undefined) : buildTextDecoration(firstRun);

  return {
    elementId: geometry.elementId,
    targetKind: authoringRef.targetKind,
    authoringRef: {
      slideKey: authoringRef.slideKey,
      editKey: authoringRef.editKey,
    },
    content: text.content,
    baseStyle: text.baseStyle,
    origin,
    width: Math.hypot(horizontalEnd.x - origin.x, horizontalEnd.y - origin.y),
    height: Math.hypot(verticalEnd.x - origin.x, verticalEnd.y - origin.y),
    rotation: Math.atan2(horizontalEnd.y - origin.y, horizontalEnd.x - origin.x) * 180 / Math.PI,
    padding,
    verticalOffset,
    ...(vertical ? { writingMode: 'vertical-rl' as const } : {}),
    fontFamily: rich ? text.baseStyle?.fontFamily ?? 'sans-serif' : firstRun?.resolvedFontFamily ?? firstRun?.fontFamily ?? 'sans-serif',
    fontSizePt,
    appliedFontScale,
    fontWeight: (rich ? text.baseStyle?.bold === true : (firstRun?.resolvedFontWeight ?? firstRun?.fontWeight) === 'bold')
      ? 'bold'
      : 'normal',
    fontStyle: (rich ? text.baseStyle?.italic === true : (firstRun?.resolvedFontStyle ?? firstRun?.fontStyle) === 'italic')
      ? 'italic'
      : 'normal',
    ...(textDecoration ? { textDecoration } : {}),
    color: rich ? text.baseStyle?.color ?? DEFAULT_TEXT_COLOR : firstRun?.color ?? DEFAULT_TEXT_COLOR,
    textAlign: node.paragraphs[0]?.align ?? 'left',
    lineHeight,
    ...(firstRun?.letterSpacing === undefined
      ? {}
      : { letterSpacingPt: firstRun.letterSpacing * appliedFontScale }),
    opacity: owner.opacity ?? 1,
  };
}

/**
 * 编辑器首行行框顶部相对内容区的位置（英寸）。画布用 Konva 把字形顶部放在排版的 `textY`，
 * em 框中心在 `textY + 字号/2`；CSS 把 em 框放在行框正中。两边居中 em 框用的是同一套浏览器
 * 字体度量，所以让行框中心对准 `textY + 字号/2`，各行基线就与画布重合，且已含垂直对齐。
 * 排版按字体文件 ascent/descent 平分多出的行距，与浏览器度量不同，不能直接用行框顶部。
 */
function resolveFirstLineTop(node: TextRenderNode, lineHeightEm: number, fontSizeInches: number): number | undefined {
  const slice = node.layout?.lines[0]?.slices?.find((candidate) => 'textY' in candidate);
  if (!slice || !('textY' in slice)) return undefined;
  return slice.textY + fontSizeInches * (1 - lineHeightEm) / 2;
}

function findFirstTextRun(node: TextRenderNode) {
  for (const paragraph of node.paragraphs) {
    for (const run of paragraph.runs) {
      if ('text' in run) return run;
    }
  }
  return undefined;
}

function buildTextDecoration(run: ReturnType<typeof findFirstTextRun>): string | undefined {
  const decorations: string[] = [];
  if (run?.underline) decorations.push('underline');
  if (run?.strikethrough) decorations.push('line-through');
  return decorations.length > 0 ? decorations.join(' ') : undefined;
}
