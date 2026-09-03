import type { ConversationImageAttachmentDraftController } from './conversationImageAttachmentDraftController';

export interface ConversationImageDraftWorkspaceScopePort {
  onScopeWillChange(handler: () => void): () => void;
}

export function bindConversationImageDraftsToWorkspaceScope(
  controller: ConversationImageAttachmentDraftController,
  workspaceScope: ConversationImageDraftWorkspaceScopePort,
): () => void {
  return workspaceScope.onScopeWillChange(() => controller.clear());
}
