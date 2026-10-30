<template>
  <div
    v-if="ghost"
    class="slides-manual-text-width-ghost"
    :style="ghostStyle"
  >
    <span class="slides-manual-text-width-ghost__label">{{ ghost.w.toFixed(2) }} in</span>
  </div>
  <button
    v-for="handle in HANDLES"
    :key="handle"
    :data-text-width-handle="handle"
    type="button"
    tabindex="-1"
    class="slides-manual-resize-handle slides-manual-resize-handle--bar"
    :style="manualResizeHandleStyle(target, handle, props)"
    :aria-label="message('slides.manualEditing.resize.textWidth')"
    :title="message('slides.manualEditing.resize.textWidth')"
    @pointerdown.stop.prevent="gesture.down(handle, $event)"
    @pointermove.stop="gesture.move"
    @pointerup.stop="gesture.up"
    @pointercancel.stop="gesture.cancel"
    @lostpointercapture="gesture.cancel"
    @keydown.esc.stop.prevent="gesture.cancel"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../shared/constants';
import type { ManualEditableTarget, ManualEditIntent, ManualEditingVisualPreview } from '../definitions/manualEditingTypes';
import { manualResizeHandleStyle } from '../functions/manualResize';
import type { ManualTextWidthHandle } from '../definitions/manualTextWidth';
import { useManualTextWidthGesture } from '../orchestration/useManualTextWidthGesture';
import { useManualEditingLocalization } from './useManualEditingLocalization';
const props = defineProps<{ target: ManualEditableTarget; slideLeft: number; slideTop: number; renderScale: number }>();
const emit = defineEmits<{ preview: [value: ManualEditingVisualPreview | null]; submit: [intent: ManualEditIntent]; dragging: [active: boolean]; finish: [] }>();
const HANDLES: readonly ManualTextWidthHandle[] = ['left', 'right'];
const { manualEditingMessage: message } = useManualEditingLocalization();
const gesture = useManualTextWidthGesture({ readTarget: () => props.target, readScale: () => props.renderScale,
  preview: value => emit('preview', value), submit: intent => emit('submit', intent),
  dragging: active => emit('dragging', active), finish: () => emit('finish') });
const ghost = computed(() => gesture.result.value
  ? { ...gesture.result.value.bounds, y: props.target.bounds.y, h: props.target.bounds.h } : null);
const ghostStyle = computed(() => ghost.value ? {
  '--slides-resize-color': SLIDES_RENDER_COLORS.selectionStroke,
  left: `${props.slideLeft + ghost.value.x * INCHES_TO_PX * props.renderScale}px`,
  top: `${props.slideTop + ghost.value.y * INCHES_TO_PX * props.renderScale}px`,
  width: `${ghost.value.w * INCHES_TO_PX * props.renderScale}px`,
  height: `${ghost.value.h * INCHES_TO_PX * props.renderScale}px`,
} : {});
</script>
