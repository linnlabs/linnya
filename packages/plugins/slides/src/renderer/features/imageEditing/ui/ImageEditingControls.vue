<template>
  <ToolbarGroup v-if="target?.targetKind === 'image'">
    <ToolbarButton
      :label="message('replaceImage')"
      :disabled="busy"
      data-property="replace-image"
      @click="input?.click()"
    >
      <ImageIcon class="slides-image-editing__icon" />
      <span>{{ message('replace') }}</span>
    </ToolbarButton>
    <input
      ref="input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="replaceImage"
    >
  </ToolbarGroup>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { ToolbarButton, ToolbarGroup } from '@linnya/renderer-ui';
import { ImageIcon } from '@linnya/renderer-ui/icons';
import { useImageEditing } from '../orchestration/useImageEditing';
const input = ref<HTMLInputElement | null>(null);
const { target, busy, message, replaceFile } = useImageEditing();
function replaceImage(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) void replaceFile(file);
}
</script>
