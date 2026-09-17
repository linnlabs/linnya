import type { RenderNodeSelectionGeometry } from '../../renderNodeSelection';
import type {
  ManualEditableTarget,
  ManualEditingVisualOperation,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';
import {
  polygonBounds,
  rectToPolygon,
} from '../../renderNodeSelection';

export function createManualVisualPreview(
  target: ManualEditableTarget,
  operation: ManualEditingVisualOperation,
): ManualEditingVisualPreview | null {
  if (
    operation.target.slideKey !== target.authoringRef.slideKey
    || operation.target.editKey !== target.authoringRef.editKey
  ) {
    return null;
  }
  return {
    elementId: target.elementId,
    affectedElementIds: operation.op === 'delete_target'
      ? target.translationElementIds
      : [target.elementId],
    operation,
  };
}

/** 选框与内容绘制消费同一批位移／属性预览；Frame 取全部可见成员的当前几何并集。 */
export function projectManualEditableTargetSelection(
  target: ManualEditableTarget,
  translations: ReadonlyMap<string, { readonly dx: number; readonly dy: number }>,
  geometries: ReadonlyMap<string, RenderNodeSelectionGeometry>,
): ManualEditableTarget {
  const fragments = target.frameSelectionFragments ?? [{
    elementId: target.elementId,
    polygon: target.polygon,
  }];
  const projectedFragments = fragments.flatMap((fragment) => {
    const resized = geometries.get(fragment.elementId)?.polygon;
    if (!resized) return [];
    const translation = translations.get(fragment.elementId);
    return [{
      elementId: fragment.elementId,
      polygon: translation
        ? resized.map(point => ({
            x: point.x + translation.dx,
            y: point.y + translation.dy,
          }))
        : resized,
    }];
  });
  if (projectedFragments.length === 0) return target;
  const polygon = target.frameSelectionFragments
    ? rectToPolygon(polygonBounds(projectedFragments.flatMap(fragment => fragment.polygon)))
    : projectedFragments[0]?.polygon ?? target.polygon;
  return {
    ...target,
    bounds: polygonBounds(polygon),
    polygon,
  };
}
