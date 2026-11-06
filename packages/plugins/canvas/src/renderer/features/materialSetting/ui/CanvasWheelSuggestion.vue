<template>
  <p v-if="suggestion.state.visible.value" class="canvas-status-item" role="status">
    <span class="canvas-status-text">检测到鼠标滚轮：要改成滚轮缩放吗？捏合始终缩放。</span>
    <BaseButton variant="plain" tone="accent" size="sm" @click="suggestion.enable()">
      改为滚轮缩放
    </BaseButton>
    <BaseButton variant="plain" size="sm" @click="suggestion.dismiss()">保持平移</BaseButton>
  </p>
</template>
<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import type { installCanvasWheelSuggestion } from '../orchestration/installCanvasWheelSuggestion';
defineProps<{ suggestion: ReturnType<typeof installCanvasWheelSuggestion> }>();
</script>
