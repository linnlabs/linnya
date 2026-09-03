<template>
  <div
    v-if="answers.length > 0"
    ref="rootElement"
    class="conversation-answer-render-host"
    :style="{ width: `${widthPx}px` }"
    aria-hidden="true"
    inert
  >
    <Message
      v-for="answer in answers"
      :key="answer.id"
      :message="answer"
      :is-streaming="false"
    />
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue';
import type { BaseMessage } from '../../../../../types';
import { MESSAGE_ENTRY_ANIMATION_PORT_KEY } from '../../../../../definitions/messageEntryAnimation';
import Message from '../../../../Message.vue';

defineProps<{
  answers: readonly BaseMessage[];
  widthPx: number;
}>();

const rootElement = ref<globalThis.HTMLElement | null>(null);

// 离屏复制只复用渲染结果，不能消费可见消息的入场动画台账。
provide(MESSAGE_ENTRY_ANIMATION_PORT_KEY, {
  isPending: () => false,
  consume: () => {},
});

defineExpose({ rootElement });
</script>
