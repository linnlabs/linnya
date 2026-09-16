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
  if (!node || !authoringRef || text?.kind !== 'plain_text'
    || !owner.authoringEdit?.capabilities.includes('set_text_content')) return null;
  if (authoringRef.targetKind !== 'text' && authoringRef.targetKind !== 'shape') return null;

  const origin = polygon[0];
  const horizontalEnd = polygon[1];
  const verticalEnd = polygon[3];
  if (!origin || !horizontalEnd || !verticalEnd) return null;

  const firstRun = findFirstTextRun(node);
  const fontSizePt = firstRun?.fontSize ?? DEFAULT_FONT_SIZE_PT;
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
  const verticalOffset = node.verticalAlign === 'bottom'
    ? remainingHeight
    : node.verticalAlign === 'middle'
      ? remainingHeight / 2
      : 0;
  const firstLineHeight = node.layout?.lines[0]?.height;
  const scaledFontHeight = fontSizePt / 72 * appliedFontScale;

  const textDecoration = buildTextDecoration(firstRun);

  return {
    elementId: geometry.elementId,
    targetKind: authoringRef.targetKind,
    authoringRef: {
      slideKey: authoringRef.slideKey,
      editKey: authoringRef.editKey,
    },
    content: text.content,
    origin,
    width: Math.hypot(horizontalEnd.x - origin.x, horizontalEnd.y - origin.y),
    height: Math.hypot(verticalEnd.x - origin.x, verticalEnd.y - origin.y),
    rotation: Math.atan2(horizontalEnd.y - origin.y, horizontalEnd.x - origin.x) * 180 / Math.PI,
    padding,
    verticalOffset,
    fontFamily: firstRun?.resolvedFontFamily ?? firstRun?.fontFamily ?? 'sans-serif',
    fontSizePt,
    appliedFontScale,
    fontWeight: (firstRun?.resolvedFontWeight ?? firstRun?.fontWeight) === 'bold'
      ? 'bold'
      : 'normal',
    fontStyle: (firstRun?.resolvedFontStyle ?? firstRun?.fontStyle) === 'italic'
      ? 'italic'
      : 'normal',
    ...(textDecoration ? { textDecoration } : {}),
    color: firstRun?.color ?? DEFAULT_TEXT_COLOR,
    textAlign: node.paragraphs[0]?.align ?? 'left',
    lineHeight: firstLineHeight && scaledFontHeight > 0
      ? firstLineHeight / scaledFontHeight
      : 1.2,
    ...(firstRun?.letterSpacing === undefined
      ? {}
      : { letterSpacingPt: firstRun.letterSpacing * appliedFontScale }),
    opacity: owner.opacity ?? 1,
  };
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
