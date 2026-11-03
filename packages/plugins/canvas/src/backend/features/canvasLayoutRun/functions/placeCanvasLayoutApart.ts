import { canvasRectanglesOverlap, type CanvasCard, type CanvasRectangle } from '../../../../shared';
import type { CanvasLayoutPosition } from '../definitions/canvasLayoutPlan';

/** 整组平移到现有障碍外；不挪动排布范围以外、锁定或正在编辑的卡。 */
export function placeCanvasLayoutApart(positions: readonly CanvasLayoutPosition[], cards: readonly CanvasCard[], obstacles: readonly CanvasRectangle[], direction: 'right' | 'down') {
  if (!positions.length) return [];
  const sizes = new Map<string, CanvasCard>(cards.map(card => [card.id, card]));
  const rectangles = positions.map(position => {
    const card = sizes.get(position.id); if (!card) throw new Error('canvas_layout_unexpected_node');
    return { ...position, width: card.width, height: card.height };
  });
  const left = Math.min(...rectangles.map(rectangle => rectangle.x)), top = Math.min(...rectangles.map(rectangle => rectangle.y));
  const width = Math.max(...rectangles.map(rectangle => rectangle.x + rectangle.width)) - left;
  const height = Math.max(...rectangles.map(rectangle => rectangle.y + rectangle.height)) - top;
  const target = { x: Math.min(...cards.map(card => card.x)), y: Math.min(...cards.map(card => card.y)), width, height };
  const intervals = obstacles.filter(obstacle => direction === 'right'
    ? obstacle.y < target.y + height && obstacle.y + obstacle.height > target.y
    : obstacle.x < target.x + width && obstacle.x + obstacle.width > target.x)
    .slice().sort((a, b) => direction === 'right' ? a.x - b.x : a.y - b.y);
  for (const obstacle of intervals) if (canvasRectanglesOverlap(target, obstacle)) {
    if (direction === 'right') target.x = obstacle.x + obstacle.width + 80;
    else target.y = obstacle.y + obstacle.height + 80;
  }
  return positions.map(position => ({ ...position, x: position.x - left + target.x, y: position.y - top + target.y }));
}
