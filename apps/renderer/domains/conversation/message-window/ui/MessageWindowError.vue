<template>
  <div
    v-if="text"
    class="message-window-error"
    role="status"
  >
    {{ text }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMessageWindowStore } from '../store/messageWindowStore';
import { conversationOperationFailureText } from '../../features/error-surface';
import { useConversationLocalization } from '../../ui/useConversationLocalization';

const props = defineProps<{ conversationId: string | null }>();
const windowStore = useMessageWindowStore();
const { conversationMessage } = useConversationLocalization();
const text = computed(() => (
  windowStore.conversationId === props.conversationId && windowStore.status === 'error' && windowStore.error
    ? conversationOperationFailureText({ ...windowStore.error, operation: 'load' }, conversationMessage)
    : null
));
</script>
