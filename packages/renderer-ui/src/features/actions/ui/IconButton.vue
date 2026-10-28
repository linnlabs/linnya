<!-- packages/renderer-ui/src/features/actions/ui/IconButton.vue -->
<template>
  <button
    ref="buttonRef"
    :type="type"
    :disabled="disabled"
    :class="classes"
    :aria-label="label"
    v-bind="tooltipAttributes"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { hoverTooltipAttributes, useHoverTooltipService } from '../../feedback';
import type { IconButtonProps, IconButtonSlots } from '../definitions/iconButton';

const props = withDefaults(defineProps<IconButtonProps>(), {
  size: 'sm',
  variant: 'ghost',
  tone: 'neutral',
  active: false,
  disabled: false,
  tooltip: true,
  type: 'button',
});

defineSlots<IconButtonSlots>();
// 提示由共享的提示服务绘制（首次悬停有延迟，相邻按钮之间无延迟），不再使用原生 title。
useHoverTooltipService();
const tooltipAttributes = computed(() => hoverTooltipAttributes(props.tooltip ? props.tooltipText ?? props.label : undefined));
const buttonRef = ref<HTMLButtonElement | null>(null);
defineExpose({ element: buttonRef });

const classes = computed<readonly string[]>(() => [
  'linnya-ui-icon-button',
  `linnya-ui-icon-button--${props.size}`,
  `linnya-ui-icon-button--${props.variant}`,
  ...(props.tone === 'danger' ? ['linnya-ui-icon-button--danger'] : []),
  ...(props.active ? ['linnya-ui-icon-button--active'] : []),
]);
</script>
