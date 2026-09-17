import { authorTextStylePatch, patchWholeTextContent } from '@plugin/slides/shared/authoringEditing';
import type { TextEditingTarget } from '../../textEditing';
import type { ManualEditingVisualPreview } from '../definitions/manualEditingTypes';

/** 正文和整框样式严格按队列顺序投影，旧样式不能再次覆盖后来的完整正文。 */
export function projectTextEditingValues(target: TextEditingTarget, previews: readonly ManualEditingVisualPreview[]): TextEditingTarget {
  return previews.reduce((current, preview) => {
    if (preview.elementId !== current.elementId) return current;
    const operation = preview.operation;
    if (operation.op === 'set_text_content') return { ...current, content: operation.content };
    if (operation.op !== 'set_text_style') return current;
    return { ...current, content: patchWholeTextContent(current.content, operation),
      baseStyle: { ...current.baseStyle, ...authorTextStylePatch(operation) },
      ...(operation.fontSizePt !== undefined ? { fontSizePt: operation.fontSizePt } : {}),
      ...(operation.color !== undefined ? { color: operation.color } : {}) };
  }, target);
}
