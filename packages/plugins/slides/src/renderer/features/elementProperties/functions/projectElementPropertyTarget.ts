import type { SlidesEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditableTarget, ManualEditingVisualPreview } from '../../manualEditing';

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
  if (textContent === undefined || !projected.textEditing) return projected;
  // 以当前可见正文收窄旧 revision 的能力；富文本整段格式统一通过输入选区全选修改。
  return { ...projected, textEditing: { ...projected.textEditing, content: textContent },
    capabilities: Array.isArray(textContent) ? projected.capabilities.filter(capability => capability !== 'set_text_style') : projected.capabilities };
}
