import { DocumentHistoryListRequestSchema, DocumentVersionRestoreRequestSchema } from '@app/schemas';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import { getDocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';
import { createDocumentHistoryOperations } from 'src/domains/document-history';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { Logger } from 'src/shared/logger';
import type { BackendRuntimeOwner } from '../../../backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';

export function registerDocumentHistoryRequests(runtimeOwner: BackendRuntimeOwner, registry: BackendRendererRequestRegistryPort): void {
  const databaseService = runtimeOwner.getServices().databaseService;
  if (!databaseService) throw new Error('Document history requires database service');
  const workspaceService = new WorkspaceService(databaseService.getDb());
  const logger = new Logger('DocumentHistory');
  const operations = createDocumentHistoryOperations({
    context: { databaseService, workspaceService },
    resolve(documentId) {
      const node = workspaceService.getNode(documentId);
      if (!node || node.deleted_at !== null) throw new DocumentHistoryError('document_not_found');
      const capability = getDocumentTypeBackendHook(node.type)?.history;
      if (!capability) throw new DocumentHistoryError('history_unavailable');
      return capability;
    },
    reportFailure: error => logger.error('Document history operation failed', error),
  });
  registry.handle('document-history:list', request => operations.list(DocumentHistoryListRequestSchema.parse(request).documentId));
  registry.handle('document-history:restore', request => operations.restore(DocumentVersionRestoreRequestSchema.parse(request)));
}
