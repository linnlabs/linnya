<!-- packages/renderer-ui/src/features/feedback/ui/ScrollToBottomButton.vue -->
<template>
  <transition name="scroll-btn">
    <button
      v-if="show"
      @click="handleClick"
      class="scroll-to-bottom-btn"
      :title="resolvedTitle"
      :aria-label="resolvedTitle"
    >
      <svg class="scroll-to-bottom-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path class="scroll-to-bottom-icon__shadow" d="M19 9l-7 7-7-7" />
        <path class="scroll-to-bottom-icon__highlight" d="M19 9l-7 7-7-7" />
        <path class="scroll-to-bottom-icon__stroke" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';

/**
 * 功能 (What): 通用的滚动到底部按钮组件
 * 输入 (Input): show - 是否显示按钮，title - 按钮提示文本
 * 输出 (Output): 触发点击事件
 * 副作用 (Side-effects): 无
 */

interface Props {
  show?: boolean;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  show: false,
  title: ''
});

const emit = defineEmits<{
  (e: 'click'): void;
}>();
const { sharedComponentMessage } = useSharedComponentLocalization();

const resolvedTitle = computed(() => (
  props.title || sharedComponentMessage('shared.scrollToBottom.title')
));

const handleClick = () => {
  emit('click');
};
</script>
