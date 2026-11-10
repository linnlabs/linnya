import { DocumentPreviewRequestSchema } from '@app/schemas';
import { listDocumentPreviewTypes } from '../../document-preview/listDocumentPreviewTypes';
import { createWorkspaceDocumentPreviewReader } from '../../document-preview/createWorkspaceDocumentPreviewReader';
import type { BackendRuntimeOwner } from '../../../backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';

export function registerDocumentPreviewRequests(owner: BackendRuntimeOwner, registry: BackendRendererRequestRegistryPort): void {
  const database = owner.getServices().databaseService;
  if (!database) throw new Error('Document preview requires database service');
  const preview = createWorkspaceDocumentPreviewReader(database.getDb());
  registry.handle('document-preview:types', () => listDocumentPreviewTypes());
  registry.handle('document-preview:read', value => preview.read(DocumentPreviewRequestSchema.parse(value)));
}
