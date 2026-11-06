import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasNavigationDirection } from '../definitions/canvasKeyboard';
import { canvasArrowVectors } from '../definitions/canvasKeyboardBindings';

export function canvasKeyboardTarget(
  cards: readonly CanvasCard[],
  selected: readonly CanvasCardId[],
  direction: CanvasNavigationDirection
): CanvasCardId | null {
  const current = cards.findIndex(card => selected.includes(card.id));
  if (direction === 'next') return cards[current + 1]?.id ?? null;
  if (direction === 'previous')
    return cards[current < 0 ? cards.length - 1 : current - 1]?.id ?? null;
  const anchor = cards[current];
  if (!anchor) return cards[0]?.id ?? null;
  const vector = canvasArrowVectors[direction],
    origin = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
  let target: CanvasCardId | null = null,
    distance = Infinity;
  for (const card of cards) {
    const dx = card.x + card.width / 2 - origin.x,
      dy = card.y + card.height / 2 - origin.y;
    if (dx * vector.x + dy * vector.y <= 0) continue;
    const score = dx * dx + dy * dy;
    if (score < distance) {
      target = card.id;
      distance = score;
    }
  }
  return target;
}
