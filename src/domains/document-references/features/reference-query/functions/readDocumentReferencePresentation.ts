import { DocumentReferenceSearchRequestSchema, DocumentReferencePresentationRequestSchema, type DocumentReferenceCandidate, type DocumentReferencePresentation } from '@app/schemas';
import type { ReferenceQueryPort } from '../definitions/referenceQuery';

export function queryDocumentReferenceCandidates(input: unknown, port: ReferenceQueryPort): readonly DocumentReferenceCandidate[] {
  const request = DocumentReferenceSearchRequestSchema.parse(input);
  return port.search(request).flatMap(node => {
    const location = port.location(node.id);
    return location ? [{ documentId: node.id, title: node.name, nodeType: node.nodeType, projectId: node.projectId, path: location.path }] : [];
  });
}
export function readDocumentReferencePresentation(input: unknown, port: ReferenceQueryPort): DocumentReferencePresentation {
  const request = DocumentReferencePresentationRequestSchema.parse(input);
  const node = port.read(request.documentId);
  if (!node || node.deletedAt !== null) return { documentId: request.documentId, status: 'deleted', title: null, nodeType: null, path: null };
  if (node.projectId !== request.projectId) return { documentId: request.documentId, status: 'outside_project', title: null, nodeType: null, path: null };
  return { documentId: node.id, title: node.name, nodeType: node.nodeType, path: port.location(node.id)?.path ?? null, status: port.isDocumentTypeAvailable(node.nodeType) ? 'available' : 'plugin_unavailable' };
}
