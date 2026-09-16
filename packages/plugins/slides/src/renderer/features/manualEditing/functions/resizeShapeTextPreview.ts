import type { TextRenderNode } from '../../../types/render';

/**
 * 拖拽只重新锚定已编译的行，不测字、不重新断行或缩放字形。
 * 正式换行/autofit 仍由提交后的 compiler 决定，避免两套字体测量事实。
 */
export function resizeShapeTextPreview(
  node: TextRenderNode,
  widthDelta: number,
  heightDelta: number,
): TextRenderNode {
  const box = { ...node.box, w: node.box.w + widthDelta, h: node.box.h + heightDelta };
  const layout = node.layout;
  if (!layout) return { ...node, box };
  const paddingHeight = (node.padding?.top ?? 0) + (node.padding?.bottom ?? 0);
  const oldSpace = Math.max(0, node.box.h - paddingHeight - layout.contentHeightInches);
  const newSpace = Math.max(0, box.h - paddingHeight - layout.contentHeightInches);
  const verticalFactor = node.verticalAlign === 'middle' ? 0.5 : node.verticalAlign === 'bottom' ? 1 : 0;
  const dy = (newSpace - oldSpace) * verticalFactor;
  return {
    ...node,
    box,
    layout: {
      ...layout,
      lines: layout.lines.map(line => {
        const dx = widthDelta * (line.align === 'center' ? 0.5 : line.align === 'right' ? 1 : 0);
        return {
          ...line,
          y: line.y + dy,
          slices: line.slices.map(slice => ({
            ...slice,
            x: slice.x + dx,
            ...(slice.kind === 'inlineBox' ? { boxY: slice.boxY + dy } : { textY: slice.textY + dy }),
          })),
        };
      }),
    },
  };
}
