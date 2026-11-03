import type { CanvasCard } from '../../../../shared';
import { canvasRectanglesOverlap } from '../../../../shared/geometry/functions/canvasGeometry';

/** 原位可用就精确恢复；被后来卡片占住时，取四个方向中最近的可用位置。 */
export function findCanvasRestorationPosition(card: CanvasCard, occupied: readonly CanvasCard[]) {
  function position(direction: 'left' | 'right' | 'top' | 'bottom') {
    let x = card.x; let y = card.y;
    for (;;) {
      const obstruction = occupied.find(other => canvasRectanglesOverlap({ ...card, x, y }, other));
      if (!obstruction) return { x, y };
      if (direction === 'left') x = obstruction.x - card.width - 32;
      if (direction === 'right') x = obstruction.x + obstruction.width + 32;
      if (direction === 'top') y = obstruction.y - card.height - 32;
      if (direction === 'bottom') y = obstruction.y + obstruction.height + 32;
    }
  }
  return [position('right'), position('top'), position('bottom')].reduce((best, candidate) => Math.hypot(best.x - card.x, best.y - card.y) <= Math.hypot(candidate.x - card.x, candidate.y - card.y) ? best : candidate, position('left'));
}
