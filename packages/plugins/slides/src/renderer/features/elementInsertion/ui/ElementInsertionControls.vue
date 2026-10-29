<template>
  <ToolbarGroup :aria-label="message('slides.insert.label')">
    <ToolbarButton
      v-for="kind in kinds"
      :key="kind"
      :label="message(`slides.insert.${kind}`)"
      :disabled="!available"
      :data-insert="kind"
      @click="insertSimple(kind)"
    >
      {{ message(`slides.insert.${kind}`) }}
    </ToolbarButton>
    <ToolbarButton
      :label="message('slides.insert.image')"
      :disabled="!available"
      data-insert="image"
      @click="input?.click()"
    >
      {{ message('slides.insert.image') }}
    </ToolbarButton>
    <input
      ref="input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="onFile"
    >
  </ToolbarGroup>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { ToolbarGroup, ToolbarButton } from '@linnya/renderer-ui';
import { useElementInsertion } from '../orchestration/useElementInsertion';
const kinds = ['text', 'rect', 'ellipse'] as const;
const input = ref<HTMLInputElement | null>(null);
const { available, message, insertSimple, insertImage } = useElementInsertion();
function onFile(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) void insertImage(file);
}
</script>
