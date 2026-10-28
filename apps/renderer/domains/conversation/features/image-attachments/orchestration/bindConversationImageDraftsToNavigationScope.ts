import type { ConversationImageAttachmentDraftController } from './conversationImageAttachmentDraftController';

export interface ConversationImageDraftNavigationScopePort {
  onScopeWillChange(handler: () => void): () => void;
}

export function bindConversationImageDraftsToNavigationScope(
  controller: ConversationImageAttachmentDraftController,
  navigationScope: ConversationImageDraftNavigationScopePort
): () => void {
  return navigationScope.onScopeWillChange(() => controller.clear());
}
