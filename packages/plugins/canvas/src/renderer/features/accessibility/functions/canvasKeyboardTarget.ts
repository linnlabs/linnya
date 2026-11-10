import {
  canvasBounds,
  orderCanvasCardsForReading,
  type CanvasCard,
  type CanvasCardConnection,
  type CanvasCardId,
  type CanvasRectangle,
} from '@plugin/canvas/shared';
import type { CanvasNavigationDirection } from '../definitions/canvasKeyboard';

type Spatial = Exclude<CanvasNavigationDirection, 'next' | 'previous'>;

const span = (low: number, size: number, otherLow: number, otherSize: number) =>
  Math.max(otherLow - (low + size), low - (otherLow + otherSize), 0);
const overlaps = (low: number, size: number, otherLow: number, otherSize: number) =>
  Math.min(low + size, otherLow + otherSize) > Math.max(low, otherLow);

/** 方向距离按边缘算：正对着（垂直方向有重叠）的卡优先，其次才是 45° 内最近的。 */
function directionalScore(origin: CanvasRectangle, card: CanvasCard, direction: Spatial) {
  const horizontal = direction === 'left' || direction === 'right',
    forward = direction === 'right' || direction === 'down' ? 1 : -1;
  const [low, size, otherLow, otherSize] = horizontal
    ? [origin.x, origin.width, card.x, card.width]
    : [origin.y, origin.height, card.y, card.height];
  const [crossLow, crossSize, otherCrossLow, otherCrossSize] = horizontal
    ? [origin.y, origin.height, card.y, card.height]
    : [origin.x, origin.width, card.x, card.width];
  const along = (otherLow + otherSize / 2 - (low + size / 2)) * forward,
    cross = Math.abs(otherCrossLow + otherCrossSize / 2 - (crossLow + crossSize / 2));
  if (along <= 0) return null;
  const facing = overlaps(crossLow, crossSize, otherCrossLow, otherCrossSize);
  if (!facing && cross > along) return null;
  const gap = span(low, size, otherLow, otherSize),
    crossGap = span(crossLow, crossSize, otherCrossLow, otherCrossSize);
  return [facing ? 0 : 1, gap + crossGap * 2, cross] as const;
}

/** Tab 走画布唯一阅读顺序；多选时从选区之后（Shift+Tab 为之前）继续。到首尾返回 null 放行浏览器焦点。 */
export function canvasKeyboardTarget(
  cards: readonly CanvasCard[],
  connections: readonly CanvasCardConnection[],
  selected: readonly CanvasCardId[],
  direction: CanvasNavigationDirection
): CanvasCardId | null {
  const order = orderCanvasCardsForReading(cards, connections),
    chosen = new Set(selected),
    indexes = order.flatMap((card, index) => (chosen.has(card.id) ? [index] : []));
  if (direction === 'next')
    return order[indexes.length ? indexes[indexes.length - 1] + 1 : 0]?.id ?? null;
  if (direction === 'previous')
    return order[indexes.length ? indexes[0] - 1 : order.length - 1]?.id ?? null;
  const origin = canvasBounds(indexes.map(index => order[index]));
  if (!origin) return order[0]?.id ?? null;
  let best: CanvasCardId | null = null,
    bestScore: readonly number[] = [];
  order.forEach((card, index) => {
    const score = chosen.has(card.id) ? null : directionalScore(origin, card, direction);
    if (!score) return;
    const ranked = [...score, index];
    if (best === null || ranksBefore(ranked, bestScore)) {
      best = card.id;
      bestScore = ranked;
    }
  });
  return best;
}

function ranksBefore(a: readonly number[], b: readonly number[]): boolean {
  for (let index = 0; index < a.length; index++)
    if (a[index] !== b[index]) return a[index] < b[index];
  return false;
}
