<template>
  <div
    class="slides-inline-text-editor slides-inline-text-editor--preview"
    :style="style"
    aria-hidden="true"
  >
    <span
      v-for="(run, index) in runs"
      :key="index"
      :style="authorTextCss(run.style, target)"
    >{{ run.text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SlidesEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import { authorTextCss } from '../functions/authorTextCss';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import { createInlineTextEditorStyle } from '../functions/createInlineTextEditorStyle';

const props = defineProps<{
  target: TextEditingTarget;
  content: SlidesEditableTextContent;
  slideLeft: number;
  slideTop: number;
  renderScale: number;
}>();
const runs = computed(() => typeof props.content === 'string' ? [{ text: props.content, style: undefined }] : props.content);
const style = computed(() => createInlineTextEditorStyle(props.target, props));
</script>
