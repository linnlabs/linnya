<template>
  <DropdownPanel
    :show="Boolean(content)"
    class="canvas-line-label-preview"
    :style="style"
    role="region"
    aria-label="连线完整标签"
    tabindex="0"
    @pointerdown.stop
    @pointerenter="editing.labelPreview.enter()"
    @pointerleave="editing.labelPreview.leave()"
    @wheel.stop
    @keydown="keydown"
  >
    <p>{{ content?.label }}</p>
  </DropdownPanel>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { DropdownPanel } from '@linnya/renderer-ui';
import type { CanvasCamera } from '@plugin/canvas/shared';
import type { createCanvasConnectionEditing } from '../orchestration/createCanvasConnectionEditing';
import { canvasConnectionLabelStyle } from '../functions/canvasConnectionLabelStyle';
const props = defineProps<{
  editing: ReturnType<typeof createCanvasConnectionEditing>;
  camera: CanvasCamera;
  viewport: { readonly width: number; readonly height: number };
}>();
const emit = defineEmits<{ focusCanvas: [] }>();
const content = computed(() => props.editing.labelPreview.content.value);
const style = computed(() =>
  canvasConnectionLabelStyle(
    content.value ? props.editing.labelPoint(content.value.id) : null,
    props.camera,
    props.viewport
  )
);
const keydown = (event: KeyboardEvent) => {
  if (
    !event.isComposing &&
    (event.ctrlKey || event.metaKey) &&
    ['f', 'k'].includes(event.key.toLowerCase())
  )
    return;
  event.stopPropagation();
  if (!event.isComposing && event.key === 'Escape') {
    event.preventDefault();
    props.editing.labelPreview.dismiss();
    emit('focusCanvas');
  }
};
</script>
