<template>
  <RichInlineTextEditor
    v-if="target.targetKind === 'text'"
    ref="richEditor"
    v-bind="props"
    @update:model-value="emit('update:modelValue', $event)"
    @commit="emit('commit')"
    @composition-start="emit('composition-start')"
    @composition-end="emit('composition-end')"
    @escape="emit('escape', $event)"
    @commit-shortcut="emit('commit-shortcut', $event)"
    @selection="emit('selection', $event)"
  />
  <PlainInlineTextEditor
    v-else
    :target="target"
    :slide-left="slideLeft"
    :slide-top="slideTop"
    :render-scale="renderScale"
    :label="label"
    :model-value="editableTextString(modelValue)"
    @update:model-value="emit('update:modelValue', $event)"
    @commit="emit('commit')"
    @composition-start="emit('composition-start')"
    @composition-end="emit('composition-end')"
    @escape="emit('escape', $event)"
    @commit-shortcut="emit('commit-shortcut', $event)"
  />
</template>
<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { editableTextString, type SlidesEditableTextContent, type SlidesTextStylePatch } from '@plugin/slides/shared/authoringEditing';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import type { InlineTextSelection } from '../definitions/richTextEditor';
import PlainInlineTextEditor from './PlainInlineTextEditor.vue';
const RichInlineTextEditor = defineAsyncComponent(() => import('./RichInlineTextEditor.vue'));
const props = defineProps<{ target: TextEditingTarget; modelValue: SlidesEditableTextContent; slideLeft: number; slideTop: number;
  renderScale: number; label: string; toolbarElement?: HTMLElement | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: SlidesEditableTextContent]; commit: []; 'composition-start': []; 'composition-end': [];
  escape: [event: KeyboardEvent]; 'commit-shortcut': [event: KeyboardEvent]; selection: [selection: InlineTextSelection | null] }>();
const richEditor = ref<InstanceType<typeof RichInlineTextEditor> | null>(null);
defineExpose({ applyStyle: (patch: SlidesTextStylePatch) => richEditor.value?.applyStyle(patch) });
</script>
