<template>
  <span :class="active && effect !== 'none' ? `execution-progress-text--${effect}` : undefined">
    <slot />
  </span>
</template>

<script setup lang="ts">
import type { ToolActivityTextEffect } from '@linnya/plugin-host-contract/renderer/executionPresentation';
import './ExecutionProgressText.css';

// 纯视觉组件；调用方传入公共活动态的派生结果，不在这里解释工具或 run 状态。
withDefaults(defineProps<{ active: boolean; effect?: ToolActivityTextEffect }>(), {
  effect: 'shimmer',
});
</script>
