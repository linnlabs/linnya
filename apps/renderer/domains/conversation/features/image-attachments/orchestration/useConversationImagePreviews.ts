import { onUnmounted, ref, watch } from 'vue';
import type { ConversationAttachmentRef } from '@app/schemas';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import type { ConversationImagePreviewItem } from '../definitions/conversationImagePreview';
import { conversationImagePreviewApi } from './conversationImagePreviewApi';
import { createConversationImagePreviewController } from './conversationImagePreviewController';

export function useConversationImagePreviews(
  readAttachments: () => readonly ConversationAttachmentRef[],
) {
  const items = ref<readonly ConversationImagePreviewItem[]>([]);
  const controller = createConversationImagePreviewController({
    api: conversationImagePreviewApi,
    state: { replace: nextItems => { items.value = [...nextItems]; } },
    objectUrls: {
      create: blob => URL.createObjectURL(blob),
      revoke: url => URL.revokeObjectURL(url),
    },
  });
  const stopAttachmentWatch = watch(
    () => readAttachments().map(attachment => `${attachment.id}:${attachment.assetId}`).join('|'),
    () => controller.setAttachments(readAttachments()),
    { immediate: true },
  );
  const stopScopeWatch = useWorkspaceScopeStore().onScopeWillChange(() => controller.dispose());

  onUnmounted(() => {
    stopAttachmentWatch();
    stopScopeWatch();
    controller.dispose();
  });

  return { items, retry: controller.retry };
}
