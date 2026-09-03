<template>
  <span
    ref="triggerRef"
    class="tooltip-trigger"
    @pointermove="handlePointerMove"
    @pointerleave="handlePointerLeave"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
  >
    <slot />
  </span>

  <Teleport to="body">
    <Transition name="tooltip-fade">
      <div
        v-if="visible"
        ref="tooltipRef"
        class="hover-tooltip"
        :style="tooltipStyle"
        role="tooltip"
      >
        {{ text }}
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { HoverTooltipProps } from '../definitions/hoverTooltip';
import { resolveHoverTooltipPosition } from '../functions/hoverTooltipInteraction';
import { useHoverTooltipInteractionEnvironment } from '../vue/useHoverTooltipInteractionEnvironment';

const props = withDefaults(defineProps<HoverTooltipProps>(), {
  placement: 'bottom',
  offset: 8,
  disabled: false,
});

const triggerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const positionTop = ref(0);
const positionLeft = ref(0);
const isPointerHovered = ref(false);
const isKeyboardFocused = ref(false);

const { inputModality, isWindowActive } = useHoverTooltipInteractionEnvironment();

const visible = computed(() => {
  if (props.disabled || !isWindowActive.value) return false;
  return (
    (inputModality.value === 'pointer' && isPointerHovered.value)
    || (inputModality.value === 'keyboard' && isKeyboardFocused.value)
  );
});

const tooltipStyle = computed(() => ({
  top: `${positionTop.value}px`,
  left: `${positionLeft.value}px`,
}));

function updateTooltipPosition(): void {
  const triggerElement = triggerRef.value;
  const tooltipElement = tooltipRef.value;
  if (triggerElement === null || tooltipElement === null) return;

  const position = resolveHoverTooltipPosition(
    triggerElement.getBoundingClientRect(),
    tooltipElement.getBoundingClientRect(),
    window.innerWidth,
    props.placement,
    props.offset,
  );
  positionTop.value = position.top;
  positionLeft.value = position.left;
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerType === 'touch') return;
  if (props.disabled || !isWindowActive.value || inputModality.value !== 'pointer') return;
  isPointerHovered.value = true;
}

function handlePointerLeave(): void {
  isPointerHovered.value = false;
}

function handleFocusIn(event: FocusEvent): void {
  if (props.disabled || !isWindowActive.value || inputModality.value !== 'keyboard') return;
  if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
  isKeyboardFocused.value = true;
}

function handleFocusOut(): void {
  isKeyboardFocused.value = false;
}

function handleViewportChange(): void {
  if (!visible.value) return;
  updateTooltipPosition();
}

watch(visible, async (nextVisible) => {
  if (nextVisible) {
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    await nextTick();
    if (visible.value) updateTooltipPosition();
    return;
  }

  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});

watch(isWindowActive, (active) => {
  if (active) return;
  isPointerHovered.value = false;
  isKeyboardFocused.value = false;
});

watch(inputModality, (modality) => {
  if (modality !== 'keyboard') isKeyboardFocused.value = false;
  if (modality !== 'pointer') isPointerHovered.value = false;
});

watch(() => props.disabled, (disabled) => {
  if (!disabled) return;
  isPointerHovered.value = false;
  isKeyboardFocused.value = false;
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});
</script>
