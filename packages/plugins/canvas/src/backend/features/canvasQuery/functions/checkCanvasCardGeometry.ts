import { canvasRectanglesOverlap, type CanvasCard } from '../../../../shared';
import type { CanvasGeometryPairReport } from '../definitions/canvasGeometryChecks';

/** 空间排序只剪掉不可能相交的配对，总数与最多100对样本分别维护。 */
export function checkCanvasCardOverlaps(cards: readonly CanvasCard[]): CanvasGeometryPairReport {
  const order = [...cards].sort((a, b) => a.x - b.x),
    samples: string[][] = [];
  let total = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length && order[j].x < order[i].x + order[i].width; j++) {
      if (!canvasRectanglesOverlap(order[i], order[j])) continue;
      total++;
      if (samples.length < 100) samples.push([order[i].id, order[j].id]);
    }
  return { total, samples };
}

export function readCanvasCardOutliers(cards: readonly CanvasCard[]) {
  if (!cards.length) return [];
  const centers = cards.map(card => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 }));
  const middle = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const cx = middle(centers.map(point => point.x)),
    cy = middle(centers.map(point => point.y));
  const distances = centers.map(point => Math.hypot(point.x - cx, point.y - cy)),
    radius = middle([...distances]);
  return cards
    .filter((_card, index) => distances[index] > Math.max(2000, radius * 4))
    .map(card => card.id);
}
