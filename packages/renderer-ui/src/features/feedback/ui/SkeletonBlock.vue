<!-- packages/renderer-ui/src/features/feedback/ui/SkeletonBlock.vue -->
<template>
  <span
    class="linnya-ui-skeleton-block"
    :class="`linnya-ui-skeleton-block--radius-${radius}`"
    :style="{ width, height }"
  />
</template>

<script setup lang="ts">
import type { SkeletonBlockProps } from '../definitions/skeleton';

withDefaults(defineProps<SkeletonBlockProps>(), {
  width: '100%',
  height: '10px',
  radius: 'full',
});
</script>
