<!-- packages/renderer-ui/src/features/feedback/ui/Skeleton.vue -->
<template>
  <div
    class="linnya-ui-skeleton"
    :class="{ 'linnya-ui-skeleton--delayed': delayed }"
    role="status"
    aria-busy="true"
  >
    <span class="linnya-ui-skeleton__label">{{ label }}</span>
    <div class="linnya-ui-skeleton__content" aria-hidden="true">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SkeletonProps, SkeletonSlots } from '../definitions/skeleton';

withDefaults(defineProps<SkeletonProps>(), {
  delayed: true,
});

defineSlots<SkeletonSlots>();
</script>
