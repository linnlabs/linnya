<template>
  <div
    class="pane-divider"
    :class="`pane-divider--${side}`"
    :data-pane-divider-group="interactionGroup || undefined"
    :aria-hidden="interactive ? undefined : 'true'"
  >
    <div class="pane-divider__line" aria-hidden="true" />
    <div
      v-if="interactive"
      class="pane-divider__resize-hit-area"
      role="separator"
      aria-orientation="vertical"
      :aria-label="label"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="value"
      :title="label"
      tabindex="0"
      @pointerdown="emit('resize-start', $event)"
      @keydown="handleKeydown"
    />
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  side: 'left' | 'right';
  interactionGroup?: 'workspace-split';
  interactive?: boolean;
  label?: string;
  min?: number;
  max?: number;
  value?: number;
}>(), {
  interactive: false,
  interactionGroup: '',
  label: '',
  min: 0,
  max: 0,
  value: 0,
});

const emit = defineEmits<{
  'resize-start': [event: PointerEvent];
  'resize-to': [width: number];
}>();

const KEYBOARD_RESIZE_STEP = 16;

const handleKeydown = (event: KeyboardEvent) => {
  let width: number | null = null;
  // 左边界向左移会增大右 pane，右边界向右移会增大左 pane。
  const arrowDirection = props.side === 'left' ? 1 : -1;
  if (event.key === 'ArrowLeft') width = props.value + KEYBOARD_RESIZE_STEP * arrowDirection;
  if (event.key === 'ArrowRight') width = props.value - KEYBOARD_RESIZE_STEP * arrowDirection;
  if (event.key === 'Home') width = props.min;
  if (event.key === 'End') width = props.max;
  if (width === null) return;

  event.preventDefault();
  emit('resize-to', Math.min(props.max, Math.max(props.min, width)));
};
</script>
