<template>
  <p v-if="suggestion.state.visible.value" class="canvas-status-item" role="status">
    <span class="canvas-status-text">{{ t('canvas.wheel.message') }}</span>
    <BaseButton variant="plain" tone="accent" size="sm" @click="suggestion.enable()">
      {{ t('canvas.wheel.accept') }}
    </BaseButton>
    <BaseButton variant="plain" size="sm" @click="suggestion.dismiss()">
      {{ t('canvas.wheel.keep') }}
    </BaseButton>
  </p>
</template>
<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import { canvasText as t } from '../../localization';
import type { installCanvasWheelSuggestion } from '../orchestration/installCanvasWheelSuggestion';
defineProps<{ suggestion: ReturnType<typeof installCanvasWheelSuggestion> }>();
</script>
