<template>
  <div class="image-read-card">
    <ConversationImageAttachmentGallery
      v-if="attachments && attachments.length > 0"
      :attachments="attachments"
      display-mode="compact-result"
    />
    <p v-else-if="presentation.status === 'success'" class="image-read-card__unavailable">
      {{ conversationMessage('conversation.tool.imageRead.unavailable') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type {
  ToolCardPresentation,
  ToolUiImageAttachmentRef,
} from '../types';
import ConversationImageAttachmentGallery from '../../../features/image-attachments/ui/ConversationImageAttachmentGallery.vue';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ImageReadPresentationData } from './definitions/imageReadPresentation';

defineProps<{
  readonly presentation: ToolCardPresentation<ImageReadPresentationData>;
  readonly attachments?: readonly ToolUiImageAttachmentRef[];
}>();

const { conversationMessage } = useConversationLocalization();
</script>
