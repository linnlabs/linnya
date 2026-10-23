<template>
  <figcaption
    v-if="title || description || $slots.title || $slots.description"
    class="figure-caption"
  >
    <div
      :id="titleId"
      class="figure-caption__title"
    >
      <slot name="title">
        {{ title }}
      </slot>
    </div>
    <div
      v-if="description || $slots.description"
      :id="descriptionId"
      class="figure-caption__description"
    >
      <slot name="description">
        {{ description }}
      </slot>
    </div>
  </figcaption>
</template>
<script setup lang="ts">
defineProps<{ title?: string; description?: string; titleId?: string; descriptionId?: string }>();
</script>
