<script setup lang="ts">
withDefaults(
  defineProps<{
    readonly label: string;
    readonly align?: 'center' | 'start';
  }>(),
  { align: 'center' }
);
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div class="gallery-row" :class="`is-align-${align}`">
    <div class="gallery-row__label">{{ label }}</div>
    <div class="gallery-row__content">
      <slot />
    </div>
  </div>
</template>
