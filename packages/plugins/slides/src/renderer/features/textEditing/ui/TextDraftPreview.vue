<template>
  <div
    class="slides-inline-text-editor slides-inline-text-editor--preview"
    :style="style"
    aria-hidden="true"
  >{{ content }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import { createInlineTextEditorStyle } from '../functions/createInlineTextEditorStyle';

const props = defineProps<{
  target: TextEditingTarget;
  content: string;
  slideLeft: number;
  slideTop: number;
  renderScale: number;
}>();
const style = computed(() => createInlineTextEditorStyle(props.target, props));
</script>
