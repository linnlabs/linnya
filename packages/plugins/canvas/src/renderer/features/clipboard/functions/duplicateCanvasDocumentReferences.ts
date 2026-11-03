import type { CanvasContentNode, CanvasTextDocument } from '@plugin/canvas/shared';

/** 复制的是新出现位置；目标文档身份不变，每个行内位置必须获得新referenceId。 */
export function duplicateCanvasDocumentReferences(content: CanvasTextDocument, allocate: () => string): CanvasTextDocument {
  const visit = (node: CanvasContentNode): CanvasContentNode => ({ ...node,
    ...(node.type === 'documentReference' ? { attrs: { ...node.attrs, referenceId: allocate() } } : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return { type: 'doc', content: content.content.map(visit) };
}
