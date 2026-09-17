import { layoutPreparedText, resizeShapeTextInput } from '@plugin/slides/shared/textLayout';
import type { TextRenderNode } from '../../../types/render';

/**
 * 已终结的形状文字使用正式测量事实与共享排版器同步换行/autofit。
 * 未终结节点没有测量事实，只能重定位既有行，不能发起平台测量。
 */
export function resizeShapeTextPreview(
  node: TextRenderNode,
  widthDelta: number,
  heightDelta: number,
): TextRenderNode {
  const box = { ...node.box, w: node.box.w + widthDelta, h: node.box.h + heightDelta };
  if (node.preparedResizeLayout) {
    const resized = resizeShapeTextInput(node, box);
    return { ...resized, layout: layoutPreparedText(resized, node.preparedResizeLayout) };
  }
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
