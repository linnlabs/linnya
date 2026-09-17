<template>
  <div
    ref="host"
    class="slides-inline-text-editor slides-rich-text-editor"
    :style="editorStyle"
    @pointerdown.stop
  />
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import type { SlidesEditableTextContent, SlidesTextStylePatch } from '@plugin/slides/shared/authoringEditing';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import type { InlineTextSelection } from '../definitions/richTextEditor';
import { createInlineTextEditorStyle } from '../functions/createInlineTextEditorStyle';
import { createRichTextEditor } from '../orchestration/createRichTextEditor';
const props = defineProps<{ target: TextEditingTarget; modelValue: SlidesEditableTextContent; slideLeft: number; slideTop: number;
  renderScale: number; label: string; toolbarElement?: HTMLElement | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: SlidesEditableTextContent]; commit: []; 'composition-start': []; 'composition-end': [];
  escape: [event: KeyboardEvent]; 'commit-shortcut': [event: KeyboardEvent]; selection: [selection: InlineTextSelection | null] }>();
const host = ref<HTMLElement | null>(null);
const editorStyle = computed(() => createInlineTextEditorStyle(props.target, props));
let editor: ReturnType<typeof createRichTextEditor> | undefined;
function owns(target: EventTarget | null): boolean {
  return target instanceof Node && (host.value?.contains(target) === true || props.toolbarElement?.contains(target) === true);
}
function outsidePointer(event: PointerEvent): void {
  if (owns(event.target)) return;
  // 数字字段的 change 必须先应用到原选区，再把本次完整正文交给保存队列。
  const active = document.activeElement;
  if (active instanceof HTMLElement && props.toolbarElement?.contains(active)) active.blur();
  emit('commit');
}
function outsideFocus(event: FocusEvent): void { if (!owns(event.target)) emit('commit'); }
function refresh(): void { editor?.refresh(); }
onMounted(() => {
  if (!host.value) return;
  editor = createRichTextEditor({ element: host.value, content: props.modelValue, target: () => props.target, label: props.label,
    update: value => emit('update:modelValue', value), selection: value => emit('selection', value),
    compositionStart: () => emit('composition-start'), compositionEnd: () => emit('composition-end'),
    escape: event => emit('escape', event), commit: event => emit('commit-shortcut', event) });
  document.addEventListener('pointerdown', outsidePointer, true);
  document.addEventListener('focusin', outsideFocus);
  document.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);
});
watch(editorStyle, refresh, { flush: 'post' });
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsidePointer, true);
  document.removeEventListener('focusin', outsideFocus);
  document.removeEventListener('scroll', refresh, true);
  window.removeEventListener('resize', refresh);
  editor?.destroy();
});
defineExpose({ applyStyle: (patch: SlidesTextStylePatch) => editor?.applyStyle(patch) });
</script>
