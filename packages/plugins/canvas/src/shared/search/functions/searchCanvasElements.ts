import type {
  CanvasCard,
  CanvasContentNode,
  CanvasElement,
} from '../../model/definitions/canvasElement';
import { readCanvasCardConnections } from '../../reading/functions/canvasCardConnections';
import { orderCanvasCardsForReading } from '../../reading/functions/orderCanvasCardsForReading';
import type { CanvasSearchContext, CanvasSearchHit } from '../definitions/canvasSearch';

function bodyText(node: CanvasContentNode, context: CanvasSearchContext): string {
  if (node.type === 'documentReference')
    return typeof node.attrs?.documentId === 'string'
      ? (context.documentTitles.get(node.attrs.documentId) ?? '')
      : '';
  if (node.type === 'inlineMath' || node.type === 'blockMath')
    return typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return node.content?.map(child => bodyText(child, context)).join(' ') ?? '';
}
export function readCanvasElementSearchText(
  element: CanvasElement,
  context: CanvasSearchContext
): string {
  if (element.type === 'text') return bodyText(element.data.content, context);
  if (element.type === 'image') return [element.data.caption, element.data.alt].join(' ');
  if (element.type === 'document') return context.documentTitles.get(element.data.documentId) ?? '';
  return element.label;
}

/** Renderer/CLI共用内容匹配；标题由引用owner显式提供，不从路径或内部ID猜测。 */
export function searchCanvasElements(
  elements: readonly CanvasElement[],
  query: string,
  context: CanvasSearchContext
): CanvasSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  // 卡片按画布唯一阅读顺序，与 Tab 一致；连线排在卡片之后保持文档顺序。
  const cards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
  const ordered: CanvasElement[] = [
    ...orderCanvasCardsForReading(cards, readCanvasCardConnections(elements)),
    ...elements.filter(element => element.type === 'edge'),
  ];
  return ordered.flatMap(element => {
    const text = readCanvasElementSearchText(element, context),
      start = text.toLocaleLowerCase().indexOf(needle);
    return start < 0
      ? []
      : [
          {
            id: element.id,
            type: element.type,
            text: text.slice(Math.max(0, start - 36), start + needle.length + 100),
          },
        ];
  });
}
