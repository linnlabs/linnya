import { resizeShapeTextInput } from '@plugin/slides/shared/textLayout';
import type { RenderNode, TextRenderNode } from '../../../types/render';
import type { EditingVisualPreview } from '../definitions/editingPreviewTypes';
import { canRelayoutTextBox, deriveTextPreview } from './deriveTextPreview';

const snapshots = new WeakMap<RenderNode, { inputs: readonly EditingVisualPreview[]; node: RenderNode }>();

/** 当前修订 + 有序编辑输入 → 完整节点；正式 RenderModel 到达后整批撤下。 */
export function projectEditingPreviewNode(
  node: RenderNode,
  previews: readonly EditingVisualPreview[],
): RenderNode {
  if (previews.length === 0) return node;
  const cached = snapshots.get(node);
  // 命中与绘制可能分别收集新的数组；相同不可变意图仍应复用一次完整排版。
  if (cached && cached.inputs.length === previews.length
    && cached.inputs.every((input, index) => input === previews[index])) return cached.node;
  const projected = previews.reduce(projectEditingPreviewOperation, node);
  snapshots.set(node, { inputs: previews, node: projected });
  return projected;
}

function projectEditingPreviewOperation(
  node: RenderNode,
  preview: EditingVisualPreview,
): RenderNode {
  if (preview.operation.op === 'delete_target') {
    return preview.affectedElementIds.includes(node.id) ? { ...node, visible: false } : node;
  }
  if (node.id !== preview.elementId) return node;
  if (preview.operation.op === 'set_visual_size') {
    if (node.kind !== 'shape' && node.kind !== 'image') return node;
    const innerText = node.kind === 'shape' && node.innerText
      ? deriveTextPreview(resizeShapeTextInput(node.innerText, { ...node.innerText.box,
          w: node.innerText.box.w + preview.operation.visualSize.width - node.box.w,
          h: node.innerText.box.h + preview.operation.visualSize.height - node.box.h }))
      : undefined;
    if (node.kind === 'shape' && node.innerText && !innerText) return node;
    return {
      ...node,
      ...(innerText ? { innerText } : {}),
      box: {
        ...node.box,
        x: node.box.x + (preview.operation.translationDelta?.dx ?? 0),
        y: node.box.y + (preview.operation.translationDelta?.dy ?? 0),
        w: preview.operation.visualSize.width,
        h: preview.operation.visualSize.height,
      },
    };
  }
  if (preview.operation.op === 'set_fill_color') {
    if (node.kind !== 'shape') return node;
    return {
      ...node,
      fill: { type: 'solid', color: preview.operation.color },
    };
  }
  if (preview.operation.op !== 'set_text_style' || node.kind !== 'text') return node;
  const textStyleOperation = preview.operation;
  const styled: TextRenderNode = {
    ...node,
    paragraphs: node.paragraphs.map(paragraph => ({
      ...paragraph,
      runs: paragraph.runs.map(run => (
        'text' in run
          ? {
              ...run,
              ...(textStyleOperation.fontSizePt !== undefined
                ? { fontSize: textStyleOperation.fontSizePt }
                : {}),
              ...(textStyleOperation.color !== undefined
                ? { color: textStyleOperation.color }
                : {}),
            }
          : run
      )),
    })),
  };
  if (textStyleOperation.fontSizePt === undefined) return styled;
  if (!canRelayoutTextBox(node) || !node.preparedTextLayout) return node;
  return deriveTextPreview({ ...styled, box: node.preparedTextLayout.inputBox }) ?? node;
}
