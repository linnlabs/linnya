<!-- apps/renderer/features/AiAssistant/ui/components/timeline/TimelineTooltip.vue -->
<template>
  <div
    class="timeline-tooltip"
    :class="[`placement-${placement}`, { visible: true }]"
    :style="tooltipStyle"
    role="tooltip"
  >
    {{ text }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * 功能 (What): 时间轴工具提示组件
 * 输入 (Input): text - 提示文本，x/y - 绝对位置，placement - 放置方向
 * 输出 (Output): 渲染浮动的工具提示
 */

interface Props {
  text: string;
  x: number;
  y: number;
  placement: 'left' | 'right';
}

const props = defineProps<Props>();

// 计算工具提示的样式
const tooltipStyle = computed(() => {
  const style: Record<string, string> = {
    position: 'fixed',
    zIndex: '1000',
  };

  if (props.placement === 'right') {
    style.left = `${props.x}px`;
    style.top = `${props.y}px`;
    style.transform = 'translateY(-50%)';
  } else {
    style.right = `${window.innerWidth - props.x}px`;
    style.top = `${props.y}px`;
    style.transform = 'translateY(-50%)';
  }

  return style;
});
</script>
