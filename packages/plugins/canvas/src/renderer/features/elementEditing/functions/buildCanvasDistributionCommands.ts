import type { CanvasCard, CanvasCardId, CanvasCommand, CanvasElement } from '@plugin/canvas/shared';
import type { CanvasDistribution } from '../definitions/canvasElementActions';

/** 保持首尾卡的位置，按真实宽/高分配相同间隙；不移动锁定卡或选区外内容。 */
export function buildDistributeCommands(
  elements: readonly CanvasElement[],
  ids: readonly CanvasCardId[],
  mode: CanvasDistribution
): CanvasCommand[] {
  const axis = mode === 'horizontal' ? 'x' : 'y',
    extent = mode === 'horizontal' ? 'width' : 'height';
  const cards = elements
    .filter(
      (element): element is CanvasCard =>
        element.type !== 'edge' && ids.includes(element.id) && !element.locked
    )
    .sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
  if (cards.length < 3) return [];
  const first = cards[0],
    last = cards[cards.length - 1];
  const size = cards.reduce((total, card) => total + card[extent], 0);
  const gap = (last[axis] + last[extent] - first[axis] - size) / (cards.length - 1);
  let cursor = first[axis];
  return cards.flatMap((card, index) => {
    const position = cursor;
    cursor += card[extent] + gap;
    if (index === 0 || index === cards.length - 1 || card[axis] === position) return [];
    return [
      { op: 'update', id: card.id, baseRevision: card.revision, patch: { [axis]: position } },
    ];
  });
}
