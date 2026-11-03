import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasReviewTarget } from '../definitions/agentReview';

export function selectCanvasReviewTarget(targets: readonly CanvasReviewTarget[], currentId: CanvasCardId | null, direction: -1 | 1): CanvasReviewTarget | undefined {
  if (!targets.length) return undefined;
  const index = targets.findIndex(target => target.id === currentId);
  return targets[index < 0 ? direction === 1 ? 0 : targets.length - 1 : (index + direction + targets.length) % targets.length];
}
