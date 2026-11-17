<script setup lang="ts">
defineProps<{
  readonly title: string;
  readonly note?: string;
}>();
defineSlots<{ default(): unknown }>();
</script>

<template>
  <section class="gallery-block">
    <header class="gallery-block__header">
      <h2 class="gallery-block__title">{{ title }}</h2>
      <p v-if="note" class="gallery-block__note">{{ note }}</p>
    </header>
    <div class="gallery-block__body">
      <slot />
    </div>
  </section>
</template>
