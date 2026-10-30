import { normalizeShapeFillInput } from '@plugin/slides/shared/visual';
import type { RenderNode, SlideRenderModel } from '../../../types/render';
import type { EditingInsertionPreview } from '../definitions/editingInsertionPreview';

export function createInsertionPreviewSlide(entries: readonly EditingInsertionPreview[]): SlideRenderModel | null {
  const elements = entries.flatMap((entry, index) => {
    const node = projectInsertionPreview(entry, index);
    return node ? [node] : [];
  });
  return elements.length ? {
    slideId: 'pending-insertions', index: 0, layoutKey: 'freeform',
    background: { paint: { type: 'none' } }, elements,
  } : null;
}

/** 正式资源帧保留旧画面，但临时对象的失败、切页或正式接管必须立即生效。 */
export function retainPendingInsertionFrame(
  ready: SlideRenderModel | null,
  target: SlideRenderModel | null,
): SlideRenderModel | null {
  if (!ready) return null;
  const pendingIds = new Set(target?.elements.map(node => node.id));
  const elements = ready.elements.filter(node => pendingIds.has(node.id));
  return elements.length ? { ...ready, elements } : null;
}

/** 只派生无需字体测量的完整节点。带字形状/文字沿用占位，不能编造 shaping 事实。 */
function projectInsertionPreview(entry: EditingInsertionPreview, index: number): RenderNode | null {
  const object = entry.object;
  const base = { id: `pending:${object.editKey}`, box: { ...object.box, unit: 'in' as const }, zIndex: index };
  if (object.kind === 'shape' && object.content === '') {
    const fill = normalizeShapeFillInput(object.fill, 'insertion.fill');
    if ('error' in fill) throw new Error(fill.error);
    return { ...base, kind: 'shape', geometry: { type: 'preset', name: object.geometry }, fill: fill.value };
  }
  if (object.kind === 'image' && entry.imageSource) {
    return { ...base, kind: 'image', assetRef: { type: 'data', dataUri: entry.imageSource }, fitMode: object.fit, alt: object.alt };
  }
  return null;
}
