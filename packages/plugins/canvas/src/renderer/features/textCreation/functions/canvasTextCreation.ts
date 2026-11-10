import type { CanvasTextCreationDraft } from '../definitions/canvasTextCreation';
import type {
  CanvasCommand,
  CanvasContentNode,
  CanvasEndpoint,
  CanvasPoint,
  CanvasRectangle,
  CanvasTextDocument,
} from '@plugin/canvas/shared';
export function canvasTextHasContent(content: CanvasTextDocument): boolean {
  const meaningful = (node: CanvasContentNode): boolean =>
    Boolean(node.text?.trim()) ||
    ['image', 'documentReference', 'horizontalRule', 'table'].includes(node.type) ||
    ((node.type === 'inlineMath' || node.type === 'blockMath') &&
      typeof node.attrs?.latex === 'string' &&
      Boolean(node.attrs.latex.trim())) ||
    Boolean(node.content?.some(meaningful));
  return content.content.some(meaningful);
}
/** 新卡朝向来源的边中点落在松手处；不向模型/持久层暴露临时卡片身份。 */
export function canvasTextCreationRectangle(
  point: CanvasPoint,
  from: CanvasEndpoint | null,
  height = 180
): CanvasRectangle {
  const width = 280;
  const side = from?.kind === 'card' ? from.side : 'auto';
  return {
    x: point.x - (side === 'left' ? width : side === 'top' || side === 'bottom' ? width / 2 : 0),
    y: point.y - (side === 'top' ? height : side === 'left' || side === 'right' ? height / 2 : 0),
    width,
    height,
  };
}

/** 草稿提交只分配一次真实卡片；来源抓手的side不固化到正式连线。 */
export function buildCanvasTextCreationCommands(
  draft: CanvasTextCreationDraft
): readonly CanvasCommand[] {
  const operations: CanvasCommand[] = [
    {
      op: 'addText',
      ref: '$created',
      x: draft.x,
      y: draft.y,
      width: draft.width,
      height: draft.height,
      content: draft.content,
    },
  ];
  if (draft.from)
    operations.push({
      op: 'connect',
      from: draft.from.kind === 'card' ? { ...draft.from, side: 'auto' } : draft.from,
      to: '$created',
      direction: 'forward',
      label: '',
      lineStyle: 'curve',
      linePattern: 'solid',
    });
  return operations;
}
