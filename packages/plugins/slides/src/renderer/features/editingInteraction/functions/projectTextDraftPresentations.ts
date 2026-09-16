import type { RenderNode } from '../../../types/render';
import {
  collectManualEditableTargets, collectManualVisualPreviews, createPresentedTextEditingTarget,
  type ManualEditingHitProjection,
} from '../../manualEditing';
import type { TextDraftPresentation } from '../definitions/editingInteractionTypes';

/** 待保存文字的几何也来自统一的视觉投影，移动/拉伸期间不能留在旧位置。 */
export function projectTextDraftPresentations(
  nodes: readonly RenderNode[],
  drafts: readonly TextDraftPresentation[],
  projection: ManualEditingHitProjection,
  activeElementId?: string,
): readonly TextDraftPresentation[] {
  const targets = collectManualEditableTargets(nodes);
  const visuals = collectManualVisualPreviews(projection.pendingVisual, projection.queuedIntents);
  return drafts.flatMap(draft => {
    if (draft.target.elementId === activeElementId) return [];
    const target = targets.find(candidate => candidate.elementId === draft.target.elementId);
    if (!target || visuals.some(preview => preview.operation.op === 'delete_target'
      && preview.affectedElementIds.includes(target.elementId))) return [];
    const presented = createPresentedTextEditingTarget(nodes, target, projection);
    return presented ? [{ ...draft, target: presented }] : [];
  });
}
