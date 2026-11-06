import type { CanvasCardId, CanvasSynchronization } from '@plugin/canvas/shared';
import type { CanvasProjectedCardChange } from '../definitions/canvasDocumentSession';

/** 只保留最后来源事实；完整before/after随本次接纳释放，不让场景状态常驻上一版大正文。 */
export function readCanvasProjectionChanges(
  update: CanvasSynchronization
): readonly CanvasProjectedCardChange[] {
  const changes = new Map<CanvasCardId, CanvasProjectedCardChange>();
  if (update.kind === 'delta')
    for (const commit of update.commits)
      for (const change of commit.changes) {
        const element = change.after ?? change.before;
        if (element && element.type !== 'edge')
          changes.set(element.id, { id: element.id, sourceKind: commit.source.kind });
      }
  return [...changes.values()];
}
