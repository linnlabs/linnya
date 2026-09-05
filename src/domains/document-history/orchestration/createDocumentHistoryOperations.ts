import {
  DocumentVersionListSchema, DocumentVersionSummarySchema,
  type DocumentVersionRestoreRequest, type DocumentHistoryListResponse, type DocumentHistoryRestoreResponse,
} from '@app/schemas';
import { DocumentHistoryError, type DocumentHistoryCapability } from '@linnya/plugin-host-contract/backend/documentHistory';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import { selectDocumentHistory } from '../functions/selectDocumentHistory';

export function createDocumentHistoryOperations(dependencies: {
  readonly resolve: (documentId: string) => DocumentHistoryCapability;
  readonly context: PluginToolContext;
  readonly reportFailure: (error: unknown) => void;
}) {
  function failure(error: unknown) {
    dependencies.reportFailure(error);
    return { success: false, code: error instanceof DocumentHistoryError ? error.code : 'restore_failed' } as const;
  }
  return {
    async list(documentId: string): Promise<DocumentHistoryListResponse> {
      try {
        const rows = DocumentVersionListSchema.parse(await dependencies.resolve(documentId).list({ documentId, context: dependencies.context }));
        const selection = selectDocumentHistory(rows);
        return { success: true, recent: [...selection.recent], earlier: [...selection.earlier] };
      } catch (error) { return failure(error); }
    },
    async restore(request: DocumentVersionRestoreRequest): Promise<DocumentHistoryRestoreResponse> {
      try {
        const current = await dependencies.resolve(request.documentId).restore({ ...request, context: dependencies.context });
        return { success: true, current: DocumentVersionSummarySchema.parse(current) };
      } catch (error) { return failure(error); }
    },
  };
}
