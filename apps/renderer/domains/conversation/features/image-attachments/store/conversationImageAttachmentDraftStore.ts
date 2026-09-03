import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  ConversationImageAttachmentErrorCode,
  ConversationImageDraftStageResponse,
} from '@app/schemas';
import type { ConversationImageDraftItem } from '../definitions/conversationImageAttachmentDraft';

function readBase(item: ConversationImageDraftItem) {
  return {
    clientId: item.clientId,
    fileName: item.fileName,
    byteLength: item.byteLength,
    previewUrl: item.previewUrl,
  };
}

/** 只持有草稿展示状态；上传、取消、URL 和 release 副作用全部由 orchestration 负责。 */
export const useConversationImageAttachmentDraftStore = defineStore(
  'conversation-image-attachment-drafts',
  () => {
    const items = ref<ConversationImageDraftItem[]>([]);

    const appendUploading = (item: Extract<ConversationImageDraftItem, { status: 'uploading' }>) => {
      items.value.push(item);
    };

    const markUploading = (clientId: string): void => {
      items.value = items.value.map(item => item.clientId === clientId
        ? { ...readBase(item), status: 'uploading' }
        : item);
    };

    const markReady = (
      clientId: string,
      staged: ConversationImageDraftStageResponse,
    ): void => {
      items.value = items.value.map(item => item.clientId === clientId
        ? { ...readBase(item), status: 'ready', staged }
        : item);
    };

    const markFailed = (
      clientId: string,
      errorCode: ConversationImageAttachmentErrorCode,
    ): void => {
      items.value = items.value.map(item => item.clientId === clientId
        ? { ...readBase(item), status: 'failed', errorCode }
        : item);
    };

    const remove = (clientId: string): void => {
      items.value = items.value.filter(item => item.clientId !== clientId);
    };

    const clear = (): void => {
      items.value = [];
    };

    return { items, appendUploading, markUploading, markReady, markFailed, remove, clear };
  },
);
