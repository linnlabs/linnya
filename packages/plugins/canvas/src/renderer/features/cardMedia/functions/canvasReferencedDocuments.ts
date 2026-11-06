import type { WorkspaceMutationEvent, DocumentReferencePresentation } from '@app/schemas';
import type { CanvasCard, CanvasContentNode } from '@plugin/canvas/shared';

export function canvasReferencedDocuments(card: CanvasCard): readonly string[] {
  if (card.type === 'document') return [card.data.documentId];
  if (card.type !== 'text') return [];
  const ids = new Set<string>();
  const visit = (node: CanvasContentNode) => {
    if (node.type === 'documentReference' && typeof node.attrs?.documentId === 'string')
      ids.add(node.attrs.documentId);
    node.content?.forEach(visit);
  };
  visit(card.data.content);
  return [...ids];
}

export function canvasMutationTargets(
  event: WorkspaceMutationEvent,
  known: readonly string[]
): readonly string[] {
  switch (event.type) {
    case 'workspace.document.updated':
      return [event.documentId];
    case 'workspace.node.deleted':
      return event.deletedNodeIds;
    case 'workspace.node.transferred':
      return event.movedNodeIds;
    case 'workspace.node.created':
    case 'workspace.node.renamed':
    case 'workspace.node.moved':
      return [event.nodeId];
    case 'project.deleted':
      return known;
    // 项目创建/改名不改变已有目标的身份、可用性或正文，文档事件负责其余失效。
    case 'project.created':
    case 'project.updated':
      return [];
  }
}

/** 类型启停只失效其对应目标；尚未取得身份的目标也必须重查。 */
export function canvasAvailabilityTargets(
  known: readonly string[],
  values: ReadonlyMap<string, DocumentReferencePresentation>,
  nodeTypes: readonly string[]
): readonly string[] {
  return known.filter(id => {
    const presentation = values.get(id);
    return (
      !presentation || (presentation.nodeType !== null && nodeTypes.includes(presentation.nodeType))
    );
  });
}
