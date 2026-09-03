<template>
  <section
    v-if="items.length > 0 || message"
    class="conversation-image-draft-strip"
    :aria-label="conversationMessage('conversation.input.image.drafts')"
  >
    <div
      v-if="items.length > 0"
      class="conversation-image-draft-strip__items"
    >
      <article
        v-for="item in items"
        :key="item.clientId"
        class="conversation-image-draft-item"
        :class="`is-${item.status}`"
      >
        <button
          type="button"
          class="conversation-image-draft-item__preview"
          :aria-label="conversationMessage('conversation.input.image.preview')"
          @click="previewItem = item"
        >
          <img :src="item.previewUrl" :alt="item.fileName">
          <span
            v-if="item.status === 'uploading'"
            class="conversation-image-draft-item__status"
          >
            {{ conversationMessage('conversation.input.image.uploading') }}
          </span>
          <span
            v-else-if="item.status === 'failed'"
            class="conversation-image-draft-item__status is-error"
          >
            {{ conversationMessage(resolveImageAttachmentErrorMessage(item.errorCode)) }}
          </span>
        </button>

        <button
          type="button"
          class="conversation-image-draft-item__remove"
          :aria-label="conversationMessage('conversation.input.image.removeNamed', { name: item.fileName })"
          :disabled="disabled"
          @click="emit('remove', item.clientId)"
        >
          <CloseIcon />
        </button>

        <button
          v-if="item.status === 'failed'"
          type="button"
          class="conversation-image-draft-item__retry"
          :aria-label="conversationMessage('conversation.input.image.retryNamed', { name: item.fileName })"
          :disabled="disabled"
          @click="emit('retry', item.clientId)"
        >
          <RefreshIcon />
        </button>
      </article>
    </div>

    <p v-if="message" class="conversation-image-draft-strip__message">
      {{ message }}
    </p>
  </section>

  <ImagePreviewModal
    :is-visible="previewItem !== null"
    :src="previewItem?.previewUrl ?? ''"
    :alt="previewItem?.fileName ?? ''"
    @close="previewItem = null"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ImagePreviewModal } from '@linnya/renderer-ui';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { RefreshIcon } from '@linnya/renderer-ui/icons';
import type { ConversationImageDraftItem } from '../definitions/conversationImageAttachmentDraft';
import { resolveImageAttachmentErrorMessage } from '../functions/resolveImageAttachmentErrorMessage';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

defineProps<{
  readonly items: readonly ConversationImageDraftItem[];
  readonly message: string;
  readonly disabled?: boolean;
}>();

const emit = defineEmits<{
  remove: [clientId: string];
  retry: [clientId: string];
}>();

const { conversationMessage } = useConversationLocalization();
const previewItem = ref<ConversationImageDraftItem | null>(null);
</script>
