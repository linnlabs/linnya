<template>
  <ToolbarGroup v-if="target?.targetKind === 'image'">
    <ToolbarButton
      :label="message('replaceImage')"
      :disabled="busy"
      @click="input?.click()"
    >
      {{ message('replaceImage') }}
    </ToolbarButton>
    <CustomSelect
      :model-value="null"
      :options="fitOptions"
      :placeholder="message('imageFit')"
      :disabled="busy"
      variant="minimal"
      :bordered="false"
      :trigger-aria-label="message('imageFit')"
      @update:model-value="setFit"
    />
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
import { computed, ref } from 'vue';
import { ToolbarButton, ToolbarGroup, CustomSelect } from '@linnya/renderer-ui';
import { useImageEditing } from '../orchestration/useImageEditing';
const input = ref<HTMLInputElement | null>(null);
const { target, busy, message, setFit, replaceFile } = useImageEditing();
const fitOptions = computed(() => [{ value: 'contain', label: message('contain') }, { value: 'cover', label: message('cover') }]);
function replaceImage(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0]; event.target.value = '';
  if (file) void replaceFile(file);
}
</script>
