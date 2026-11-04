import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasRasterReadiness } from '../../src/renderer/orchestration/createCanvasRasterPresentation';

/** 一张首显不代表整批首显；只有目标revision在当前可见body中都被真正draw才成立。 */
export function readCanvasEvaluationBodyPresentation(readiness: CanvasRasterReadiness, revisions: ReadonlyMap<CanvasCardId, number>) {
  const visible = readiness.cards.filter(card => card.mode === 'body');
  const presented = visible.filter(card => card.revision === revisions.get(card.id) && card.firstPresented);
  const superseded = readiness.cards.filter(card => { const expected = revisions.get(card.id); return expected !== undefined && card.revision !== null && card.revision > expected; });
  return { visibleBodyIds: visible.map(card => card.id), presentedBodyIds: presented.map(card => card.id), supersededCardIds: superseded.map(card => card.id),
    allVisiblePresented: !readiness.suspended && visible.length > 0 && visible.length === presented.length };
}

export function sameCanvasEvaluationBodyIds(left: readonly CanvasCardId[], right: readonly CanvasCardId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
