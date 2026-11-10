import type { IpcRenderer } from 'electron';
import {
  CONVERSATION_RUN_DOCUMENT_CHANGES_CHANNEL,
  type ConversationRunDocumentChangesRequest,
} from '@app/schemas';

export function buildConversationRunDocumentChangesPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    /** 返回值未校验；Renderer 必须用 ConversationRunDocumentChangesSchema 解析。 */
    listConversationRunDocumentChanges: (request: ConversationRunDocumentChangesRequest): Promise<unknown> => (
      ipcRenderer.invoke(CONVERSATION_RUN_DOCUMENT_CHANGES_CHANNEL, request)
    ),
  };
}
