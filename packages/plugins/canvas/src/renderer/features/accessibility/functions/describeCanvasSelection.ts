import {
  orderCanvasCardsForReading,
  readCanvasCardConnections,
  readCanvasElementSearchText,
  type CanvasCard,
  type CanvasElement,
  type CanvasElementId,
} from '@plugin/canvas/shared';
import { canvasText } from '../../localization';
const typeKeys = {
  text: 'canvas.a11y.text',
  image: 'canvas.a11y.image',
  document: 'canvas.a11y.document',
  edge: 'canvas.a11y.edge',
} as const;
/** 有界摘要供读屏与键盘选择共用：按画布阅读顺序列出并报第几张，正文投影沿用搜索规则，绝不以内部文档ID代替标题。 */
export function describeCanvasSelection(
  elements: readonly CanvasElement[],
  selected: readonly CanvasElementId[],
  documentTitles: ReadonlyMap<string, string>
): string {
  const ids = new Set(selected),
    order = orderCanvasCardsForReading(
      elements.filter((element): element is CanvasCard => element.type !== 'edge'),
      readCanvasCardConnections(elements)
    ),
    index = new Map(order.map((card, position) => [card.id, position + 1])),
    items = [...order, ...elements.filter(element => element.type === 'edge')].filter(element =>
      ids.has(element.id)
    );
  if (!items.length) return canvasText('canvas.a11y.empty');
  const descriptions = items.slice(0, 5).map(element =>
    canvasText('canvas.a11y.item', {
      type: canvasText(typeKeys[element.type]),
      locked: element.locked ? canvasText('canvas.a11y.locked') : '',
      text:
        readCanvasElementSearchText(element, { documentTitles }).trim().slice(0, 240) ||
        canvasText('canvas.a11y.noText'),
      position:
        element.type === 'edge'
          ? ''
          : canvasText('canvas.a11y.position', {
              index: index.get(element.id) ?? 0,
              total: order.length,
            }),
    })
  );
  return canvasText('canvas.a11y.selected', {
    count: items.length,
    items: descriptions.join(canvasText('canvas.list.separator')),
    more: items.length > descriptions.length ? canvasText('canvas.a11y.more') : '',
  });
}
