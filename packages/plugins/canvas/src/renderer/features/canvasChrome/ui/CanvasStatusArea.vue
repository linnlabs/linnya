<template>
  <div v-if="items.length || $slots.default" class="canvas-status-area" @pointerdown.stop>
    <slot />
    <p
      v-for="item in items"
      :key="item.id"
      class="canvas-status-item"
      :class="{ 'is-error': item.tone === 'error' }"
      :role="item.tone === 'error' ? 'alert' : 'status'"
    >
      <span class="canvas-status-text">{{ item.text }}</span>
      <BaseButton
        v-for="action in item.actions ?? []"
        :key="action.label"
        variant="plain"
        size="sm"
        :tone="item.tone === 'error' ? 'accent' : undefined"
        :disabled="action.disabled"
        @click="action.run()"
      >
        {{ action.label }}
      </BaseButton>
    </p>
  </div>
</template>
<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import type { CanvasStatusItem } from '../definitions/canvasStatus';

/** 画布所有进度、提示与错误共用一个底部状态区，不再各自定位、互相遮挡。 */
defineProps<{ items: readonly CanvasStatusItem[] }>();
defineSlots<{ default?(): unknown }>();
</script>
