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
    <div
      class="slides-image-editing__fit"
      role="radiogroup"
      :aria-label="message('imageFit')"
    >
      <button
        v-for="value in FITS"
        :key="value"
        type="button"
        role="radio"
        class="slides-image-editing__fit-option"
        :class="{ 'slides-image-editing__fit-option--active': fit === value }"
        :aria-checked="fit === value"
        :disabled="busy"
        :data-fit="value"
        @click="setFit(value)"
      >
        {{ message(value) }}
      </button>
    </div>
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
const FITS = ['contain', 'cover'] as const;
const input = ref<HTMLInputElement | null>(null);
const { target, fit, busy, message, setFit, replaceFile } = useImageEditing();
function replaceImage(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0]; event.target.value = '';
  if (file) void replaceFile(file);
}
</script>
