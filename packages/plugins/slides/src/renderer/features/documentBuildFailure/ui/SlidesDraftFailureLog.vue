<template>
  <section class="slides-draft-failure-log">
    <div class="slides-draft-failure-log__toolbar">
      <button
        type="button"
        class="slides-draft-failure-log__toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <ChevronIcon
          direction="right"
          class="slides-draft-failure-log__chevron"
          :class="{ 'is-expanded': expanded }"
        />
        <span>错误日志</span>
      </button>

      <button
        type="button"
        class="slides-draft-failure-log__copy"
        :class="{
          'is-copied': copyFeedback === 'copied',
          'is-failed': copyFeedback === 'failed',
        }"
        :title="copyButtonTitle"
        :aria-label="copyButtonTitle"
        @click="copyLog"
      >
        <CopyIcon />
      </button>
    </div>

    <pre
      v-if="expanded"
      class="slides-draft-failure-log__content"
    >{{ log }}</pre>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ChevronIcon, CopyIcon } from '@linnya/renderer-ui/icons';

const props = defineProps<{
  log: string;
}>();

const COPY_FEEDBACK_DURATION_MS = 2_000;

const expanded = ref(false);
const copyFeedback = ref<'idle' | 'copied' | 'failed'>('idle');
let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

const copyButtonTitle = computed(() => {
  if (copyFeedback.value === 'copied') return '已复制错误日志';
  if (copyFeedback.value === 'failed') return '复制错误日志失败';
  return '复制错误日志';
});

function settleCopyFeedback(next: 'copied' | 'failed'): void {
  copyFeedback.value = next;
  if (copyFeedbackTimer !== undefined) clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => {
    copyFeedback.value = 'idle';
    copyFeedbackTimer = undefined;
  }, COPY_FEEDBACK_DURATION_MS);
}

async function copyLog(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.log);
    settleCopyFeedback('copied');
  } catch (error: unknown) {
    console.error('[SlidesDraftFailureLog] 复制错误日志失败', { error });
    settleCopyFeedback('failed');
  }
}

onBeforeUnmount(() => {
  if (copyFeedbackTimer !== undefined) clearTimeout(copyFeedbackTimer);
});
</script>
