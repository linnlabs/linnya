/**
 * Annotation layout recalculation policy.
 *
 * 中文说明：
 * - 统一定义“何时需要全量回到理想位置(resetToIdeal=true)”；
 * - 避免在 UI / factory / services 中散落布尔字面量，后续接入 block 可见性门控时也只需要改这一处。
 */

export const ANNOTATION_LAYOUT_RECALC_REASON = Object.freeze({
  SCROLL: 'scroll',
  RESIZE: 'resize',
  DOCUMENT_CHANGE: 'document-change',
  SIDEBAR_ANIMATION: 'sidebar-animation',
  STRUCTURE_CHANGE: 'structure-change',
});

export function shouldResetAnnotationLayout(reason) {
  switch (reason) {
    case ANNOTATION_LAYOUT_RECALC_REASON.DOCUMENT_CHANGE:
    case ANNOTATION_LAYOUT_RECALC_REASON.STRUCTURE_CHANGE:
    case ANNOTATION_LAYOUT_RECALC_REASON.SIDEBAR_ANIMATION:
      return true;
    case ANNOTATION_LAYOUT_RECALC_REASON.SCROLL:
    case ANNOTATION_LAYOUT_RECALC_REASON.RESIZE:
      return false;
    default:
      return true;
  }
}

function resolveLayoutManager(target) {
  if (!target) return null;
  if (typeof target.recalculateAllPositions === 'function') return target;
  const value = target.value;
  if (value && typeof value.recalculateAllPositions === 'function') return value;
  return null;
}

export async function requestAnnotationLayoutRecalculation(target, reason) {
  const layoutManager = resolveLayoutManager(target);
  if (!layoutManager) return false;
  await layoutManager.recalculateAllPositions(shouldResetAnnotationLayout(reason));
  return true;
}
