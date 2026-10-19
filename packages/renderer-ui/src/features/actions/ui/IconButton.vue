<!-- packages/renderer-ui/src/features/actions/ui/IconButton.vue -->
<template>
  <button
    ref="buttonRef"
    :type="type"
    :disabled="disabled"
    :class="classes"
    :aria-label="label"
    :title="tooltip ? label : undefined"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { IconButtonProps, IconButtonSlots } from '../definitions/iconButton';

const props = withDefaults(defineProps<IconButtonProps>(), {
  size: 'sm',
  variant: 'ghost',
  tone: 'neutral',
  active: false,
  disabled: false,
  tooltip: true,
  type: 'button',
});

defineSlots<IconButtonSlots>();
const buttonRef = ref<HTMLButtonElement | null>(null);
defineExpose({ element: buttonRef });

const classes = computed<readonly string[]>(() => [
  'linnya-ui-icon-button',
  `linnya-ui-icon-button--${props.size}`,
  `linnya-ui-icon-button--${props.variant}`,
  ...(props.tone === 'danger' ? ['linnya-ui-icon-button--danger'] : []),
  ...(props.active ? ['linnya-ui-icon-button--active'] : []),
]);
</script>
