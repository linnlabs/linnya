<!-- packages/renderer-ui/src/features/selection/ui/TagChip.vue -->
<template>
  <span
    class="tt-tag-chip"
    :style="styleObject"
  >
    <span v-if="$slots.icon" class="tt-tag-chip__icon">
      <slot name="icon" />
    </span>
    <span class="tt-tag-chip__label">
      {{ label }}
    </span>
    <button
      v-if="closable"
      type="button"
      class="tt-tag-chip__close"
      @click.prevent.stop="$emit('close')"
    >
      <CloseIcon />
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CloseIcon } from '@linnya/renderer-ui/icons';

/**
 * 通用标签 Chip 组件。
 * - 支持可关闭标签（显示右侧“×”按钮）
 * - 支持自定义颜色，方便未来做“按标签配置颜色”的扩展
 */
const props = defineProps<{
  /**
   * 标签文本内容
   */
  label: string;

  /**
   * 是否显示右侧关闭按钮
   */
  closable?: boolean;

  /**
   * 自定义背景色（优先级高于默认主题色）
   */
  backgroundColor?: string;

  /**
   * 自定义文字颜色（优先级高于默认主题色）
   */
  textColor?: string;

  /**
   * 自定义边框颜色（可选）
   */
  borderColor?: string;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

// 内联 style 用于支持未来的“标签颜色自定义”
const styleObject = computed(() => {
  const style: Record<string, string> = {};

  if (props.backgroundColor) {
    style.backgroundColor = props.backgroundColor;
  }
  if (props.textColor) {
    style.color = props.textColor;
  }
  if (props.borderColor) {
    style.borderColor = props.borderColor;
  }

  return style;
});
</script>
