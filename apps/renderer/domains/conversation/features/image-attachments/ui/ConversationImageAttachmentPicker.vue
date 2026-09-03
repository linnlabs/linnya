<template>
  <button
    v-if="showTrigger"
    type="button"
    class="conversation-image-attachment-picker"
    :disabled="disabled"
    :title="title"
    :aria-label="title"
    @click="openPicker"
  >
    <ImageIcon />
  </button>
  <input
    ref="inputRef"
    class="conversation-image-attachment-picker__input"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    multiple
    tabindex="-1"
    aria-hidden="true"
    @change="handleChange"
  >
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ImageIcon } from '@linnya/renderer-ui/icons';
import type { ConversationImageAttachmentPickerHandle } from '../definitions/conversationImageAttachmentPicker';

const props = withDefaults(defineProps<{
  readonly disabled: boolean;
  readonly title: string;
  readonly showTrigger?: boolean;
}>(), {
  showTrigger: true,
});

const emit = defineEmits<{
  filesSelected: [files: readonly File[]];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function openPicker(): void {
  if (!props.disabled) inputRef.value?.click();
}

defineExpose<ConversationImageAttachmentPickerHandle>({ openPicker });

function handleChange(event: Event): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length > 0) emit('filesSelected', files);
}
</script>
