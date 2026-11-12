<template>
  <InlineTextInput
    v-if="draft && style"
    :key="draft.id"
    class="canvas-section-title-input"
    variant="inline"
    :style="style"
    :model-value="draft.value"
    :placeholder="t('canvas.card.section')"
    :aria-label="t('canvas.section.titleInput')"
    @update:model-value="editing.state.update"
    @commit="commit"
    @cancel="cancel"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { InlineTextInput } from '@linnya/renderer-ui';
import {
  CANVAS_SECTION_PADDING,
  readCanvasSectionPalette,
  type CanvasCamera,
} from '@plugin/canvas/shared';
import { canvasText as t } from '../../localization';
import type { CanvasSectionEditing } from '../orchestration/createCanvasSectionEditing';

const props = defineProps<{
  editing: CanvasSectionEditing;
  camera: CanvasCamera;
  run: (action: () => Promise<unknown>) => Promise<void>;
}>();
const emit = defineEmits<{ 'focus-canvas': [] }>();
const draft = computed(() => props.editing.state.draft.value);
const css = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
/** 编辑框压在分区标题原位：同样的左内边距、字号随缩放，底色取分区染纸色盖住原标题。 */
const style = computed(() => {
  const value = draft.value,
    section = value ? props.editing.read(value.id) : undefined;
  if (!section) return null;
  const { zoom, x, y } = props.camera,
    palette = readCanvasSectionPalette(section.color, props.editing.readDark());
  return {
    left: `${(section.x + CANVAS_SECTION_PADDING - 4) * zoom + x}px`,
    top: `${(section.y + 10) * zoom + y}px`,
    width: `${Math.max(120, (section.width - CANVAS_SECTION_PADDING * 2 + 8) * zoom)}px`,
    height: `${28 * zoom}px`,
    fontSize: `${15 * zoom}px`,
    background: css(palette.fill),
    color: css(palette.title),
  };
});
function commit(value: string) {
  void props.run(() => props.editing.save(value));
  emit('focus-canvas');
}
function cancel() {
  props.editing.cancel();
  emit('focus-canvas');
}
</script>
