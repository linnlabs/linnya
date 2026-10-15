<template>
  <div
    class="execution-notice"
    :class="{ 'execution-notice--failed': presentation.failed }"
    role="status"
    aria-live="polite"
  >
    <ExecutionProgressText :active="presentation.active">
      {{ presentation.text }}
    </ExecutionProgressText>
    <span
      v-if="presentation.elapsedSeconds !== undefined"
      class="execution-notice__time"
    >
      {{
        conversationMessage('conversation.retry.elapsed', { seconds: presentation.elapsedSeconds })
      }}
      <template v-if="presentation.remainingSeconds !== undefined">
        ·
        {{
          conversationMessage('conversation.retry.next', { seconds: presentation.remainingSeconds })
        }}
      </template>
    </span>
    <details
      v-if="message.metadata.error_code"
      class="execution-notice__details"
    >
      <summary>{{ conversationMessage('conversation.retry.details') }}</summary>
      <code>{{ message.metadata.error_code }}</code>
      <span>{{ message.id }}</span>
    </details>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ExecutionProgressText,
  useMessageExecutionActivity,
} from '../../shared/execution-presentation';
import type { ExecutionNoticeMessage } from '../../features/error-surface/definitions/executionNotice';
import {
  projectExecutionNoticePresentation,
  isExecutionNoticeExecuting,
} from '../../features/error-surface/functions/projectExecutionNoticePresentation';
import { useConversationLocalization } from '../useConversationLocalization';
const props = defineProps<{ message: ExecutionNoticeMessage }>();
const { conversationMessage } = useConversationLocalization();
const now = ref(Date.now());
const activity = useMessageExecutionActivity(() => props.message.metadata.run_id);
const presentation = computed(() =>
  projectExecutionNoticePresentation(
    props.message.metadata,
    now.value,
    conversationMessage,
    isExecutionNoticeExecuting(props.message.metadata, activity.value)
  )
);
let timer: ReturnType<typeof setInterval> | undefined;
function stopTimer(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}
watch(
  () => presentation.value.active,
  active => {
    stopTimer();
    if (active) {
      now.value = Date.now();
      timer = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    }
  },
  { immediate: true }
);
onBeforeUnmount(stopTimer);
</script>
