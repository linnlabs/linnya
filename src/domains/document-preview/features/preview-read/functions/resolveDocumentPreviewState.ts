import type { DocumentPreviewContent, DocumentPreviewRequest, DocumentPreviewResult } from '@app/schemas';
import type { PreviewNode } from '../../../definitions/documentPreview';

export function resolveDocumentPreviewState(input: {
  readonly request: DocumentPreviewRequest;
  readonly node: PreviewNode | null;
  readonly hasProvider: boolean;
  readonly textSnapshot: string | null;
  readonly content?: DocumentPreviewContent;
}): DocumentPreviewResult {
  const { request, node, content } = input;
  if (!node || node.deletedAt !== null) return { documentId: request.documentId, title: null, nodeType: null, status: 'deleted' };
  if (node.projectId !== request.projectId) return { documentId: node.id, title: null, nodeType: null, status: 'outside_project' };
  const identity = { documentId: node.id, title: node.name, nodeType: node.nodeType };
  if (!input.hasProvider) {
    return { ...identity, status: 'plugin_unavailable', ...(input.textSnapshot === null ? {} : { content: { revisionKey: 'text-snapshot', summary: input.textSnapshot.slice(0, 4000) } }) };
  }
  return { ...identity, status: content ? 'ready' : 'preview_unavailable', ...(content ? { content } : {}) };
}
