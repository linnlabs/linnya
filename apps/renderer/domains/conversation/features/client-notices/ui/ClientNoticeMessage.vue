<template>
  <div
    class="client-notice"
    role="status"
  >
    {{ text }}
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
