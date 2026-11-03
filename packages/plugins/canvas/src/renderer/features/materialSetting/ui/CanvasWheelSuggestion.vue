<template>
  <aside
    v-if="suggestion.state.visible.value"
    class="canvas-wheel-suggestion"
    role="status"
  >
    <p>看起来您在使用鼠标滚轮，要启用滚轮缩放吗？也可以继续滚动平移；捏合始终缩放。</p>
    <button
      type="button"
      @click="suggestion.enable()"
    >
      启用滚轮缩放
    </button>
    <button
      type="button"
      @click="suggestion.dismiss()"
    >
      保持平移
    </button>
  </aside>
</template>
<script setup lang="ts">
import type { installCanvasWheelSuggestion } from '../orchestration/installCanvasWheelSuggestion';
defineProps<{ suggestion: ReturnType<typeof installCanvasWheelSuggestion> }>();
</script>
