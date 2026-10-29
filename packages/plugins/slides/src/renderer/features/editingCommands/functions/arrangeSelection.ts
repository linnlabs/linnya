import { quantizeManualTranslation, type SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import { manualSelectionBounds, type ManualEditableTarget, type ManualEditIntent } from '../../manualEditing';
import type { SelectionArrangement } from '../definitions/selectionArrangement';

/** 多选按选区边界对齐，单选按页边界；等距分布固定两端，以真实可见外框计算间距。 */
export function arrangeSelection(targets: readonly ManualEditableTarget[], action: SelectionArrangement, slideSize: { width: number; height: number }): ManualEditIntent | null {
  if (targets.length === 0 || !targets.every(target => target.capabilities.includes('translate'))) return null;
  const selectedBounds = manualSelectionBounds(targets);
  if (!selectedBounds) return null;
  const bounds = targets.length === 1 ? { x: 0, y: 0, w: slideSize.width, h: slideSize.height } : selectedBounds;
  const deltas = new Map<string, { dx: number; dy: number }>();
  if (action === 'distributeX' || action === 'distributeY') {
    if (targets.length < 3) return null;
    const axis = action === 'distributeX' ? 'x' : 'y';
    const size = action === 'distributeX' ? 'w' : 'h';
    const sorted = [...targets].sort((a, b) => a.bounds[axis] - b.bounds[axis]);
    const gap = (bounds[size] - sorted.reduce((sum, target) => sum + target.bounds[size], 0)) / (sorted.length - 1);
    let position = bounds[axis];
    for (const target of sorted) {
      deltas.set(target.elementId, { dx: axis === 'x' ? position - target.bounds.x : 0, dy: axis === 'y' ? position - target.bounds.y : 0 });
      position += target.bounds[size] + gap;
    }
  } else for (const target of targets) {
    const box = target.bounds;
    deltas.set(target.elementId, {
      dx: action === 'left' ? bounds.x - box.x : action === 'center' ? bounds.x + bounds.w / 2 - box.x - box.w / 2 : action === 'right' ? bounds.x + bounds.w - box.x - box.w : 0,
      dy: action === 'top' ? bounds.y - box.y : action === 'middle' ? bounds.y + bounds.h / 2 - box.y - box.h / 2 : action === 'bottom' ? bounds.y + bounds.h - box.y - box.h : 0,
    });
  }
  const moves = targets.flatMap(target => {
    const raw = deltas.get(target.elementId);
    const delta = raw && quantizeManualTranslation(raw);
    return delta && (delta.dx !== 0 || delta.dy !== 0) ? [{ target, delta }] : [];
  });
  if (moves.length === 0) return null;
  const operations: SlidesManualEditOperation[] = moves.map(({ target, delta }) => ({ op: 'translate_by', targetKind: target.targetKind, target: target.authoringRef, delta }));
  return { operation: operations.length === 1 ? operations[0] : { op: 'batch', operations },
    translationPreviews: moves.map(({ target, delta }) => ({ elementId: target.elementId, affectedElementIds: target.translationElementIds, ...delta })) };
}
