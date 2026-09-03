import type { IpcRenderer } from 'electron';
import {
  CONVERSATION_FILE_LINK_RESOLVE_CHANNEL,
  CONVERSATION_FILE_LINK_REVEAL_CHANNEL,
  type ConversationFileLinkResolution,
  type ConversationFileLinkResolveRequest,
  type ConversationFileLinkRevealRequest,
  type OperationResult,
} from '@app/schemas';

export function buildConversationFileLinkPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    resolveConversationFileLink: (
      request: ConversationFileLinkResolveRequest,
    ): Promise<OperationResult<ConversationFileLinkResolution>> => (
      ipcRenderer.invoke(CONVERSATION_FILE_LINK_RESOLVE_CHANNEL, request)
    ),
    revealConversationFileLink: (
      request: ConversationFileLinkRevealRequest,
    ): Promise<OperationResult<void>> => (
      ipcRenderer.invoke(CONVERSATION_FILE_LINK_REVEAL_CHANNEL, request)
    ),
  };
}
