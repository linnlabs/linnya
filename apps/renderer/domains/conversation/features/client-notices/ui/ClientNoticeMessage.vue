<template>
  <div
    class="client-notice"
    role="status"
  >
    {{ text }}
    <span
      v-if="message.localDelivery === 'pending'"
      class="client-notice-sync"
    > · {{ conversationMessage('conversation.clientNotice.pending') }}</span>
    <span
      v-else
      class="client-notice-sync"
    > · {{ conversationMessage('conversation.clientNotice.reported') }}</span>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ClientNoticeMessage } from '../definitions/clientNotice';
import { clientNoticeText } from '../functions/clientNoticePresentation';
const props = defineProps<{ message: ClientNoticeMessage }>();
const { conversationMessage } = useConversationLocalization();
const text = computed(() => clientNoticeText(props.message.metadata, conversationMessage));
</script>
<style scoped>
.client-notice { padding: 8px 0; color: var(--color-error, #d14343); font-size: 13px; line-height: 1.6; }
.client-notice-sync { color: var(--color-text-secondary, #777); font-size: 12px; }
</style>
