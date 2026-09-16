import type { ManualEditableTarget, ManualEditingVisualPreview } from '../../manualEditing';

/** 面板与 Canvas 使用同一队列的有效值；失败撤销队列后自然回到正式值。 */
export function projectElementPropertyTarget(
  target: ManualEditableTarget,
  previews: readonly ManualEditingVisualPreview[],
): ManualEditableTarget {
  return previews.reduce((current, preview) => {
    if (preview.elementId !== current.elementId) return current;
    const operation = preview.operation;
    if (operation.op === 'set_fill_color') {
      return { ...current, fill: { kind: 'solid', color: operation.color } };
    }
    if (operation.op === 'set_visual_size') return { ...current, visualSize: operation.visualSize };
    if (operation.op === 'set_text_style' && current.textEditing) {
      return {
        ...current,
        textEditing: {
          ...current.textEditing,
          ...(operation.color !== undefined ? { color: operation.color } : {}),
          ...(operation.fontSizePt !== undefined ? { fontSizePt: operation.fontSizePt } : {}),
        },
      };
    }
    return current;
  }, target);
}
