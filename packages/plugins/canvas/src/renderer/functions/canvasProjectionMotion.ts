import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasDocumentProjection } from '../features/canvasDocument';

/** 追平可能混合多来源；只动画每张卡最后一次正式改动，不能把用户更新算成Agent动效。 */
export function canvasProjectionMotion(projection: CanvasDocumentProjection): {
  readonly animateIds: readonly CanvasCardId[];
  readonly batch: boolean;
} {
  const animateIds = projection.cardChanges
    .filter(change => change.sourceKind === 'agent')
    .map(change => change.id);
  return { animateIds, batch: animateIds.length > 200 };
}
