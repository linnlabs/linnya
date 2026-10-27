<template>
  <FileEditorViewport class="markdown-file-editor">
    <EditorContent
      :editor="editor"
      class="text-file-editor-document"
    />
  </FileEditorViewport>
</template>
<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import { createMarkdownFileEditor } from '../functions/createMarkdownFileEditor';
import FileEditorViewport from './FileEditorViewport.vue';

const props = defineProps<{ modelValue: string; label: string; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [content: string] }>();
const session = createMarkdownFileEditor({
  content: props.modelValue, label: props.label, readonly: props.readonly ?? false,
  onChange: content => emit('update:modelValue', content),
});
const editor = shallowRef(session.editor);
watch(() => props.modelValue, content => session.replaceContent(content));
watch(() => props.readonly, readonly => editor.value.setEditable(!readonly, false));
watch(() => props.label, label => editor.value.view.dom.setAttribute('aria-label', label));
onBeforeUnmount(() => editor.value.destroy());
</script>
