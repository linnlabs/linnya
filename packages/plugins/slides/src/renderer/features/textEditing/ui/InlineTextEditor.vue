<template>
  <textarea
    ref="inputRef"
    class="slides-inline-text-editor"
    :style="editorStyle"
    :value="props.modelValue"
    :aria-label="props.label"
    @input="handleInput"
    @blur="emit('commit')"
    @pointerdown.stop
    @compositionstart="emit('composition-start')"
    @compositionend="handleCompositionEnd"
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

function handleCompositionEnd(event: CompositionEvent): void {
  // compositionend 的最终文本必须先交给会话，再处理之前的 blur 请求。
  handleInput(event);
  emit('composition-end');
}

function handleInput(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) {
    emit('update:modelValue', event.target.value);
  }
}
</script>
