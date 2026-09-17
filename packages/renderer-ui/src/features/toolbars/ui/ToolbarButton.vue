<template>
  <button
    type="button"
    class="linnya-toolbar-button"
    :class="{ 'linnya-toolbar-button--active': active }"
    :disabled="disabled"
    :title="label"
    :aria-label="label"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import type { ToolbarButtonProps } from '../definitions/toolbar';
defineProps<ToolbarButtonProps>();
defineSlots<{ default(): unknown }>();
</script>
