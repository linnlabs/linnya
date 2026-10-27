<template>
  <EditorContent
    :editor="editor"
    class="text-file-editor"
  />
</template>
<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import { createTextFileEditor, textFileContent } from '../functions/createTextFileEditor';

const props = defineProps<{ modelValue: string; label: string; language?: string; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [content: string] }>();
const editor = shallowRef(createTextFileEditor({
  content: props.modelValue, label: props.label, readonly: props.readonly ?? false,
  language: props.language,
  onChange: content => emit('update:modelValue', content),
}));

watch(() => props.modelValue, content => {
  if (content !== editor.value.state.doc.textContent) {
    editor.value.commands.setContent(textFileContent(content, props.language), { emitUpdate: false });
  }
});
watch(() => props.readonly, readonly => editor.value.setEditable(!readonly, false));
watch(() => props.label, label => editor.value.view.dom.setAttribute('aria-label', label));
watch(() => props.language, language => editor.value.commands.updateAttributes('codeBlock', { language: language ?? 'plaintext' }));
onBeforeUnmount(() => editor.value.destroy());
</script>
