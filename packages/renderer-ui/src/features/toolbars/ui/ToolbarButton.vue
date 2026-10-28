<template>
  <button
    type="button"
    class="linnya-toolbar-button"
    :class="{ 'linnya-toolbar-button--active': active }"
    :disabled="disabled"
    :data-linnya-tooltip="label"
    :aria-label="label"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { useHoverTooltipService } from '../../feedback';
import type { ToolbarButtonProps } from '../definitions/toolbar';
defineProps<ToolbarButtonProps>();
useHoverTooltipService();
defineSlots<{ default(): unknown }>();
</script>
