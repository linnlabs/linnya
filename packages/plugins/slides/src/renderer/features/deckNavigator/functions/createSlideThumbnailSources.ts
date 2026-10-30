import type { PresentationRenderModel, RenderNode, RenderNodeBase, TextRenderNode } from '../../../types/render';
import type { SlideThumbnailSource } from '../definitions/slideThumbnails';

const editingFields: ReadonlySet<string> = new Set([
  'id', 'editableTarget', 'authoringRef', 'authoringAncestorRefs', 'authoringEdit',
  'sourceSpan', 'layoutConstraintEvidence', 'diagnosticsRefIds', 'locked', 'interactive',
  // 交互测量快照不参与离屏绘制；正式 layout 仍完整保留。
  'preparedTextLayout', 'shapeTextSizing',
] satisfies readonly (keyof RenderNodeBase | keyof TextRenderNode)[]);

/**
 * 页面和元素 ID 含页序；插入、复制会改写身份和源码行号，却不改变像素。
 * 只在 RenderNode 边界排除编辑元数据，不能递归删除任意对象的 id（例如图表数据）。
 * 保留所有其余视觉字段，使新加入的绘制属性默认参与失效判断。
 */
function visualNode(node: RenderNode): object {
  const visual = Object.fromEntries(Object.entries(node).filter(([key]) => !editingFields.has(key)));
  if (node.kind === 'group') return { ...visual, children: node.children.map(visualNode) };
  if (node.kind === 'shape') return { ...visual, innerText: node.innerText && visualNode(node.innerText) };
  return visual;
}

export function createSlideThumbnailSources(model: PresentationRenderModel): SlideThumbnailSource[] {
  return model.slides.map(slide => ({
    slide,
    slideSize: model.slideSize,
    // 使用完整序列化值而非有碰撞风险的短 hash；仅在正式模型变化时计算一次。
    contentKey: JSON.stringify({
      size: model.slideSize,
      background: slide.background,
      elements: slide.elements.map(visualNode),
    }),
  }));
}
