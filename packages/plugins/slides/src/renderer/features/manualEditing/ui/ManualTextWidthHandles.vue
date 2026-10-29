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
    @pointerdown.stop.prevent="down(handle, $event)"
    @pointermove.stop="move"
    @pointerup.stop="up"
    @pointercancel.stop="cancel"
    @lostpointercapture="cancel"
    @keydown.esc.stop.prevent="cancel"
  />
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';
import { INCHES_TO_PX } from '../../../shared/constants';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { manualResizeHandleStyle } from '../functions/manualResize';
import { resolveManualTextWidth, type ManualTextWidthHandle, type ManualTextWidthResult } from '../functions/manualTextWidth';
import { useManualEditingLocalization } from './useManualEditingLocalization';
const props = defineProps<{ target: ManualEditableTarget; slideLeft: number; slideTop: number; renderScale: number }>();
const emit = defineEmits<{ submit: [operation: SlidesManualEditCommandOperation]; dragging: [active: boolean]; finish: [] }>();
const HANDLES: readonly ManualTextWidthHandle[] = ['left', 'right'];
const { manualEditingMessage: message } = useManualEditingLocalization();
const result = shallowRef<ManualTextWidthResult | null>(null);
const ghost = computed(() => result.value?.bounds ?? null);
const ghostStyle = computed(() => ghost.value ? {
  left: `${props.slideLeft + ghost.value.x * INCHES_TO_PX * props.renderScale}px`,
  top: `${props.slideTop + ghost.value.y * INCHES_TO_PX * props.renderScale}px`,
  width: `${ghost.value.w * INCHES_TO_PX * props.renderScale}px`,
  height: `${ghost.value.h * INCHES_TO_PX * props.renderScale}px`,
} : {});
let session: { handle: ManualTextWidthHandle; pointerId: number; clientX: number; element: HTMLElement } | null = null;
function down(handle: ManualTextWidthHandle, event: PointerEvent): void {
  if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  session = { handle, pointerId: event.pointerId, clientX: event.clientX, element: event.currentTarget };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.focus({ preventScroll: true });
  emit('dragging', true);
}
function move(event: PointerEvent): void {
  if (!session || session.pointerId !== event.pointerId) return;
  result.value = resolveManualTextWidth(props.target, session.handle, event.clientX - session.clientX, props.renderScale);
}
function up(event: PointerEvent): void {
  if (!session || session.pointerId !== event.pointerId) return;
  move(event);
  const operation = result.value?.operation;
  if (operation) emit('submit', operation);
  cancel();
}
function cancel(): void {
  const previous = session;
  if (!previous) return;
  session = null;
  result.value = null;
  if (previous.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
  emit('dragging', false);
  emit('finish');
}
onBeforeUnmount(() => { if (session) cancel(); });
</script>
