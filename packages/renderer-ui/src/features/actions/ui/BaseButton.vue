<!-- packages/renderer-ui/src/features/actions/ui/BaseButton.vue -->
<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <span v-if="$slots.icon" class="linnya-ui-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="linnya-ui-button__label">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';
import type { BaseButtonProps, BaseButtonSlots } from '../definitions/baseButton';

const props = withDefaults(defineProps<BaseButtonProps>(), {
  variant: 'secondary',
  tone: 'neutral',
  size: 'sm',
  shape: 'default',
  block: false,
  disabled: false,
  type: 'button',
});

defineSlots<BaseButtonSlots>();
const slots = useSlots();

const classes = computed<readonly string[]>(() => [
  'linnya-ui-button',
  `linnya-ui-button--${props.variant}`,
  `linnya-ui-button--${props.size}`,
  ...(props.variant === 'outline' ? [`linnya-ui-button--tone-${props.tone}`] : []),
  ...(props.shape === 'pill' ? ['linnya-ui-button--pill'] : []),
  ...(props.block ? ['linnya-ui-button--block'] : []),
  ...(slots.icon ? ['linnya-ui-button--with-icon'] : []),
]);
</script>
