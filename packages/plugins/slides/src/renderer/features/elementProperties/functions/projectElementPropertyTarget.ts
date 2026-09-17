import type { SlidesEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import { projectTextEditingValues, type ManualEditableTarget, type ManualEditingVisualPreview } from '../../manualEditing';

/** 面板与 Canvas 使用同一队列的有效值；失败撤销队列后自然回到正式值。 */
export function projectElementPropertyTarget(
  target: ManualEditableTarget,
  previews: readonly ManualEditingVisualPreview[],
  textContent?: SlidesEditableTextContent,
): ManualEditableTarget {
  const projected = previews.reduce<ManualEditableTarget>((current, preview) => {
    if (preview.elementId !== current.elementId) return current;
    const operation = preview.operation;
    if (operation.op === 'set_fill_color') {
      return { ...current, fill: { kind: 'solid', color: operation.color } };
    }
    if (operation.op === 'set_visual_size') return { ...current, visualSize: operation.visualSize };
    return current;
  }, target);
  if (!projected.textEditing) return projected;
  const textEditing = projectTextEditingValues(projected.textEditing, previews);
  return { ...projected, textEditing: textContent === undefined ? textEditing : { ...textEditing, content: textContent } };
}
