import type { WorkspaceMutationEvent } from '@app/schemas';
import type { CanvasCard, CanvasContentNode } from '@plugin/canvas/shared';

export function canvasReferencedDocuments(card: CanvasCard): readonly string[] {
  if (card.type === 'document') return [card.data.documentId];
  if (card.type !== 'text') return [];
  const ids = new Set<string>();
  const visit = (node: CanvasContentNode) => { if (node.type === 'documentReference' && typeof node.attrs?.documentId === 'string') ids.add(node.attrs.documentId); node.content?.forEach(visit); };
  visit(card.data.content); return [...ids];
}

export function canvasMutationTargets(event: WorkspaceMutationEvent, known: readonly string[]): readonly string[] {
  switch (event.type) {
    case 'workspace.document.updated': return [event.documentId];
    case 'workspace.node.deleted': return event.deletedNodeIds;
    case 'workspace.node.transferred': return event.movedNodeIds;
    case 'workspace.node.created': case 'workspace.node.renamed': case 'workspace.node.moved': return [event.nodeId];
    case 'project.deleted': return known;
    default: return [];
  }
}
