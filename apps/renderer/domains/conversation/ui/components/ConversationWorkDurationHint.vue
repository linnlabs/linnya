<template>
  <div
    v-if="shouldShow"
    class="turn-work-duration-hint"
  >
    <span class="turn-work-duration-text">
      {{ conversationMessage('conversation.turn.workDuration', { duration: durationText }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useConversationLocalization } from '../useConversationLocalization';

const props = defineProps<{
  durationMs: number | undefined;
  isStreaming: boolean;
}>();

const { conversationMessage } = useConversationLocalization();
const shouldShow = computed(() => (
  !props.isStreaming
  && typeof props.durationMs === 'number'
  && props.durationMs >= 5 * 60 * 1000
));
const durationText = computed(() => {
  if (typeof props.durationMs !== 'number') return '';
  const totalSeconds = Math.floor(props.durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
});
</script>
