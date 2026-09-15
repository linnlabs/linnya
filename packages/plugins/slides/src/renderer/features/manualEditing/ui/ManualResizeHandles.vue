<template>
  <button
    v-for="handle in handles"
    :key="handle"
    type="button"
    tabindex="-1"
    class="slides-manual-resize-handle"
    :style="manualResizeHandleStyle(target, handle, props)"
    :aria-label="message(`slides.manualEditing.resize.${handle}`)"
    :title="message(`slides.manualEditing.resize.${handle}`)"
    @pointerdown.stop.prevent="gesture.down(handle, $event)"
    @pointermove.stop="gesture.move"
    @pointerup.stop="gesture.up"
    @pointercancel.stop="gesture.cancel"
    @lostpointercapture="gesture.cancel"
    @keydown.esc.stop.prevent="gesture.cancel"
  />
</template>
<script setup lang="ts">
import type { ManualEditableTarget, ManualEditingVisualOperation, ManualEditingVisualPreview } from '../definitions/manualEditingTypes';
import { manualResizeHandleStyle } from '../functions/manualResize';
import { useManualResizeGesture } from '../orchestration/useManualResizeGesture';
import { useManualEditingLocalization } from './useManualEditingLocalization';
const props = defineProps<{
  target: ManualEditableTarget;
  slideLeft: number;
  slideTop: number;
  renderScale: number;
}>();
const emit = defineEmits<{
  preview: [value: ManualEditingVisualPreview | null];
  submit: [operation: ManualEditingVisualOperation];
  finish: [];
}>();
const handles = ['right', 'bottom', 'corner'] as const;
const { manualEditingMessage: message } = useManualEditingLocalization();
const gesture = useManualResizeGesture({
  readTarget: () => props.target,
  readScale: () => props.renderScale,
  preview: value => emit('preview', value),
  submit: operation => emit('submit', operation),
  finish: () => emit('finish'),
});
</script>
