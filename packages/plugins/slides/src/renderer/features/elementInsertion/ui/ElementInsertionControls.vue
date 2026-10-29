<template>
  <ToolbarGroup :aria-label="message('slides.insert.label')">
    <ToolbarButton
      v-for="item in kinds"
      :key="item.kind"
      :label="message(`slides.insert.${item.kind}`)"
      :disabled="!available"
      :data-insert="item.kind"
      @click="insertSimple(item.kind)"
    >
      <component
        :is="item.icon"
      />
    </ToolbarButton>
    <ToolbarButton
      :label="message('slides.insert.image')"
      :disabled="!available"
      data-insert="image"
      @click="input?.click()"
    >
      <ImageIcon />
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
import { ImageIcon } from '@linnya/renderer-ui/icons';
import { EllipseIcon, InsertTextIcon, RectangleIcon } from '../../../shared/icons';
import { useElementInsertion } from '../orchestration/useElementInsertion';
const kinds = [
  { kind: 'text', icon: InsertTextIcon },
  { kind: 'rect', icon: RectangleIcon },
  { kind: 'ellipse', icon: EllipseIcon },
] as const;
const input = ref<HTMLInputElement | null>(null);
const { available, message, insertSimple, insertImage } = useElementInsertion();
function onFile(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) void insertImage(file);
}
</script>

