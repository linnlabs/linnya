<template>
  <section
    v-if="items.length > 0"
    class="conversation-image-gallery"
    :class="{
      'is-result': isResultMode,
      'is-compact-result': props.displayMode === 'compact-result',
    }"
    :aria-label="conversationMessage('conversation.userMessage.image.gallery')"
  >
    <article
      v-for="item in items"
      :key="item.attachment.id"
      class="conversation-image-gallery__item"
      :class="[
        `is-${item.status}`,
        { 'is-result': isResultMode },
      ]"
      :style="isResultMode ? resultItemStyle(item.attachment) : undefined"
    >
      <button
        v-if="item.status === 'ready'"
        type="button"
        class="conversation-image-gallery__preview"
        :title="conversationMessage('conversation.userMessage.image.previewNamed', {
          name: attachmentName(item),
        })"
        @click="selectedAttachmentId = item.attachment.id"
      >
        <img :src="item.objectUrl" :alt="attachmentName(item)">
      </button>
      <div v-else-if="item.status === 'loading'" class="conversation-image-gallery__status">
        {{ conversationMessage('conversation.userMessage.image.loading') }}
      </div>
      <button
        v-else
        type="button"
        class="conversation-image-gallery__status is-error"
        :title="conversationMessage('conversation.userMessage.image.retryNamed', {
          name: attachmentName(item),
        })"
        @click="retry(item.attachment.id)"
      >
        <RefreshIcon />
        <span>{{ conversationMessage(resolveImageAttachmentErrorMessage(item.errorCode)) }}</span>
      </button>
    </article>
  </section>

  <ImagePreviewModal
    :is-visible="selectedItem !== null"
    :src="selectedItem?.objectUrl ?? ''"
    :alt="selectedItem ? attachmentName(selectedItem) : ''"
    @close="selectedAttachmentId = null"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ConversationAttachmentRef } from '@app/schemas';
import { ImagePreviewModal } from '@linnya/renderer-ui';
import { RefreshIcon } from '@linnya/renderer-ui/icons';
import type { ConversationImagePreviewItem } from '../definitions/conversationImagePreview';
import { resolveImageAttachmentErrorMessage } from '../functions/resolveImageAttachmentErrorMessage';
import { useConversationImagePreviews } from '../orchestration/useConversationImagePreviews';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import {
  calculateCompactConversationImageResultBoxSize,
  calculateConversationImageReservedBoxSize,
  CONVERSATION_IMAGE_MAX_WIDTH_PX,
} from '../../../functions/conversationImageLayout';

const props = withDefaults(defineProps<{
  readonly attachments: readonly ConversationAttachmentRef[];
  readonly displayMode?: 'thumbnail' | 'result' | 'compact-result';
}>(), {
  displayMode: 'thumbnail',
});

const { conversationMessage } = useConversationLocalization();
const { items, retry } = useConversationImagePreviews(() => props.attachments);
const isResultMode = computed(() => props.displayMode !== 'thumbnail');
const selectedAttachmentId = ref<string | null>(null);
const selectedItem = computed(() => {
  const item = items.value.find(candidate => candidate.attachment.id === selectedAttachmentId.value);
  return item?.status === 'ready' ? item : null;
});

function resultItemStyle(attachment: ConversationAttachmentRef): Record<string, string> {
  const dimensions = { width: attachment.width, height: attachment.height };
  const box =
    props.displayMode === 'compact-result'
      ? calculateCompactConversationImageResultBoxSize(dimensions, CONVERSATION_IMAGE_MAX_WIDTH_PX)
      : calculateConversationImageReservedBoxSize(dimensions, CONVERSATION_IMAGE_MAX_WIDTH_PX);
  return {
    width: `${box.widthPx}px`,
    'max-height': `${box.heightPx}px`,
    'aspect-ratio': `${attachment.width} / ${attachment.height}`,
  };
}

function attachmentName(item: ConversationImagePreviewItem): string {
  return item.attachment.fileName
    || item.attachment.label
    || conversationMessage('conversation.userMessage.image.unnamed');
}
</script>
