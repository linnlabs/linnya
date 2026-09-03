import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { conversationImageAttachmentApi } from './conversationImageAttachmentApi';
import { createConversationImageAttachmentDraftController } from './conversationImageAttachmentDraftController';
import { bindConversationImageDraftsToWorkspaceScope } from './bindConversationImageDraftsToWorkspaceScope';
import { useConversationImageAttachmentDraftStore } from '../store/conversationImageAttachmentDraftStore';

let productionController: ReturnType<typeof createConversationImageAttachmentDraftController> | null = null;

/** 草稿生命周期属于 conversation feature，不随 composer 组件临时卸载而结束。 */
export function useConversationImageAttachmentDrafts() {
  const store = useConversationImageAttachmentDraftStore();
  if (productionController) return { store, controller: productionController };

  const controller = createConversationImageAttachmentDraftController({
      store,
      api: conversationImageAttachmentApi,
      objectUrls: {
        create: file => URL.createObjectURL(file),
        revoke: url => URL.revokeObjectURL(url),
      },
      log: {
        releaseFailed: code => console.warn('[conversation-image-draft] release 失败', { code }),
      },
      createClientId: () => globalThis.crypto.randomUUID(),
  });
  productionController = controller;
  bindConversationImageDraftsToWorkspaceScope(controller, useWorkspaceScopeStore());
  return { store, controller };
}
