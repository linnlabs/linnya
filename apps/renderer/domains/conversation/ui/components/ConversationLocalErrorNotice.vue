<template>
  <div class="conversation-local-error" role="alert">
    <span>{{ error }}</span>
    <small>{{ conversationMessage('conversation.retry.localOnly') }}</small>
    <button
      type="button"
      :aria-label="conversationMessage('conversation.error.close')"
      @click="$emit('dismiss')"
    >
      ×
    </button>
  </div>
</template>
<script setup lang="ts">
import { useConversationLocalization } from '../useConversationLocalization';
defineProps<{ error: string }>();
defineEmits<{ dismiss: [] }>();
const { conversationMessage } = useConversationLocalization();
</script>
<style scoped>
.conversation-local-error {
  color: var(--color-error, #c74343);
  font-size: 13px;
  line-height: 1.7;
  padding: 8px 20px;
}
.conversation-local-error small {
  margin-inline-start: 8px;
  opacity: 0.7;
}
.conversation-local-error button {
  border: 0;
  background: transparent;
  color: inherit;
  margin-inline-start: 8px;
  cursor: pointer;
}
</style>
