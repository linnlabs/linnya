import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { watch } from 'vue';
import { useConversationState } from '../../../store/conversationState';
import { conversationImageAttachmentApi } from './conversationImageAttachmentApi';
import { createConversationImageEditSessionController } from './conversationImageEditSessionController';
import { useConversationImageEditSessionStore } from '../store/conversationImageEditSessionStore';

let productionController: ReturnType<typeof createConversationImageEditSessionController> | null = null;
let stopScopeWatch: (() => void) | null = null;
let stopConversationWatch: (() => void) | null = null;

export function useConversationImageEditSession() {
  const store = useConversationImageEditSessionStore();
  if (!productionController) {
    const conversationState = useConversationState();
    productionController = createConversationImageEditSessionController({
      store,
      api: conversationImageAttachmentApi,
      objectUrls: {
        create: file => URL.createObjectURL(file),
        revoke: url => URL.revokeObjectURL(url),
      },
      createClientId: () => globalThis.crypto.randomUUID(),
    });
    stopScopeWatch = useWorkspaceScopeStore().onScopeWillChange(() => productionController?.cancel());
    stopConversationWatch = watch(
      () => conversationState.activeConversationId,
      (nextConversationId, previousConversationId) => {
        if (previousConversationId !== null && nextConversationId !== previousConversationId) {
          productionController?.cancel();
        }
      },
    );
  }
  return { store, controller: productionController };
}

export function getActiveConversationImageEditSessionController() {
  return productionController;
}

export function disposeConversationImageEditSessionForTests(): void {
  productionController?.cancel();
  productionController = null;
  stopScopeWatch?.();
  stopScopeWatch = null;
  stopConversationWatch?.();
  stopConversationWatch = null;
}
