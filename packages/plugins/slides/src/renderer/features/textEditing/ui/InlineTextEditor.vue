<template>
  <textarea
    ref="inputRef"
    class="slides-inline-text-editor"
    :style="editorStyle"
    :value="props.modelValue"
    :aria-label="props.label"
    :aria-busy="props.disabled"
    :disabled="props.disabled"
    @input="handleInput"
    @blur="emit('commit')"
    @pointerdown.stop
    @compositionstart="emit('composition-start')"
    @compositionend="emit('composition-end')"
    @keydown.esc="emit('escape', $event)"
    @keydown.ctrl.enter="emit('commit-shortcut', $event)"
    @keydown.meta.enter="emit('commit-shortcut', $event)"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import { createInlineTextEditorStyle } from '../functions/createInlineTextEditorStyle';

const props = defineProps<{
  target: TextEditingTarget;
  modelValue: string;
  slideLeft: number;
  slideTop: number;
  renderScale: number;
  label: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  commit: [];
  escape: [event: KeyboardEvent];
  'commit-shortcut': [event: KeyboardEvent];
  'composition-start': [];
  'composition-end': [];
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);
const editorStyle = computed(() => createInlineTextEditorStyle(props.target, {
  slideLeft: props.slideLeft,
  slideTop: props.slideTop,
  renderScale: props.renderScale,
}));

watch(
  () => props.target.elementId,
  async () => {
    await nextTick();
    const input = inputRef.value;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  },
  { immediate: true },
);

function handleInput(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) {
    emit('update:modelValue', event.target.value);
  }
}
</script>
