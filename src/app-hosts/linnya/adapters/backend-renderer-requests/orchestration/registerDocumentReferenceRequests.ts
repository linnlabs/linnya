import { DocumentReferenceDeletionRequestSchema } from '@app/schemas';
import { readWorkspaceDeletionReferencePreview } from '../../../application/workspace-node-deletion';
import { readDocumentBacklinks, createDocumentReferenceOperations, queryDocumentReferenceCandidates, readDocumentReferencePresentation, type ReferenceQueryPort } from 'src/domains/document-references';
import { readWorkspaceDocumentIdentity, readWorkspaceDocumentLocation, searchWorkspaceDocumentIdentities } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { getDocumentTypeBackendHook } from 'src/plugin-sdk/backend/documentTypeBackendHook';
import type { BackendRuntimeOwner } from '../../../backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';

export function registerDocumentReferenceRequests(owner: BackendRuntimeOwner, registry: BackendRendererRequestRegistryPort): void {
  const service = owner.getServices().databaseService;
  if (!service) throw new Error('Document references require database service');
  const db = service.getDb();
  const port: ReferenceQueryPort = {
    read: documentId => readWorkspaceDocumentIdentity(db, documentId), location: documentId => readWorkspaceDocumentLocation(db, documentId),
    search: request => searchWorkspaceDocumentIdentities(db, request).map(node => ({ id: node.id, projectId: node.project_id, name: node.name, nodeType: node.type })),
    isDocumentTypeAvailable: nodeType => nodeType === 'document' || Boolean(getDocumentTypeBackendHook(nodeType)),
  };
  registry.handle('document-references:deletion-preview', value => readWorkspaceDeletionReferencePreview(db, DocumentReferenceDeletionRequestSchema.parse(value).nodeIds));
  registry.handle('document-references:backlinks', value => readDocumentBacklinks(value, { read: port.read, listBacklinks: createDocumentReferenceOperations(db, port).listBacklinks }));
  registry.handle('document-references:search', value => queryDocumentReferenceCandidates(value, port));
  registry.handle('document-references:resolve', value => readDocumentReferencePresentation(value, port));
}
