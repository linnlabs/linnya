import type { CanvasContentNode, CanvasEndpoint, CanvasPoint, CanvasRectangle, CanvasTextDocument } from '@plugin/canvas/shared';
export function canvasTextHasContent(content: CanvasTextDocument): boolean {
  const meaningful = (node: CanvasContentNode): boolean => Boolean(node.text?.trim()) || ['image', 'documentReference', 'horizontalRule', 'table'].includes(node.type)
    || (node.type === 'inlineMath' || node.type === 'blockMath') && typeof node.attrs?.latex === 'string' && Boolean(node.attrs.latex.trim()) || Boolean(node.content?.some(meaningful));
  return content.content.some(meaningful);
}
/** 新卡朝向来源的边中点落在松手处；不向模型/持久层暴露临时卡片身份。 */
export function canvasTextCreationRectangle(point: CanvasPoint, from: CanvasEndpoint | null): CanvasRectangle {
  const width = 280, height = 180;
  const side = from?.kind === 'card' ? from.side : 'auto';
  return { x: point.x - (side === 'left' ? width : side === 'top' || side === 'bottom' ? width / 2 : 0),
    y: point.y - (side === 'top' ? height : side === 'left' || side === 'right' ? height / 2 : 0), width, height };
}
