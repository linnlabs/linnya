import {
  DocumentHistoryListResponseSchema,
  DocumentHistoryRestoreResponseSchema,
} from '@app/schemas';
import type { HistoryPanelPort } from '../definitions/historyPanel';

export const historyPanelIpc: HistoryPanelPort = {
  async list(documentId) {
    return DocumentHistoryListResponseSchema.parse(
      await window.electronAPI['document-history:list']({ documentId })
    );
  },
  async restore(request) {
    return DocumentHistoryRestoreResponseSchema.parse(
      await window.electronAPI['document-history:restore'](request)
    );
  },
};
