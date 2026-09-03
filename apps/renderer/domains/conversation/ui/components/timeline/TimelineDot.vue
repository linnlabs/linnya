<!-- 时间轴标记点组件 -->
<template>
  <button
    class="timeline-dot"
    :class="{ active: isActive }"
    :style="{ '--n': normalizedPosition }"
    :aria-label="summary"
    :disabled="disabled"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <span class="dot-indicator" />
  </button>
</template>

<script setup lang="ts">
import type { ConversationCompleteVisualTurnId } from '@app/schemas';

/**
 * 功能 (What): 单个时间轴标记点
 * 输入 (Input): visualTurnId、summary、position、active 状态
 * 输出 (Output): 渲染可点击的标记点，支持长按收藏
 */

interface Props {
  visualTurnId: ConversationCompleteVisualTurnId;
  summary: string;
  normalizedPosition: number; // 0-1
  isActive?: boolean;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isActive: false,
  disabled: false,
});

const emit = defineEmits<{
  click: [visualTurnId: ConversationCompleteVisualTurnId];
  mouseenter: [event: MouseEvent];
  mouseleave: [];
}>();

function handleClick() {
  emit('click', props.visualTurnId);
}

function handleMouseEnter(e: MouseEvent) {
  emit('mouseenter', e);
}

function handleMouseLeave() {
  emit('mouseleave');
}
</script>
