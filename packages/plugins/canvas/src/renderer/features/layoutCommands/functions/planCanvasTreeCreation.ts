import {
  readCanvasCardComponent,
  readCanvasCardConnections,
  type CanvasCard,
  type CanvasCardId,
  type CanvasElement,
} from '@plugin/canvas/shared';
import type { CanvasTreeCreationPlan } from '../definitions/canvasLayoutCommands';
import { canvasText } from '../../localization';
/** 树父子按from→to定义，与箭头画法及预留分组parentId无关。多父不能任取一条。 */
export function planCanvasTreeCreation(
  elements: readonly CanvasElement[],
  selected: readonly CanvasCardId[],
  kind: 'child' | 'sibling',
  direction: 'right' | 'down'
): CanvasTreeCreationPlan {
  if (selected.length !== 1) throw new Error(canvasText('canvas.error.treeNeedsOne'));
  const card = elements.find(
    (element): element is CanvasCard => element.id === selected[0] && element.type !== 'edge'
  );
  if (!card) throw new Error(canvasText('canvas.error.selectedGone'));
  if (card.locked) throw new Error(canvasText('canvas.error.selectedLocked'));
  const parents = new Set(
    elements.flatMap(element =>
      element.type === 'edge' &&
      element.to.kind === 'card' &&
      element.to.cardId === card.id &&
      element.from.kind === 'card'
        ? [element.from.cardId]
        : []
    )
  );
  if (kind === 'sibling' && parents.size > 1)
    throw new Error(canvasText('canvas.error.multipleParents'));
  const parent = kind === 'child' ? card.id : ([...parents][0] ?? null);
  const point =
    kind === 'child'
      ? direction === 'right'
        ? { x: card.x + card.width + 80, y: card.y + card.height / 2 }
        : { x: card.x + card.width / 2, y: card.y + card.height + 80 }
      : direction === 'right'
        ? { x: card.x, y: card.y + card.height + 80 }
        : { x: card.x + card.width + 80, y: card.y };
  return {
    point,
    from: parent
      ? { kind: 'card', cardId: parent, side: direction === 'right' ? 'right' : 'bottom' }
      : null,
    options: {
      algorithm: 'tree',
      direction,
      elementIds: [
        ...readCanvasCardComponent(readCanvasCardConnections(elements), card.id),
        '$created',
      ],
    },
  };
}
