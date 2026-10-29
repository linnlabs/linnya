<template>
  <span
    class="tooltip-trigger"
    v-bind="tooltipAttributes"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HoverTooltipProps } from '../definitions/hoverTooltip';
import { hoverTooltipAttributes } from '../functions/hoverTooltipAttributes';
import { useHoverTooltipService } from '../vue/useHoverTooltipService';

const props = withDefaults(defineProps<HoverTooltipProps>(), {
  placement: 'bottom',
  offset: 8,
  disabled: false,
});

// 气泡由全局共享的提示服务绘制；这里只声明文字与落点，延迟、相邻免延迟与键盘规则见服务。
useHoverTooltipService();

const tooltipAttributes = computed(() => (
  props.disabled
    ? {}
    : hoverTooltipAttributes(props.text, { placement: props.placement, offset: props.offset })
));
</script>
